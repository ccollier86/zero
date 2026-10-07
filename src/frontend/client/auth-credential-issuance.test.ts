/** Bounded operation-owned cookie issuance, without recursively taking the browser lock. */
import { afterEach, describe, expect, test } from 'bun:test';
import { AuthSessionController, type AuthCredentialIssuanceLease } from './auth-session';
import { BrowserAuthCoordinator, type BrowserAuthCoordinationEnvironment } from './auth-browser-coordination';
import { completionUser } from './auth-user-profile-completion.test-fixtures';

const baseUrl = 'https://credential-issuance.test';
const originalFetch = globalThis.fetch;
const sessions = new Set<AuthSessionController>();
const peers = new Set<BrowserAuthCoordinator>();
afterEach(() => {
  for (const session of sessions) session.dispose(); sessions.clear();
  for (const peer of peers) peer.dispose(); peers.clear();
  globalThis.fetch = originalFetch;
});

describe('operation-owned credential issuance', () => {
  test('completion and token installation share one admitted browser lock', async () => {
    const fixture = environment(), session = controller(fixture.options);
    let retained: AuthCredentialIssuanceLease | undefined;
    await session.runCredentialIssuance(() => {}, async lease => {
      retained = lease;
      return lease.completeAuthentication(result());
    });
    expect(fixture.admissions()).toBe(1);
    expect(session.user?.userId).toBe(completionUser().userId);
    await expect(retained!.updateTokens('late-access', 'late-proof')).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.refreshToken).toBe('synthetic-proof');
    const scope = session.authorizationScopeKey;
    await session.runCredentialIssuance(() => session.assertAuthorizationScopeCurrent(scope), async lease => {
      await lease.updateTokens('next-access', 'next-proof');
    });
    expect(fixture.admissions()).toBe(2);
    expect(session.refreshToken).toBe('next-proof');
  });

  for (const held of ['headers', 'body'] as const) {
    test(`a stalled ${held} releases ownership and refuses late completion`, async () => {
      const fixture = environment(), session = controller(fixture.options, 10);
      const headers = deferred<Response>(), body = deferred<unknown>();
      let signal: AbortSignal | undefined;
      mock((_url, init) => {
        signal = init?.signal ?? undefined;
        if (held === 'headers') return headers.promise;
        const response = Response.json({}); response.json = () => body.promise; return response;
      });
      const pending = session.runCredentialIssuance(() => {}, async lease => {
        const response = await fetch(`${baseUrl}/auth/login`, { signal: lease.signal });
        const value = await response.json();
        return lease.completeAuthentication(value);
      });
      await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(signal?.aborted).toBe(true);
      expect(session.user).toBeNull();
      headers.resolve(Response.json(result())); body.resolve(result());
      await Bun.sleep(1);
      expect(session.refreshToken).toBeNull();
      await session.runCredentialIssuance(() => {}, lease => lease.completeAuthentication(result()));
      expect(session.isAuthenticated).toBe(true);
    });
  }

  test('queued admission expiry never dispatches when the abandoned lock callback later runs', async () => {
    const fixture = environment(), session = controller(fixture.options, 10);
    const gate = deferred<void>(), entered = deferred<void>();
    const blocker = session.runCredentialOperation(async () => { entered.resolve(); await gate.promise; });
    await entered.promise;
    let exchanges = 0;
    const pending = session.runCredentialIssuance(() => {}, async lease => { exchanges++; return lease.completeAuthentication(result()); });
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    gate.resolve(); await blocker; await Bun.sleep(1);
    expect(exchanges).toBe(0);
    expect(session.refreshToken).toBeNull();
  });

  test('caller cancellation and disposal reject late issuer responses without publishing credentials', async () => {
    for (const mode of ['caller', 'dispose'] as const) {
      const fixture = environment(), session = controller(fixture.options);
      const gate = deferred<void>(), entered = deferred<void>(), caller = new AbortController();
      const pending = session.runCredentialIssuance(() => {}, async lease => {
        entered.resolve(); await gate.promise; return lease.completeAuthentication(result());
      }, caller.signal);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await entered.promise;
      if (mode === 'caller') caller.abort(); else session.dispose();
      expect(await settled).toMatchObject({ error: { name: 'AbortError' } });
      gate.resolve(); await Bun.sleep(1);
      expect(session.refreshToken).toBeNull();
    }
  });

  test('a durable replacement rejects an old held issuer completion', async () => {
    const fixture = environment(), session = controller(fixture.options);
    const gate = deferred<void>(), entered = deferred<void>();
    const scope = session.authorizationScopeKey;
    const pending = session.runCredentialIssuance(() => session.assertAuthorizationScopeCurrent(scope), async lease => {
      entered.resolve(); await gate.promise; return lease.completeAuthentication(result());
    });
    await entered.promise;
    const peer = new BrowserAuthCoordinator(baseUrl, fixture.options); peers.add(peer);
    peer.commitSession('newer-proof', 'newer-family', 'scope');
    gate.resolve();
    await expect(pending).rejects.toThrow('previous authorization scope');
    expect(session.user).toBeNull();
    expect(peer.readCredential()?.refreshToken).toBe('newer-proof');
  });

  test('owned authenticated 401 refresh and token installation do not reacquire the lock', async () => {
    const fixture = environment(), session = controller(fixture.options);
    await session.completeAuthentication(result());
    let refreshes = 0;
    mock(url => {
      expect(url.endsWith('/auth/refresh')).toBe(true); refreshes++;
      return Response.json({ accessToken: 'rotated-access', refreshToken: 'rotated-proof' });
    });
    const seen: (string | null)[] = [];
    const scope = session.authorizationScopeKey;
    await session.runCredentialIssuance(() => session.assertAuthorizationScopeCurrent(scope), async lease => {
      const response = await lease.requestWithAuth(async token => {
        seen.push(token); return Response.json({}, { status: seen.length === 1 ? 401 : 200 });
      });
      expect(response.status).toBe(200);
      await lease.updateTokens('password-access', 'password-proof');
    });
    expect(seen).toEqual(['synthetic-access', 'rotated-access']);
    expect(refreshes).toBe(1);
    expect(fixture.admissions()).toBe(2);
    expect(session.refreshToken).toBe('password-proof');
  });

  test('owned rejected refresh retires inline instead of nesting the logout lock', async () => {
    const fixture = environment(), session = controller(fixture.options);
    await session.completeAuthentication(result());
    mock(() => Response.json({}, { status: 401 }));
    const scope = session.authorizationScopeKey;
    const response = await session.runCredentialIssuance(() => session.assertAuthorizationScopeCurrent(scope), async lease => {
      return lease.requestWithAuth(async () => Response.json({}, { status: 401 }));
    });
    expect(response.status).toBe(401);
    expect(fixture.admissions()).toBe(2);
    expect(session.user).toBeNull();
    expect(session.refreshToken).toBeNull();
  });

  test('an accepted credential commit hands off to local reconciliation rather than timing out as retryable issuance', async () => {
    const fixture = environment(), gate = deferred<void>(), started = deferred<void>();
    const session = new AuthSessionController(baseUrl, { coordination: fixture.options, recoveryRequestTimeoutMs: 10,
      scopeLifecycle: { beginTransition() {}, completeTransition() { started.resolve(); return gate.promise; }, abortTransition() {} } });
    sessions.add(session);
    const pending = session.runCredentialIssuance(() => {}, lease => lease.completeAuthentication(result()));
    await started.promise; await Bun.sleep(20);
    expect(session.user?.userId).toBe(completionUser().userId);
    expect(session.sessionTransition.phase).toBe('reconciling');
    gate.resolve();
    expect(await pending).toMatchObject({ accessToken: 'synthetic-access' });
    expect(session.sessionTransition.phase).toBe('idle');
  });

  test('a committed local synchronization failure retains its explicit committed contract', async () => {
    const fixture = environment();
    const session = new AuthSessionController(baseUrl, { coordination: fixture.options,
      scopeLifecycle: { beginTransition() {}, completeTransition() { throw new Error('Synthetic baseline unavailable'); }, abortTransition() {} } });
    sessions.add(session);
    await expect(session.runCredentialIssuance(() => {}, lease => lease.completeAuthentication(result())))
      .rejects.toMatchObject({ code: 'AUTH_SCOPE_SYNCHRONIZATION_REQUIRED', committed: true, recoverable: true });
    expect(session.isAuthenticated).toBe(true);
    expect(session.sessionTransition.phase).toBe('recovery-required');
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
function environment() {
  let admissions = 0, id = 0;
  const options: BrowserAuthCoordinationEnvironment = { storage: new MemoryStorage(),
    locks: { async request<T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> { admissions++; return callback(); } },
    createChannel: null, addStorageListener: () => () => {}, randomId: () => `issuance-${++id}` };
  return { options, admissions: () => admissions };
}
function controller(options: BrowserAuthCoordinationEnvironment, timeout?: number) {
  const session = new AuthSessionController(baseUrl, { coordination: options, recoveryRequestTimeoutMs: timeout });
  sessions.add(session); return session;
}
function result() { return { user: completionUser(), accessToken: 'synthetic-access', refreshToken: 'synthetic-proof' }; }
function mock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => Promise.resolve().then(() => handler(String(input), init))) as typeof fetch;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
