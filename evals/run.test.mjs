import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildClaudeArgs, substitute, parseMcpResponse, mcpCall, setupScenario, resetEvalOrg, runClaude, runScenario, main, loadEvalEnv, checkState } from './run.mjs';

const runEnv = {
  ARCHDOCS_EVAL_PAT: 'test-credential',
  ARCHDOCS_EVAL_PASSWORD_FULL: 'full-password', ARCHDOCS_EVAL_ORG_ID: 'full-org',
  ARCHDOCS_EVAL_PASSWORD_LEAN: 'lean-password', ARCHDOCS_EVAL_ORG_ID_LEAN: 'lean-org',
};
const emptyOrgFetch = async (url) => Response.json(url.endsWith('/auth/login') ? { token: 'jwt' }
  : url.endsWith('/adrs') ? { adrs: [] } : { designDocs: [], nextCursor: null });

test('resetEvalOrg logs in, pages all design doc statuses, and deletes every doc and ADR with org headers', async () => {
  const calls = [];
  const statuses = ['DRAFT', 'IN_PROGRESS', 'SHIPPED', 'ABANDONED', 'SUPERSEDED'];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname + new URL(url).search;
    calls.push([options.method, route]);
    assert.equal(options.redirect, 'error');
    if (route === '/auth/login') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { email: 'eval@example.test', password: 'secret-password' });
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ token: 'secret-jwt' });
    }
    assert.equal(options.headers.Authorization, 'Bearer secret-jwt');
    assert.equal(options.headers['x-organization-id'], 'eval-org');
    if (options.method === 'DELETE') {
      assert.deepEqual(JSON.parse(options.body), {});
      return Response.json({ id: 'deleted' });
    }
    if (route === '/adrs') return Response.json({ adrs: [{ id: 'adr-one' }, { id: 'adr-two' }] });
    const secondPage = route === '/design-docs?cursor=25';
    assert.ok(secondPage || route === '/design-docs');
    return Response.json({
      designDocs: statuses.slice(secondPage ? 3 : 0, secondPage ? 5 : 3).map((status) => ({ id: `doc-${status}`, status })),
      nextCursor: secondPage ? null : 25,
    });
  };
  assert.deepEqual(await resetEvalOrg({ api: 'http://localhost:4500/', email: 'eval@example.test', password: 'secret-password', orgId: 'eval-org', fetchImpl }),
    { designDocsDeleted: 5, adrsDeleted: 2 });
  assert.deepEqual(calls, [
    ['POST', '/auth/login'], ['GET', '/design-docs'], ['GET', '/design-docs?cursor=25'],
    ...statuses.map((status) => ['DELETE', `/design-docs/doc-${status}`]),
    ['GET', '/adrs'], ['DELETE', '/adrs/adr-one'], ['DELETE', '/adrs/adr-two'],
  ]);
});

