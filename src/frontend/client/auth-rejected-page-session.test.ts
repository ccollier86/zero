/** Exact-proof page-cookie cleanup after definitive authorization rejection. */
import { afterEach, describe, expect, test } from 'bun:test';
import { AuthClient, type AuthAuthorizationScopeLifecycle } from './auth-client';
import { AuthSessionController } from './auth-session';
import { BrowserAuthCoordinator, type BrowserAuthCoordinationEnvironment } from './auth-browser-coordination';
import { AuthorizationScopeRecoveryController } from './authorization-scope-recovery';
import { completionUser } from './auth-user-profile-completion.test-fixtures';

const baseUrl = 'https://rejected-page-session.test';
const originalFetch = globalThis.fetch;
const clients = new Set<AuthClient>();
const sessions = new Set<AuthSessionController>();
const coordinators = new Set<BrowserAuthCoordinator>();
afterEach(() => {
  for (const client of clients) client.dispose(); clients.clear();
  for (const session of sessions) session.dispose(); sessions.clear();
  for (const coordinator of coordinators) coordinator.dispose(); coordinators.clear();
  globalThis.fetch = originalFetch;
});

describe('automatic authorization rejection retires the page session', () => {
  for (const status of [401, 403]) {
    test(`${status} fences current SDK work before acknowledged logout and clears once`, async () => {
      const gate = deferred<Response>(), environment = coordination(), events: string[] = [];
      const lifecycle = scopeLifecycle(events);
      let logout = false, logouts = 0;
      let submitted: unknown;
      mock((url, init) => {
        if (url.endsWith('/auth/login')) return Response.json(sessionResult());
        if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'synthetic-access', refreshToken: 'rotated-proof' });
        if (url.endsWith('/auth/authorization')) return Response.json({ error: 'PRIVATE_DENIAL_DETAIL' }, { status });
        if (url.endsWith('/auth/logout')) { logout = true; logouts++; submitted = JSON.parse(String(init?.body)); return gate.promise; }
        throw new Error('Rejected authority must not reach another transport.');
      });
      const client = new AuthClient(baseUrl, { browserAuthCoordination: environment,
        authorizationScopeLifecycle: lifecycle, authorizationRevalidationIntervalMs: 0 });
      clients.add(client);
      await client.login('synthetic-user', 'synthetic-password');
      events.length = 0;
      await client.getAuthorization();
      await waitFor(() => logout);
      expect(client.sessionTransition.phase).toBe('preparing');
      expect(events).toEqual(['begin']);
      await expect(client.fetchWithAuth(`${baseUrl}/private`)).rejects.toThrow('Scope is unreadable');
      gate.resolve(Response.json({ ok: true }));
      await waitFor(() => !client.isAuthenticated && client.sessionTransition.phase === 'idle');
      expect(logouts).toBe(1);
      expect(submitted).toEqual({ refreshToken: status === 401 ? 'rotated-proof' : 'synthetic-proof' });
      expect(client.authorizationScopeKey).toBeNull();
      expect(client.hasRecoverableSession).toBe(false);
      expect(client.hasAcknowledgedPageSessionCleanup).toBe(true);
      expect(events).toEqual(['begin', 'complete']);
    });
  }

  test('explicit recovery retains its existing owned sign-out cleanup and does not write twice', async () => {
    const environment = coordination();
    let logouts = 0, reloads = 0;
    mock((url) => {
      if (url.endsWith('/auth/login')) return Response.json(sessionResult());
      if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'synthetic-access', refreshToken: 'rotated-proof' });
      if (url.endsWith('/auth/me')) return Response.json(completionUser());
      if (url.endsWith('/auth/authorization')) return Response.json({}, { status: 403 });
      logouts++; return Response.json({ ok: true });
    });
    const client = new AuthClient(baseUrl, { browserAuthCoordination: environment, authorizationRevalidationIntervalMs: 0 });
    clients.add(client);
    await client.login('synthetic-user', 'synthetic-password');
    const recovery = new AuthorizationScopeRecoveryController(); recovery.activate();
    expect(await recovery.run({ client, scopeKey: client.authorizationScopeKey, operation: 'recover',
      onStart() {}, onReload() { reloads++; }, onRetryable() { throw new Error('Definite denial is not a transient retry.'); } })).toEqual({ kind: 'reload' });
    expect(logouts).toBe(1);
    expect(reloads).toBe(1);
    expect(client.user).toBeNull();
    expect(client.hasRecoverableSession).toBe(false);
    recovery.retire();
  });

  test('an observed authorization hint during explicit recovery still has one cleanup owner', async () => {
    const environment = coordination();
    let deny = false, logouts = 0;
    mock((url) => {
      if (url.endsWith('/auth/login')) return Response.json(sessionResult());
      if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'synthetic-access', refreshToken: 'rotated-proof' });
      if (url.endsWith('/auth/me')) return Response.json(completionUser());
      if (url.endsWith('/auth/authorization')) {
        if (deny) return Response.json({}, { status: 403 });
        return Response.json({ version: 1,
          identity: { userId: completionUser().userId, platformRole: completionUser().role },
          profile: { tenancy: 'single', authorization: 'advanced' },
          scope: null, revision: 'synthetic-policy' });
      }
      logouts++; return Response.json({ ok: true });
    });
    const client = new AuthClient(baseUrl, { browserAuthCoordination: environment, authorizationRevalidationIntervalMs: 0 });
    clients.add(client);
    await client.login('synthetic-user', 'synthetic-password');
    const unsubscribe = client.subscribeAuthorization(() => {});
    await client.getAuthorization();
    expect(client.authorizationState.status).toBe('ready');
    deny = true;
    const recovery = new AuthorizationScopeRecoveryController(); recovery.activate();
    expect(await recovery.run({ client, scopeKey: client.authorizationScopeKey, operation: 'recover',
      onStart() {}, onReload() {}, onRetryable() { throw new Error('Definite denial is not a transient retry.'); } })).toEqual({ kind: 'reload' });
    expect(logouts).toBe(1);
    expect(client.user).toBeNull();
    unsubscribe(); recovery.retire();
  });

  test('raw AuthClient rejects new cookie issuance while owned cleanup is preparing', async () => {
    const gate = deferred<Response>();
    let loginRequests = 0, logout = false;
    mock((url) => {
      if (url.endsWith('/auth/login')) { loginRequests++; return Response.json(sessionResult()); }
      if (url.endsWith('/auth/authorization')) return Response.json({}, { status: 403 });
      logout = true; return gate.promise;
    });
    const client = new AuthClient(baseUrl, { browserAuthCoordination: coordination(), authorizationRevalidationIntervalMs: 0 });
    clients.add(client);
    await client.login('synthetic-user', 'synthetic-password');
    await client.getAuthorization(); await waitFor(() => logout);
    await expect(client.login('new-user', 'new-password')).rejects.toThrow('Authorization scope is changing');
    expect(loginRequests).toBe(1);
    gate.resolve(Response.json({ ok: true }));
    await waitFor(() => client.user === null);
  });
});

