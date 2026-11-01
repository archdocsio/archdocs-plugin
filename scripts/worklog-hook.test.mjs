import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const commitText = 'Archdocs: you committed while working under a design doc. Before your next step, add a Work Log entry for this commit with add_journal_entry (kind progress, a COMMIT reference with the repository and full SHA, and what it covers), unless the journal\'s instructions say otherwise. Without a journal, post it in the plan\'s "Deviations from the plan" thread.';
const subagentText = 'Archdocs: a subagent returned while you\'re working under a design doc. Before your next step, record what it produced and what your review of it found with add_journal_entry, unless the journal\'s instructions say otherwise. A run, its review and its test results can share one entry.';
const stopText = (items) => `Archdocs: the design doc's Work Log is behind the work. Since its last entry: ${items}. Record them now with add_journal_entry (exact test results, commit references, what each run produced and what review found), unless the journal's instructions say otherwise. If none of this belongs on the design doc, say so and finish.`;
const output = (hookEventName, additionalContext) => ({ hookSpecificOutput: { hookEventName, additionalContext } });
const post = (tool_name, tool_input = {}, extra = {}) => ({
  hook_event_name: 'PostToolUse', session_id: 'session-1', tool_name, tool_input, ...extra,
});
const stop = (extra = {}) => ({ hook_event_name: 'Stop', session_id: 'session-1', ...extra });