test('resetEvalOrg reports HTTP, transport and JSON failures without secrets or response bodies', async () => {
  const options = { api: 'http://localhost:4500', email: 'eval@example.test', password: 'secret-password', orgId: 'eval-org' };
  for (const stage of ['/auth/login', '/design-docs', '/design-docs/doc', '/adrs', '/adrs/adr']) {
    for (const failure of ['http', 'transport', 'json']) {
      const fetchImpl = async (url) => {
        const route = new URL(url).pathname;
        if (route === stage) {
          if (failure === 'transport') throw new Error('secret-password secret-jwt transport details');
          return new Response('secret-password secret-jwt response details', { status: failure === 'http' ? 403 : 200 });
        }
        return Response.json(route === '/auth/login' ? { token: 'secret-jwt' }
          : route === '/design-docs' ? { designDocs: [{ id: 'doc' }], nextCursor: null }
          : route === '/adrs' ? { adrs: [{ id: 'adr' }] } : { id: 'deleted' });
      };
      await assert.rejects(resetEvalOrg({ ...options, fetchImpl }), (error) => {
        assert.match(error.message, /^Eval org reset failed: (POST|GET|DELETE) \//);
        assert.doesNotMatch(error.message, /secret-password|secret-jwt|details/);
        if (failure === 'http') assert.match(error.message, /HTTP 403/);
        return true;
      });
    }
  }
});

test('resetEvalOrg rejects missing JWTs, invalid lists and invalid or looping cursors', async () => {
  for (const reply of [null, {}, { designDocs: 'invalid', nextCursor: null },
    { designDocs: [{}], nextCursor: null }, { designDocs: [], nextCursor: 0 },
    { designDocs: [], nextCursor: 10 }, { designDocs: [], nextCursor: 'secret-password' }]) {
    await assert.rejects(resetEvalOrg({ api: 'http://localhost:4500', email: 'eval@example.test', password: 'secret-password', orgId: 'eval-org',
      fetchImpl: async (url) => Response.json(url.endsWith('/auth/login') && reply !== null ? { token: 'jwt' } : reply),
    }), /Eval org reset failed:/);
  }
  await assert.rejects(resetEvalOrg({ api: 'http://localhost:4500', email: 'eval@example.test', password: 'secret-password', orgId: 'eval-org',
    fetchImpl: async (url) => Response.json(url.endsWith('/auth/login') ? { token: 'jwt' }
      : url.endsWith('/adrs') ? { adrs: [{}] } : { designDocs: [], nextCursor: null }),
  }), /invalid ADR list/);
});

test('loadEvalEnv parses KEY=VALUE, ignores blank and comment lines, and preserves env values', async (t) => {
  const file = path.join(await temporary(t), '.eval-env');
  await writeFile(file, '\r\n# comment=ignored\r\n  # indented=ignored\r\nFIRST=one\r\nSECOND=two=three\r\n EXISTING = replaced\r\nEMPTY=replaced\r\nFIRST=duplicate\r\ninvalid line\r\n');
  const env = { EXISTING: 'original', EMPTY: '' };
  assert.equal(await loadEvalEnv({ file, env }), env);
  assert.deepEqual(env, { EXISTING: 'original', EMPTY: '', FIRST: 'one', SECOND: 'two=three' });
  assert.equal(await loadEvalEnv({ file: file + '.missing', env }), env);
});

test('buildClaudeArgs includes required flags and plugin only with skills', () => {
  const required = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', 'C:/temp path/mcp.json', '--strict-mcp-config', '--allowedTools', 'mcp__archdocs-eval', 'Read', '--setting-sources', 'project'];
  const options = { mcpConfigPath: 'C:/temp path/mcp.json', pluginDir: 'K:/plugin path' };
  assert.deepEqual(buildClaudeArgs({ ...options, mode: 'without' }), required);
  assert.deepEqual(buildClaudeArgs({ ...options, mode: 'with' }), [...required, '--plugin-dir', options.pluginDir]);
  assert.throws(() => buildClaudeArgs({ ...options, mode: 'both' }), /Invalid mode/);
});
test('buildClaudeArgs appends scenario tools after Read and rejects unsafe names', () => {
  const options = { mcpConfigPath: 'mcp.json', pluginDir: 'plugin', mode: 'without' };
  const args = buildClaudeArgs({ ...options, tools: ['Bash', 'Edit'] });
  const index = args.indexOf('--allowedTools');
  assert.deepEqual(args.slice(index, index + 5), ['--allowedTools', 'mcp__archdocs-eval', 'Read', 'Bash', 'Edit']);
  assert.deepEqual(args.slice(index + 5, index + 7), ['--setting-sources', 'project']);
  assert.throws(() => buildClaudeArgs({ ...options, tools: ['Bash(rm *)'] }), /tool name/);
});
test('checkState compares design doc, journal, thread and criteria state against expectations', async () => {
  const doc = {
    status: 'APPROVED',
    openQuestionCount: 1,
    variations: [{ typeKey: 'spec', state: 'READY' }, { typeKey: 'evidence', state: 'DRAFT' }, { typeKey: 'work-log', contentMode: 'JOURNAL' }],
  };
  const invoke = async (name, args) => {
    if (name === 'get_design_doc') return doc;
    if (name === 'list_journal_entries') return { entries: [{ number: 3, kind: 'handoff' }, { number: 2, kind: 'progress' }, { number: 1, kind: 'blocker' }], nextCursor: null, total: 3 };
    if (name === 'list_comment_threads') return [{ id: 't1', resolved: false }];
    if (name === 'get_verification_status') return { summary: { state: 'PARTIAL' }, criteria: [{ key: 'AC-1', outcome: 'SATISFIED' }, { key: 'AC-2', outcome: 'PENDING' }] };
    throw new Error(`unexpected ${name} ${JSON.stringify(args)}`);
  };
  const context = { invoke, designDocId: 'doc-1' };
  assert.deepEqual(await checkState({
    variationState: { spec: 'READY', evidence: 'DRAFT' }, designDocStatus: 'APPROVED', openQuestions: 1,
    journalKinds: ['progress', 'handoff'], journalLastKind: 'handoff', threadResolved: false,
    criteriaOutcomes: { 'AC-1': 'SATISFIED', 'AC-2': 'PENDING' },
  }, context), []);
  const failures = await checkState({
    variationState: { evidence: 'READY' }, designDocStatus: 'SHIPPED', openQuestions: 0,
    journalKinds: ['test'], journalLastKind: 'progress', threadResolved: true, criteriaOutcomes: { 'AC-2': 'SATISFIED' },
  }, context);
  assert.equal(failures.length, 7, failures.join('\n'));
  assert.match(failures[0], /evidence.*expected READY.*DRAFT/);
  assert.match(failures[1], /status.*expected SHIPPED.*APPROVED/);
  assert.match(failures[2], /open questions.*expected 0.*1/);
  assert.match(failures[3], /journal.*test/);
  assert.match(failures[4], /last journal entry.*expected progress.*handoff/);
  assert.match(failures[5], /thread.*resolved/);
  assert.match(failures[6], /AC-2.*expected SATISFIED.*PENDING/);
});
test('checkState reads the journal variation key from the doc and reports a missing journal or thread', async () => {
  const invoke = async (name) => {
    if (name === 'get_design_doc') return { status: 'DRAFT', openQuestionCount: 0, variations: [{ typeKey: 'spec', state: 'DRAFT' }] };
    if (name === 'list_comment_threads') return [];
    throw new Error(`unexpected ${name}`);
  };
  const failures = await checkState({ journalKinds: ['handoff'], threadResolved: true }, { invoke, designDocId: 'doc-1' });
  assert.equal(failures.length, 2, failures.join('\n'));
  assert.match(failures[0], /no journal/);
  assert.match(failures[1], /no comment thread/);
});
test('substitute replaces repeated variables and preserves Windows paths', () => {
  assert.equal(substitute('{{planFile}} {{n}} {{n}}', { planFile: 'C:\\temp dir\\plan.md', n: 0 }), 'C:\\temp dir\\plan.md 0 0');
});
test('substitute throws on unreplaced placeholders', () => {
  assert.throws(() => substitute('{{missing}}', {}), /Unreplaced.*missing/);
  assert.throws(() => substitute('{{x}}', { x: '{{other}}' }), /Unreplaced/);
});
const result = { content: [{ type: 'text', text: '{"id":"fixture"}' }] };
test('parseMcpResponse accepts a plain JSON-RPC body', () => {
  assert.deepEqual(parseMcpResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result })), result);
});
test('parseMcpResponse accepts SSE with data lines and notifications', () => {
  assert.deepEqual(parseMcpResponse(': ping\r\n\r\nevent: message\r\ndata: {"method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{}}\r\n\r\n'), {});
});
test('parseMcpResponse throws on JSON-RPC errors and missing results', () => {
  const error = JSON.stringify({ error: { code: -1, message: 'Denied' } });
  assert.throws(() => parseMcpResponse(error), /-1.*Denied/);
  assert.throws(() => parseMcpResponse(`data: ${error}\n\n`), /Denied/);
  assert.throws(() => parseMcpResponse('data: {"method":"notification"}\n\n'), /no JSON-RPC result/);
  assert.throws(() => parseMcpResponse('invalid'), /no JSON-RPC result/);
});
test('mcpCall sends tools/call headers and parses first text content', async (t) => {
  t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
    assert.equal(endpoint, 'https://mcp.archdocs.io/mcp');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer test-credential' });
    assert.deepEqual(JSON.parse(options.body), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_design_doc', arguments: { title: 'Fixture' } } });
    return new Response(JSON.stringify({ result: { content: [{ type: 'image' }, ...result.content] } }));
  });
  assert.deepEqual(await mcpCall('https://mcp.archdocs.io/mcp', 'test-credential', 'create_design_doc', { title: 'Fixture' }), { id: 'fixture' });
});
test('mcpCall handles SSE, plain text, HTTP errors and tool errors without leaking credentials', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('data: {"result":{"content":[{"type":"text","text":"plain"}]}}\n\n'));
  assert.equal(await mcpCall('endpoint', 'test-credential', 'tool', {}), 'plain');
  mock.mock.mockImplementation(async () => new Response('', { status: 403 }));
  await assert.rejects(mcpCall('endpoint', 'test-credential', 'tool', {}), /HTTP 403/);
  mock.mock.mockImplementation(async () => new Response(JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: 'test-credential rejected' }] } })));
  await assert.rejects(mcpCall('endpoint', 'test-credential', 'tool', {}), (error) => !error.message.includes('test-credential') && error.message.includes('[REDACTED]'));
});

