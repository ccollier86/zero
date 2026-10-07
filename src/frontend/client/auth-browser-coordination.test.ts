import { afterEach, describe, expect, test } from 'bun:test';
import {
  BrowserAuthCoordinationError,
  BrowserAuthCoordinator,
  getBrowserAuthStorageKeys,
  normalizeAuthBaseUrl,
  type BrowserAuthCoordinationEnvironment,
} from './auth-browser-coordination';
import {
  AuthClient,
  AuthSessionSynchronizationError,
  type AuthAuthorizationScopeLifecycle,
} from './auth-client';

const originalFetch = globalThis.fetch;
const clients: AuthClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  globalThis.fetch = originalFetch;
});

describe('browser auth coordination primitives', () => {
  test('normalizes base URLs, adopts the legacy key once, and isolates apps', async () => {
    const storage = new SharedStorage();
    storage.setItem('__platform_refresh_token', 'legacy-refresh');
    const ids = idFactory();
    const environment = environmentFor(storage, { ids, channel: false, locks: false });

    expect(normalizeAuthBaseUrl('HTTP://Example.COM:80/api///')).toBe(
      'http://example.com/api',
    );
    const adopted = new BrowserAuthCoordinator('http://example.com/api/', environment);
    const adoptedRecord = adopted.readCredential();
    expect(adoptedRecord?.refreshToken).toBe('legacy-refresh');
    expect(storage.getItem('__platform_refresh_token')).toBeNull();

    const equivalent = new BrowserAuthCoordinator('HTTP://EXAMPLE.COM:80/api', environment);
    expect(equivalent.readCredential()?.refreshToken).toBe('legacy-refresh');

    const isolated = new BrowserAuthCoordinator('http://example.com/other', environment);
    expect(isolated.readCredential()).toBeNull();
    await isolated.runExclusive(async () => {
      isolated.commitSession('other-refresh', isolated.createScopeId(), 'session');
    });
    expect(adopted.readCredential()?.refreshToken).toBe('legacy-refresh');
    expect(isolated.readCredential()?.refreshToken).toBe('other-refresh');
    expect(adopted.keys.credential).not.toBe(isolated.keys.credential);

    adopted.dispose();
    equivalent.dispose();
    isolated.dispose();
  });

  test('uses the bounded storage fallback without Web Locks or BroadcastChannel', async () => {
    const storage = new SharedStorage();
    const ids = idFactory();
    const environment = environmentFor(storage, { ids, channel: false, locks: false });
    const first = new BrowserAuthCoordinator('http://zero.test', environment);
    const second = new BrowserAuthCoordinator('http://zero.test', environment);
    let concurrent = 0;
    let maximum = 0;

    await Promise.all([
      first.runExclusive(async () => {
        concurrent += 1;
        maximum = Math.max(maximum, concurrent);
        await delay(4);
        concurrent -= 1;
      }),
      second.runExclusive(async () => {
        concurrent += 1;
        maximum = Math.max(maximum, concurrent);
        await delay(1);
        concurrent -= 1;
      }),
    ]);
    expect(maximum).toBe(1);

    let logicalNow = 1_000;
    const blockedEnvironment = environmentFor(storage, {
      ids,
      channel: false,
      locks: false,
      now: () => logicalNow,
      sleep: async (milliseconds) => {
        logicalNow += milliseconds;
      },
      lockTimeoutMs: 20,
    });
    const blocked = new BrowserAuthCoordinator('http://blocked.test', blockedEnvironment);
    storage.setItem(`${blocked.keys.lockPrefix}older`, JSON.stringify({
      owner: 'older',
      phase: 'waiting',
      ticket: 1,
      expiresAt: 20_000,
    }));
    await expect(blocked.runExclusive(async () => undefined)).rejects.toBeInstanceOf(
      BrowserAuthCoordinationError,
    );

    first.dispose();
    second.dispose();
    blocked.dispose();
  });

  test('settles startup restoration when credential coordination rejects', async () => {
    const storage = new SharedStorage();
    const ids = idFactory();
    const baseEnvironment = environmentFor(storage, {
      ids,
      channel: false,
      locks: false,
    });
    const seed = new BrowserAuthCoordinator('http://zero.test', baseEnvironment);
    seed.commitSession('stored-refresh', 'stored-scope', 'session');
    seed.dispose();

    let fetchCalls = 0;
    globalThis.fetch = (async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      fetchCalls += 1;
      return Response.json({ error: 'Unexpected request' }, { status: 500 });
    }) as typeof fetch;

    const coordinationFailure = new BrowserAuthCoordinationError(
      'Injected credential lock failure',
    );
    const client = track(new AuthClient('http://zero.test', {
      browserAuthCoordination: {
        ...baseEnvironment,
        locks: {
          async request<T>(
            _name: string,
            _options: { mode: 'exclusive' },
            _callback: () => Promise<T>,
          ): Promise<T> {
            throw coordinationFailure;
          },
        },
      },
    }));

    expect(client.isLoading).toBe(true);
    expect(client.isRestoring).toBe(true);
    await waitFor(() => !client.isLoading && !client.isRestoring);

    expect(client.error).toBe('Unable to restore the browser session');
    expect(client.isAuthenticated).toBe(false);
    expect(fetchCalls).toBe(0);
    expect(JSON.parse(
      storage.getItem(getBrowserAuthStorageKeys('http://zero.test').credential)!,
    ).refreshToken).toBe('stored-refresh');
  });

  test('settles login loading when credential coordination rejects', async () => {
    const storage = new SharedStorage();
    const coordinationFailure = new BrowserAuthCoordinationError(
      'Injected credential lock failure',
    );
    globalThis.fetch = (async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => Response.json({
      user: authUser(),
      accessToken: 'uncommitted-access',
      refreshToken: 'uncommitted-refresh',
      activeTenant: tenant('ten_a'),
    })) as unknown as typeof fetch;
    const client = track(new AuthClient('http://zero.test', {
      browserAuthCoordination: {
        ...environmentFor(storage, {
          ids: idFactory(), channel: false, locks: false,
        }),
        locks: {
          async request<T>(): Promise<T> {
            throw coordinationFailure;
          },
        },
      },
    }));

    await expect(client.login('ada', 'password')).rejects.toBe(coordinationFailure);
    expect(client.isLoading).toBe(false);
    expect(client.error).toBe('Login failed');
    expect(client.isAuthenticated).toBe(false);
    expect(client.accessToken).toBeNull();
  });

  test('retains identity continuation across stale-session purge and remount', async () => {
    const storage = new SharedStorage();
    const environment = environmentFor(storage, {
      ids: idFactory(), channel: false, locks: false,
    });
    const seed = new BrowserAuthCoordinator('http://zero.test', environment);
    seed.commitSession('stale-refresh', 'stale-scope', 'session');
    seed.dispose();
    const lifecycle = createLifecycleRecorder();

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
      if (url.endsWith('/auth/refresh')) {
        throw new Error('restore network unavailable');
      }
      if (url.endsWith('/auth/login')) {
        return Response.json({
          user: authUser(),
          tenantSelectionRequired: true,
          tenantSelection: {
            continuation: 'selection-continuation',
            expiresAt: Date.now() + 60_000,
            tenants: [tenant('ten_a'), tenant('ten_b')],
          },
        });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;

    const client = track(new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
      browserAuthCoordination: environment,
    }));
    await waitFor(() => !client.isRestoring && !client.isLoading);
    expect(client.error).toBe('Unable to restore the browser session');

    const completion = await client.login('ada', 'password');

    expect(completion).toMatchObject({
      tenantSelectionRequired: true,
      tenantSelection: { continuation: 'selection-continuation' },
    });
    expect(client.authenticationContinuation).toEqual(completion);
    expect(client.isLoading).toBe(false);
    expect(client.isAuthenticated).toBe(false);
    expect(client.authorizationScopeKey).toBeNull();
    expect(lifecycle.events).toEqual(['begin', 'complete']);

    client.clearAuthenticationContinuation();
    expect(client.authenticationContinuation).toBeNull();
  });

  test('preserves a committed-login synchronization error without optional cancellation hooks', async () => {
    const storage = new SharedStorage();
    const environment = environmentFor(storage, {
      ids: idFactory(), channel: false, locks: false,
    });
    const lifecycle = createLifecycleRecorder();
    lifecycle.failCompletion = true;
    globalThis.fetch = (async () => Response.json({
      user: authUser(),
      accessToken: 'committed-access',
      refreshToken: 'committed-refresh',
      activeTenant: tenant('ten_a'),
    })) as unknown as typeof fetch;
    const client = track(new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
      browserAuthCoordination: environment,
    }));

    await expect(client.login('ada', 'password')).rejects.toBeInstanceOf(
      AuthSessionSynchronizationError,
    );
    expect(client.isAuthenticated).toBe(true);
    expect(client.accessToken).toBe('committed-access');
    expect(client.sessionTransition.phase).toBe('recovery-required');
    expect(client.sessionTransition.recoverable).toBe(true);
    expect(lifecycle.events).not.toContain('abort');

    lifecycle.failCompletion = false;
    await client.reconcileSession();
    expect(client.sessionTransition.phase).toBe('idle');
  });

  test('publishes only sanitized revision/scope signals', async () => {
    const storage = new SharedStorage();
    const hub = new ChannelHub();
    const environment = environmentFor(storage, {
      ids: idFactory(),
      hub,
      channel: true,
      locks: false,
    });
    const first = new BrowserAuthCoordinator('http://zero.test', environment);
    const second = new BrowserAuthCoordinator('http://zero.test', environment);
    const received: unknown[] = [];
    second.subscribe((signal) => received.push(signal));

    await first.runExclusive(async () => {
      first.commitSession('top-secret-refresh', first.createScopeId(), 'session');
    });
    await flushTasks();

    expect(received).toHaveLength(1);
    expect(JSON.stringify(received)).not.toContain('top-secret-refresh');
    expect(JSON.stringify(hub.messages)).not.toContain('top-secret-refresh');
    const signalValue = storage.getItem(
      getBrowserAuthStorageKeys('http://zero.test').signal,
    );
    expect(signalValue).not.toContain('top-secret-refresh');

    first.dispose();
    second.dispose();
  });
});

