import { afterEach, describe, expect, test } from 'bun:test';
import { AuthClient, type AuthAuthorizationScopeLifecycle } from './auth-client';
import {
  BrowserAuthCoordinator,
  getBrowserAuthStorageKeys,
  type BrowserAuthCoordinationEnvironment,
} from './auth-browser-coordination';
import type { AuthUser } from './auth-types';
import { AuthSessionController } from './auth-session';

const baseUrl = 'http://session-recovery.test';
const originalFetch = globalThis.fetch;
const clients: AuthClient[] = [];
const controllers: AuthSessionController[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  for (const controller of controllers.splice(0)) controller.dispose();
  globalThis.fetch = originalFetch;
});

describe('explicit browser session recovery', () => {
  for (const status of [404, 429, 500, 503]) {
    test(`startup refresh HTTP ${status} retains proof for a complete retry`, async () => {
      const fixture = seeded();
      let available = false;
      const requests: string[] = [];
      mockFetch((url) => {
        requests.push(url);
        if (url.endsWith('/auth/refresh')) {
          return available ? refreshed() : Response.json({ error: 'Private upstream detail' }, { status });
        }
        if (url.endsWith('/auth/me')) return Response.json(user());
        if (url.endsWith('/auth/authorization')) return Response.json(authorization());
        throw new Error(`Unexpected synthetic route: ${url}`);
      });
      const lifecycle = scopeLifecycle();
      const client = createClient(fixture.environment, lifecycle.api);
      await settled(client);
      expect(client.hasRecoverableSession).toBe(true);
      expect(client.user).toBeNull();
      expect(fixture.credential()?.refreshToken).toBe('stored-refresh');
      available = true;
      expect(await client.recoverSession()).toEqual({ kind: 'authenticated' });
      expect(client.user?.userId).toBe('u_recovery');
      expect(client.authorizationState.status).toBe('ready');
      expect(fixture.credential()?.refreshToken).toBe('rotated-refresh');
      expect(lifecycle.events).toEqual(['begin', 'complete']);
      expect(requests.filter((url) => url.endsWith('/auth/me'))).toHaveLength(1);
    });
  }

  test('network and malformed startup responses retain proof without reporting authentication', async () => {
    for (const mode of ['network', 'json', 'shape'] as const) {
      const fixture = seeded();
      mockFetch(() => {
        if (mode === 'network') throw new Error('Private credential-like transport detail');
        return mode === 'json'
          ? new Response('{ invalid', { headers: { 'Content-Type': 'application/json' } })
          : Response.json({ accessToken: 'only-half-a-session' });
      });
      const client = createClient(fixture.environment);
      await settled(client);
      expect(client.hasRecoverableSession).toBe(true);
      expect(client.isAuthenticated).toBe(false);
      expect(fixture.credential()?.refreshToken).toBe('stored-refresh');
      expect(client.error).not.toContain('Private');
      client.dispose();
    }
  });

  for (const mode of ['503', '404', 'network', 'json', 'shape'] as const) {
    test(`a ${mode} /me failure retains the rotated proof and can recover`, async () => {
      const fixture = seeded();
      let startup = true;
      let healthy = false;
      mockFetch((url) => {
        if (url.endsWith('/auth/refresh')) {
          return startup ? Response.json({}, { status: 503 }) : refreshed();
        }
        if (url.endsWith('/auth/me')) {
          if (healthy) return Response.json(user());
          if (mode === 'network') throw new Error('Internal service detail');
          if (mode === 'json') return new Response('{');
          if (mode === 'shape') return Response.json({ userId: 'malformed' });
          return Response.json({ error: 'Internal service detail' }, { status: Number(mode) });
        }
        return Response.json(authorization());
      });
      const client = createClient(fixture.environment);
      await settled(client);
      startup = false;
      const failed = await client.recoverSession();
      expect(failed).toEqual({ kind: 'retryable', error: 'Unable to verify the browser session. Please retry.' });
      expect(client.hasRecoverableSession).toBe(true);
      expect(client.user).toBeNull();
      expect(client.isRestoring).toBe(false);
      expect(fixture.credential()?.refreshToken).toBe('rotated-refresh');
      healthy = true;
      expect(await client.recoverSession()).toEqual({ kind: 'authenticated' });
      expect(client.user?.userId).toBe('u_recovery');
    });
  }

  for (const route of ['refresh', 'me'] as const) {
    for (const status of [401, 403]) {
      test(`${route} HTTP ${status} deliberately settles sign-out behind the scope barrier`, async () => {
        const fixture = seeded();
        let startup = true;
        mockFetch((url) => {
          if (url.endsWith('/auth/refresh')) {
            if (startup) return Response.json({}, { status: 503 });
            return route === 'refresh' ? Response.json({}, { status }) : refreshed();
          }
          if (url.endsWith('/auth/me')) return Response.json({}, { status });
          throw new Error('Authorization must not run for rejected identity');
        });
        const lifecycle = scopeLifecycle();
        const client = createClient(fixture.environment, lifecycle.api);
        await settled(client);
        startup = false;
        expect(await client.recoverSession()).toEqual({ kind: 'signed-out' });
        expect(client.hasRecoverableSession).toBe(false);
        expect(client.user).toBeNull();
        expect(client.authorizationScopeKey).toBeNull();
        expect(fixture.credential()?.refreshToken).toBeNull();
        expect(lifecycle.events).toEqual(['begin', 'complete']);
      });
    }
  }

  test('authorization outages retain hydrated identity and retryable proof', async () => {
    const fixture = seeded();
    let startup = true;
    let authorized = false;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return startup ? Response.json({}, { status: 503 }) : refreshed();
      if (url.endsWith('/auth/me')) return Response.json(user());
      return authorized ? Response.json(authorization()) : Response.json({}, { status: 503 });
    });
    const client = createClient(fixture.environment, scopeLifecycle().api);
    await settled(client);
    startup = false;
    expect(await client.recoverSession()).toEqual({ kind: 'retryable', error: 'Unable to verify current access. Please retry.' });
    expect(client.user?.userId).toBe('u_recovery');
    expect(client.hasRecoverableSession).toBe(true);
    expect(client.authorizationState.status).toBe('error');
    authorized = true;
    expect(await client.recoverSession()).toEqual({ kind: 'authenticated' });
  });

  for (const status of [401, 403]) {
    test(`live authorization HTTP ${status} expires only the recovered credential`, async () => {
      const fixture = seeded();
      let startup = true;
      mockFetch((url) => {
        if (url.endsWith('/auth/refresh')) return startup ? Response.json({}, { status: 503 }) : refreshed();
        if (url.endsWith('/auth/me')) return Response.json(user());
        return Response.json({}, { status });
      });
      const client = createClient(fixture.environment, scopeLifecycle().api);
      await settled(client);
      startup = false;
      expect(await client.recoverSession()).toEqual({ kind: 'signed-out' });
      expect(client.hasRecoverableSession).toBe(false);
      expect(client.user).toBeNull();
      expect(fixture.credential()?.refreshToken).toBeNull();
    });
  }

  test('concurrent explicit retries share one complete recovery', async () => {
    const fixture = seeded();
    let startup = true;
    const gate = deferred<Response>();
    let refreshes = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1;
        return startup ? Response.json({}, { status: 503 }) : gate.promise;
      }
      return Response.json(url.endsWith('/auth/me') ? user() : authorization());
    });
    const client = createClient(fixture.environment, scopeLifecycle().api);
    await settled(client);
    startup = false;
    const first = client.recoverSession();
    const second = client.recoverSession();
    expect(second).toBe(first);
    gate.resolve(refreshed());
    expect(await first).toEqual({ kind: 'authenticated' });
    expect(refreshes).toBe(2);
  });

  for (const heldRoute of ['refresh', 'me'] as const) {
    test(`a newer durable scope wins over late recovery ${heldRoute}`, async () => {
      const fixture = seeded();
      let startup = true;
      const gate = deferred<Response>();
      let waiting = false;
      mockFetch((url) => {
        if (url.endsWith('/auth/refresh') && startup) return Response.json({}, { status: 503 });
        if (url.endsWith(`/auth/${heldRoute}`)) { waiting = true; return gate.promise; }
        if (url.endsWith('/auth/refresh')) return refreshed();
        return Response.json(user());
      });
      const client = createClient(fixture.environment, scopeLifecycle().api);
      await settled(client);
      startup = false;
      const result = client.recoverSession();
      const observed = result.catch((error: unknown) => error);
      await waitFor(() => waiting);
      const replacing = new BrowserAuthCoordinator(baseUrl, fixture.environment);
      replacing.commitSession('newer-proof', 'newer-family', 'session');
      replacing.dispose();
      gate.resolve(heldRoute === 'refresh' ? refreshed() : Response.json(user()));
      expect(await observed).toBeInstanceOf(Error);
      expect(fixture.credential()?.scopeId).toBe('newer-family');
      expect(fixture.credential()?.refreshToken).toBe('newer-proof');
      expect(client.user).toBeNull();
    });
  }

  test('disposed recovery cannot hydrate a user from a late /me body', async () => {
    const fixture = seeded();
    let startup = true;
    let waiting = false;
    const gate = deferred<Response>();
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return startup ? Response.json({}, { status: 503 }) : refreshed();
      waiting = true;
      return gate.promise;
    });
    const client = createClient(fixture.environment);
    await settled(client);
    startup = false;
    const outcome = client.recoverSession().catch((error: unknown) => error);
    await waitFor(() => waiting);
    client.dispose();
    gate.resolve(Response.json(user()));
    expect(await outcome).toBeInstanceOf(Error);
    expect(client.user).toBeNull();
  });

  test('ordinary refresh keeps existing identity and proof on transient HTTP failure', async () => {
    const fixture = seeded();
    let outage = false;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return outage ? Response.json({}, { status: 503 }) : refreshed();
      return Response.json(user());
    });
    const client = createClient(fixture.environment);
    await settled(client);
    expect(client.isAuthenticated).toBe(true);
    outage = true;
    expect(await client.refresh()).toBe(false);
    expect(client.user?.userId).toBe('u_recovery');
    expect(client.hasRecoverableSession).toBe(true);
    expect(fixture.credential()?.refreshToken).toBe('rotated-refresh');
  });

  for (const status of [401, 403]) {
    test(`initial /me HTTP ${status} clears the page session before publishing sign-out`, async () => {
      const fixture = seeded();
      const cleanup = deferred<Response>();
      let cleanupRequested = false;
      let submitted: unknown;
      mockFetch((url, init) => {
        if (url.endsWith('/auth/refresh')) return refreshed();
        if (url.endsWith('/auth/me')) return Response.json({}, { status });
        if (url.endsWith('/auth/logout')) {
          cleanupRequested = true;
          submitted = JSON.parse(String(init?.body));
          return cleanup.promise;
        }
        throw new Error('Unexpected initial restoration route');
      });
      const client = createClient(fixture.environment);
      await waitFor(() => cleanupRequested);
      expect(client.isRestoring).toBe(true);
      expect(client.hasRecoverableSession).toBe(true);
      expect(client.user).toBeNull();
      expect(submitted).toEqual({ refreshToken: 'rotated-refresh' });
      cleanup.resolve(Response.json({ ok: true }));
      await settled(client);
      expect(client.hasRecoverableSession).toBe(false);
      expect(client.authorizationScopeKey).toBeNull();
      expect(fixture.credential()?.refreshToken).toBeNull();
    });
  }

  test('an unacknowledged initial page-cookie cleanup retains nonhydrated retry proof', async () => {
    const fixture = seeded();
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return refreshed();
      if (url.endsWith('/auth/me')) return Response.json({}, { status: 401 });
      return Response.json({}, { status: 503 });
    });
    const client = createClient(fixture.environment);
    await settled(client);
    expect(client.hasRecoverableSession).toBe(true);
    expect(client.user).toBeNull();
    expect(client.error).toBe('Unable to restore the browser session');
    expect(fixture.credential()?.refreshToken).toBe('rotated-refresh');
  });

  test('disposal promptly retires recovery even when fetch ignores AbortSignal', async () => {
    const fixture = seeded();
    let startup = true;
    let waiting = false;
    let signal: AbortSignal | undefined;
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh') && startup) return Response.json({}, { status: 503 });
      waiting = true;
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    const client = createClient(fixture.environment);
    await settled(client);
    startup = false;
    const observed = client.recoverSession().catch((error: unknown) => error);
    await waitFor(() => waiting);
    client.dispose();
    expect(await observed).toBeInstanceOf(Error);
    expect(signal?.aborted).toBe(true);
    expect(fixture.credential()?.refreshToken).toBe('stored-refresh');
  });

  test('same-family proof rotated during /me body reading is never replaced by stale hydration', async () => {
    const fixture = seeded();
    let startup = true;
    let reading = false;
    const body = deferred<unknown>();
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return startup ? Response.json({}, { status: 503 }) : refreshed();
      const response = Response.json(user());
      response.json = () => { reading = true; return body.promise; };
      return response;
    });
    const client = createClient(fixture.environment);
    await settled(client);
    startup = false;
    const recovery = client.recoverSession();
    await waitFor(() => reading);
    const peer = new BrowserAuthCoordinator(baseUrl, fixture.environment);
    peer.commitSession('peer-rotated', 'stored-family', 'refresh');
    peer.dispose();
    body.resolve(user());
    expect(await recovery).toEqual({ kind: 'retryable', error: 'Unable to verify the browser session. Please retry.' });
    expect(client.user).toBeNull();
    expect(fixture.credential()?.refreshToken).toBe('peer-rotated');
  });

  test('a failed committed baseline can be reconciled before a complete retry', async () => {
    const fixture = seeded();
    let startup = true;
    let failCompletion = true;
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) return startup ? Response.json({}, { status: 503 }) : refreshed();
      return Response.json(url.endsWith('/auth/me') ? user() : authorization());
    });
    const lifecycle = scopeLifecycle();
    const originalComplete = lifecycle.api.completeTransition;
    lifecycle.api.completeTransition = () => {
      originalComplete();
      if (failCompletion) throw new Error('Synthetic baseline failure');
    };
    lifecycle.api.reconcileTransition = () => { lifecycle.events.push('reconcile'); };
    const client = createClient(fixture.environment, lifecycle.api);
    await settled(client);
    startup = false;
    expect((await client.recoverSession()).kind).toBe('retryable');
    expect(client.sessionTransition.phase).toBe('recovery-required');
    expect(client.hasRecoverableSession).toBe(true);
    failCompletion = false;
    expect(await client.recoverSession()).toEqual({ kind: 'authenticated' });
    expect(lifecycle.events).toEqual(['begin', 'complete', 'reconcile', 'begin', 'complete']);
  });

  test('held startup lock admission times out and its late callback cannot adopt or send credentials', async () => {
    const fixture = seeded();
    const gate = deferred<void>();
    let waiting = false;
    let callbackFinished = false;
    let sends = 0;
    mockFetch(() => { sends += 1; return refreshed(); });
    const controller = new AuthSessionController(baseUrl, {
      coordination: { ...fixture.environment, locks: { async request(_name, _options, callback) {
        waiting = true;
        await gate.promise;
        try { return await callback(); } finally { callbackFinished = true; }
      } } },
      recoveryRequestTimeoutMs: 5,
    });
    controllers.push(controller);
    await waitFor(() => waiting && !controller.isRestoring);
    expect(controller.hasRecoverableSession).toBe(true);
    expect(controller.user).toBeNull();
    expect(controller.error).toBe('Unable to restore the browser session');
    expect(sends).toBe(0);
    gate.resolve();
    await waitFor(() => callbackFinished);
    expect(sends).toBe(0);
    expect(fixture.credential()?.refreshToken).toBe('stored-refresh');
  });

  test('explicit recovery waiting for a held lock returns retryable and cannot execute after release', async () => {
    const fixture = seeded();
    const gate = deferred<void>();
    let hold = false;
    let waiting = false;
    let callbackFinished = false;
    let sends = 0;
    mockFetch(() => { sends += 1; return Response.json({}, { status: 503 }); });
    const controller = new AuthSessionController(baseUrl, {
      coordination: { ...fixture.environment, locks: { async request(_name, _options, callback) {
        if (hold) { waiting = true; await gate.promise; }
        try { return await callback(); } finally { if (hold) callbackFinished = true; }
      } } },
      recoveryRequestTimeoutMs: 5,
    });
    controllers.push(controller);
    await waitFor(() => !controller.isRestoring);
    hold = true;
    const result = await controller.recoverSession();
    expect(waiting).toBe(true);
    expect(result).toEqual({ kind: 'retryable', error: 'Unable to verify the browser session. Please retry.' });
    expect(sends).toBe(1);
    gate.resolve();
    await waitFor(() => callbackFinished);
    expect(sends).toBe(1);
    expect(controller.sessionTransition.phase).toBe('idle');
    expect(fixture.credential()?.refreshToken).toBe('stored-refresh');
  });

  for (const route of ['refresh', 'me'] as const) {
    test(`initial ${route} body has a bounded read and retains proof for retry`, async () => {
      const fixture = seeded();
      let signal: AbortSignal | undefined;
      mockFetch((url, init) => {
        if (route === 'me' && url.endsWith('/auth/refresh')) return refreshed();
        signal = init?.signal ?? undefined;
        const response = Response.json({});
        response.json = () => new Promise(() => {});
        return response;
      });
      const controller = new AuthSessionController(baseUrl, {
        coordination: fixture.environment,
        recoveryRequestTimeoutMs: 5,
      });
      controllers.push(controller);
      await waitFor(() => !controller.isRestoring);
      expect(signal?.aborted).toBe(true);
      expect(controller.hasRecoverableSession).toBe(true);
      expect(controller.user).toBeNull();
      expect(fixture.credential()?.refreshToken).toBe(route === 'refresh' ? 'stored-refresh' : 'rotated-refresh');
    });
  }

  test('queued same-family logout uses the latest rotated proof', async () => {
    const fixture = seeded();
    let hold = false;
    let waiting = false;
    const gate = deferred<void>();
    let submitted: unknown;
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return refreshed();
      if (url.endsWith('/auth/me')) return Response.json(user());
      submitted = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    });
    const controller = new AuthSessionController(baseUrl, {
      coordination: { ...fixture.environment, locks: { async request(_name, _options, callback) {
        if (hold) { waiting = true; await gate.promise; }
        return callback();
      } } },
    });
    controllers.push(controller);
    await waitFor(() => !controller.isRestoring);
    hold = true;
    const logout = controller.logout();
    await waitFor(() => waiting);
    const peer = new BrowserAuthCoordinator(baseUrl, fixture.environment);
    peer.commitSession('peer-rotated', 'stored-family', 'refresh');
    peer.dispose();
    gate.resolve();
    await logout;
    expect(submitted).toEqual({ refreshToken: 'peer-rotated' });
    expect(controller.hasRecoverableSession).toBe(false);
  });
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