async function temporary(t) {
  const dir = await mkdtemp(path.join(process.cwd(), '.eval-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test('setup creates fresh spec and plan with briefs, ready states and open question', async (t) => {
  const calls = [];
  let count = 0;
  const call = async (endpoint, pat, name, args) => {
    calls.push({ name, args });
    if (name === 'list_design_doc_types') return { features: { approvals: true }, types: ['spec', 'plan'].map((key) => ({ key, enabled: true, approvalFor: [], briefFields: [{ key: 'summary', computed: false }, { key: 'openQuestions', computed: true }] })) };
    if (name === 'create_design_doc') return { id: `id-${++count}`, displayNumber: `DD-000${count}` };
    return {};
  };
  const options = { endpoint: 'endpoint', pat: 'test-credential', tempDir: await temporary(t), call };
  assert.deepEqual(await setupScenario({ setup: 'with-open-question' }, options), { designDocNumber: 'DD-0001', designDocId: 'id-1' });
  assert.deepEqual(await setupScenario({ setup: 'design-doc-with-spec-and-plan' }, options), { designDocNumber: 'DD-0002', designDocId: 'id-2' });
  const writes = calls.filter((call) => call.name === 'write_design_doc_variation');
  assert.equal(writes.length, 4);
  for (const { args } of writes) {
    assert.equal(Object.hasOwn(args, 'baseVersion'), false);
    assert.ok(args.content && args.brief.summary);
    assert.equal(Object.hasOwn(args.brief, 'openQuestions'), false);
  }
  assert.equal(calls.filter((call) => call.name === 'mark_variation_ready').length, 4);
  assert.deepEqual(calls.find((call) => call.name === 'add_design_doc_question').args, {
    designDocId: 'id-1', text: 'Twilio or MessageBird for SMS?', context: 'The SMS provider has not been decided.', variation: 'spec', options: [{ label: 'Twilio' }, { label: 'MessageBird' }],
  });
});
test('approved-plan requires human approval or accepts an explicit doc number without creating a doc', async () => {
  await assert.rejects(setupScenario({ setup: 'approved-plan' }, { env: {} }), /needs a human approval step/);
  assert.deepEqual(await setupScenario({ setup: 'approved-plan' }, { env: { ARCHDOCS_EVAL_APPROVED_DD: 'DD-0004' } }), { designDocNumber: 'DD-0004' });
  await assert.rejects(setupScenario({ setup: 'approved-plan' }, { env: { ARCHDOCS_EVAL_APPROVED_DD: 'bad' } }), /DD-0004/);
});
test('setup respects approval feature and size rules without sending baseVersion', async () => {
  for (const approvals of [false, true]) {
    const calls = [];
    await setupScenario({ setup: 'design-doc-with-spec-and-plan' }, {
      call: async (endpoint, pat, name, args) => {
        calls.push({ name, args });
        if (name === 'list_design_doc_types') return { features: { approvals }, types: ['spec', 'plan'].map((key) => ({ key, enabled: true, approvalFor: ['STANDARD'], briefFields: [] })) };
        if (name === 'create_design_doc') return { id: 'fixture', displayNumber: 'DD-0001' };
        return {};
      },
    });
    assert.ok(calls.filter((call) => call.name === 'write_design_doc_variation').every((call) => !Object.hasOwn(call.args, 'baseVersion')));
    assert.equal(calls.filter((call) => call.name === 'mark_variation_ready').length, 0);
    assert.equal(calls.filter((call) => call.name === 'request_design_doc_review').length, approvals ? 2 : 0);
  }
});
test('with-journal-entries setup adds entries and a handoff to the enabled journal, or fails clearly without one', async (t) => {
  const calls = [];
  const types = (journal) => ['spec', 'plan'].map((key) => ({ key, enabled: true, approvalFor: [], briefFields: [] }))
    .concat(journal ? [{ key: 'work-log', enabled: true, contentMode: 'JOURNAL', briefFields: [] }] : []);
  const call = (journal) => async (endpoint, pat, name, args) => {
    calls.push({ name, args });
    if (name === 'list_design_doc_types') return { features: { approvals: false }, types: types(journal) };
    if (name === 'create_design_doc') return { id: 'fixture', displayNumber: 'DD-0003' };
    return {};
  };
  const tempDir = await temporary(t);
  assert.deepEqual(await setupScenario({ setup: 'with-journal-entries' }, { endpoint: 'endpoint', pat: 'test-credential', tempDir, call: call(true) }),
    { designDocNumber: 'DD-0003', designDocId: 'fixture', journalVariation: 'work-log' });
  const entries = calls.filter((call) => call.name === 'add_journal_entry');
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.args.designDocId === 'fixture' && entry.args.variation === 'work-log' && entry.args.summary));
  assert.deepEqual(entries.map((entry) => entry.args.kind), ['progress', 'blocker', 'handoff']);
  assert.ok(entries[2].args.handoff.done && entries[2].args.handoff.blocked && entries[2].args.handoff.next);
  assert.equal(calls.filter((call) => call.name === 'write_design_doc_variation').every((call) => call.args.variation !== 'work-log'), true);
  await assert.rejects(setupScenario({ setup: 'with-journal-entries' }, { endpoint: 'endpoint', pat: 'test-credential', tempDir, call: call(false) }), /Journal type/);
});
test('with-standing-adr setup creates an accepted ADR and links it to the Delivery Worker over REST', async () => {
  const calls = [];
  const call = async (endpoint, pat, name, args) => {
    calls.push({ name, args });
    if (name === 'list_objects') return { objects: [{ id: 'seq', name: 'Sequencer' }, { id: 'worker', name: 'Delivery Worker' }] };
    if (name === 'create_adr') return { id: 'adr-1', title: args.title };
    return {};
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname;
    requests.push({ method: options.method, route, auth: options.headers.Authorization, org: options.headers['x-organization-id'], body: options.body });
    return Response.json(route === '/auth/login' ? { token: 'jwt' } : { links: [] });
  };
  const vars = await setupScenario({ setup: 'with-standing-adr', org: 'full' }, { endpoint: 'endpoint', pat: 'test-credential', env: runEnv, call, fetchImpl });
  assert.match(vars.adrTitle, /never synchronously/);
  assert.deepEqual(calls.map((call) => call.name), ['list_objects', 'create_adr']);
  const link = requests.find((request) => request.route === '/adrs/adr-1/links');
  assert.equal(link.method, 'PUT');
  assert.equal(link.auth, 'Bearer jwt');
  assert.equal(link.org, 'full-org');
  assert.deepEqual(JSON.parse(link.body), { links: [{ targetType: 'object', targetId: 'worker' }] });
  assert.equal(calls.some((call) => call.name === 'create_design_doc'), false);
});
// A fake MCP that answers the calls every doc fixture makes; `extra` answers the setup-specific ones.
function fixtureCall(calls, { journal = true, extra = () => undefined } = {}) {
  return async (endpoint, pat, name, args) => {
    calls.push({ name, args });
    const answer = extra(name, args);
    if (answer !== undefined) return answer;
    if (name === 'list_design_doc_types') {
      return { features: { approvals: true }, types: ['spec', 'plan'].map((key) => ({ key, enabled: true, approvalFor: [], briefFields: [] }))
        .concat(journal ? [{ key: 'work-log', enabled: true, contentMode: 'JOURNAL', briefFields: [] }] : []) };
    }
    if (name === 'create_design_doc') return { id: 'fixture', displayNumber: 'DD-0009' };
    return {};
  };
}
const base = { endpoint: 'endpoint', pat: 'test-credential', env: runEnv };
test('with-failing-test-repo writes a committed repo whose test fails on the formatting bug', async (t) => {
  const calls = [];
  const tempDir = await temporary(t);
  const vars = await setupScenario({ setup: 'with-failing-test-repo', org: 'full' }, { ...base, tempDir, call: fixtureCall(calls) });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture', repoDir: tempDir });
  assert.equal(JSON.parse(await readFile(path.join(tempDir, 'package.json'), 'utf8')).scripts.test, 'node --test');
  assert.match(await readFile(path.join(tempDir, 'test', 'sms.test.mjs'), 'utf8'), /\+15550100/);
  assert.match(await readFile(path.join(tempDir, 'src', 'sms.mjs'), 'utf8'), /export function formatRecipient/);
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync('git', ['log', '--format=%s'], { cwd: tempDir, encoding: 'utf8' }), /^feat: sms recipient formatting\s*$/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: tempDir, encoding: 'utf8' }).trim(), '');
});
test('with-review-thread opens an actionable reviewer thread on the spec', async (t) => {
  const calls = [];
  const vars = await setupScenario({ setup: 'with-review-thread', org: 'full' }, { ...base, tempDir: await temporary(t), call: fixtureCall(calls, { extra: (name) => (name === 'create_comment_thread' ? { id: 'thread-1' } : undefined) }) });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture', threadId: 'thread-1' });
  const thread = calls.find((call) => call.name === 'create_comment_thread').args;
  assert.equal(thread.designDocId, 'fixture');
  assert.equal(thread.anchorField, 'spec');
  assert.match(thread.content, /^Reviewer: .*rejects a number/);
});
test('with-stale-test-entry records a passing test at a commit before the handoff', async (t) => {
  const calls = [];
  const vars = await setupScenario({ setup: 'with-stale-test-entry', org: 'full' }, { ...base, tempDir: await temporary(t), call: fixtureCall(calls) });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture', journalVariation: 'work-log' });
  const kinds = calls.filter((call) => call.name === 'add_journal_entry').map((call) => call.args.kind);
  assert.deepEqual(kinds, ['progress', 'blocker', 'test', 'handoff']);
  const testEntry = calls.find((call) => call.args?.kind === 'test').args;
  assert.deepEqual(testEntry.references, [{ kind: 'COMMIT', repo: 'example/cadence', sha: '3f9c2d1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d' }]);
});
test('with-done-handoff leaves a handoff saying nothing is left in the plan', async (t) => {
  const calls = [];
  const vars = await setupScenario({ setup: 'with-done-handoff', org: 'full' }, { ...base, tempDir: await temporary(t), call: fixtureCall(calls) });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture', journalVariation: 'work-log' });
  const entries = calls.filter((call) => call.name === 'add_journal_entry').map((call) => call.args);
  assert.deepEqual(entries.map((entry) => entry.kind), ['progress', 'progress', 'test', 'deviation', 'handoff']);
  assert.match(entries[3].summary, /batched every 5 seconds/);
  assert.match(entries[4].handoff.done, /PR #42 merged/);
  assert.match(entries[4].handoff.next, /Nothing left in the plan/);
});
test('large-doc creates a LARGE doc with spec and plan and no readiness calls', async (t) => {
  const calls = [];
  const vars = await setupScenario({ setup: 'large-doc', org: 'full' }, { ...base, tempDir: await temporary(t), call: fixtureCall(calls) });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture' });
  assert.equal(calls.find((call) => call.name === 'create_design_doc').args.size, 'LARGE');
  assert.equal(calls.filter((call) => call.name === 'write_design_doc_variation').length, 2);
  assert.equal(calls.some((call) => ['mark_variation_ready', 'request_design_doc_review'].includes(call.name)), false);
});
test('with-authorized-criteria proposes an agent-permitted and a human-only attestation and authorizes them as the person', async (t) => {
  const calls = [];
  const requests = [];
  const { createHash } = await import('node:crypto');
  const fetchImpl = async (url, options) => {
    const route = new URL(url).pathname;
    requests.push({ method: options.method, route, auth: options.headers.Authorization, body: options.body });
    return Response.json(route === '/auth/login' ? { token: 'jwt' } : { id: 'baseline-1', version: 1, status: 'AUTHORIZED' });
  };
  const call = fixtureCall(calls, { extra: (name) => (name === 'propose_acceptance_criteria' ? { id: 'baseline-1', version: 1, status: 'DRAFT' } : undefined) });
  const tempDir = await temporary(t);
  const vars = await setupScenario({ setup: 'with-authorized-criteria', org: 'full' }, { ...base, tempDir, call, fetchImpl });
  assert.deepEqual(vars, { designDocNumber: 'DD-0009', designDocId: 'fixture', repoDir: tempDir });
  // The evidence scenario's checkout passes its own test.
  const { execFileSync } = await import('node:child_process');
  // A nested node --test skips itself when it inherits the parent runner's context.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assert.match(execFileSync('node', ['--test'], { cwd: tempDir, encoding: 'utf8', env }), /# fail 0/);
  const proposed = calls.find((call) => call.name === 'propose_acceptance_criteria').args;
  assert.equal(proposed.designDocId, 'fixture');
  const [agent, human] = proposed.criteria;
  assert.equal(agent.key, undefined);
  assert.equal(agent.title, 'Sequencer SMS unit tests pass');
  assert.equal(agent.requirement.kind, 'attest');
  assert.equal(agent.requirement.by, 'HUMAN_OR_AGENT');
  assert.equal(agent.requirement.statementHash, createHash('sha256').update(agent.requirement.statement).digest('hex'));
  assert.equal(human.key, undefined);
  assert.equal(human.title, 'Product owner confirmed the SMS copy');
  assert.equal(human.requirement.by, 'HUMAN');
  const authorize = requests.find((request) => request.route === '/design-docs/fixture/criteria/baselines/baseline-1/authorize');
  assert.equal(authorize.method, 'POST');
  assert.equal(authorize.auth, 'Bearer jwt');
  assert.deepEqual(JSON.parse(authorize.body), { expectedVersion: 1 });
});
test('plan-file setup writes an importable plan', async (t) => {
  const vars = await setupScenario({ setup: 'plan-file' }, { tempDir: await temporary(t) });
  assert.match(await readFile(vars.planFile, 'utf8'), /Session Cache eviction change/);
});

function fakeSpawn(onSpawn) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let input = '';
    child.stdin.on('data', (chunk) => { input += chunk; });
    queueMicrotask(() => onSpawn({ child, command, args, options, input }));
    return child;
  };
}
test('runClaude sends prompt on stdin without a shell and retries Windows ENOENT only', async () => {
  const seen = [];
  const prompt = 'A "quoted" prompt with $ and \\ and\nnewlines';
  const spawnProcess = fakeSpawn(({ child, command, options, input }) => {
    seen.push(command);
    assert.equal(options.shell, false);
    assert.equal(input, prompt);
    if (command === 'claude') child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    else { child.stdout.end('test-credential'); child.emit('close', 0); }
  });
  const result = await runClaude(['-p'], prompt, { platform: 'win32', spawnProcess, secrets: ['test-credential'] });
  assert.deepEqual(seen, ['claude', 'claude.exe']);
  assert.equal(result.stdout, '[REDACTED]');
});
test('runClaude does not retry other spawn failures or non-Windows ENOENT', async () => {
  for (const [platform, code] of [['win32', 'EACCES'], ['linux', 'ENOENT']]) {
    let count = 0;
    await assert.rejects(runClaude([], '', { platform, spawnProcess: fakeSpawn(({ child }) => {
      count++; child.emit('error', Object.assign(new Error(code), { code }));
    }) }), new RegExp(code));
    assert.equal(count, 1);
  }
});
test('runScenario fails fast for missing org PAT', async () => {
  await assert.rejects(runScenario({ id: 'lean', org: 'lean' }, 'without', 1, '.', { env: {} }), /ARCHDOCS_EVAL_PAT_LEAN/);
});