describe('multi-tab auth session behavior', () => {
  test('serializes simultaneous refreshes and re-reads the rotated proof', async () => {
    const fixture = await createTwoTabFixture();
    fixture.server.refreshProofs.length = 0;
    const startingProof = fixture.server.currentRefresh;
    if (!startingProof) throw new Error('Expected a restored refresh proof');

    const results = await Promise.all([fixture.first.refresh(), fixture.second.refresh()]);

    expect(results).toEqual([true, true]);
    expect(fixture.server.invalidProofs).toBe(0);
    expect(fixture.server.refreshProofs).toHaveLength(2);
    expect(fixture.server.refreshProofs[0]).toBe(startingProof);
    expect(new Set(fixture.server.refreshProofs).size).toBe(2);
    expect(fixture.first.isAuthenticated).toBe(true);
    expect(fixture.second.isAuthenticated).toBe(true);
  });

  test('serializes tenant switch and rejects the queued old-scope refresh', async () => {
    const secondLifecycle = createLifecycleRecorder();
    const fixture = await createTwoTabFixture({ secondLifecycle });
    fixture.server.refreshProofs.length = 0;

    const [switched, refreshResult] = await Promise.all([
      fixture.first.switchTenant('ten_b'),
      fixture.second.refresh().catch((error: unknown) => error),
    ]);
    await waitFor(() => fixture.second.activeTenant?.tenantId === 'ten_b');

    expect(switched.activeTenant?.tenantId).toBe('ten_b');
    expect(refreshResult).toBeInstanceOf(Error);
    expect((refreshResult as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(fixture.server.invalidProofs).toBe(0);
    expect(secondLifecycle.events).toContain('begin');
    expect(secondLifecycle.events).toContain('complete');
    expect(fixture.second.isAuthenticated).toBe(true);
  });

  test('propagates logout and opens the purge barrier before clearing the peer', async () => {
    let second!: AuthClient;
    const observations: boolean[] = [];
    const lifecycle = createLifecycleRecorder({
      onBegin: () => observations.push(second.isAuthenticated),
    });
    const fixture = await createTwoTabFixture({ secondLifecycle: lifecycle });
    second = fixture.second;

    await fixture.first.logout();
    await waitFor(() => !fixture.second.isAuthenticated);

    expect(observations).toEqual([true]);
    expect(lifecycle.events.slice(-2)).toEqual(['begin', 'complete']);
    expect(fixture.second.accessToken).toBeNull();
  });

  test('ignores stale signals and a late old-scope 401 cannot clear the new session', async () => {
    const storage = new SharedStorage();
    const hub = new ChannelHub();
    const lockManager = new MockLockManager();
    const environment = environmentFor(storage, {
      ids: idFactory(), hub, lockManager, channel: true, locks: true,
    });
    const server = new RotatingAuthServer();
    const pending = deferred<Response>();
    let protectedCalls = 0;
    server.extraFetch = (url) => {
      if (!url.endsWith('/api/protected')) return null;
      protectedCalls += 1;
      return protectedCalls === 1 ? pending.promise : Response.json({ ok: true });
    };
    server.install();
    const lifecycle = createLifecycleRecorder();
    const client = track(new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
      browserAuthCoordination: environment,
    }));
    await client.login('ada', 'password');
    const oldSignal = JSON.parse(
      storage.getItem(getBrowserAuthStorageKeys('http://zero.test').signal)!,
    );

    const lateRequest = client.fetchWithAuth('http://zero.test/api/protected');
    await waitFor(() => protectedCalls === 1);
    await client.switchTenant('ten_b');
    const currentAccess = client.accessToken;
    hub.emit(getBrowserAuthStorageKeys('http://zero.test').channel, {
      ...oldSignal,
      sourceId: 'stale-other-tab',
    });
    pending.resolve(Response.json({ error: 'old scope' }, { status: 401 }));

    await expect(lateRequest).rejects.toThrow(
      'Discarded a response from a previous authorization scope',
    );
    await flushTasks();
    expect(client.accessToken).toBe(currentAccess);
    expect(client.activeTenant?.tenantId).toBe('ten_b');
    expect(client.isAuthenticated).toBe(true);
  });

  test('rejects stale password-rotation tokens after an external scope wins the lock', async () => {
    const storage = new SharedStorage();
    const lockManager = new MockLockManager();
    const environment = environmentFor(storage, {
      ids: idFactory(), lockManager, channel: false, locks: true,
    });
    const server = new RotatingAuthServer();
    let passwordChanges = 0;
    server.extraFetch = (url) => {
      if (!url.endsWith('/auth/change-password')) return null;
      passwordChanges += 1;
      return Response.json({
        accessToken: 'stale-password-access',
        refreshToken: 'stale-password-refresh',
      });
    };
    server.install();
    // Deliberately omit authorizationScopeLifecycle: AuthClient must retain
    // this guarantee when constructed as a standalone public SDK.
    const client = track(new AuthClient('http://zero.test', {
      browserAuthCoordination: environment,
    }));
    await client.login('ada', 'password');
    const blocker = new BrowserAuthCoordinator('http://zero.test', environment);
    const heldLock = await holdCredentialLock(blocker);

    const staleChange = client.changePassword('old-password', 'new-password');
    const observedChange = staleChange.catch((error: unknown) => error);
    // Issuing HTTP now shares the credential lock, not only token commit.
    // The stale password intent must never mint an out-of-order page cookie.
    await flushTasks();
    expect(passwordChanges).toBe(0);
    server.currentRefresh = 'external-refresh';
    server.currentTenant = 'ten_external';
    blocker.commitSession(
      'external-refresh',
      blocker.createScopeId(),
      'scope',
    );
    await heldLock.release();

    const rejection = await observedChange;
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toMatchObject({ name: 'AbortError' });
    expect(client.accessToken).not.toBe('stale-password-access');
    // Cancellation retires the old writer promptly; peer reconciliation has
    // its own queued hydration operation behind the just-released lock.
    await waitFor(() => client.activeTenant?.tenantId === 'ten_external');
    expect(client.activeTenant?.tenantId).toBe('ten_external');
    expect(server.currentRefresh).not.toBe('stale-password-refresh');
    expect(passwordChanges).toBe(0);
    blocker.dispose();
  });

  test('drops a tenant-selection continuation that became stale while waiting for the lock', async () => {
    const fixture = await createBlockedTenantIntentFixture('/auth/tenants/select');
    const staleSelection = fixture.client.selectTenant('old-continuation', 'ten_selected');
    const observedSelection = staleSelection.catch((error: unknown) => error);
    await flushTasks();
    await fixture.replaceScopeAndRelease();

    const rejection = await observedSelection;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(fixture.intentRequests()).toBe(0);
    expect(fixture.client.activeTenant?.tenantId).toBe('ten_external');
    fixture.blocker.dispose();
  });

  test('drops refresh-backed create and switch intents that became stale at the lock', async () => {
    for (const scenario of [
      {
        endpoint: '/auth/tenants/create',
        run: (client: AuthClient) => client.createTenant({ name: 'Stale workspace' }),
      },
      {
        endpoint: '/auth/tenants/switch',
        run: (client: AuthClient) => client.switchTenant('ten_selected'),
      },
    ]) {
      const fixture = await createBlockedTenantIntentFixture(scenario.endpoint);
      const staleIntent = scenario.run(fixture.client);
      const observedIntent = staleIntent.catch((error: unknown) => error);
      await flushTasks();
      await fixture.replaceScopeAndRelease();

      const rejection = await observedIntent;
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain(
        'Discarded a response from a previous authorization scope',
      );
      expect(fixture.intentRequests()).toBe(0);
      expect(fixture.client.activeTenant?.tenantId).toBe('ten_external');
      fixture.blocker.dispose();
    }
  });

  test('does not let a queued logout clear an externally replaced account scope', async () => {
    const fixture = await createBlockedTenantIntentFixture('/auth/logout');
    const staleLogout = fixture.client.logout();
    const observedLogout = staleLogout.catch((error: unknown) => error);
    await flushTasks();
    await fixture.replaceScopeAndRelease();

    const rejection = await observedLogout;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    expect(fixture.intentRequests()).toBe(0);
    // Cancellation now retires the stale logout promptly. The separately
    // queued peer reconciliation still owns hydration of the new scope.
    await waitFor(() => fixture.client.activeTenant?.tenantId === 'ten_external');
    expect(fixture.client.isAuthenticated).toBe(true);
    expect(fixture.client.activeTenant?.tenantId).toBe('ten_external');
    fixture.blocker.dispose();
  });

  test('retains a server-committed switch when baseline reconciliation fails', async () => {
    const storage = new SharedStorage();
    const environment = environmentFor(storage, {
      ids: idFactory(), channel: false, locks: false,
    });
    const server = new RotatingAuthServer();
    server.install();
    const lifecycle = createLifecycleRecorder();
    const client = track(new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
      browserAuthCoordination: environment,
    }));
    await client.login('ada', 'password');
    lifecycle.failCompletion = true;

    await expect(client.switchTenant('ten_b')).rejects.toBeInstanceOf(
      AuthSessionSynchronizationError,
    );

    expect(client.activeTenant?.tenantId).toBe('ten_b');
    expect(client.accessToken).toContain('access-');
    expect(client.sessionTransition.phase).toBe('recovery-required');
    expect(client.sessionTransition.recoverable).toBe(true);
    expect(lifecycle.events).not.toContain('abort');
    const persisted = JSON.parse(
      storage.getItem(getBrowserAuthStorageKeys('http://zero.test').credential)!,
    );
    expect(persisted.refreshToken).toBe(server.currentRefresh);

    lifecycle.failCompletion = false;
    await client.reconcileSession();
    expect(client.sessionTransition.phase).toBe('idle');
    expect(lifecycle.events).toContain('reconcile');
  });
});

