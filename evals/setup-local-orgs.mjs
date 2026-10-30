import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadEvalEnv } from './run.mjs';

const outputFile = new URL('./.eval-env', import.meta.url);
const apiEnvFile = new URL('../../archdocs/apps/api/.env', import.meta.url);
const accounts = [
  { key: 'FULL', label: 'full', email: 'eval-full@archdocs.test', name: 'Eval Full', patKey: 'ARCHDOCS_EVAL_PAT', enabled: true },
  { key: 'LEAN', label: 'lean', email: 'eval-lean@archdocs.test', name: 'Eval Lean', patKey: 'ARCHDOCS_EVAL_PAT_LEAN', enabled: false },
];

export async function main() {
  const api = new URL(process.env.ARCHDOCS_EVAL_API || 'http://localhost:4500');
  // Credentials must never be sent to a remote host by this local setup script.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(api.hostname) || api.username || api.password || !['http:', 'https:'].includes(api.protocol)) {
    throw new Error('ARCHDOCS_EVAL_API must be a local HTTP(S) API URL without credentials.');
  }
  api.pathname = api.pathname.replace(/\/$/, '');
  api.search = '';
  api.hash = '';
  const base = api.href.replace(/\/$/, '');
  const stored = await loadEvalEnv({ file: outputFile, env: {} });
  const values = { ARCHDOCS_EVAL_ENDPOINT: `${base}/mcp` };
  for (const account of accounts) {
    const passwordKey = `ARCHDOCS_EVAL_PASSWORD_${account.key}`;
    values[passwordKey] = stored[passwordKey] || `Aa1!${randomBytes(32).toString('base64url')}`;
    if (stored[account.patKey]) values[account.patKey] = stored[account.patKey];
  }
  const save = () => writeFile(outputFile, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), { mode: 0o600 });

  // Read only the reference API's mail configuration, never print its contents.
  const mailEnv = parseEnv(await readFile(apiEnvFile, 'utf8'));
  const mailEnabled = Boolean(mailEnv.RESEND_API_KEY);
  console.log(`Mail: Resend key ${mailEnabled ? 'set' : 'unset'} in API .env; registration recipients restricted to archdocs.test.`);
  if (mailEnabled) console.log(`Mail: ${mailEnv.APP_ENV === 'prod' ? 'production delivery to non-routable archdocs.test recipients' : 'non-prod API redirects recipients to Resend sandbox addresses'}.`);
  console.log('Auth: email verification is not required for login; no verification bypass used.');

  async function request(route, { method = 'GET', body, token, orgId } = {}) {
    let response;
    try {
      response = await fetch(`${base}${route}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(orgId ? { 'x-organization-id': orgId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error(`${method} ${route} failed to reach the local API.`); }
    // Response bodies and transport errors can contain credentials. Never log them.
    if (!response.ok) throw new Error(`${method} ${route} failed (HTTP ${response.status}). Check API availability and saved eval passwords.`);
    try { return await response.json(); }
    catch { throw new Error(`${method} ${route} returned invalid JSON.`); }
  }

  // Checkpoint passwords before signup so an interrupted run can recover by login.
  await save();
  for (const account of accounts) {
    const passwordKey = `ARCHDOCS_EVAL_PASSWORD_${account.key}`;
    const password = values[passwordKey];
    let auth;
    let created = false;
    if (stored[passwordKey]) {
      try {
        auth = await request('/auth/login', { method: 'POST', body: { email: account.email, password } });
      } catch (error) {
        // Also recover when a previous run checkpointed a password before signup.
        if (!error.message.includes('(HTTP 401)')) throw error;
      }
    }
    if (!auth) {
      if (account.email.split('@')[1] !== 'archdocs.test') throw new Error('Registration requires an archdocs.test recipient.');
      // AuthService.register bootstraps the org, owner role and core object kinds.
      auth = await request('/auth/register', {
        method: 'POST', body: { email: account.email, name: account.name, organizationName: account.name, password },
      });
      created = true;
    }
    if (!auth.token || !Array.isArray(auth.organizations)) throw new Error(`${account.label}: authentication response missing token or organizations.`);
    const matches = auth.organizations.filter((org) => org.name === account.name);
    if (matches.length !== 1) throw new Error(`${account.label}: expected exactly one organization named ${account.name}.`);
    const orgId = matches[0].id;
    // The API has no persisted active-org field. Select it on every request;
    // POST /pat binds this same organization into the MCP principal.
    const scoped = (route, options = {}) => request(route, { ...options, token: auth.token, orgId });
    await scoped(`/organizations/${orgId}`);
    console.log(`${account.label}: user ${created ? 'created' : 'reused'}; organization ${created ? 'created' : 'reused'}; active organization selected.`);

    const status = await scoped('/sample-workspace');
    let seeded = false;
    if (!status.seeded) seeded = (await scoped('/sample-workspace', { method: 'POST', body: {} })).created;
    if (!(await scoped('/sample-workspace')).seeded) throw new Error(`${account.label}: sample workspace was not seeded.`);
    console.log(`${account.label}: Cadence sample workspace ${seeded ? 'created' : 'reused'}.`);

    const features = { approvals: account.enabled, sizes: account.enabled, evidenceTracking: account.enabled };
    const sameFeatures = (settings) => Object.entries(features).every(([key, value]) => settings.features?.[key] === value);
    const settings = await scoped('/design-doc-settings');
    const changed = !sameFeatures(settings);
    // Persist false explicitly too, so lean stays deterministic on reruns.
    await scoped('/design-doc-settings', { method: 'PUT', body: features });
    if (!sameFeatures(await scoped('/design-doc-settings'))) throw new Error(`${account.label}: design doc settings did not match.`);
    console.log(`${account.label}: design doc settings ${changed ? 'updated' : 'reused'} (approvals=${account.enabled}, sizes=${account.enabled}, evidenceTracking=${account.enabled}).`);

    // MCP handlers authorize with PermissionService, not PAT scopes. The org
    // owner has all permissions for design docs, ADRs, comments, objects and docs.
    const pat = await scoped('/pat', { method: 'POST', body: { name: `Local eval ${account.label}`, scopes: [] } });
    if (!pat.token) throw new Error(`${account.label}: PAT creation returned no token.`);
    values[account.patKey] = pat.token;
    await save();
    console.log(`${account.label}: fresh PAT created with the owner's MCP permissions.`);
  }
  console.log('Wrote evals/.eval-env (credentials hidden).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Only our controlled errors are safe to display. Unexpected IO errors may
    // include paths or input, so keep the final diagnostic credential-free.
    console.error(error.message.startsWith('ARCHDOCS_EVAL_API') || /^(?:GET|POST|PUT) \/|^(?:full|lean):|^Registration requires/.test(error.message)
      ? error.message : 'Local eval setup failed. Check API .env and evals/.eval-env file access.');
    process.exitCode = 1;
  });
}
