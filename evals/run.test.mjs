import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildClaudeArgs, substitute, parseMcpResponse, mcpCall, setupScenario, runClaude, runScenario, main } from './run.mjs';

test('buildClaudeArgs includes required flags and plugin only with skills', () => {
  const required = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', 'C:/temp path/mcp.json', '--strict-mcp-config', '--allowedTools', 'mcp__archdocs-eval', 'Read'];
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
test('runScenario writes per-run config, grades JSONL, redacts PAT and cleans up', async (t) => {
  const dir = await temporary(t);
  let configPath;
  const grade = await runScenario({ id: 'fixture', prompt: 'Prompt', expect: { mustCall: ['create_adr'] } }, 'without', 1, dir, {
    env: { ARCHDOCS_EVAL_PAT: 'test-credential' }, tempRoot: dir,
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
      env: { ARCHDOCS_EVAL_PAT: 'test-credential' }, tempRoot: dir,
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
      env: { ARCHDOCS_EVAL_PAT: 'test-credential' }, tempRoot: dir, execute: async () => result,
    });
    assert.equal(grade.pass, false);
  }
});
test('main rejects invalid CLI options before any eval work', async () => {
  for (const args of [['--mode', 'bad'], ['--runs', '0'], ['--runs', '1.5'], ['--unknown'], ['--scenario']]) await assert.rejects(main(args));
});
test('all thirteen scenario files have matching ids and use known tools and valid patterns', async () => {
  const dir = new URL('./scenarios/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 13);
  const tools = new Set(JSON.parse(await readFile(new URL('../tool-names.json', import.meta.url), 'utf8')).tools);
  for (const file of files) {
    const scenario = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.equal(file, `${scenario.id}.json`);
    assert.ok(scenario.prompt);
    assert.ok(['full', 'lean'].includes(scenario.org ?? 'full'));
    assert.ok(['none', 'design-doc-with-spec-and-plan', 'with-open-question', 'approved-plan', 'plan-file'].includes(scenario.setup ?? 'none'));
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