async function createTwoTabFixture(options: {
  secondLifecycle?: ReturnType<typeof createLifecycleRecorder>;
} = {}) {
  const storage = new SharedStorage();
  const hub = new ChannelHub();
  const lockManager = new MockLockManager();
  const environment = environmentFor(storage, {
    ids: idFactory(), hub, lockManager, channel: true, locks: true,
  });
  const server = new RotatingAuthServer();
  server.install();
  const firstLifecycle = createLifecycleRecorder();
  const secondLifecycle = options.secondLifecycle ?? createLifecycleRecorder();
  const first = track(new AuthClient('http://zero.test', {
    authorizationScopeLifecycle: firstLifecycle.api,
    browserAuthCoordination: environment,
  }));
  await first.login('ada', 'password');
  const second = track(new AuthClient('http://zero.test', {
    authorizationScopeLifecycle: secondLifecycle.api,
    browserAuthCoordination: environment,
  }));
  await waitFor(() => second.isAuthenticated);
  await flushTasks();
  return { storage, hub, server, first, second, firstLifecycle, secondLifecycle };
}

async function createBlockedTenantIntentFixture(endpoint: string) {
  const storage = new SharedStorage();
  const lockManager = new MockLockManager();
  const environment = environmentFor(storage, {
    ids: idFactory(), lockManager, channel: false, locks: true,
  });
  const server = new RotatingAuthServer();
  let intentRequests = 0;
  server.extraFetch = (url) => {
    if (!url.endsWith(endpoint)) return null;
    intentRequests += 1;
    return Response.json({
      user: authUser(),
      accessToken: 'unexpected-intent-access',
      refreshToken: 'unexpected-intent-refresh',
      activeTenant: tenant('ten_selected'),
    });
  };
  server.install();
  const client = track(new AuthClient('http://zero.test', {
    browserAuthCoordination: environment,
  }));
  await client.login('ada', 'password');
  const blocker = new BrowserAuthCoordinator('http://zero.test', environment);
  const heldLock = await holdCredentialLock(blocker);

  return {
    client,
    blocker,
    intentRequests: () => intentRequests,
    async replaceScopeAndRelease() {
      server.currentRefresh = 'external-refresh';
      server.currentTenant = 'ten_external';
      blocker.commitSession(
        'external-refresh',
        blocker.createScopeId(),
        'scope',
      );
      await heldLock.release();
    },
  };
}

