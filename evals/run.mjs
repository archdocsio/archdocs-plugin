import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gradeTranscript } from './grade.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function loadEvalEnv({ file = new URL('./.eval-env', import.meta.url), env = process.env } = {}) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return env; throw error; }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match && !Object.hasOwn(env, match[1])) env[match[1]] = match[2].trim();
  }
  return env;
}

export const usage = `Usage: node evals/run.mjs [--scenario <id>] [--runs 3] [--mode with|without|both]

Options:
  --scenario <id>  Run one scenario (default: all)
  --runs <n>       Runs per scenario and mode (default: 3)
  --mode <mode>    with, without, or both (default: both)
  --help          Print this usage without requiring credentials

Environment:
  ARCHDOCS_EVAL_ENDPOINT     MCP endpoint (default: http://localhost:3000/mcp)
  ARCHDOCS_EVAL_API          REST API base (default: endpoint without trailing /mcp)
  ARCHDOCS_EVAL_PAT          PAT for the full org
  ARCHDOCS_EVAL_PAT_LEAN     PAT for the lean org
  ARCHDOCS_EVAL_PASSWORD_FULL / ARCHDOCS_EVAL_PASSWORD_LEAN  Stored login passwords
  ARCHDOCS_EVAL_ORG_ID / ARCHDOCS_EVAL_ORG_ID_LEAN           Orgs to reset before each run
  ARCHDOCS_EVAL_APPROVED_DD  Manually approved plan, for example DD-0004
`;

export function buildClaudeArgs({ mode, mcpConfigPath, pluginDir, tools = [] }) {
  if (!['with', 'without'].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  // Scenario tools are plain Claude Code tool names (Bash, Edit, Write); patterns would widen permissions in ways the scenario file can't review.
  for (const tool of tools) if (!/^[A-Za-z]+$/.test(tool)) throw new Error(`Invalid scenario tool name: ${tool}`);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpConfigPath,
    '--strict-mcp-config', '--allowedTools', 'mcp__archdocs-eval', 'Read', ...tools,
    // Skip user-level plugins, hooks and settings so both modes see the same clean agent.
    '--setting-sources', 'project'];
  if (mode === 'with') args.push('--plugin-dir', pluginDir);
  return args;
}

export function substitute(prompt, vars) {
  const result = prompt.replace(/\{\{([^{}]+)\}\}/g, (token, name) =>
    Object.hasOwn(vars, name) && vars[name] !== undefined ? String(vars[name]) : token);
  if (/\{\{.*?\}\}/s.test(result)) throw new Error('Unreplaced prompt placeholder: ' + result.match(/\{\{.*?\}\}/s)[0]);
  return result;
}

export function parseMcpResponse(text) {
  const trimmed = text.trim();
  const bodies = [];
  if (trimmed.startsWith('{')) bodies.push(JSON.parse(trimmed));
  else {
    // SSE joins consecutive data lines within one event with newlines.
    for (const event of trimmed.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (data && data !== '[DONE]') bodies.push(JSON.parse(data));
    }
  }
  for (const body of bodies) {
    if (body.error) throw new Error(`MCP JSON-RPC error ${body.error.code}: ${body.error.message}`);
  }
  const body = bodies.find((body) => Object.hasOwn(body, 'result'));
  if (!body || body.result === null || typeof body.result !== 'object') throw new Error('MCP response has no JSON-RPC result');
  return body.result;
}

function redact(text, secrets) {
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '[REDACTED]');
  return text;
}

