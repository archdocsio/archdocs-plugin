import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateSkillFile(file, text, toolNames) {
  const errors = [];
  const fail = (message) => errors.push(`${file}: ${message}`);
  const normalized = file.replaceAll('\\', '/');
  const command = /(?:^|\/)commands\/[^/]+\.md$/.test(normalized);
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const fields = {};
  if (end > 0) {
    for (const line of lines.slice(1, end)) {
      const match = /^([\w-]+):\s*(.*?)\s*$/.exec(line);
      if (match) fields[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!command) {
    if (end < 0) fail('missing frontmatter');
    const dir = normalized.split('/').at(-2);
    if (fields.name !== dir) fail('name must equal the directory name');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name ?? '')) fail('name must be lowercase kebab-case');
    if ((fields.name?.length ?? 0) > 64) fail('name exceeds 64 characters');
    if (!/^Use when(?:\s|$)/.test(fields.description ?? '')) fail('description must start with "Use when"');
    if ((fields.description?.length ?? 0) > 1024) fail('description exceeds 1024 characters');
  }
  const body = end > 0 ? lines.slice(end + 1) : lines;
  if (body.at(-1) === '') body.pop();
  if (body.length > 300) fail('body exceeds 300 lines');
  if (text.includes('\u2014')) fail('contains em dash');
  let fence;
  for (const line of body) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && /^\s{0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
      continue;
    }
    if (marker) { fence = marker; continue; }
    for (const match of line.matchAll(/(`+)([^`]+)\1/g)) {
      const token = match[2];
      if (/^[a-z]+(?:_[a-z]+)+$/.test(token) && !toolNames.has(token)) fail(`unknown tool name ${token}`);
    }
  }
  return errors;
}

export async function validateRepo(rootDir) {
  const errors = [];
  let toolNames;
  try { toolNames = new Set(JSON.parse(await readFile(path.join(rootDir, 'tool-names.json'), 'utf8')).tools); }
  catch (error) { return [`tool-names.json: ${error.message}`]; }
  async function walk(relative = '') {
    const entries = await readdir(path.join(rootDir, relative), { withFileTypes: true });
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!['node_modules', '.git'].includes(entry.name) && file !== 'evals/results') await walk(file);
      } else if (entry.isFile() && /\.(md|json)$/.test(file)) {
        const text = await readFile(path.join(rootDir, file), 'utf8');
        if (/^skills\/[^/]+\/SKILL\.md$/.test(file) || /^commands\/[^/]+\.md$/.test(file)) {
          errors.push(...validateSkillFile(file, text, toolNames));
        } else if (text.includes('\u2014')) errors.push(`${file}: contains em dash`);
      }
    }
  }
  await walk();
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const errors = await validateRepo(process.cwd());
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