function seeded() {
  const storage = new MemoryStorage();
  let id = 0;
  const environment: BrowserAuthCoordinationEnvironment = {
    storage,
    createChannel: null,
    addStorageListener: () => () => {},
    randomId: () => `recovery-${++id}`,
    locks: { async request(_name, _options, callback) { return callback(); } },
  };
  const seed = new BrowserAuthCoordinator(baseUrl, environment);
  seed.commitSession('stored-refresh', 'stored-family', 'session');
  seed.dispose();
  return {
    environment,
    credential: (): { refreshToken: string | null; scopeId: string | null } | null => {
      const raw = storage.getItem(getBrowserAuthStorageKeys(baseUrl).credential);
      return raw === null ? null : JSON.parse(raw);
    },
  };
}

function createClient(environment: BrowserAuthCoordinationEnvironment, lifecycle?: AuthAuthorizationScopeLifecycle) {
  const client = new AuthClient(baseUrl, {
    browserAuthCoordination: environment,
    authorizationScopeLifecycle: lifecycle,
    authorizationRevalidationIntervalMs: 0,
  });
  clients.push(client);
  return client;
}
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => Promise.resolve().then(() => handler(String(input), init))) as typeof fetch;
}
function refreshed() { return Response.json({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }); }
function user(): AuthUser {
  return { userId: 'u_recovery', username: 'ada', email: 'ada@example.test', firstName: null,
    lastName: null, role: 'user', status: 'active', passwordChangeRequired: false,
    emailVerifiedAt: 1, emailVerificationRequired: false, mfaRequired: false, properties: {},
    createdAt: 1, updatedAt: null };
}
function authorization() {
  return { version: 1, identity: { userId: 'u_recovery', platformRole: 'user' },
    profile: { tenancy: 'single', authorization: 'simple' },
    scope: { kind: 'application', scopeId: 'application', roles: ['user'], permissions: [],
      allPermissions: false, revision: 'scope-recovery' }, revision: 'projection-recovery' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
async function settled(client: AuthClient) { await waitFor(() => !client.isRestoring && !client.isLoading); }
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Synthetic session condition did not settle');
}
function scopeLifecycle(): { api: AuthAuthorizationScopeLifecycle; events: string[] } {
  let epoch = 0;
  let changing = false;
  const events: string[] = [];
  return { events, api: {
    beginTransition() { if (changing) throw new Error('Nested scope transition'); changing = true; epoch += 1; events.push('begin'); },
    completeTransition() { changing = false; events.push('complete'); },
    abortTransition() { changing = false; events.push('abort'); },
    beginRequest() { if (changing) throw new Error('Request during scope transition'); return epoch; },
    assertRequestCurrent(expected) { if (changing || expected !== epoch) throw new Error('Stale scope request'); },
  } };
}