export function restClient({ api, email, password, orgId, fetchImpl = fetch }) {
  let token;
  const base = api.replace(/\/$/, '');
  async function request(route, { method = 'GET', body, scoped = true } = {}) {
    // Do not include response bodies or transport errors: either can echo credentials.
    const label = `${method} ${route.split('?')[0].replace(/\/(design-docs|adrs)\/.+$/, '/$1/{id}')}`;
    let response;
    try {
      response = await fetchImpl(`${base}${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/json',
          ...(scoped ? { Authorization: `Bearer ${token}`, 'x-organization-id': orgId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error(`${label} failed to reach the API.`); }
    if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}).`);
    try { return await response.json(); }
    catch { throw new Error(`${label} returned invalid JSON.`); }
  }
  async function login() {
    if (!email || !password || !orgId) throw new Error('Login email, stored password and organization id are required. Run evals/setup-local-orgs.mjs.');
    const auth = await request('/auth/login', { method: 'POST', scoped: false, body: { email, password } });
    if (typeof auth?.token !== 'string' || !auth.token) throw new Error('POST /auth/login returned no JWT.');
    token = auth.token;
  }
  return { request, login, secrets: () => [password, token] };
}

export async function resetEvalOrg(options) {
  const client = restClient(options);
  const { request } = client;
  try {
    await client.login();
    const ids = [];
    const cursors = new Set();
    let cursor;
    do {
      // No status filter: includes shipped, abandoned, superseded and draft docs.
      const page = await request(`/design-docs${cursor === undefined ? '' : `?cursor=${cursor}`}`);
      if (!Array.isArray(page?.designDocs) || !page.designDocs.every((doc) => typeof doc?.id === 'string' && doc.id)) {
        throw new Error('GET /design-docs returned an invalid design doc list.');
      }
      ids.push(...page.designDocs.map((doc) => doc.id));
      cursor = page.nextCursor;
      if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor <= 0 || cursors.has(cursor))) {
        throw new Error('GET /design-docs returned an invalid or repeated pagination cursor.');
      }
      cursors.add(cursor);
    } while (cursor !== null);
    // Finish paging before deleting so mutations cannot shift the result set.
    let designDocsDeleted = 0;
    for (const id of new Set(ids)) {
      await request(`/design-docs/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
      designDocsDeleted++;
    }
    // The ADR contract exposes GET /adrs and DELETE /adrs/{id}, with no pagination.
    const page = await request('/adrs');
    if (!Array.isArray(page?.adrs) || !page.adrs.every((adr) => typeof adr?.id === 'string' && adr.id)) {
      throw new Error('GET /adrs returned an invalid ADR list.');
    }
    let adrsDeleted = 0;
    for (const id of new Set(page.adrs.map((adr) => adr.id))) {
      await request(`/adrs/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
      adrsDeleted++;
    }
    return { designDocsDeleted, adrsDeleted };
  } catch (error) {
    throw new Error(redact(`Eval org reset failed: ${error.message}`, client.secrets()));
  }
}

