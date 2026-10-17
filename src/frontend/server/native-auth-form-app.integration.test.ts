/** Raw OAuth forms must survive the complete managed createApp middleware stack. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import { derivePkceS256Challenge } from '../../auth/native';
import { createApp } from './app-factory';

const CLIENT_ID = 'com.example.managed-native';
const REDIRECT_URI = `${CLIENT_ID}:/oauth/callback`;
const VERIFIER = 'v'.repeat(64);
const STATE = 's'.repeat(43);
const NONCE = 'n'.repeat(43);
const FORM_PATHS = [
  '/oauth/authorize', '/oauth/token', '/oauth/revoke',
  '/oauth/tenants', '/oauth/tenants/switch',
] as const;

interface Harness {
  app: Awaited<ReturnType<typeof createApp>>;
  url: string;
  issuer: string;
  root: string;
}

const active: Harness[] = [];
const sockets = new Set<WebSocket>();

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.clear();
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop(true);
    await rm(harness.root, { recursive: true, force: true });
  }
});

describe('managed native OAuth form ownership', () => {
  test('authorizes, exchanges, refreshes and revokes through managed HTTP and Sync', async () => {
    const h = await start();
    const owner = await register(h, 'managed-native-owner');
    const code = await approveCode(h, owner.cookie);
    const exchange = await exchangeCode(h, code);
    expect(exchange.status).toBe(200);
    expect(exchange.headers.get('cache-control')).toBe('no-store');
    expect(decodeJwt(exchange.body.id_token)).toMatchObject({ nonce: NONCE });
    expect(await nativeContext(h, exchange.body.access_token)).toMatchObject({
      userId: owner.body.user.userId, clientId: CLIENT_ID, sessionKind: 'native',
    });

    const replayed = await exchangeCode(h, code);
    expect(replayed.status).toBe(400);
    expect(replayed.body.error).toBe('invalid_grant');

    const refreshed = await form(h, '/oauth/token', {
      grant_type: 'refresh_token', client_id: CLIENT_ID,
      refresh_token: exchange.body.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(exchange.body.refresh_token);
    expect(decodeJwt(refreshed.body.access_token).sid)
      .toBe(decodeJwt(exchange.body.access_token).sid);

    const listed = await form(h, '/oauth/tenants', {
      client_id: CLIENT_ID, refresh_token: refreshed.body.refresh_token,
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ activeTenantId: null, tenants: [] });

    const socket = await connectSync(h, refreshed.body.access_token);
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener('close', resolve, { once: true });
    });
    const revoked = await form(h, '/oauth/revoke', {
      client_id: CLIENT_ID, token: refreshed.body.refresh_token,
    });
    expect(revoked.status).toBe(200);
    expect(revoked.text).toBe('');
    expect(await nativeContext(h, refreshed.body.access_token)).toEqual({ anonymous: true });
    expect((await within(closed, 'revoked managed Sync connection')).code).toBe(4001);
    const afterRevoke = await form(h, '/oauth/token', {
      grant_type: 'refresh_token', client_id: CLIENT_ID,
      refresh_token: refreshed.body.refresh_token,
    });
    expect(afterRevoke.status).toBe(400);
    expect(afterRevoke.body.error).toBe('invalid_grant');
  }, 30_000);

  test('preserves same-origin, browser-owner, denial and PKCE checks', async () => {
    const h = await start();
    const owner = await register(h, 'managed-consent-owner');
    const other = await register(h, 'managed-consent-other');
    const requestId = await pendingRequest(h, owner.cookie);
    const input = { request_id: requestId, decision: 'approve' };
    const foreign = await form(h, '/oauth/authorize', input, {
      Cookie: owner.cookie, Origin: 'https://foreign.example',
    });
    expect(foreign.status).toBe(400);
    expect(foreign.headers.get('location')).toBeNull();

    const wrongOwner = await form(h, '/oauth/authorize', input, { Cookie: other.cookie });
    expect(wrongOwner.status).toBe(302);
    expect(callback(wrongOwner).searchParams.get('error')).toBe('access_denied');
    expect(callback(wrongOwner).searchParams.get('code')).toBeNull();

    const approved = await form(h, '/oauth/authorize', input, { Cookie: owner.cookie });
    expect(approved.status).toBe(302);
    const badProof = await exchangeCode(h, callback(approved).searchParams.get('code')!, 'x'.repeat(64));
    expect(badProof.status).toBe(400);
    expect(badProof.body.error).toBe('invalid_grant');

    const denied = await form(h, '/oauth/authorize', {
      request_id: await pendingRequest(h, owner.cookie), decision: 'deny',
    }, { Cookie: owner.cookie });
    expect(denied.status).toBe(302);
    expect(callback(denied).searchParams.get('error')).toBe('access_denied');
    expect(callback(denied).searchParams.get('state')).toBe(STATE);
    expect(callback(denied).searchParams.get('code')).toBeNull();
    expect(denied.headers.get('referrer-policy')).toBe('no-referrer');
  }, 30_000);

  test('rejects missing, null and hostile Origins for approval and denial without consuming consent', async () => {
    const h = await start();
    const owner = await register(h, 'managed-consent-origin');
    const requestId = await pendingRequest(h, owner.cookie);
    for (const decision of ['approve', 'deny']) {
      for (const origin of [undefined, 'null', 'https://foreign.example']) {
        const headers = new Headers({ Cookie: owner.cookie, 'Content-Type': 'application/x-www-form-urlencoded' });
        if (origin !== undefined) headers.set('Origin', origin);
        const rejected = await fetch(`${h.issuer}/oauth/authorize`, {
          method: 'POST', redirect: 'manual', headers,
          body: new URLSearchParams({ request_id: requestId, decision }),
        });
        expect(rejected.status).toBe(400);
        expect(rejected.headers.get('location')).toBeNull();
        expect(await rejected.text()).toContain('Authorization confirmation was rejected.');
      }
    }
    const approved = await form(h, '/oauth/authorize', {
      request_id: requestId, decision: 'approve',
    }, { Cookie: owner.cookie });
    expect(approved.status).toBe(302);
    expect(callback(approved).searchParams.has('code')).toBe(true);
    expect(approved.headers.get('referrer-policy')).toBe('no-referrer');
  }, 30_000);

  test('lists and switches a real tenant-bound family using managed form routes', async () => {
    const h = await start('multi');
    const owner = await register(h, 'managed-tenant-owner');
    const tenantId = owner.body.tenant.tenantId;
    const first = await exchangeCode(h, await approveCode(h, owner.cookie));
    expect(first.status).toBe(200);
    expect(first.body.active_tenant.tenantId).toBe(tenantId);
    const fields = { client_id: CLIENT_ID, refresh_token: first.body.refresh_token };
    const listed = await form(h, '/oauth/tenants', fields);
    expect(listed.status).toBe(200);
    expect(listed.body.activeTenantId).toBe(tenantId);
    expect(listed.body.tenants).toContainEqual(expect.objectContaining({ tenantId }));

    const switched = await form(h, '/oauth/tenants/switch', { ...fields, tenant_id: tenantId });
    expect(switched.status).toBe(200);
    expect(switched.body.active_tenant.tenantId).toBe(tenantId);
    expect(decodeJwt(switched.body.access_token).sid).not.toBe(decodeJwt(first.body.access_token).sid);
    expect(await nativeContext(h, first.body.access_token)).toEqual({ anonymous: true });
    expect(await nativeContext(h, switched.body.access_token)).toMatchObject({ tenantId });
  }, 30_000);

  test('leaves content-type, size and duplicate-field validation to the strict form reader', async () => {
    const h = await start();
    for (const path of FORM_PATHS) {
      const wrongType = await rawForm(h, path, '{}', { 'Content-Type': 'application/json' });
      expect(wrongType.status).toBe(400);
      expect(wrongType.text).toContain('Form-encoded request body required.');
      const oversized = await rawForm(h, path, `x=${'x'.repeat(16_385)}`);
      expect(oversized.status).toBe(400);
      expect(oversized.text).toContain('OAuth request body is too large.');
    }
    const duplicateFields = [
      ['/oauth/authorize', 'request_id=a&request_id=b&decision=approve'],
      ['/oauth/token', 'grant_type=authorization_code&grant_type=refresh_token'],
      ['/oauth/revoke', `token=a&token=b&client_id=${CLIENT_ID}`],
      ['/oauth/tenants', `refresh_token=a&client_id=${CLIENT_ID}&client_id=${CLIENT_ID}`],
      ['/oauth/tenants/switch', `refresh_token=a&client_id=${CLIENT_ID}&tenant_id=a&tenant_id=b`],
    ];
    for (const [path, body] of duplicateFields) {
      const rejected = await rawForm(h, path, body);
      expect(rejected.status).toBe(400);
      expect(rejected.text).toContain('required exactly once');
    }
  }, 30_000);

  test('rejects public-client secrets and Basic credentials on all machine form routes', async () => {
    const h = await start();
    for (const path of FORM_PATHS.filter((path) => path !== '/oauth/authorize')) {
      for (const name of ['client_secret', 'client_assertion']) {
        const rejected = await form(h, path, { [name]: 'not-a-native-secret' });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error).toBe('invalid_client');
      }
      const basic = await form(h, path, {}, { Authorization: 'Basic Zm9vOmJhcg==' });
      expect(basic.status).toBe(401);
      expect(basic.body.error).toBe('invalid_client');
      expect(basic.headers.get('www-authenticate')).toBe('Basic realm="Zero native OAuth"');
    }
  }, 30_000);

  test('does not disable normal managed JSON or URL-encoded body parsing', async () => {
    const h = await start();
    for (const [contentType, body] of [
      ['application/json', JSON.stringify({ title: 'JSON still parsed' })],
      ['application/x-www-form-urlencoded', 'title=Form+still+parsed'],
    ]) {
      const response = await fetch(`${h.url}/api/parser-proof`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ title: contentType === 'application/json'
        ? 'JSON still parsed' : 'Form still parsed' });
    }
  }, 30_000);
});

async function start(tenancy: 'single' | 'multi' = 'single'): Promise<Harness> {
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? join(tmpdir(), 'zero-platform-tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'native-oauth-form-'));
  await mkdir(join(root, 'app'), { recursive: true });
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  const url = `http://127.0.0.1:${port}`;
  let app: Harness['app'];
  try {
    app = await createApp({
      app: { name: 'Managed Native Form Test', publicUrl: url },
      db: { mode: 'memory' }, tables: {},
      auth: { tenancy, bootstrap: 'public', registration: { mode: 'public' },
        accountEmails: { passwordReset: false },
        nativeApps: { clients: [{ clientId: CLIENT_ID, name: 'Managed Native', redirectUris: [REDIRECT_URI] }] },
      },
      appDir: join(root, 'app'), outDir: join(root, 'out'),
      generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
      serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false,
      serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      observability: false, ai: false, vector: false, pdf: false, kv: false,
      email: false, workflows: false, migrate: false,
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const h = { app, root, url, issuer: `${url}/auth` };
  active.push(h);
  // App extensions may inspect parsed bodies. This enables Elysia's body
  // inference for the composition without reading or patching Request itself.
  app.onBeforeHandle(({ body }) => { void body; });
  app.get('/api/native-form-context', ({ authContext }: any) => authContext ?? { anonymous: true });
  app.post('/api/parser-proof', ({ body }) => body);
  app.listen({ hostname: '127.0.0.1', port });
  return h;
}

async function register(h: Harness, username: string) {
  const response = await fetch(`${h.url}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.test`, password: 'password123',
      ...(username.includes('tenant') ? { organizationName: 'Managed Tenant' } : {}) }),
  });
  const body = await response.json() as any;
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]!;
  return { body, cookie };
}

async function pendingRequest(h: Harness, cookie: string): Promise<string> {
  const query = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI, scope: 'openid profile email', state: STATE, nonce: NONCE,
    code_challenge: await derivePkceS256Challenge(VERIFIER), code_challenge_method: 'S256' });
  const response = await fetch(`${h.issuer}/oauth/authorize?${query}`, {
    headers: { Cookie: cookie }, redirect: 'manual',
  });
  expect(response.status).toBe(200);
  const html = await response.text();
  const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1];
  if (!requestId) throw new Error('Managed authorization page omitted request_id');
  return requestId;
}

async function approveCode(h: Harness, cookie: string): Promise<string> {
  const approved = await form(h, '/oauth/authorize', {
    request_id: await pendingRequest(h, cookie), decision: 'approve',
  }, { Cookie: cookie });
  expect(approved.status).toBe(302);
  expect(approved.headers.get('referrer-policy')).toBe('no-referrer');
  const target = callback(approved);
  expect(target.searchParams.get('state')).toBe(STATE);
  expect(target.searchParams.get('iss')).toBe(h.issuer);
  const code = target.searchParams.get('code');
  if (!code) throw new Error('Managed authorization did not issue a code');
  return code;
}

function exchangeCode(h: Harness, code: string, verifier = VERIFIER) {
  return form(h, '/oauth/token', { grant_type: 'authorization_code', client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI, code, code_verifier: verifier });
}

function form(h: Harness, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return rawForm(h, path, new URLSearchParams(fields).toString(), headers);
}

async function rawForm(h: Harness, path: string, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${h.issuer}${path}`, {
    method: 'POST', redirect: 'manual', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: h.url, ...headers },
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text,
    body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) as any : null };
}

function callback(result: { headers: Headers }): URL {
  return new URL(result.headers.get('location')!);
}

function nativeContext(h: Harness, token: string): Promise<any> {
  return fetch(`${h.url}/api/native-form-context`, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => response.json());
}

async function connectSync(h: Harness, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${h.url.replace('http:', 'ws:')}/sync`);
  sockets.add(socket);
  await within(new Promise<void>((resolve, reject) => {
    socket.onopen = () => socket.send(JSON.stringify({ type: 'sync.auth', token }));
    socket.onerror = () => reject(new Error('Managed Sync connection failed'));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.type === 'sync.auth.ready' && message.authenticated === true) resolve();
    };
    socket.addEventListener('close', () => reject(new Error('Managed Sync closed before authentication')), { once: true });
  }), 'native managed Sync authentication');
  return socket;
}

async function within<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 3_000);
    })]);
  } finally { clearTimeout(timer); }
}