describe('rejected page-session cleanup lifecycle', () => {
  for (const outcome of ['503', 'network', 'headers-timeout'] as const) {
    test(`${outcome} retires invalid local authority without claiming a cookie acknowledgement`, async () => {
      const session = await authenticatedSession(10);
      let signal: AbortSignal | undefined, requests = 0;
      mock((_url, init) => {
        requests++; signal = init?.signal ?? undefined;
        if (outcome === 'network') throw new Error('PRIVATE_TRANSPORT_DETAIL');
        if (outcome === 'headers-timeout') return new Promise(() => {});
        return Response.json({}, { status: 503 });
      });
      expect(await session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey)).toBe(false);
      expect(requests).toBe(1);
      expect(session.user).toBeNull();
      expect(session.hasRecoverableSession).toBe(false);
      expect(session.hasAcknowledgedPageSessionCleanup).toBe(false);
      expect(session.sessionTransition.phase).toBe('idle');
      if (outcome === 'headers-timeout') expect(signal?.aborted).toBe(true);
    });
  }

  test('an unused stalled logout body does not hold credential retirement', async () => {
    const session = await authenticatedSession(10);
    let reads = 0;
    mock(() => {
      const response = Response.json({ ok: true });
      response.json = () => { reads++; return new Promise(() => {}); };
      return response;
    });
    expect(await session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey)).toBe(true);
    expect(reads).toBe(0);
    expect(session.user).toBeNull();
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(true);
  });

  test('duplicate rejection receipts send only one logout for their originating revision', async () => {
    const session = await authenticatedSession();
    let logouts = 0;
    mock(() => { logouts++; return Response.json({ ok: true }); });
    const revision = session.revision, scope = session.authorizationScopeKey;
    const first = session.expireRejectedPageSessionAtRevision(revision, scope);
    const second = session.expireRejectedPageSessionAtRevision(revision, scope);
    expect(await first).toBe(true);
    expect(await second).toBeNull();
    expect(logouts).toBe(1);
  });

  test('an acknowledged anonymous receipt is invalidated by a later durable family or revision', async () => {
    const environment = coordination(), session = await authenticatedSession(undefined, environment);
    mock(() => Response.json({ ok: true }));
    await session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey);
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(true);
    await session.completeAuthentication(sessionResult());
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(false);
    await session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey);
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(true);
    const peer = coordinator(environment);
    peer.commitLogout();
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(false);
    peer.commitSession('newer-proof', 'newer-family', 'scope');
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(false);
  });

  test('a queued admission deadline is bounded and cannot write after the lock later opens', async () => {
    const session = await authenticatedSession(10), gate = deferred<void>(), entered = deferred<void>();
    const blocker = session.runCredentialOperation(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
    let sends = 0;
    mock(() => { sends++; return Response.json({ ok: true }); });
    const expiry = session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey);
    await expect(expiry).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(session.sessionTransition.phase).toBe('idle');
    expect(session.user?.userId).toBe(completionUser().userId);
    gate.resolve(); await blocker; await Bun.sleep(1);
    expect(sends).toBe(0);
    expect(session.hasRecoverableSession).toBe(true);
  });

  for (const pending of ['loading', 'failed', 'transition'] as const) {
    test(`a newer ${pending} authentication attempt invalidates queued rejection before proof commit`, async () => {
      const session = await authenticatedSession(), gate = deferred<void>(), entered = deferred<void>();
      const blocker = session.runCredentialOperation(async () => { entered.resolve(); await gate.promise; });
      await entered.promise;
      let sends = 0;
      mock(() => { sends++; return Response.json({ ok: true }); });
      const expiry = session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey);
      if (pending === 'transition') session.beginScopeTransition('authentication');
      else {
        session.beginAuthentication();
        if (pending === 'failed') session.failAuthentication('Synthetic authentication was rejected');
      }
      gate.resolve(); await blocker;
      expect(await expiry).toBeNull();
      expect(sends).toBe(0);
      expect(session.hasRecoverableSession).toBe(true);
    });
  }

  for (const replacement of ['family', 'same-family'] as const) {
    test(`a queued ${replacement} replacement prevents any old-proof cookie writer`, async () => {
      const environment = coordination(), session = await authenticatedSession(undefined, environment);
      const gate = deferred<void>(), entered = deferred<void>();
      const blocker = session.runCredentialOperation(async () => { entered.resolve(); await gate.promise; });
      await entered.promise;
      const revision = session.revision, scope = session.authorizationScopeKey;
      let sends = 0;
      mock(() => { sends++; return Response.json({ ok: true }); });
      const expiry = session.expireRejectedPageSessionAtRevision(revision, scope);
      const peer = coordinator(environment);
      peer.commitSession('newer-proof', replacement === 'family' ? 'newer-family' : scope!, 'scope');
      gate.resolve(); await blocker;
      expect(await expiry).toBeNull();
      expect(sends).toBe(0);
      expect(peer.readCredential()?.refreshToken).toBe('newer-proof');
      expect(session.user?.userId).toBe(completionUser().userId);
    });
  }

  for (const retired of ['disposal', 'family'] as const) {
    test(`${retired} during held cleanup rejects late local publication`, async () => {
      const environment = coordination(), session = await authenticatedSession(undefined, environment);
      const gate = deferred<Response>(), entered = deferred<void>();
      let signal: AbortSignal | undefined;
      mock((_url, init) => { signal = init?.signal ?? undefined; entered.resolve(); return gate.promise; });
      const expiry = session.expireRejectedPageSessionAtRevision(session.revision, session.authorizationScopeKey);
      const settled = expiry.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      const peer = coordinator(environment);
      if (retired === 'disposal') session.dispose();
      else peer.commitSession('newer-proof', 'newer-family', 'scope');
      gate.resolve(Response.json({ ok: true }));
      if (retired === 'disposal') {
        expect(await settled).toMatchObject({ error: { name: 'AbortError' } });
      } else {
        expect(await settled).toEqual({ value: null });
      }
      expect(session.user?.userId).toBe(completionUser().userId);
      if (retired === 'disposal') expect(signal?.aborted).toBe(true);
      else expect(peer.readCredential()).toMatchObject({ refreshToken: 'newer-proof', scopeId: 'newer-family' });
    });
  }

  test('public expireSession remains a local-only operation', async () => {
    const session = await authenticatedSession();
    let sends = 0;
    mock(() => { sends++; throw new Error('Local expiry must not send a cookie writer.'); });
    session.expireSession();
    await waitFor(() => session.user === null);
    expect(sends).toBe(0);
    expect(session.hasRecoverableSession).toBe(false);
    expect(session.hasAcknowledgedPageSessionCleanup).toBe(false);
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
function coordination(): BrowserAuthCoordinationEnvironment {
  let id = 0;
  return { storage: new MemoryStorage(), locks: null, createChannel: null,
    addStorageListener: () => () => {}, randomId: () => `rejected-${++id}` };
}
async function authenticatedSession(timeout?: number, environment = coordination()) {
  const session = new AuthSessionController(baseUrl, { coordination: environment, recoveryRequestTimeoutMs: timeout });
  sessions.add(session);
  await session.completeAuthentication(sessionResult());
  return session;
}
function coordinator(environment: BrowserAuthCoordinationEnvironment) {
  const value = new BrowserAuthCoordinator(baseUrl, environment); coordinators.add(value); return value;
}
function sessionResult() {
  return { user: completionUser(), accessToken: 'synthetic-access', refreshToken: 'synthetic-proof' };
}
function scopeLifecycle(events: string[]): AuthAuthorizationScopeLifecycle {
  let epoch = 0, changing = false;
  return {
    beginTransition() { changing = true; epoch++; events.push('begin'); },
    completeTransition() { changing = false; events.push('complete'); },
    abortTransition() { changing = false; events.push('abort'); },
    beginRequest() { if (changing) throw new Error('Scope is unreadable'); return epoch; },
    assertRequestCurrent(expected) { if (changing || epoch !== expected) throw new Error('Scope is unreadable'); },
  };
}
function mock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => Promise.resolve().then(() => handler(String(input), init))) as typeof fetch;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await Bun.sleep(1); }
  throw new Error('Synthetic rejection lifecycle did not settle.');
}