function fixture(t) {
  // Keep every test artifact inside the requested worktree, including temp data.
  const root = fs.mkdtempSync(path.join(process.cwd(), '.worklog-test-'));
  const dirs = Object.fromEntries(['claude', 'plugin', 'tmp'].map((name) => [name, path.join(root, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dirs.claude, PLUGIN_DATA: dirs.plugin, TMPDIR: dirs.tmp };
  const run = (input, options = {}) => {
    const result = spawnSync('bash', options.launcher ? ['hooks/run-hook.cmd', 'worklog'] : ['hooks/worklog'], {
      cwd: process.cwd(), encoding: 'utf8', input: typeof input === 'string' ? input : JSON.stringify(input),
      env: { ...env, ...options.env }, timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout === '' ? null : JSON.parse(result.stdout);
  };
  const statePath = (key = 'session-1', dir = dirs.claude) => path.join(dir, 'worklog', `${key}.state`);
  const state = (key, dir) => fs.existsSync(statePath(key, dir)) ? fs.readFileSync(statePath(key, dir), 'utf8') : '';
  const activate = (extra = {}, options = {}) => {
    assert.equal(run(post('mcp__archdocs__get_design_doc', {}, extra), options), null);
  };
  return { root, dirs, env, run, statePath, state, activate };
}

test('inactive commits are silent and do not create state', (t) => {
  const f = fixture(t);
  assert.equal(f.run(post('Bash', { command: 'git commit -m x' })), null);
  assert.equal(fs.existsSync(f.statePath()), false);
  assert.deepEqual(fs.readdirSync(f.dirs.claude), []);
});

for (const name of ['mcp__archdocs__get_design_doc', 'mcp__plugin_archdocs_archdocs__get_design_doc',
  'mcp__archdocs__get_journal_handoff', 'mcp__archdocs__list_journal_entries',
  'mcp__archdocs__add_journal_entry', 'mcp__archdocs__create_design_doc',
  'mcp__archdocs__write_design_doc_variation', 'mcp__archdocs__import_plan_file']) {
  test(`design-doc tool activates: ${name}`, (t) => {
    const f = fixture(t);
    assert.equal(f.run(post(name)), null);
    assert.equal(f.state(), 'active\n');
  });
}

test('bare design-doc tools and unrelated MCP tools do not activate', (t) => {
  const f = fixture(t);
  for (const name of ['get_design_doc', 'mcp__archdocs__search', 'create_comment_thread']) {
    assert.equal(f.run(post(name)), null);
    assert.equal(fs.existsSync(f.statePath()), false);
  }
});

test('commit produces the exact Claude Code reminder', (t) => {
  const f = fixture(t);
  f.activate();
  assert.deepEqual(f.run(post('Bash', { command: 'git commit -m x' })), output('PostToolUse', commitText));
  assert.equal(f.state(), 'active\npending commit git commit -m x\n');
});

const commitMatches = [
  'git commit -m "x"', "git commit -am 'fix'", 'git -C /some/path commit -m x',
  'git -c user.name=A commit --amend --no-edit', 'cd repo && git commit -m "a && b"',
  'git add -A; git commit -m x',
  'git --git-dir=.git --work-tree=. --no-pager commit -m x',
  'VAR=value /usr/bin/GIT.exe commit -m x', 'VAR= git commit -m x', '(git commit -m x)', '{ git commit -m x; }',
  'echo ready || git commit -m x', 'echo ready | git commit -m x', 'echo ready & git commit -m x',
  'echo ready\ngit commit -m x', 'git commit -m a; git commit -m b',
];
const commitMisses = [
  'git log --oneline', 'git commit-tree abc', 'echo "git commit"', 'git show HEAD',
  'git status', 'ls commit', 'grep -r "git commit" .',
];
for (const [matches, commands] of [[true, commitMatches], [false, commitMisses]]) {
  for (const command of commands) {
    test(`commit ${matches ? 'match' : 'non-match'}: ${command}`, (t) => {
      const f = fixture(t);
      f.activate();
      const result = f.run(post('Bash', { command }));
      assert.equal(f.state().split('\n').filter((line) => line.startsWith('pending commit ')).length, matches ? 1 : 0);
      assert.deepEqual(result, matches ? output('PostToolUse', commitText) : null);
    });
  }
}

const testMatches = [
  'pnpm test', 'pnpm --filter api test', 'pnpm -r test', 'npm test', 'npm run test',
  'yarn test', 'bun test', 'pnpm test:unit', 'npx jest src/mcp', 'npx vitest run',
  'jest --runInBand', 'vitest', 'pytest -q', 'python -m pytest tests', 'go test ./...',
  'cargo test', 'mvn -q test', './gradlew test', 'gradle test', 'dotnet test',
  'bundle exec rspec', 'rspec spec/x_spec.rb', 'vendor/bin/phpunit', 'node --test',
  'cd api && npx jest', 'make test', 'npx playwright test',
  'mocha', 'ava', 'playwright test', 'bunx vitest', 'pnpm exec jest', 'pnpm dlx jest',
  'yarn dlx jest', 'uv run pytest', 'poetry run pytest', 'pipenv run pytest',
  'python3 -m pytest', 'py -m pytest', 'deno test', 'swift test', 'mix test',
  'make check', 'gradle api:test', 'tsx --test spec.ts', 'CI=1 ENV=test /usr/bin/jest.cmd',
  'pnpm exec npx vitest', 'npm test; pytest -q',
];
const testMisses = [
  'ls tests/', 'cat test.txt', 'git commit -m "add test"', 'echo jest', 'grep -r pytest .',
  'mkdir test', 'pnpm install', 'npm run build', 'pnpm add test-utils', 'npx playwright install',
];
for (const [matches, commands] of [[true, testMatches], [false, testMisses]]) {
  for (const command of commands) {
    test(`test-run ${matches ? 'match' : 'non-match'}: ${command}`, (t) => {
      const f = fixture(t);
      f.activate();
      const result = f.run(post('Bash', { command }));
      assert.equal(f.state().split('\n').filter((line) => line.startsWith('pending test ')).length, matches ? 1 : 0);
      assert.deepEqual(result, command.startsWith('git commit') ? output('PostToolUse', commitText) : null);
    });
  }
}

test('PowerShell commit and a combined test/commit track one line per kind', (t) => {
  const f = fixture(t);
  f.activate();
  assert.deepEqual(f.run(post('PowerShell', { command: 'git add -A; git commit -m x' })), output('PostToolUse', commitText));
  assert.deepEqual(f.run(post('Bash', { command: 'npm test && git commit -m x' })), output('PostToolUse', commitText));
  assert.equal(f.state(), 'active\npending commit git add -A; git commit -m x\npending test npm test && git commit -m x\npending commit npm test && git commit -m x\n');
});

test('completed Agent and legacy Task record results; background launch is ignored', (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(f.run(post('Agent', { description: 'background' }, { tool_response: { status: 'async_launched' } })), null);
  assert.equal(f.state(), 'active\n');
  assert.deepEqual(f.run(post('Agent', { description: 'review implementation' }, { tool_response: { status: 'completed' } })), output('PostToolUse', subagentText));
  assert.deepEqual(f.run(post('Task')), output('PostToolUse', subagentText));
  assert.equal(f.state(), 'active\npending subagent review implementation\npending subagent subagent\n');
});

test('inside a subagent, checkpoints are recorded without a reminder', (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(f.run(post('Bash', { command: 'pnpm test && git commit -m x' }, { agent_id: 'a4d2c8f1e0b3a297', agent_type: 'general-purpose' })), null);
  assert.equal(f.state(), 'active\npending test pnpm test && git commit -m x\npending commit pnpm test && git commit -m x\n');
  assert.deepEqual(f.run(stop()), output('Stop', stopText('tests (pnpm test && git commit -m x); commit (pnpm test && git commit -m x)')));
});

test('ARCHDOCS_WORKLOG_HOOKS=off silences the hooks and leaves state alone', (t) => {
  const f = fixture(t);
  f.activate();
  for (const value of ['off', 'false', '0']) {
    assert.equal(f.run(post('Bash', { command: 'git commit -m x' }), { env: { ARCHDOCS_WORKLOG_HOOKS: value } }), null);
  }
  assert.equal(f.state(), 'active\n');
  assert.deepEqual(f.run(post('Bash', { command: 'git commit -m x' }), { env: { ARCHDOCS_WORKLOG_HOOKS: 'on' } }), output('PostToolUse', commitText));
});

// Unix runs "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" directly, so the files must keep their executable bit.
test('launcher and hook script are tracked as executable', () => {
  const result = spawnSync('git', ['ls-files', '-s', 'hooks/run-hook.cmd', 'hooks/worklog'], { encoding: 'utf8' });
  const modes = Object.fromEntries(result.stdout.trim().split('\n').filter(Boolean).map((line) => [line.split('\t')[1], line.split(' ')[0]]));
  assert.deepEqual(modes, { 'hooks/run-hook.cmd': '100755', 'hooks/worklog': '100755' });
});

for (const name of ['add_journal_entry', 'create_comment_thread', 'reply_to_comment_thread']) {
  test(`record tool clears checkpoints and reminder marker: ${name}`, (t) => {
    const f = fixture(t);
    f.activate();
    f.run(post('Bash', { command: 'git commit -m x' }));
    f.run(stop());
    assert.match(f.state(), /stop-reminded 1/);
    assert.equal(f.run(post(`mcp__plugin_archdocs_archdocs__${name}`)), null);
    assert.equal(f.state(), 'active\n');
    assert.equal(f.run(stop()), null);
  });
}

test('Stop lists checkpoints once and only newly added items on the next reminder', (t) => {
  const f = fixture(t);
  f.activate();
  f.run(post('Bash', { command: 'npm test' }));
  f.run(post('Agent', { description: 'review' }));
  f.run(post('Bash', { command: 'git commit -m first' }));
  assert.deepEqual(f.run(stop()), output('Stop', stopText('tests (npm test); subagent (review); commit (git commit -m first)')));
  assert.equal(f.run(stop()), null);
  f.run(post('Bash', { command: 'git commit -m second' }));
  assert.equal(f.run(stop({ stop_hook_active: true })), null);
  assert.deepEqual(f.run(stop()), output('Stop', stopText('commit (git commit -m second)')));
  assert.equal(f.state().split('\n').filter((line) => line.startsWith('stop-reminded ')).length, 1);
  assert.match(f.state(), /stop-reminded 4\n$/);
});

test('Stop is silent for inactive sessions and sessions with no checkpoints', (t) => {
  const f = fixture(t);
  assert.equal(f.run(stop()), null);
  f.activate();
  assert.equal(f.run(stop()), null);
});

test('Stop caps its list at five and reports the remaining count', (t) => {
  const f = fixture(t);
  f.activate();
  for (let i = 1; i <= 7; i++) f.run(post('Task', { description: `run ${i}` }));
  assert.deepEqual(f.run(stop()), output('Stop', stopText('subagent (run 1); subagent (run 2); subagent (run 3); subagent (run 4); subagent (run 5); and 2 more')));
  assert.equal(f.run(stop()), null);
});

test('Codex uses PostToolUse context, Stop blocking, and ignores spawn_agent', (t) => {
  const f = fixture(t);
  f.activate({ turn_id: 'turn-1' });
  assert.equal(f.run(post('spawn_agent', { description: 'not finished' }, { turn_id: 'turn-1' })), null);
  assert.equal(f.state(), 'active\n');
  assert.deepEqual(f.run(post('Bash', { command: 'git commit -m x' }, { turn_id: 'turn-1' })), output('PostToolUse', commitText));
  assert.equal(f.run(stop({ turn_id: 'turn-1', stop_hook_active: true })), null);
  assert.deepEqual(f.run(stop({ turn_id: 'turn-1' })), { decision: 'block', reason: stopText('commit (git commit -m x)') });
});

test('Cursor conversation, Shell, Task, MCP record tools and loop guards', (t) => {
  const f = fixture(t);
  const cursor = { session_id: undefined, conversation_id: 'conversation-1', hook_event_name: 'postToolUse', cursor_version: '2.0' };
  assert.equal(f.run(post('MCP:get_design_doc', {}, cursor)), null);
  assert.deepEqual(f.run(post('Shell', { command: 'git commit -m x' }, cursor)), { additional_context: commitText });
  assert.deepEqual(f.run(post('Task', { description: 'cursor review' }, cursor)), { additional_context: subagentText });
  const cursorStop = { ...cursor, hook_event_name: 'stop', status: 'completed' };
  for (const extra of [{ loop_count: 1 }, { loop_count: 0.5 }, { status: 'aborted' }, { status: 'error' }, { status: '' }]) {
    assert.equal(f.run({ ...cursorStop, ...extra }), null);
  }
  assert.deepEqual(f.run({ ...cursorStop, loop_count: 0 }), {
    followup_message: stopText('commit (git commit -m x); subagent (cursor review)'),
  });
  assert.equal(f.run(post('MCP:add_journal_entry', {}, cursor)), null);
  assert.equal(f.state('conversation-1'), 'active\n');
  assert.equal(f.run(cursorStop), null);
});

test('Cursor detection works with lowercase events alone or a cursor_version key', (t) => {
  const f = fixture(t);
  f.activate();
  assert.deepEqual(f.run(post('Shell', { command: 'git commit -m x' }, { hook_event_name: 'postToolUse' })), { additional_context: commitText });
  assert.deepEqual(f.run(post('Shell', { command: 'git commit -m y' }, { cursor_version: '2', turn_id: 'turn-1' })), { additional_context: commitText });
  assert.deepEqual(f.run(stop({ cursor_version: '2' })), {
    followup_message: stopText('commit (git commit -m x); commit (git commit -m y)'),
  });
});

test('decoded quotes, backslashes and whitespace produce valid JSON and single-line state', (t) => {
  const f = fixture(t);
  f.activate();
  const description = 'review "quoted" C:\\work\\file\nnext\tline\rfinal';
  assert.deepEqual(f.run(post('Agent', { description })), output('PostToolUse', subagentText));
  const normalized = 'review "quoted" C:\\work\\file next line final';
  assert.equal(f.state(), `active\npending subagent ${normalized}\n`);
  assert.deepEqual(f.run(stop()), output('Stop', stopText(`subagent (${normalized})`)));
});

test('supported JSON escapes decode once and unicode escapes remain literal', (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(f.run('{"hook_event_name":"PostToolUse","session_id":"session-1","tool_name":"Bash","tool_input":{"command":"git\\u0020commit -m x"}}'), null);
  f.run('{"hook_event_name":"PostToolUse","session_id":"session-1","tool_name":"Task","tool_input":{"description":"a\\/b \\u1234 \\\\n"}}');
  assert.match(f.state(), /pending subagent a\/b \\u1234 \\n\n$/);
});

test('escaped keys inside strings and nested top-level fields cannot spoof detection', (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(f.run(post('Bash', { command: 'echo "tool_name":"Agent"' })), null);
  assert.equal(f.state(), 'active\n');
  // Put misleading nested fields before the actual top-level fields.
  const input = {
    tool_input: { tool_name: 'Agent', hook_event_name: 'stop', turn_id: 'spoof', cursor_version: 'spoof', command: 'git commit -m x' },
    hook_event_name: 'PostToolUse', session_id: 'session-1', tool_name: 'Bash',
  };
  assert.deepEqual(f.run(input), output('PostToolUse', commitText));
  assert.deepEqual(f.run(stop()), output('Stop', stopText('commit (git commit -m x)')));
});

test('malformed, empty, unknown-event and missing-session inputs are silent', (t) => {
  const f = fixture(t);
  for (const input of ['', 'not JSON', '{', '{"tool_name":"Agent"', '{}', '[]',
    post('Bash', { command: 'git commit -m x' }, { session_id: undefined }),
    post('mcp__archdocs__get_design_doc', {}, { hook_event_name: 'PreToolUse' })]) {
    assert.equal(f.run(input), null);
  }
  assert.deepEqual(fs.readdirSync(f.dirs.claude), []);
});

test('session keys are sanitized and limited to 128 characters', (t) => {
  const f = fixture(t);
  const session_id = '../bad/\\key !' + 'x'.repeat(150);
  f.activate({ session_id });
  const key = session_id.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128);
  assert.equal(f.state(key), 'active\n');
  assert.equal(f.run(post('mcp__archdocs__get_design_doc', {}, { session_id: '/ !' })), null);
  assert.deepEqual(fs.readdirSync(path.join(f.dirs.claude, 'worklog')), [`${key}.state`]);
});

test('checkpoint text is trimmed, collapsed and truncated to 100 characters plus ellipsis', (t) => {
  const f = fixture(t);
  f.activate();
  const description = ` \n\t${'x'.repeat(110)}\t\n `;
  f.run(post('Task', { description }));
  assert.equal(f.state(), `active\npending subagent ${'x'.repeat(100)}...\n`);
});

test('truncation preserves complete UTF-8 characters', (t) => {
  const f = fixture(t);
  f.activate();
  f.run(post('Task', { description: '\u03bb'.repeat(101) }));
  assert.equal(f.state(), `active\npending subagent ${'\u03bb'.repeat(100)}...\n`);
  assert.deepEqual(f.run(stop()), output('Stop', stopText(`subagent (${'\u03bb'.repeat(100)}...)`)));
});

test('output drops other control characters', (t) => {
  const f = fixture(t);
  f.activate();
  f.run(post('Task', { description: 'a\u007fb' }));
  assert.deepEqual(f.run(stop()), output('Stop', stopText('subagent (ab)')));
});

test('host-specific tool names ignore tools from other hosts', (t) => {
  const f = fixture(t);
  f.activate();
  for (const [name, extra] of [['Shell', {}], ['Agent', { turn_id: 'turn-1' }],
    ['PowerShell', { turn_id: 'turn-1' }], ['Bash', { cursor_version: '2' }],
    ['Agent', { cursor_version: '2' }]]) {
    assert.equal(f.run(post(name, { command: 'git commit -m x', description: 'review' }, extra)), null);
  }
  assert.equal(f.state(), 'active\n');
});

test('state precedence: CLAUDE_PLUGIN_DATA wins', (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(f.state(), 'active\n');
  assert.deepEqual(fs.readdirSync(f.dirs.plugin), []);
  assert.deepEqual(fs.readdirSync(f.dirs.tmp), []);
});

test('state precedence: PLUGIN_DATA when CLAUDE_PLUGIN_DATA is unset or empty', (t) => {
  const f = fixture(t);
  f.activate({}, { env: { CLAUDE_PLUGIN_DATA: undefined } });
  assert.equal(f.state('session-1', f.dirs.plugin), 'active\n');
  f.activate({ session_id: 'empty-claude' }, { env: { CLAUDE_PLUGIN_DATA: '' } });
  assert.equal(f.state('empty-claude', f.dirs.plugin), 'active\n');
  assert.deepEqual(fs.readdirSync(f.dirs.claude), []);
});

test('state precedence: TMPDIR fallback when plugin directories are unset', (t) => {
  const f = fixture(t);
  f.activate({}, { env: { CLAUDE_PLUGIN_DATA: undefined, PLUGIN_DATA: undefined } });
  assert.equal(f.state('session-1', path.join(f.dirs.tmp, 'archdocs-plugin')), 'active\n');
});

test('state storage failures exit successfully and silently', (t) => {
  const f = fixture(t);
  const blocked = path.join(f.root, 'file');
  fs.writeFileSync(blocked, 'not a directory');
  f.activate({}, { env: { CLAUDE_PLUGIN_DATA: blocked } });
});

test('creating state cleans files older than seven days opportunistically', (t) => {
  const f = fixture(t);
  const dir = path.join(f.dirs.claude, 'worklog');
  fs.mkdirSync(dir);
  const old = path.join(dir, 'old.state');
  const fresh = path.join(dir, 'fresh.state');
  const unrelated = path.join(dir, 'old.txt');
  for (const file of [old, fresh, unrelated]) fs.writeFileSync(file, 'active\n');
  const past = new Date(Date.now() - 10 * 86400000);
  for (const file of [old, unrelated]) fs.utimesSync(file, past, past);
  f.activate();
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(unrelated), true);
});

test('Unix polyglot launcher invokes the same hook', (t) => {
  const f = fixture(t);
  f.activate();
  assert.deepEqual(f.run(post('Bash', { command: 'git commit -m x' }), { launcher: true }), output('PostToolUse', commitText));
});

test('hook configs parse and every command uses the shared launcher and worklog script', () => {
  const claude = JSON.parse(fs.readFileSync('hooks/hooks.json', 'utf8'));
  const cursor = JSON.parse(fs.readFileSync('hooks/hooks-cursor.json', 'utf8'));
  for (const entries of Object.values(claude.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        assert.match(hook.command, /run-hook\.cmd" worklog$/);
        assert.equal(hook.shell, 'bash');
        assert.equal(hook.timeout, 10);
      }
    }
  }
  for (const entries of Object.values(cursor.hooks)) {
    for (const hook of entries) assert.match(hook.command, /run-hook\.cmd"? worklog$/);
  }
  assert.equal(cursor.hooks.stop[0].loop_limit, 1);
  const manifest = JSON.parse(fs.readFileSync('.cursor-plugin/plugin.json', 'utf8'));
  assert.equal(manifest.hooks, './hooks/hooks-cursor.json');
});

test('20 sequential inactive invocations finish within ten seconds', (t) => {
  const f = fixture(t);
  const start = performance.now();
  for (let i = 0; i < 20; i++) assert.equal(f.run(post('Bash', { command: 'git commit -m x' })), null);
  const elapsed = performance.now() - start;
  t.diagnostic(`20 inactive invocations: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 10000, `elapsed ${elapsed} ms`);
});
