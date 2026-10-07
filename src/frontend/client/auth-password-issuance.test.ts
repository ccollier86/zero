/** Password rotation participates in the same bounded cookie-writer lease. */
import { afterEach, expect, test } from 'bun:test';
import { AuthClient } from './auth-client';
import type { BrowserAuthCoordinationEnvironment } from './auth-browser-coordination';
import { completionUser } from './auth-user-profile-completion.test-fixtures';

const originalFetch = globalThis.fetch;
const clients = new Set<AuthClient>();
afterEach(() => {
  for (const client of clients) client.dispose();
  clients.clear();
  globalThis.fetch = originalFetch;
});

test('password rotation owns HTTP, refresh retry, body parsing and token commit without nesting the lock', async () => {
  const fixture = clientFixture();
  const routes: string[] = [], bearers: (string | null)[] = [];
  let passwordCalls = 0;
  mock((url, init) => {
    routes.push(new URL(url).pathname);
    if (url.endsWith('/auth/login')) return sessionResult();
    expect(fixture.active()).toBe(1);
    if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'rotated-access', refreshToken: 'rotated-proof' });
    bearers.push(new Headers(init?.headers).get('Authorization'));
    expect(JSON.parse(String(init?.body))).toEqual({ currentPassword: 'current', newPassword: 'replacement' });
    passwordCalls++;
    return passwordCalls === 1 ? Response.json({}, { status: 401 })
      : Response.json({ accessToken: 'password-access', refreshToken: 'password-proof' });
  });
  await fixture.client.login('user', 'password');
  await fixture.client.changePassword('current', 'replacement');
  expect(routes).toEqual(['/auth/login', '/auth/change-password', '/auth/refresh', '/auth/change-password']);
  expect(bearers).toEqual(['Bearer initial-access', 'Bearer rotated-access']);
  expect(fixture.admissions()).toBe(2);
  expect(fixture.client.accessToken).toBe('password-access');
});

test('a rejected password refresh retires the session inline and preserves the useful request failure', async () => {
  const fixture = clientFixture();
  mock(url => url.endsWith('/auth/login') ? sessionResult() : Response.json({ error: 'Rejected' }, { status: 401 }));
  await fixture.client.login('user', 'password');
  await expect(fixture.client.changePassword('current', 'replacement')).rejects.toMatchObject({ status: 401 });
  expect(fixture.admissions()).toBe(2);
  expect(fixture.client.user).toBeNull();
  expect(fixture.client.accessToken).toBeNull();
});

test('disposal aborts a password response body and prevents its late token installation', async () => {
  const fixture = clientFixture();
  let release!: (value: unknown) => void;
  let entered!: () => void;
  const body = new Promise<unknown>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let signal: AbortSignal | undefined;
  mock((url, init) => {
    if (url.endsWith('/auth/login')) return sessionResult();
    signal = init?.signal ?? undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        entered();
        const result = await body;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(result)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  });
  await fixture.client.login('user', 'password');
  const pending = fixture.client.changePassword('current', 'replacement');
  const settled = pending.then(() => null, error => error);
  await reading;
  fixture.client.dispose();
  expect(await settled).toMatchObject({ name: 'AbortError' });
  expect(signal?.aborted).toBe(true);
  release({ accessToken: 'late-access', refreshToken: 'late-proof' });
  await Bun.sleep(1);
  expect(fixture.client.accessToken).toBe('initial-access');
});

function clientFixture() {
  let tail: Promise<unknown> = Promise.resolve(), active = 0, admissions = 0, id = 0;
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; }, clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; }, key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); }, setItem(key, value) { values.set(key, value); },
  };
  const coordination: BrowserAuthCoordinationEnvironment = {
    storage, createChannel: null, addStorageListener: () => () => {}, randomId: () => `password-${++id}`,
    locks: {
      request<T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
        const result = tail.then(async () => {
          active++; admissions++;
          try { return await callback(); } finally { active--; }
        });
        tail = result.catch(() => {});
        return result;
      },
    },
  };
  const client = new AuthClient('https://password-issuance.test', { browserAuthCoordination: coordination });
  clients.add(client);
  return { client, active: () => active, admissions: () => admissions };
}
function sessionResult() {
  return Response.json({ user: completionUser(), accessToken: 'initial-access', refreshToken: 'initial-proof' });
}
function mock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => Promise.resolve().then(() => handler(String(input), init))) as typeof fetch;
}
