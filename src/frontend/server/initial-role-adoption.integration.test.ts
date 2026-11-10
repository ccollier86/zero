/** Synthetic file-backed createApp upgrade; no app data, patched DB writes or external providers. */
import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodeJwt } from 'jose';
import { derivePkceS256Challenge } from '../../auth/native';
import { DEFAULT_NATIVE_REFRESH_POLICY } from '../../auth/native/policy-config';
import { createApp } from './app-factory';
import type { AuthAuthorizationOptions } from '../../auth/types';

const CLIENT = 'com.example.initial-role-upgrade', REDIRECT = `${CLIENT}:/oauth/callback`;
const VERIFIER = 'v'.repeat(64), STATE = 's'.repeat(43), NONCE = 'n'.repeat(43);
const binding: AuthAuthorizationOptions = {
  mode: 'simple', registryVersion: 2,
  permissions: { 'support:knowledge-search': { scope: 'application' }, 'support:knowledge-ingest': { scope: 'application' } },
  roles: { admin: { permissions: ['support:knowledge-search', 'support:knowledge-ingest'] } },
  initialRoleAdoption: { fromRegistryVersion: 1, toRegistryVersion: 2, roles: ['admin'] },
};

test('managed populated upgrade preserves web/native families and grants only the explicitly adopted admin binding', async () => {
  const parent = process.env.PROJECT_SCRATCH_DIR ?? (process.platform === 'darwin'
    ? '/Volumes/code-bank/tmp/scratch/zero-platform/auth-initial-role-adoption' : join(tmpdir(), 'zero-platform-tests'));
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'auth-initial-role-adoption-'));
  const identity = await lstat(root), marker = join(root, '.storage-synthetic-fixture.json');
  const encoded = JSON.stringify({ schema: 1, kind: 'synthetic-test-fixture', project: 'zero-platform',
    allocator: 'src/frontend/server/initial-role-adoption.integration.test.ts', run_id: randomUUID(), created_at: new Date().toISOString() });
  const active = new Set<Awaited<ReturnType<typeof createApp>>>();
  let url = '';
  try {
    await writeFile(marker, encoded, { flag: 'wx', mode: 0o600 });
    await mkdir(join(root, 'routes')); await mkdir(join(root, 'application')); await mkdir(join(root, 'system'));
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    url = `http://127.0.0.1:${reservation.port}`; await reservation.stop(true);
    async function start(authorization: 'simple' | AuthAuthorizationOptions) {
      const app = await createApp({
        app: { name: 'Synthetic Role Upgrade', publicUrl: url }, tables: {},
        db: { mode: 'file', path: join(root, 'application/app.db') },
        systemDb: { mode: 'file', path: join(root, 'system/system.db') },
        auth: { tenancy: 'single', authorization, bootstrap: 'public', registration: { mode: 'public' },
          accountEmails: { passwordReset: false },
          nativeApps: { clients: [{ clientId: CLIENT, name: 'Synthetic device', redirectUris: [REDIRECT] }] } },
        appDir: join(root, 'routes'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
        serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false,
        serverRoutesDir: false, resourceRoutes: false, observability: false, ai: false, vector: false, pdf: false,
        kv: false, email: false, workflows: false,
      });
      active.add(app);
      app.get('/api/knowledge-probe', ({ access }: any) => { access.requirePermission('support:knowledge-search'); return { allowed: true }; });
      app.listen({ hostname: '127.0.0.1', port: Number(new URL(url).port) });
      return app;
    }
    async function stop(app: Awaited<ReturnType<typeof createApp>>) { await app.stop(true); active.delete(app); }
    async function json(path: string, body: unknown, headers: Record<string, string> = {}) {
      const response = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return { response, body: await response.json() as any };
    }
    async function form(path: string, fields: Record<string, string>, cookie?: string) {
      const response = await fetch(url + '/auth' + path, { method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: url, ...(cookie ? { Cookie: cookie } : {}) },
        body: new URLSearchParams(fields) });
      return response;
    }
    async function authorization(token: string) {
      const response = await fetch(url + '/auth/authorization', { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200); return await response.json() as any;
    }
    const baseline = await start('simple');
    const owner = await json('/auth/register', { username: 'synthetic-owner', email: 'owner@example.test', password: 'synthetic-password-123' });
    const member = await json('/auth/register', { username: 'synthetic-member', email: 'member@example.test', password: 'synthetic-password-123' });
    expect(owner.response.status).toBe(200); expect(member.response.status).toBe(200);
    expect((await authorization(owner.body.accessToken)).identity.platformRole).toBe('admin');
    const cookie = owner.response.headers.get('set-cookie')!.split(';', 1)[0]!;
    const query = new URLSearchParams({ response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT,
      scope: 'openid profile email', state: STATE, nonce: NONCE,
      code_challenge: await derivePkceS256Challenge(VERIFIER), code_challenge_method: 'S256' });
    const consent = await fetch(url + '/auth/oauth/authorize?' + query, { headers: { Cookie: cookie }, redirect: 'manual' });
    expect(consent.status).toBe(200);
    const requestId = (await consent.text()).match(/name="request_id" value="([^"]+)"/)?.[1]; expect(requestId).toBeString();
    const approved = await form('/oauth/authorize', { request_id: requestId!, decision: 'approve' }, cookie);
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
    const exchanged = await form('/oauth/token', { grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER });
    expect(exchanged.status).toBe(200); const native = await exchanged.json() as any;
    const nativeSid = decodeJwt(native.access_token).sid;
    await stop(baseline);

    const { initialRoleAdoption: _, ...unacknowledged } = binding;
    await expect(start(unacknowledged)).rejects.toMatchObject({ code: 'AUTHORIZATION_ROLE_REACTIVATION_BLOCKED' });
    const upgraded = await start(binding);
    for (const token of [owner.body.accessToken, native.access_token]) {
      const current = await authorization(token);
      expect(current.identity.userId).toBe(owner.body.user.userId);
      expect(current.scope.permissions).toEqual(['support:knowledge-ingest', 'support:knowledge-search']);
      expect((await fetch(url + '/api/knowledge-probe', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    }
    const ordinary = await authorization(member.body.accessToken);
    expect(ordinary.identity.userId).toBe(member.body.user.userId); expect(ordinary.scope.permissions).toEqual([]);
    expect((await fetch(url + '/api/knowledge-probe', { headers: { Authorization: `Bearer ${member.body.accessToken}` } })).status).toBe(403);
    const webRefresh = await json('/auth/refresh', { refreshToken: owner.body.refreshToken }, { Cookie: cookie });
    expect(webRefresh.response.status).toBe(200);
    const nativeRefresh = await form('/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: native.refresh_token });
    expect(nativeRefresh.status).toBe(200); const refreshedNative = await nativeRefresh.json() as any;
    const nativeRotatedAt = Date.now();
    expect(decodeJwt(refreshedNative.access_token).sid).toBe(nativeSid);
    const eventsPath = '/auth/audit/platform/events?action=application.initial-role-binding-adopted';
    const audit = await fetch(url + eventsPath, { headers: { Authorization: `Bearer ${webRefresh.body.accessToken}` } });
    expect(audit.status).toBe(200); const events = await audit.json() as any;
    expect(events.events).toHaveLength(1); expect(events.events[0]).toMatchObject({ targetId: 'admin', outcome: 'succeeded', metadata: { 'retained-count': 1 } });
    await stop(upgraded);

    const restarted = await start(binding);
    expect((await authorization(webRefresh.body.accessToken)).scope.permissions).toHaveLength(2);
    expect((await authorization(refreshedNative.access_token)).scope.permissions).toHaveLength(2);
    const earlyRefresh = await form('/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: refreshedNative.refresh_token });
    expect(earlyRefresh.status).toBe(429);
    expect((await earlyRefresh.json() as any).error).toBe('temporarily_unavailable');
    expect((await authorization(refreshedNative.access_token)).scope.permissions).toHaveLength(2);
    // Respect the real default anti-abuse cadence; never weaken it for this test.
    const remaining = nativeRotatedAt + DEFAULT_NATIVE_REFRESH_POLICY.minRotationIntervalMs + 5 - Date.now();
    if (remaining > 0) await Bun.sleep(remaining);
    const refreshedAgain = await form('/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: refreshedNative.refresh_token });
    expect(refreshedAgain.status).toBe(200);
    expect(decodeJwt((await refreshedAgain.json() as any).access_token).sid).toBe(nativeSid);
    const login = await json('/auth/login', { username: 'owner@example.test', password: 'synthetic-password-123' });
    expect(login.response.status).toBe(200); expect(login.body.user.userId).toBe(owner.body.user.userId);
    const repeatedAudit = await fetch(url + eventsPath, { headers: { Authorization: `Bearer ${login.body.accessToken}` } });
    expect(repeatedAudit.status).toBe(200); expect((await repeatedAudit.json() as any).events).toHaveLength(1);
    await stop(restarted);
  } finally {
    const failures: unknown[] = [];
    for (const app of active) try { await app.stop(true); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, `Owned synthetic fixture retained because shutdown failed: ${root}`);
    const current = await lstat(root);
    if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || await readFile(marker, 'utf8') !== encoded) {
      throw new Error(`Synthetic fixture ownership changed; preserving ${root}`);
    }
    await rm(root, { recursive: true, force: false });
  }
}, 120_000);