async function holdCredentialLock(coordinator: BrowserAuthCoordinator): Promise<{
  release: () => Promise<void>;
}> {
  const acquired = deferred<void>();
  const release = deferred<void>();
  const held = coordinator.runExclusive(async () => {
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  return {
    async release() {
      release.resolve();
      await held;
    },
  };
}

class RotatingAuthServer {
  currentRefresh: string | null = null;
  currentTenant = 'ten_a';
  refreshProofs: string[] = [];
  invalidProofs = 0;
  private counter = 0;
  extraFetch?: (url: string, init?: RequestInit) => Response | Promise<Response> | null;

  install(): void {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
      const extra = this.extraFetch?.(url, init);
      if (extra) return extra;
      if (url.endsWith('/auth/login')) {
        this.currentTenant = 'ten_a';
        return Response.json(this.newSession());
      }
      if (url.endsWith('/auth/refresh')) {
        const proof = body(init).refreshToken;
        this.refreshProofs.push(String(proof));
        if (!this.acceptProof(proof)) return unauthorized();
        return Response.json(this.newTokens());
      }
      if (url.endsWith('/auth/tenants/switch')) {
        const request = body(init);
        if (!this.acceptProof(request.refreshToken)) return unauthorized();
        this.currentTenant = String(request.tenantId);
        return Response.json(this.newSession());
      }
      if (url.endsWith('/auth/logout')) {
        this.currentRefresh = null;
        return Response.json({ ok: true });
      }
      if (url.endsWith('/auth/me')) return Response.json(authUser());
      return Response.json({ ok: true });
    }) as typeof fetch;
  }

  private acceptProof(value: unknown): boolean {
    if (typeof value === 'string' && value === this.currentRefresh) return true;
    this.invalidProofs += 1;
    return false;
  }

  private newSession() {
    return { user: authUser(), ...this.newTokens() };
  }

  private newTokens() {
    this.counter += 1;
    this.currentRefresh = `refresh-${this.counter}`;
    return {
      accessToken: `access-${this.counter}`,
      refreshToken: this.currentRefresh,
      activeTenant: tenant(this.currentTenant),
    };
  }
}

