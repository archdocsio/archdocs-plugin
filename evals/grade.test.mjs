import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeTranscript } from './grade.mjs';

const events = (...calls) => [{ type: 'assistant', message: { content: calls.map((call) => ({
  type: 'tool_use', name: typeof call === 'string' ? call : call.name,
  input: typeof call === 'string' ? {} : call.input,
})) } }];
test('passes when mustCall tool appears', () => {
  assert.deepEqual(gradeTranscript(events('mcp__archdocs-eval__create_adr'), { mustCall: ['create_adr'] }), { pass: true, failures: [] });
});
test('fails mustNotCall', () => {
  assert.match(gradeTranscript(events('create_design_doc'), { mustNotCall: ['create_design_doc'] }).failures[0], /create_design_doc/);
});
const order = { order: [['a', 'b']] };
test('order fails when b precedes a', () => assert.equal(gradeTranscript(events('b', 'a', 'b'), order).pass, false));
test('order fails when b called and a never called', () => assert.equal(gradeTranscript(events('b'), order).pass, false));
test('order passes when b never called', () => assert.equal(gradeTranscript(events('a'), order).pass, true));
test('order accepts alternation', () => {
  assert.equal(gradeTranscript(events('search', 'write_design_doc_variation'), { order: [['list_objects|search', 'write_design_doc_variation']] }).pass, true);
});
test('finalTextMatches reads the result event', () => {
  const transcript = [...events(), { type: 'result', result: 'Open an amendment first' }];
  assert.deepEqual(gradeTranscript(transcript, { finalTextMatches: 'amendment' }), { pass: true, failures: [] });
  assert.equal(gradeTranscript(transcript, { finalTextMatches: 'shipped' }).pass, false);
  assert.equal(gradeTranscript(transcript, { finalTextMatches: 'AMENDMENT' }).pass, true);
});
test('finalTextMatches uses the last result event', () => {
  const transcript = [{ type: 'result', result: 'shipped' }, { type: 'result', result: 'Open an amendment first' }, ...events()];
  assert.equal(gradeTranscript(transcript, { finalTextMatches: 'amendment' }).pass, true);
  assert.equal(gradeTranscript(transcript, { finalTextMatches: 'shipped' }).pass, false);
});
test('finalTextMatches fails clearly when the result event or result string is missing', () => {
  const expect = { finalTextMatches: 'amendment' };
  const missingEvent = gradeTranscript(events(), expect);
  assert.equal(missingEvent.pass, false);
  assert.match(missingEvent.failures[0], /missing result event/);
  for (const result of [undefined, null, 42]) {
    const missingText = gradeTranscript([{ type: 'result', result: 'amendment' }, { type: 'result', result }], expect);
    assert.equal(missingText.pass, false);
    assert.match(missingText.failures[0], /last result event has no result string/);
  }
});
test('argMatches checks nested path', () => {
  const expect = { argMatches: [{ tool: 'write_design_doc_variation', path: 'brief.decision', pattern: 'Valkey' }] };
  assert.equal(gradeTranscript(events({ name: 'write_design_doc_variation', input: { brief: { decision: 'Use Valkey' } } }), expect).pass, true);
  assert.equal(gradeTranscript(events({ name: 'write_design_doc_variation', input: { brief: {} } }), expect).pass, false);
});

const noEvidence = { argMustNotMatch: [{ tool: 'write_design_doc_variation', path: 'variation', pattern: '^evidence$' }] };

test('argMustNotMatch fails on a matching call', () => {
  const transcript = events(
    { name: 'write_design_doc_variation', input: { variation: 'plan' } },
    { name: 'mcp__archdocs-eval__write_design_doc_variation', input: { variation: 'evidence' } },
  );
  const grade = gradeTranscript(transcript, noEvidence);
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /write_design_doc_variation.*variation.*evidence/);
});

test('argMustNotMatch passes when only other values appear', () => {
  assert.deepEqual(gradeTranscript(events({ name: 'write_design_doc_variation', input: { variation: 'plan' } }), noEvidence), { pass: true, failures: [] });
});

test('argMustNotMatch checks nested values and ignores missing paths and other tools', () => {
  const expect = { argMustNotMatch: [{ tool: 'write_design_doc_variation', path: 'brief.decision', pattern: 'Valkey' }] };
  assert.equal(gradeTranscript(events({ name: 'write_design_doc_variation', input: { brief: { decision: 'Use Valkey' } } }), expect).pass, false);
  assert.deepEqual(gradeTranscript(events(
    { name: 'write_design_doc_variation', input: { brief: {} } },
    { name: 'other_tool', input: { brief: { decision: 'Use Valkey' } } },
  ), expect), { pass: true, failures: [] });
  assert.deepEqual(gradeTranscript(events(), expect), { pass: true, failures: [] });
});