test('runScenario resets the selected org before setup on every run, with API override or endpoint fallback', async (t) => {
  const dir = await temporary(t);
  for (const org of ['full', 'lean']) {
    const order = [];
    for (let n = 1; n <= 2; n++) {
      const env = { ...runEnv, ARCHDOCS_EVAL_PAT_LEAN: 'lean-pat', ARCHDOCS_EVAL_ENDPOINT: 'http://localhost:4500/mcp',
        ...(org === 'lean' ? { ARCHDOCS_EVAL_API: 'http://localhost:4600' } : {}) };
      await runScenario({ id: org, org, setup: 'design-doc-with-spec-and-plan', prompt: '{{designDocNumber}}', expect: {} }, 'without', n, dir, {
        env, tempRoot: dir,
        fetchImpl: async (url, options) => {
          assert.equal(new URL(url).origin, org === 'lean' ? 'http://localhost:4600' : 'http://localhost:4500');
          if (url.endsWith('/auth/login')) {
            order.push('login');
            assert.deepEqual(JSON.parse(options.body), { email: `eval-${org}@archdocs.test`, password: `${org}-password` });
          } else {
            assert.equal(options.headers['x-organization-id'], `${org}-org`);
            order.push(url.endsWith('/adrs') ? 'adrs' : 'design-docs');
          }
          return emptyOrgFetch(url);
        },
        call: async (endpoint, pat, name) => {
          if (name === 'list_design_doc_types') {
            order.push('setup');
            return { types: ['spec', 'plan'].map((key) => ({ key, enabled: true, briefFields: [] })) };
          }
          if (name === 'create_design_doc') return { id: 'fixture', displayNumber: 'DD-0001' };
        },
        execute: async () => { order.push('execute'); return { code: 0, stdout: '{"type":"result"}', stderr: '' }; },
      });
    }
    assert.deepEqual(order, Array(2).fill(['login', 'design-docs', 'adrs', 'setup', 'execute']).flat());
  }
});