function resetOptions(scenario, env) {
  const lean = scenario.org === 'lean';
  const passwordKey = lean ? 'ARCHDOCS_EVAL_PASSWORD_LEAN' : 'ARCHDOCS_EVAL_PASSWORD_FULL';
  const orgKey = lean ? 'ARCHDOCS_EVAL_ORG_ID_LEAN' : 'ARCHDOCS_EVAL_ORG_ID';
  for (const key of [passwordKey, orgKey]) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable ${key} for ${scenario.id}. Run evals/setup-local-orgs.mjs.`);
  }
  const endpoint = env.ARCHDOCS_EVAL_ENDPOINT || 'http://localhost:3000/mcp';
  return {
    api: env.ARCHDOCS_EVAL_API || endpoint.replace(/\/mcp\/?$/, ''),
    email: lean ? 'eval-lean@archdocs.test' : 'eval-full@archdocs.test',
    password: env[passwordKey], orgId: env[orgKey],
  };
}

export async function mcpCall(endpoint, pat, name, args) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${pat}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (!response.ok) throw new Error(`MCP HTTP ${response.status} calling ${name}`);
    const result = parseMcpResponse(await response.text());
    const text = result.content?.find((item) => item.type === 'text')?.text;
    if (result.isError) throw new Error(`MCP tool ${name} failed: ${text ?? 'unknown error'}`);
    if (text !== undefined) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return result;
  } catch (error) { throw new Error(redact(error.message, [pat])); }
}

// Compares server state after a run with scenario.expect.state. Every check reads through MCP, so it sees what the next agent would see.
export async function checkState(expected, {
  invoke, designDocId, authorize, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 30000,
}) {
  const failures = [];
  const doc = await invoke('get_design_doc', { id: designDocId });
  for (const [typeKey, state] of Object.entries(expected.variationState ?? {})) {
    const actual = doc.variations?.find((variation) => variation.typeKey === typeKey)?.state ?? 'absent';
    if (actual !== state) failures.push(`State: variation ${typeKey} expected ${state}, got ${actual}`);
  }
  if (expected.designDocStatus !== undefined && doc.status !== expected.designDocStatus) {
    failures.push(`State: design doc status expected ${expected.designDocStatus}, got ${doc.status}`);
  }
  if (expected.openQuestions !== undefined && doc.openQuestionCount !== expected.openQuestions) {
    failures.push(`State: open questions expected ${expected.openQuestions}, got ${doc.openQuestionCount}`);
  }
  if (expected.journalKinds !== undefined || expected.journalLastKind !== undefined) {
    const journal = doc.variations?.find((variation) => variation.contentMode === 'JOURNAL');
    if (!journal) failures.push('State: the design doc has no journal variation');
    else {
      const { entries = [] } = await invoke('list_journal_entries', { designDocId, variation: journal.typeKey, limit: 100 });
      const kinds = entries.map((entry) => entry.kind);
      for (const kind of expected.journalKinds ?? []) {
        if (!kinds.includes(kind)) failures.push(`State: journal has no ${kind} entry (kinds: ${kinds.join(', ') || 'none'})`);
      }
      // Entries come newest first.
      if (expected.journalLastKind !== undefined && kinds[0] !== expected.journalLastKind) {
        failures.push(`State: last journal entry expected ${expected.journalLastKind}, got ${kinds[0] ?? 'none'}`);
      }
    }
  }
  if (expected.threadResolved !== undefined) {
    const threads = await invoke('list_comment_threads', { designDocId });
    const first = (Array.isArray(threads) ? threads : threads.threads ?? [])[0];
    if (!first) failures.push('State: the design doc has no comment thread');
    else if (Boolean(first.resolved) !== expected.threadResolved) failures.push(`State: first thread ${expected.threadResolved ? 'not resolved' : 'resolved'}`);
  }
  if (expected.criteriaOutcomes !== undefined) {
    const { criteria = [] } = await invoke('get_verification_status', { designDocId });
    for (const [key, outcome] of Object.entries(expected.criteriaOutcomes)) {
      const actual = criteria.find((criterion) => criterion.key === key)?.outcome ?? 'absent';
      if (actual !== outcome) failures.push(`State: criterion ${key} expected ${outcome}, got ${actual}`);
    }
  }
  // Standard checks are the criteria Archdocs adds itself (author kind SYSTEM), named here by fact.
  if (expected.standardChecks !== undefined || expected.afterAuthorize !== undefined) {
    const listed = await invoke('list_acceptance_criteria', { designDocId });
    const baseline = listed.draft ?? listed.authorized;
    const system = (baseline?.criteria ?? []).filter((criterion) => criterion.authorKind === 'SYSTEM');
    const keyFor = (fact) => system.find((criterion) => criterion.requirement?.fact === fact)?.key;
    for (const fact of expected.standardChecks ?? []) {
      if (!keyFor(fact)) failures.push(`State: no standard check for ${fact} (standard checks: ${system.map((c) => c.requirement?.fact).join(', ') || 'none'})`);
    }
    if (expected.afterAuthorize !== undefined) {
      // Agents never authorize criteria, so the person authorizes over REST, then a recheck is queued.
      if (!listed.draft) failures.push('State: no draft criteria to authorize');
      else if (!authorize) failures.push('State: afterAuthorize needs the person to authorize the draft');
      else {
        await authorize(listed.draft);
        await invoke('recheck_verification', { designDocId });
        for (const [fact, outcome] of Object.entries(expected.afterAuthorize)) {
          const key = keyFor(fact);
          if (!key) { failures.push(`State: no standard check for ${fact} to evaluate`); continue; }
          let last;
          for (let waited = 0; ; waited += 2000) {
            const { criteria = [] } = await invoke('list_acceptance_criteria', { designDocId });
            last = criteria.find((criterion) => criterion.key === key);
            if (last?.outcome === outcome || waited >= timeoutMs) break;
            await sleep(2000);
          }
          if (last?.outcome !== outcome) failures.push(`State: ${fact} (${key}) expected ${outcome} after authorization, got ${last?.outcome ?? 'absent'}${last?.reason ? ` (${last.reason})` : ''}`);
        }
      }
    }
  }
  return failures;
}

export async function setupScenario(scenario, { endpoint, pat, tempDir, env = process.env, call = mcpCall, fetchImpl = fetch }) {
  const setup = scenario.setup ?? 'none';
  if (setup === 'none') return {};
  const invoke = (name, args) => call(endpoint, pat, name, args);
  if (setup === 'with-standing-adr') {
    // An accepted ADR linked to the Delivery Worker, so a spec that calls Twilio synchronously conflicts with it.
    const listed = await invoke('list_objects', { search: 'Delivery Worker' });
    const objects = Array.isArray(listed) ? listed : listed.objects ?? listed.items ?? [];
    const worker = objects.find((object) => object.name === 'Delivery Worker');
    if (!worker?.id) throw new Error('Eval org needs the Cadence "Delivery Worker" object. Run evals/setup-local-orgs.mjs.');
    const adr = await invoke('create_adr', {
      title: 'Delivery Worker sends through the outbound queue, never synchronously',
      context: 'Synchronous provider calls in the send path stalled the Delivery Worker during the 2025 email provider outage.',
      decisionOutcome: 'Every outbound message leaves the Delivery Worker through the outbound queue. The send path never waits on a provider call; delivery status arrives through provider callbacks.',
      consideredOptions: [
        { id: 'queue', title: 'Outbound queue with callbacks', chosen: true },
        { id: 'sync', title: 'Synchronous provider call in the send path', cons: ['Provider latency stalls the worker'] },
      ],
    });
    if (!adr.id) throw new Error('create_adr did not return an id');
    // Accepting an ADR needs a Business plan, so the fixture stays PROPOSED; get_task_context lists it as uncertain (not approved).
    // ADR links have no MCP tool; set them over REST with the eval user's login.
    const client = restClient({ ...resetOptions(scenario, env), fetchImpl });
    await client.login();
    await client.request(`/adrs/${encodeURIComponent(adr.id)}/links`, { method: 'PUT', body: { links: [{ targetType: 'object', targetId: worker.id }] } });
    return { adrTitle: 'Delivery Worker sends through the outbound queue, never synchronously' };
  }
  if (setup === 'approved-plan') {
    if (!env.ARCHDOCS_EVAL_APPROVED_DD) {
      throw new Error('approved-plan setup needs a human approval step: approve the plan variation in the UI with no amendment open, then set ARCHDOCS_EVAL_APPROVED_DD (for example DD-0004).');
    }
    if (!/^DD-\d+$/.test(env.ARCHDOCS_EVAL_APPROVED_DD)) throw new Error('ARCHDOCS_EVAL_APPROVED_DD must be a design doc number like DD-0004');
    return { designDocNumber: env.ARCHDOCS_EVAL_APPROVED_DD };
  }
  if (setup === 'plan-file') {
    const planFile = path.join(tempDir, 'session-cache-plan.md');
    await writeFile(planFile, '# Session Cache eviction change\n\n## Goal\nEvict expired sessions from Session Cache.\n\n## Implementation plan\n1. Read the current eviction code and tests.\n2. Add expiry checks before returning cached sessions.\n3. Test expired and active sessions.\n');
    return { planFile };
  }
  const docSetups = ['design-doc-with-spec-and-plan', 'with-open-question', 'with-journal-entries', 'with-failing-test-repo',
    'with-failing-test-repo-origin', 'with-review-thread', 'with-stale-test-entry', 'with-done-handoff', 'large-doc', 'with-authorized-criteria',
    'with-subsystem-design'];
  if (!docSetups.includes(setup)) throw new Error(`Unknown setup: ${setup}`);
  const standard = await invoke('list_design_doc_types', {});
  // large-doc leaves readiness to the agent under test; every other fixture arrives with spec and plan ready.
  const doc = await createDocWithSpecAndPlan(invoke, standard, setup === 'large-doc' ? { size: 'LARGE', ready: false }
    : setup === 'with-subsystem-design' ? { design: SUBSYSTEM_DESIGN } : {});
  const vars = { designDocNumber: doc.displayNumber, designDocId: doc.id };
  if (setup === 'with-open-question') await invoke('add_design_doc_question', {
    designDocId: doc.id, text: 'Twilio or MessageBird for SMS?',
    context: 'The SMS provider has not been decided.', variation: 'spec',
    options: [{ label: 'Twilio' }, { label: 'MessageBird' }],
  });
  if (setup === 'with-review-thread') {
    const thread = await invoke('create_comment_thread', {
      designDocId: doc.id, anchorField: 'spec',
      content: 'Reviewer: the spec never says what happens when the SMS provider rejects a number. Add a failure path.',
    });
    return { ...vars, threadId: thread.id };
  }
  if (setup === 'with-failing-test-repo' || setup === 'with-failing-test-repo-origin') {
    await writeTestRepo(tempDir, { passing: false, origin: setup === 'with-failing-test-repo-origin' });
    return { ...vars, repoDir: tempDir };
  }
  if (setup === 'with-authorized-criteria') {
    const { createHash } = await import('node:crypto');
    const attest = (leafId, statement, by) => ({
      kind: 'attest', leafId, statement, statementHash: createHash('sha256').update(statement).digest('hex'), by,
      binding: { start: 'design_doc', steps: [] },
    });
    const baseline = await invoke('propose_acceptance_criteria', {
      designDocId: doc.id, reason: 'Eval fixture',
      criteria: [
        // The server assigns keys in order (AC-1, AC-2); a key in the request must name an existing criterion.
        { title: 'Sequencer SMS unit tests pass', required: true, requirement: attest('ac-1', 'Unit tests for the Sequencer SMS path pass locally.', 'HUMAN_OR_AGENT') },
        { title: 'Product owner confirmed the SMS copy', required: true, requirement: attest('ac-2', 'Product owner confirmed the SMS copy.', 'HUMAN') },
      ],
    });
    if (!baseline.id || !baseline.version) throw new Error('propose_acceptance_criteria did not return a baseline id and version');
    // Agents never authorize criteria, so the fixture authorizes over REST as the eval person.
    const client = restClient({ ...resetOptions(scenario, env), fetchImpl });
    await client.login();
    await client.request(`/design-docs/${encodeURIComponent(doc.id)}/criteria/baselines/${encodeURIComponent(baseline.id)}/authorize`, { method: 'POST', body: { expectedVersion: baseline.version } });
    // The agent must run the check itself to submit evidence, so the checkout's tests pass.
    await writeTestRepo(tempDir, { passing: true });
    return { ...vars, repoDir: tempDir };
  }
  if (['with-journal-entries', 'with-stale-test-entry', 'with-done-handoff'].includes(setup)) {
    // A journal with a saved handoff, left by a previous session. Setup never approves anything.
    const journal = standard.types?.find((type) => type.contentMode === 'JOURNAL' && type.enabled);
    if (!journal) throw new Error('Eval org needs an enabled Journal type such as the Work Log. Run evals/setup-local-orgs.mjs.');
    const entry = (args) => invoke('add_journal_entry', { designDocId: doc.id, variation: journal.key, ...args });
    if (setup === 'with-done-handoff') {
      await entry({ kind: 'progress', summary: 'Sequencer SMS path implemented and merged in PR #42.', references: [{ kind: 'PULL_REQUEST', repo: 'example/cadence', number: 42 }] });
      await entry({ kind: 'progress', summary: 'Delivery Worker SMS path implemented and merged in PR #42; delivery events batched every 5 seconds.' });
      await entry({ kind: 'test', summary: 'node --test passes for the Sequencer and Delivery Worker SMS paths at 7d2e1f0.', references: [{ kind: 'COMMIT', repo: 'example/cadence', sha: '7d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e' }] });
      await entry({ kind: 'deviation', summary: 'Delivery events are batched every 5 seconds instead of streamed to the Event Store: the stream client drops events under backpressure.' });
      await entry({
        kind: 'handoff', summary: 'Session handoff',
        handoff: { done: 'Sequencer and Delivery Worker SMS paths (E-1, E-2), tests green (E-3); PR #42 merged.', blocked: '', next: 'Nothing left in the plan. The batching deviation is recorded (E-4).' },
        references: [{ kind: 'ENTRY', number: 1 }, { kind: 'ENTRY', number: 2 }, { kind: 'ENTRY', number: 3 }, { kind: 'ENTRY', number: 4 }],
      });
      return { ...vars, journalVariation: journal.key };
    }
    await entry({ kind: 'progress', summary: 'Sequencer SMS path implemented; its unit tests pass locally.' });
    await entry({ kind: 'blocker', summary: 'Event Store stream client drops events under backpressure, so streaming delivery events as planned does not hold.' });
    if (setup === 'with-stale-test-entry') await entry({
      kind: 'test', summary: 'node --test passes at 3f9c2d1 (Sequencer SMS path).',
      references: [{ kind: 'COMMIT', repo: 'example/cadence', sha: '3f9c2d1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d' }],
    });
    await entry({
      kind: 'handoff', summary: 'Session handoff',
      handoff: {
        done: 'Sequencer SMS path (E-1).',
        blocked: 'Event Store streaming drops events under backpressure (E-2). Batching versus streaming is undecided.',
        next: 'Decide batching versus streaming for the Event Store, then extend the Delivery Worker.',
      },
      references: [{ kind: 'ENTRY', number: 1 }, { kind: 'ENTRY', number: 2 }],
    });
    return { ...vars, journalVariation: journal.key };
  }
  return vars;
}

const SMS_DESIGN = {
  title: 'SMS delivery channel',
  fixture: {
    spec: '# SMS delivery channel\n\nAdd SMS delivery through the Sequencer and Delivery Worker. The provider is undecided between Twilio and MessageBird.\n',
    plan: '# SMS delivery plan\n\nExtend the Sequencer and Delivery Worker for SMS. Stream delivery events to the Event Store. Verify SMS delivery with tests.\n',
  },
};

// The standing design of the Delivery Worker's retry subsystem. autoLink turns the Cadence object names into mentions,
// so a discussion about retries can reach the doc through the catalog as well as by its title.
const SUBSYSTEM_DESIGN = {
  title: 'Delivery Worker retries: requeue with backoff and a dead-letter queue',
  autoLink: true,
  fixture: {
    spec: '# Delivery Worker retries\n\nA failed send never retries in place inside the Delivery Worker. The message goes back on the outbound queue with exponential backoff (30s, 2m, 10m, 1h), and after five attempts it moves to the dead-letter queue, where the Sequencer marks the step failed. Retrying in place was rejected: it holds a worker slot while a provider is down, and it stalled the Delivery Worker during the 2025 email provider outage.\n',
    plan: '# Delivery Worker retries plan\n\nAdd the backoff schedule to the Delivery Worker requeue path, add the dead-letter queue, and have the Sequencer consume dead-letter events. Verify with a provider outage test.\n',
  },
};

// The design doc a doc fixture starts from (the SMS delivery doc unless the setup passes another). Readiness follows the org's rules; setup never approves anything.
async function createDocWithSpecAndPlan(invoke, standard, { size = 'STANDARD', ready = true, design = SMS_DESIGN } = {}) {
  const doc = await invoke('create_design_doc', { title: design.title, size });
  if (!doc.id || !doc.displayNumber) throw new Error('create_design_doc did not return id and displayNumber');
  const { fixture } = design;
  for (const variation of ['spec', 'plan']) {
    const type = standard.types?.find((type) => type.key === variation && type.enabled);
    if (!type) throw new Error(`Eval org needs an enabled ${variation} type`);
    const brief = Object.fromEntries(type.briefFields.filter((field) => !field.computed)
      .map((field) => [field.key, fixture[variation].split('\n').slice(2).join('\n').trim()]));
    await invoke('write_design_doc_variation', { designDocId: doc.id, variation, content: fixture[variation], brief, ...(design.autoLink ? { autoLink: true } : {}) });
    // Both readiness and review require the approvals feature, even in lean orgs.
    if (ready && standard.features?.approvals) {
      const action = type.approvalFor?.includes(size) ? 'request_design_doc_review' : 'mark_variation_ready';
      await invoke(action, { designDocId: doc.id, variation });
    }
  }
  return doc;
}

// A one-commit repository with one test: formatRecipient should strip spaces from the number. With passing false it returns the number unchanged.
// With origin it also has a GitHub remote, so a commit reference has a repository to name; nothing is ever pushed there.
async function writeTestRepo(dir, { passing, origin = false }) {
  const { execFileSync } = await import('node:child_process');
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'cadence-sms', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n');
  const body = passing ? "  return number.replace(/\\s+/g, '');" : '  return number;';
  await writeFile(path.join(dir, 'src', 'sms.mjs'), `// Normalizes a recipient number for the SMS provider.\nexport function formatRecipient(number) {\n${body}\n}\n`);
  await writeFile(path.join(dir, 'test', 'sms.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatRecipient } from '../src/sms.mjs';\n\ntest('formats recipient', () => {\n  assert.equal(formatRecipient(' +1 555 0100 '), '+15550100');\n});\n");
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.name=Eval', '-c', 'user.email=eval@archdocs.test', 'add', '.');
  git('-c', 'user.name=Eval', '-c', 'user.email=eval@archdocs.test', 'commit', '-q', '-m', 'feat: sms recipient formatting');
  if (origin) git('remote', 'add', 'origin', 'https://github.com/example/cadence.git');
}

export function runClaude(args, prompt, { cwd, secrets = [], spawnProcess = spawn, platform = process.platform } = {}) {
  function attempt(command) {
    return new Promise((resolve, reject) => {
      // The agent under test may run shell commands; it must not inherit the eval PATs or passwords.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ARCHDOCS_EVAL_')));
      const child = spawnProcess(command, args, { shell: false, cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, stdout: redact(stdout, secrets), stderr: redact(stderr, secrets) }));
      // A failed spawn can close stdin before end; the process error remains authoritative.
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
  }
  return attempt('claude').catch((error) => {
    if (error.code === 'ENOENT' && platform === 'win32') return attempt('claude.exe');
    throw error;
  });
}

export async function runScenario(scenario, mode, n, resultsDir, {
  env = process.env, tempRoot = os.tmpdir(), execute = runClaude, call = mcpCall, fetchImpl = fetch,
} = {}) {
  const patName = scenario.org === 'lean' ? 'ARCHDOCS_EVAL_PAT_LEAN' : 'ARCHDOCS_EVAL_PAT';
  const pat = env[patName];
  if (!pat?.trim()) throw new Error(`Missing required environment variable ${patName} for ${scenario.id}`);
  const endpoint = env.ARCHDOCS_EVAL_ENDPOINT || 'http://localhost:3000/mcp';
  const tempDir = await mkdtemp(path.join(tempRoot, 'archdocs-eval-'));
  const secrets = [env.ARCHDOCS_EVAL_PAT, env.ARCHDOCS_EVAL_PAT_LEAN,
    env.ARCHDOCS_EVAL_PASSWORD_FULL, env.ARCHDOCS_EVAL_PASSWORD_LEAN];
  try {
    await resetEvalOrg({ ...resetOptions(scenario, env), fetchImpl });
    if (scenario.setup === 'approved-plan') {
      throw new Error('approved-plan setup requires human approval of a fresh fixture after the per-run reset. Pre-existing approved plans are deleted by reset; this scenario needs a manual setup step before Claude can run.');
    }
    const vars = await setupScenario(scenario, { endpoint, pat, tempDir, env, call, fetchImpl });
    const mcpConfigPath = path.join(tempDir, 'mcp.eval.json');
    await writeFile(mcpConfigPath, JSON.stringify({ mcpServers: {
      'archdocs-eval': { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${pat}` } },
    } }), { mode: 0o600 });
    const prompt = substitute(scenario.prompt, vars);
    const args = buildClaudeArgs({ mode, mcpConfigPath, pluginDir: root, tools: scenario.tools });
    const result = await execute(args, prompt, { cwd: tempDir, secrets });
    const stdout = redact(result.stdout, secrets);
    const file = path.join(resultsDir, `${scenario.id}.${mode}.${n}.jsonl`);
    await writeFile(file, stdout);
    const events = [];
    let malformed = false;
    for (const line of stdout.split(/\r?\n/).filter((line) => line.trim())) {
      try { events.push(JSON.parse(line)); } catch { malformed = true; }
    }
    const grade = gradeTranscript(events, scenario.expect);
    if (malformed) grade.failures.push('Claude emitted invalid JSONL');
    if (!events.some((event) => event.type === 'result')) grade.failures.push('Claude emitted no final result event');
    if (events.some((event) => event.type === 'result' && (event.is_error || (event.subtype && event.subtype !== 'success')))) grade.failures.push('Claude reported an unsuccessful result');
    if (result.code !== 0) grade.failures.push(`Claude exited with ${result.code ?? result.signal}: ${redact(result.stderr, secrets).trim()}`);
    if (scenario.expect.state) {
      if (!vars.designDocId) grade.failures.push('State checks need a fixture that creates a design doc');
      else grade.failures.push(...await checkState(scenario.expect.state, {
        invoke: (name, args) => call(endpoint, pat, name, args), designDocId: vars.designDocId,
        authorize: async (draft) => {
          const client = restClient({ ...resetOptions(scenario, env), fetchImpl });
          await client.login();
          await client.request(`/design-docs/${encodeURIComponent(vars.designDocId)}/criteria/baselines/${encodeURIComponent(draft.id)}/authorize`, { method: 'POST', body: { expectedVersion: draft.version } });
        },
      }));
    }
    grade.pass = grade.failures.length === 0;
    return grade;
  } catch (error) { throw new Error(redact(error.message, secrets)); }
  finally { await rm(tempDir, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { console.log(usage); return; }
  await loadEvalEnv();
  let mode = 'both';
  let runs = 3;
  let scenarioId;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (!['--mode', '--runs', '--scenario'].includes(flag) || !value || value.startsWith('--')) throw new Error(`Invalid option: ${flag}. Use --help.`);
    if (flag === '--mode') mode = value;
    if (flag === '--runs') runs = Number(value);
    if (flag === '--scenario') scenarioId = value;
  }
  if (!['with', 'without', 'both'].includes(mode)) throw new Error('--mode must be with, without, or both');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const dir = path.join(root, 'evals', 'scenarios');
  const scenarios = [];
  for (const file of (await readdir(dir)).filter((file) => file.endsWith('.json')).sort()) {
    const scenario = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (!scenarioId || scenario.id === scenarioId) scenarios.push(scenario);
  }
  if (!scenarios.length) throw new Error(`Unknown scenario: ${scenarioId}`);
  // Check every selected credential before creating any fixtures or starting Claude.
  for (const scenario of scenarios) {
    const key = scenario.org === 'lean' ? 'ARCHDOCS_EVAL_PAT_LEAN' : 'ARCHDOCS_EVAL_PAT';
    if (!process.env[key]?.trim()) throw new Error(`Missing required environment variable ${key} for ${scenario.id}`);
    resetOptions(scenario, process.env);
    if (scenario.setup === 'approved-plan') await setupScenario(scenario, { env: process.env });
  }
  const resultsDir = path.join(root, 'evals', 'results', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
  await mkdir(resultsDir, { recursive: true });
  const modes = mode === 'both' ? ['without', 'with'] : [mode];
  console.log('scenario | mode | passes');
  let failed = false;
  for (const scenario of scenarios) for (const selectedMode of modes) {
    let passes = 0;
    for (let n = 1; n <= runs; n++) {
      let grade;
      try { grade = await runScenario(scenario, selectedMode, n, resultsDir); }
      catch (error) { grade = { pass: false, failures: [error.message] }; }
      if (grade.pass) passes++;
      else { failed = true; console.log(`${scenario.id}.${selectedMode}.${n}: ${grade.failures.join('; ')}`); }
    }
    console.log(`${scenario.id} | ${selectedMode} | ${passes}/${runs}`);
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(redact(error.message, [process.env.ARCHDOCS_EVAL_PAT, process.env.ARCHDOCS_EVAL_PAT_LEAN,
      process.env.ARCHDOCS_EVAL_PASSWORD_FULL, process.env.ARCHDOCS_EVAL_PASSWORD_LEAN]));
    process.exitCode = 1;
  });
}
