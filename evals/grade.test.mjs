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
test('order uses the first call across right-side alternatives', () => {
  assert.equal(gradeTranscript(events('c', 'a', 'b'), { order: [['a', 'b|c']] }).pass, false);
  assert.equal(gradeTranscript(events('x', 'c', 'b'), { order: [['a|x', 'b|c']] }).pass, true);
});
test('ignores tool results and user content', () => {
  assert.equal(gradeTranscript([{ type: 'user', message: { content: [{ type: 'tool_use', name: 'create_adr' }] } }], { mustCall: ['create_adr'] }).pass, false);
});