test('runScenario stops before setup and execution on reset failure and cleans up', async (t) => {
  const dir = await temporary(t);
  await assert.rejects(runScenario({ id: 'fixture', setup: 'design-doc-with-spec-and-plan' }, 'without', 1, dir, {
    env: runEnv, tempRoot: dir,
    fetchImpl: async () => { throw new Error('full-password test-credential'); },
    call: async () => assert.fail('setup must not run'), execute: async () => assert.fail('Claude must not run'),
  }), /^Error: Eval org reset failed: POST \/auth\/login failed to reach the API\.$/);
  assert.deepEqual(await readdir(dir), []);
});

test('runScenario requires reset credentials and redacts both passwords from later errors', async (t) => {
  const dir = await temporary(t);
  for (const key of ['ARCHDOCS_EVAL_PASSWORD_FULL', 'ARCHDOCS_EVAL_ORG_ID']) {
    await assert.rejects(runScenario({ id: 'fixture' }, 'without', 1, dir, {
      env: { ...runEnv, [key]: '' }, tempRoot: dir, fetchImpl: async () => assert.fail('must validate before fetching'),
    }), new RegExp(key));
  }
  await assert.rejects(runScenario({ id: 'fixture', prompt: '', expect: {} }, 'without', 1, dir, {
    env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch,
    execute: async () => { throw new Error('full-password lean-password test-credential'); },
  }), { message: '[REDACTED] [REDACTED] [REDACTED]' });
});