test('finalTextNotMatches fails on a match', () => {
  const grade = gradeTranscript([{ type: 'result', result: 'I would start a design doc' }], { finalTextNotMatches: 'DESIGN DOC' });
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /Final result text.*DESIGN DOC/);
});

test('finalTextNotMatches passes otherwise', () => {
  assert.deepEqual(gradeTranscript([{ type: 'result', result: 'I will add a retry counter metric.' }], { finalTextNotMatches: 'design doc' }), { pass: true, failures: [] });
});

test('finalTextNotMatches uses the last result event', () => {
  const expect = { finalTextNotMatches: 'design doc' };
  assert.equal(gradeTranscript([{ type: 'result', result: 'design doc' }, { type: 'result', result: 'Done' }], expect).pass, true);
  assert.equal(gradeTranscript([{ type: 'result', result: 'Done' }, { type: 'result', result: 'design doc' }], expect).pass, false);
});

test('finalTextNotMatches fails clearly when the result event or result string is missing', () => {
  const expect = { finalTextNotMatches: 'design doc' };
  const missingEvent = gradeTranscript(events(), expect);
  assert.equal(missingEvent.pass, false);
  assert.match(missingEvent.failures[0], /missing result event/);
  for (const result of [undefined, null, 42]) {
    const missingText = gradeTranscript([{ type: 'result', result: 'Done' }, { type: 'result', result }], expect);
    assert.equal(missingText.pass, false);
    assert.match(missingText.failures[0], /last result event has no result string/);
  }
});
test('order uses the first call across right-side alternatives', () => {
  assert.equal(gradeTranscript(events('c', 'a', 'b'), { order: [['a', 'b|c']] }).pass, false);
  assert.equal(gradeTranscript(events('x', 'c', 'b'), { order: [['a|x', 'b|c']] }).pass, true);
});
test('ignores tool results and user content', () => {
  assert.equal(gradeTranscript([{ type: 'user', message: { content: [{ type: 'tool_use', name: 'create_adr' }] } }], { mustCall: ['create_adr'] }).pass, false);
});