function createLifecycleRecorder(options: { onBegin?: () => void } = {}) {
  let epoch = 0;
  let transitioning = false;
  const events: string[] = [];
  const recorder = {
    events,
    failCompletion: false,
    api: {
      beginTransition() {
        transitioning = true;
        epoch += 1;
        events.push('begin');
        options.onBegin?.();
      },
      async completeTransition() {
        transitioning = false;
        events.push('complete');
        if (recorder.failCompletion) throw new Error('baseline timeout');
      },
      abortTransition() {
        transitioning = false;
        events.push('abort');
      },
      async reconcileTransition() {
        events.push('reconcile');
        if (recorder.failCompletion) throw new Error('baseline timeout');
      },
      beginRequest() {
        if (transitioning) throw new Error('scope transition active');
        return epoch;
      },
      assertRequestCurrent(requestEpoch: number) {
        if (transitioning || requestEpoch !== epoch) {
          throw new Error('[client] Discarded a response from a previous authorization scope.');
        }
      },
    } satisfies AuthAuthorizationScopeLifecycle,
  };
  return recorder;
}

class SharedStorage implements Storage {
  private readonly values = new Map<string, string>();
  private readonly listeners = new Set<(
    key: string | null,
    value: string | null,
  ) => void>();

  get length(): number { return this.values.size; }
  clear(): void {
    this.values.clear();
    for (const listener of this.listeners) listener(null, null);
  }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void {
    this.values.delete(key);
    for (const listener of this.listeners) listener(key, null);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
    for (const listener of this.listeners) listener(key, String(value));
  }
  subscribe(listener: (key: string | null, value: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class ChannelHub {
  readonly messages: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent<unknown>) => void>>();

  channel(name: string) {
    const listeners = this.listeners.get(name) ?? new Set();
    this.listeners.set(name, listeners);
    let ownListener: ((event: MessageEvent<unknown>) => void) | null = null;
    return {
      postMessage: (value: unknown) => {
        this.messages.push(value);
        queueMicrotask(() => this.emit(name, value));
      },
      addEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
        ownListener = listener;
        listeners.add(listener);
      },
      removeEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
        listeners.delete(listener);
      },
      close: () => {
        if (ownListener) listeners.delete(ownListener);
      },
      onmessage: null,
    };
  }

