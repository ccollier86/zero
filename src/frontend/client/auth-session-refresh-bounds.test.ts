/** Ordinary API/Sync refresh must never hold the shared credential lock forever. */
import { afterEach, expect, test } from 'bun:test';
import { AuthSessionController } from './auth-session';
import { BrowserAuthCoordinator, type BrowserAuthCoordinationEnvironment } from './auth-browser-coordination';
import { completionUser } from './auth-user-profile-completion.test-fixtures';

const originalFetch = globalThis.fetch;
const controllers = new Set<AuthSessionController>();
afterEach(() => { for (const controller of controllers) controller.dispose(); controllers.clear(); globalThis.fetch = originalFetch; });
async function session(coordination?: BrowserAuthCoordinationEnvironment) {
  const controller = new AuthSessionController('http://ordinary-refresh-bounds.test', {
    coordination: coordination ?? { storage: null, locks: null, createChannel: null, addStorageListener: () => () => {} },
    recoveryRequestTimeoutMs: 10,
  });
  controllers.add(controller);
  await controller.completeAuthentication({ user: completionUser(), accessToken: 'synthetic-access', refreshToken: 'original-proof' });
  return controller;
}
function mock(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const rotated = () => Response.json({ accessToken: 'recovered-access', refreshToken: 'recovered-proof' });

for (const mode of ['headers', 'body'] as const) test(`ordinary held ${mode} is bounded, preserves ambiguous proof, and admits recovery/logout afterward`, async () => {
  const controller = await session(), gate = deferred<Response>(), body = deferred<unknown>();
  let phase = 'held', signal: AbortSignal | undefined, sends = 0;
  mock((url, init) => {
    sends++;
    if (phase === 'held') {
      signal = init.signal ?? undefined;
      if (mode === 'headers') return gate.promise;
      const response = rotated(); response.json = () => body.promise; return response;
    }
    if (url.endsWith('/auth/refresh')) return rotated();
    if (url.endsWith('/auth/me')) return Response.json(completionUser());
    return Response.json({ ok: true });
  });
  const first = controller.refresh(), duplicate = controller.refresh();
  expect(await first).toBe(false); expect(await duplicate).toBe(false);
  expect(sends).toBe(1); expect(signal?.aborted).toBe(true);
  expect(controller.hasRecoverableSession).toBe(true); expect(controller.refreshToken).toBe('original-proof');
  expect(controller.isAuthenticated).toBe(true);
  phase = 'healthy';
  expect(await controller.recoverSession()).toEqual({ kind: 'authenticated' });
  expect(controller.refreshToken).toBe('recovered-proof');
  // A provider that ignored cancellation cannot publish late accepted bytes.
  gate.resolve(Response.json({ accessToken: 'late-access', refreshToken: 'late-proof' }));
  body.resolve({ accessToken: 'late-access', refreshToken: 'late-proof' });
  await Promise.resolve(); await Promise.resolve();
  expect(controller.refreshToken).toBe('recovered-proof');
  await controller.logout(); expect(controller.hasRecoverableSession).toBe(false); expect(controller.user).toBeNull();
});

test('disposing an ordinary refresh cancels its request and refuses late credential publication', async () => {
  const controller = await session(), gate = deferred<Response>(), reached = deferred<void>(); let signal: AbortSignal | undefined;
  mock((_url, init) => { signal = init.signal ?? undefined; reached.resolve(); return gate.promise; });
  const refresh = controller.refresh(); await reached.promise; controller.dispose();
  await expect(refresh).rejects.toMatchObject({ name: 'AbortError' }); expect(signal?.aborted).toBe(true);
  gate.resolve(rotated()); await Promise.resolve(); await Promise.resolve();
  expect(controller.refreshToken).toBe('original-proof');
});

test('retiring an ordinary refresh scope cancels its transport, without waiting for its deadline', async () => {
  const controller = await session(), gate = deferred<Response>(), reached = deferred<void>(), scope = new AbortController();
  let signal: AbortSignal | undefined;
  mock((_url, init) => { signal = init.signal ?? undefined; reached.resolve(); return gate.promise; });
  const refresh = controller.refresh(() => scope.signal.throwIfAborted(), () => {}, scope.signal);
  await reached.promise; scope.abort();
  await expect(refresh).rejects.toMatchObject({ name: 'AbortError' }); expect(signal?.aborted).toBe(true);
  gate.resolve(rotated()); await Promise.resolve(); await Promise.resolve();
  expect(controller.refreshToken).toBe('original-proof');
});

test('timed-out ordinary lock admission cannot run its abandoned callback later', async () => {
  const gate = deferred<void>(); let hold = false, sends = 0, late = false;
  const controller = new AuthSessionController('http://ordinary-refresh-admission.test', {
    coordination: { storage: null, createChannel: null, addStorageListener: () => () => {}, locks: {
      async request(_name, _options, callback) { if (hold) await gate.promise;
        try { return await callback(); } finally { if (hold) late = true; } },
    } }, recoveryRequestTimeoutMs: 10,
  });
  controllers.add(controller);
  await controller.completeAuthentication({ user: completionUser(), accessToken: 'synthetic-access', refreshToken: 'original-proof' });
  mock(() => { sends++; return rotated(); }); hold = true;
  expect(await controller.refresh()).toBe(false); expect(sends).toBe(0);
  gate.resolve();
  for (let attempt = 0; attempt < 20 && !late; attempt++) await new Promise(done => setTimeout(done, 0));
  expect(late).toBe(true); expect(sends).toBe(0); expect(controller.refreshToken).toBe('original-proof');
  hold = false; expect(await controller.refresh()).toBe(true); expect(sends).toBe(1);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
for (const route of ['refresh', 'me'] as const) for (const mode of ['headers', 'body'] as const) {
  test(`replacement-family ${route} held ${mode} releases the lock and recovers B without retaining A identity`, async () => {
    const environment = { storage: new MemoryStorage(), locks: null, createChannel: null, addStorageListener: () => () => {} };
    const controller = await session(environment), peer = new BrowserAuthCoordinator('http://ordinary-refresh-bounds.test', environment);
    peer.commitSession('replacement-proof', 'replacement-family', 'scope'); peer.dispose();
    const gate = deferred<Response>(), body = deferred<unknown>(); let phase = 'held', signal: AbortSignal | undefined;
    const b = completionUser('user-b');
    mock((url, init) => {
      if (phase === 'held' && url.endsWith(`/auth/${route}`)) {
        signal = init.signal ?? undefined;
        if (mode === 'headers') return gate.promise;
        const response = Response.json({}); response.json = () => body.promise; return response;
      }
      return url.endsWith('/auth/refresh') ? rotated() : Response.json(url.endsWith('/auth/me') ? b : { ok: true });
    });
    await expect(controller.updateTokens('never-adopt-access', 'never-adopt-proof')).rejects.toMatchObject({ code: 'AUTH_SCOPE_SYNCHRONIZATION_REQUIRED' });
    expect(signal?.aborted).toBe(true); expect(controller.user).toBeNull(); expect(controller.activeTenant).toBeNull();
    expect(controller.hasRecoverableSession).toBe(true); expect(controller.isLoading).toBe(false);
    expect(controller.refreshToken).toBe(route === 'refresh' ? 'replacement-proof' : 'recovered-proof');
    phase = 'healthy'; await controller.reconcileSession();
    expect(await controller.recoverSession()).toEqual({ kind: 'authenticated' }); expect(controller.user?.userId).toBe('user-b');
    gate.resolve(Response.json(route === 'refresh' ? { accessToken: 'late-access', refreshToken: 'late-proof' } : completionUser()));
    body.resolve(route === 'refresh' ? { accessToken: 'late-access', refreshToken: 'late-proof' } : completionUser());
    await Promise.resolve(); await Promise.resolve(); expect(controller.user?.userId).toBe('user-b');
    await controller.logout(); expect(controller.user).toBeNull();
  });
}