// Each pair is [name, input, { ok, text }]; results are correlated by tool_use_id, the way stream-json transcripts carry them.
const withResults = (...pairs) => {
  const uses = pairs.map(([name, input], i) => ({ type: 'tool_use', id: `toolu_${i}`, name, input }));
  const results = pairs.filter(([, , result]) => result).map(([, , result], i) => ({
    type: 'tool_result', tool_use_id: `toolu_${i}`, ...(result.ok ? {} : { is_error: true }), content: result.text,
  }));
  return [{ type: 'assistant', message: { content: uses } }, { type: 'user', message: { content: results } }];
};
test('mustSucceed fails when every call of the tool errored, while mustCall still passes', () => {
  const transcript = withResults(['mcp__archdocs-eval__mark_variation_ready', { variation: 'evidence' }, { ok: false, text: 'Approvals are off for this organization.' }]);
  assert.equal(gradeTranscript(transcript, { mustCall: ['mark_variation_ready'] }).pass, true);
  const grade = gradeTranscript(transcript, { mustSucceed: ['mark_variation_ready'] });
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /mark_variation_ready never succeeded.*Approvals are off/);
});
test('mustSucceed passes when one call succeeded after a failure', () => {
  const transcript = withResults(
    ['write_design_doc_variation', { variation: 'spec' }, { ok: false, text: 'brief is required' }],
    ['write_design_doc_variation', { variation: 'spec' }, { ok: true, text: '{"id":"v1"}' }],
  );
  assert.deepEqual(gradeTranscript(transcript, { mustSucceed: ['write_design_doc_variation'] }), { pass: true, failures: [] });
});
test('mustSucceed fails when the tool was never called', () => {
  assert.match(gradeTranscript(withResults(), { mustSucceed: ['submit_evidence'] }).failures[0], /submit_evidence never succeeded/);
});
test('a call with no tool_result counts as not successful', () => {
  const transcript = withResults(['mark_variation_ready', { variation: 'spec' }]);
  assert.equal(gradeTranscript(transcript, { mustSucceed: ['mark_variation_ready'] }).pass, false);
});
test('mustNotFail fails on any errored call of the tool', () => {
  const transcript = withResults(
    ['mark_variation_ready', { variation: 'spec' }, { ok: false, text: 'Approval is required for this size. Request review instead.' }],
    ['request_design_doc_review', { variation: 'spec' }, { ok: true, text: '{}' }],
  );
  const grade = gradeTranscript(transcript, { mustNotFail: ['mark_variation_ready'] });
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /mark_variation_ready failed: Approval is required/);
  assert.deepEqual(gradeTranscript(transcript, { mustNotFail: ['request_design_doc_review'] }), { pass: true, failures: [] });
});
test('expectFailure requires an errored call whose message matches', () => {
  const transcript = withResults(['mark_variation_ready', { variation: 'spec' }, { ok: false, text: 'Approval is required for this size.' }]);
  assert.deepEqual(gradeTranscript(transcript, { expectFailure: [{ tool: 'mark_variation_ready', pattern: 'Approval is required' }] }), { pass: true, failures: [] });
  const grade = gradeTranscript(transcript, { expectFailure: [{ tool: 'mark_variation_ready', pattern: 'Business plan' }] });
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /No failed mark_variation_ready call matches \/Business plan\//);
  assert.equal(gradeTranscript(withResults(['mark_variation_ready', {}, { ok: true, text: '{}' }]), { expectFailure: [{ tool: 'mark_variation_ready', pattern: '.' }] }).pass, false);
});
test('resultMatches reads string and array result content of successful calls only', () => {
  const array = [{ type: 'text', text: '# tests 3\n' }, { type: 'text', text: '# fail 0\n' }];
  const transcript = withResults(
    ['Bash', { command: 'node --test' }, { ok: false, text: '# fail 1' }],
    ['Bash', { command: 'node --test' }, { ok: true, text: array }],
  );
  assert.deepEqual(gradeTranscript(transcript, { resultMatches: [{ tool: 'Bash', pattern: '# fail 0' }] }), { pass: true, failures: [] });
  const grade = gradeTranscript(transcript, { resultMatches: [{ tool: 'Bash', pattern: '# fail 1' }] });
  assert.equal(grade.pass, false);
  assert.match(grade.failures[0], /No successful Bash result matches \/# fail 1\//);
});
test('argMatches and order with ok: true consider only calls that succeeded', () => {
  const transcript = withResults(
    ['write_design_doc_variation', { variation: 'evidence' }, { ok: false, text: 'brief is required' }],
    ['write_design_doc_variation', { variation: 'plan' }, { ok: true, text: '{}' }],
    ['mark_design_doc_shipped', {}, { ok: true, text: '{}' }],
  );
  const evidence = { tool: 'write_design_doc_variation', path: 'variation', pattern: '^evidence$' };
  assert.equal(gradeTranscript(transcript, { argMatches: [evidence] }).pass, true);
  const strict = gradeTranscript(transcript, { argMatches: [{ ...evidence, ok: true }] });
  assert.equal(strict.pass, false);
  assert.match(strict.failures[0], /No successful write_design_doc_variation input at variation matches/);
  // The evidence write failed, so with ok: true it does not count as happening before the ship call.
  assert.equal(gradeTranscript(transcript, { order: [['write_design_doc_variation', 'mark_design_doc_shipped']] }).pass, true);
  assert.equal(gradeTranscript(transcript, { order: [{ before: 'write_design_doc_variation', after: 'mark_design_doc_shipped', ok: true }] }).pass, true);
  const onlyEvidence = withResults(
    ['write_design_doc_variation', { variation: 'evidence' }, { ok: false, text: 'brief is required' }],
    ['mark_design_doc_shipped', {}, { ok: true, text: '{}' }],
  );
  assert.equal(gradeTranscript(onlyEvidence, { order: [['write_design_doc_variation', 'mark_design_doc_shipped']] }).pass, true);
  const strictOrder = gradeTranscript(onlyEvidence, { order: [{ before: 'write_design_doc_variation', after: 'mark_design_doc_shipped', ok: true }] });
  assert.equal(strictOrder.pass, false);
  assert.match(strictOrder.failures[0], /Expected a successful write_design_doc_variation before first mark_design_doc_shipped/);
});
test('results correlate by id across several user events and ignore unrelated ids', () => {
  const transcript = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'mark_variation_ready', input: {} }, { type: 'tool_use', id: 'b', name: 'link_pull_request', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'ok' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'zzz', content: 'stray' }, { type: 'tool_result', tool_use_id: 'a', is_error: true, content: 'nope' }] } },
  ];
  assert.deepEqual(gradeTranscript(transcript, { mustSucceed: ['link_pull_request'] }), { pass: true, failures: [] });
  assert.equal(gradeTranscript(transcript, { mustSucceed: ['mark_variation_ready'] }).pass, false);
});
