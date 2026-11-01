import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildClaudeArgs, substitute, parseMcpResponse, mcpCall, setupScenario, resetEvalOrg, runClaude, runScenario, main, loadEvalEnv } from './run.mjs';

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
  assert.deepEqual(await setupScenario({ setup: 'with-open-question' }, options), { designDocNumber: 'DD-0001' });
  assert.deepEqual(await setupScenario({ setup: 'design-doc-with-spec-and-plan' }, options), { designDocNumber: 'DD-0002' });
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
    { designDocNumber: 'DD-0003', journalVariation: 'work-log' });
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
test('all nineteen scenario files have matching ids and use known tools and valid patterns', async () => {
  const dir = new URL('./scenarios/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 19);
  const tools = new Set(JSON.parse(await readFile(new URL('../tool-names.json', import.meta.url), 'utf8')).tools);
  for (const file of files) {
    const scenario = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.equal(file, `${scenario.id}.json`);
    assert.ok(scenario.prompt);
    assert.ok(['full', 'lean'].includes(scenario.org ?? 'full'));
    assert.ok(['none', 'design-doc-with-spec-and-plan', 'with-open-question', 'with-journal-entries', 'with-standing-adr', 'approved-plan', 'plan-file'].includes(scenario.setup ?? 'none'));
    const argExpectations = [...(scenario.expect.argMatches ?? []), ...(scenario.expect.argMustNotMatch ?? [])];
    for (const tool of [...(scenario.expect.mustCall ?? []), ...(scenario.expect.mustNotCall ?? []), ...(scenario.expect.order ?? []).flat(), ...argExpectations.map((item) => item.tool)]) {
      for (const alternative of tool.split('|')) assert.ok(tools.has(alternative), `${scenario.id}: ${alternative}`);
    }
    for (const { pattern } of argExpectations) assert.doesNotThrow(() => new RegExp(pattern));
    for (const pattern of [scenario.expect.finalTextMatches, scenario.expect.finalTextNotMatches]) {
      if (pattern !== undefined) assert.doesNotThrow(() => new RegExp(pattern, 'i'));
    }
  }
});