  emit(name: string, value: unknown): void {
    const event = { data: value } as MessageEvent<unknown>;
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class MockLockManager {
  private readonly queues = new Map<string, Promise<void>>();

  async request<T>(
    name: string,
    _options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.queues.set(name, tail);
    await previous.catch(() => undefined);
    try {
      return await callback();
    } finally {
      release();
      if (this.queues.get(name) === tail) this.queues.delete(name);
    }
  }
}

function environmentFor(
  storage: SharedStorage,
  options: {
    ids: () => string;
    hub?: ChannelHub;
    lockManager?: MockLockManager;
    channel: boolean;
    locks: boolean;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    lockTimeoutMs?: number;
  },
): BrowserAuthCoordinationEnvironment {
  return {
    storage,
    locks: options.locks ? options.lockManager ?? new MockLockManager() : null,
    createChannel: options.channel
      ? (name) => options.hub?.channel(name) ?? null
      : null,
    addStorageListener: (listener) => storage.subscribe(listener),
    randomId: options.ids,
    now: options.now,
    sleep: options.sleep,
    lockTimeoutMs: options.lockTimeoutMs,
  };
}

function body(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function authUser() {
  return {
    userId: 'u_1', username: 'ada', email: 'ada@example.com', firstName: null,
    lastName: null, role: 'user', status: 'active' as const,
    passwordChangeRequired: false, emailVerifiedAt: 1,
    emailVerificationRequired: false, mfaRequired: false, properties: {},
    createdAt: 1, updatedAt: null,
  };
}

function tenant(tenantId: string) {
  return {
    tenantId,
    kind: 'organization' as const,
    slug: tenantId.replaceAll('_', '-'),
    name: tenantId,
    role: 'owner',
  };
}

function idFactory(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

function track(client: AuthClient): AuthClient {
  clients.push(client);
  return client;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  throw new Error('Timed out waiting for test condition');
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await delay(0);
  await Promise.resolve();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
