import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRepo, validateSkillFile } from './validate.mjs';

const tools = new Set(['create_design_doc']);
const skill = (body = 'body', name = 'foo', description = 'Use when x') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
const errors = (text) => validateSkillFile('skills/foo/SKILL.md', text, tools);

test('rejects name that differs from directory', () => {
  assert.ok(errors(skill('body', 'bar')).some((e) => e.includes('name')));
});
test('rejects description not starting with "Use when"', () => {
  assert.ok(errors(skill('body', 'foo', 'Write a doc')).some((e) => e.includes('description')));
});
test('rejects description over 1024 characters', () => {
  assert.ok(errors(skill('body', 'foo', 'Use when ' + 'x'.repeat(1024))).length);
});
test('rejects body over 300 lines', () => {
  assert.ok(errors(skill(Array(301).fill('line').join('\n'))).some((e) => e.includes('300')));
});
test('rejects em dash', () => {
  assert.ok(errors(skill('\u2014')).some((e) => e.includes('em dash')));
});
test('rejects unknown tool name', () => {
  assert.ok(errors(skill('`create_desgin_doc`')).some((e) => e.includes('create_desgin_doc')));
  assert.deepEqual(errors(skill('`create_design_doc`')), []);
});
test('ignores snake_case inside fenced code blocks', () => {
  assert.deepEqual(errors(skill('```json\n{"field": "`session_url`"}\n```')), []);
  assert.deepEqual(errors(skill('~~~json\n`session_url`\n~~~')), []);
});
test('validateRepo flags em dash in README.md', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.validate-test-'));
  try {
    fs.writeFileSync(path.join(root, 'tool-names.json'), '{"tools":[]}');
    fs.writeFileSync(path.join(root, 'README.md'), '\u2014');
    assert.ok((await validateRepo(root)).some((e) => e.includes('README.md') && e.includes('em dash')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('accepts zero skills and validates commands without skill frontmatter', async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.validate-test-'));
  try {
    fs.writeFileSync(path.join(root, 'tool-names.json'), '{"tools":[]}');
    assert.deepEqual(await validateRepo(root), []);
    fs.mkdirSync(path.join(root, 'commands'));
    fs.writeFileSync(path.join(root, 'commands', 'foo.md'), '---\ndescription: Start here\n---\n`unknown_tool`');
    const found = await validateRepo(root);
    assert.equal(found.length, 1);
    assert.match(found[0], /unknown_tool/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('rejects invalid or oversized skill names', () => {
  assert.ok(errors(skill('body', 'Foo')).some((e) => e.includes('kebab-case')));
  assert.ok(errors(skill('body', 'x'.repeat(65))).some((e) => e.includes('64')));
});