test('runScenario fails the manual approved-plan fixture clearly after reset without starting Claude', async (t) => {
  const dir = await temporary(t);
  await assert.rejects(runScenario({ id: 'fixture', setup: 'approved-plan' }, 'without', 1, dir, {
    env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch,
    execute: async () => assert.fail('Claude must not run with a deleted fixture'),
  }), /human approval of a fresh fixture after the per-run reset/);
});
test('runScenario writes per-run config, grades JSONL, redacts PAT and cleans up', async (t) => {
  const dir = await temporary(t);
  let configPath;
  const grade = await runScenario({ id: 'fixture', prompt: 'Prompt', expect: { mustCall: ['create_adr'] } }, 'without', 1, dir, {
    env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch,
    execute: async (args, prompt, { cwd }) => {
      assert.equal(prompt, 'Prompt');
      configPath = args[args.indexOf('--mcp-config') + 1];
      assert.equal(path.dirname(configPath), cwd);
      assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { mcpServers: { 'archdocs-eval': { type: 'http', url: 'http://localhost:3000/mcp', headers: { Authorization: 'Bearer test-credential' } } } });
      return { code: 0, stderr: '', stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__archdocs-eval__create_adr', input: { title: 'test-credential' } }] } }) + '\n{"type":"result","subtype":"success"}\n' };
    },
  });
  assert.equal(grade.pass, true);
  await assert.rejects(readFile(configPath), /ENOENT/);
  assert.doesNotMatch(await readFile(path.join(dir, 'fixture.without.1.jsonl'), 'utf8'), /test-credential/);
});
test('runScenario grants scenario tools and appends server-state failures after grading', async (t) => {
  const dir = await temporary(t);
  const scenario = {
    id: 'fixture', org: 'full', setup: 'design-doc-with-spec-and-plan', tools: ['Bash', 'Edit'], prompt: 'Work on {{designDocNumber}}',
    expect: { mustCall: ['add_journal_entry'], state: { variationState: { evidence: 'READY' } } },
  };
  const call = async (endpoint, pat, name) => {
    if (name === 'list_design_doc_types') return { features: { approvals: false }, types: ['spec', 'plan'].map((key) => ({ key, enabled: true, approvalFor: [], briefFields: [] })) };
    if (name === 'create_design_doc') return { id: 'doc-7', displayNumber: 'DD-0007' };
    if (name === 'get_design_doc') return { status: 'DRAFT', openQuestionCount: 0, variations: [{ typeKey: 'evidence', state: 'DRAFT' }] };
    return {};
  };
  const grade = await runScenario(scenario, 'without', 1, dir, {
    env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch, call,
    execute: async (args, prompt) => {
      assert.equal(prompt, 'Work on DD-0007');
      const index = args.indexOf('--allowedTools');
      assert.deepEqual(args.slice(index + 1, index + 5), ['mcp__archdocs-eval', 'Read', 'Bash', 'Edit']);
      return { code: 0, stderr: '', stdout: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__archdocs-eval__add_journal_entry', input: {} }] } }) + '\n{"type":"result","subtype":"success"}\n' };
    },
  });
  assert.equal(grade.pass, false);
  assert.deepEqual(grade.failures, ['State: variation evidence expected READY, got DRAFT']);
});
test('runScenario cleans up after setup or execution failure', async (t) => {
  const dir = await temporary(t);
  for (const setup of ['none', 'design-doc-with-spec-and-plan']) {
    await assert.rejects(runScenario({ id: 'fixture', setup, prompt: '', expect: {} }, 'without', 1, dir, {
      env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch,
      call: async () => { throw new Error('setup test-credential'); },
      execute: async () => { throw new Error('execute test-credential'); },
    }), (error) => error.message.includes('[REDACTED]') && !error.message.includes('test-credential'));
    assert.deepEqual(await readdir(dir), []);
  }
});
test('runScenario fails incomplete, malformed or unsuccessful transcripts even for negative-only expectations', async (t) => {
  const dir = await temporary(t);
  for (const result of [
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: 'invalid\n{"type":"result"}', stderr: '' },
    { code: 0, stdout: '{"type":"result","is_error":true}', stderr: '' },
    { code: 1, stdout: '{"type":"result"}', stderr: 'failure' },
  ]) {
    const grade = await runScenario({ id: 'fixture', prompt: '', expect: { mustNotCall: ['create_design_doc'] } }, 'without', 1, dir, {
      env: runEnv, tempRoot: dir, fetchImpl: emptyOrgFetch, execute: async () => result,
    });
    assert.equal(grade.pass, false);
  }
});
test('main rejects invalid CLI options before any eval work', async () => {
  for (const args of [['--mode', 'bad'], ['--runs', '0'], ['--runs', '1.5'], ['--unknown'], ['--scenario']]) await assert.rejects(main(args));
});
test('all twenty-seven scenario files have matching ids and use known tools and valid patterns', async () => {
  const dir = new URL('./scenarios/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 27);
  const tools = new Set(JSON.parse(await readFile(new URL('../tool-names.json', import.meta.url), 'utf8')).tools);
  for (const file of files) {
    const scenario = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.equal(file, `${scenario.id}.json`);
    assert.ok(scenario.prompt);
    assert.ok(['full', 'lean'].includes(scenario.org ?? 'full'));
    assert.ok(['none', 'design-doc-with-spec-and-plan', 'with-open-question', 'with-journal-entries', 'with-standing-adr', 'approved-plan', 'plan-file',
      'with-failing-test-repo', 'with-review-thread', 'with-stale-test-entry', 'with-done-handoff', 'large-doc', 'with-authorized-criteria'].includes(scenario.setup ?? 'none'));
    // Scenario tools are Claude Code tools, not MCP tools; they are granted on top of Read.
    for (const tool of scenario.tools ?? []) assert.match(tool, /^[A-Za-z]+$/, `${scenario.id}: tool ${tool}`);
    const builtIn = new Set(scenario.tools ?? []);
    const argExpectations = [...(scenario.expect.argMatches ?? []), ...(scenario.expect.argMustNotMatch ?? []), ...(scenario.expect.expectFailure ?? []), ...(scenario.expect.resultMatches ?? [])];
    for (const tool of [...(scenario.expect.mustCall ?? []), ...(scenario.expect.mustNotCall ?? []), ...(scenario.expect.mustSucceed ?? []), ...(scenario.expect.mustNotFail ?? []), ...(scenario.expect.order ?? []).flat(), ...argExpectations.map((item) => item.tool)]) {
      for (const alternative of tool.split('|')) assert.ok(tools.has(alternative) || builtIn.has(alternative), `${scenario.id}: ${alternative}`);
    }
    for (const { pattern } of argExpectations) assert.doesNotThrow(() => new RegExp(pattern));
    for (const key of Object.keys(scenario.expect.state ?? {})) {
      assert.ok(['variationState', 'designDocStatus', 'openQuestions', 'journalKinds', 'journalLastKind', 'threadResolved', 'criteriaOutcomes'].includes(key), `${scenario.id}: state.${key}`);
    }
    for (const pattern of [scenario.expect.finalTextMatches, scenario.expect.finalTextNotMatches]) {
      if (pattern !== undefined) assert.doesNotThrow(() => new RegExp(pattern, 'i'));
    }
  }
});
