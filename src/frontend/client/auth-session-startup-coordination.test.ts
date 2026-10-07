/**
 * Browser-session startup coordination regressions.
 *
 * Exercises real controller/coordinator logic with synthetic proof, fetch and
 * a non-reentrant shared lock. No live browser credentials or database are used.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AuthSessionController } from './auth-session';
import {
  BrowserAuthCoordinator,
  type BrowserAuthCoordinationEnvironment,
} from './auth-browser-coordination';
import { completionUser } from './auth-user-profile-completion.test-fixtures';

const baseUrl = 'https://startup-coordination.test';
const originalFetch = globalThis.fetch;
const controllers = new Set<AuthSessionController>();
const peers = new Set<BrowserAuthCoordinator>();
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.clear();
  for (const peer of peers) peer.dispose();
  peers.clear();
  globalThis.fetch = originalFetch;
});

describe('startup rotation and identity hydration share one credential lock', () => {
  for (const held of ['headers', 'body'] as const) {
    test(`a legal peer rotation waits for held /me ${held} and cannot cause recovery`, async () => {
      const f = fixture();
      const response = deferred<Response>(), body = deferred<unknown>();
      let reading = false;
      mock((url) => {
        if (url.endsWith('/auth/refresh')) return rotated();
        reading = true;
        if (held === 'headers') return response.promise;
        const accepted = Response.json(completionUser());
        accepted.json = () => body.promise;
        return accepted;
      });
      const controller = startup(f.environment);
      await waitFor(() => reading);
      const events: string[] = [];
      const unsubscribe = controller.subscribe(() => {
        if (controller.isAuthenticated && !events.includes('hydrated')) events.push('hydrated');
      });
      const peer = coordinator(f.environment);
      const rotation = peer.runExclusive(async () => {
        events.push('peer-rotated');
        peer.commitSession('peer-rotated-proof', 'startup-family', 'refresh');
      });
      // Same-document coordinators also serialize before Web Lock admission.
      // Drain that queue without requiring the still-blocked peer's lock call.
      await drain();
      expect(f.lock.admitted).toBe(1);
      expect(events).toEqual([]);
      expect(controller.isRestoring).toBe(true);
      response.resolve(Response.json(completionUser()));
      body.resolve(completionUser());
      await rotation;
      await waitFor(() => !controller.isRestoring);
      expect(events).toEqual(['hydrated', 'peer-rotated']);
      expect(controller.user?.userId).toBe(completionUser().userId);
      expect(controller.error).toBeNull();
      expect(controller.authorizationScopeKey).toBe('startup-family');
      expect(peer.readCredential()?.refreshToken).toBe('peer-rotated-proof');
      expect(f.lock.maximum).toBe(1);
      unsubscribe();
    });
  }

  test('two simultaneous startup controllers rotate and hydrate in serialized order', async () => {
    const f = fixture(), firstMe = deferred<Response>();
    const submitted: string[] = [];
    let identityRequests = 0;
    mock((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        submitted.push(JSON.parse(String(init?.body)).refreshToken);
        return Response.json({ accessToken: `access-${submitted.length}`, refreshToken: `proof-${submitted.length}` });
      }
      identityRequests++;
      return identityRequests === 1 ? firstMe.promise : Response.json(completionUser());
    });
    const first = startup(f.environment);
    await waitFor(() => identityRequests === 1);
    const second = startup(f.environment);
    await drain();
    expect(submitted).toEqual(['startup-proof']);
    firstMe.resolve(Response.json(completionUser()));
    await waitFor(() => !first.isRestoring && !second.isRestoring);
    expect(submitted).toEqual(['startup-proof', 'proof-1']);
    expect(first.isAuthenticated).toBe(true);
    expect(second.isAuthenticated).toBe(true);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(coordinator(f.environment).readCredential()?.refreshToken).toBe('proof-2');
    expect(f.lock.maximum).toBe(1);
  });

  for (const status of [401, 403]) {
    test(`/me ${status} clears its page session without acquiring a nested lock`, async () => {
      const f = fixture(), routes: string[] = [];
      let submittedLogout: unknown;
      mock((url, init) => {
        routes.push(new URL(url).pathname);
        if (url.endsWith('/auth/refresh')) return rotated();
        if (url.endsWith('/auth/me')) return Response.json({}, { status });
        submittedLogout = JSON.parse(String(init?.body));
        return Response.json({ ok: true });
      });
      const controller = startup(f.environment);
      await waitFor(() => !controller.isRestoring);
      expect(routes).toEqual(['/auth/refresh', '/auth/me', '/auth/logout']);
      expect(submittedLogout).toEqual({ refreshToken: 'rotated-proof' });
      expect(controller.user).toBeNull();
      expect(controller.hasRecoverableSession).toBe(false);
      expect(controller.authorizationScopeKey).toBeNull();
      expect(f.lock.requested).toBe(1);
      expect(f.lock.maximum).toBe(1);
    });
  }

  for (const held of ['headers', 'body'] as const) {
    test(`a stalled /me ${held} times out, releases the shared lock and rejects late hydration`, async () => {
      const f = fixture(), response = deferred<Response>(), body = deferred<unknown>();
      let reading = false;
      let signal: AbortSignal | undefined;
      mock((url, init) => {
        if (url.endsWith('/auth/refresh')) return rotated();
        reading = true;
        signal = init?.signal ?? undefined;
        if (held === 'headers') return response.promise;
        const accepted = Response.json(completionUser());
        accepted.json = () => body.promise;
        return accepted;
      });
      const controller = startup(f.environment, 20);
      await waitFor(() => reading);
      const peer = coordinator(f.environment);
      const rotation = peer.runExclusive(async () => {
        peer.commitSession('post-timeout-proof', 'startup-family', 'refresh');
      });
      await rotation;
      await waitFor(() => !controller.isRestoring);
      expect(signal?.aborted).toBe(true);
      expect(controller.user).toBeNull();
      expect(controller.hasRecoverableSession).toBe(true);
      expect(controller.error).toBe('Unable to restore the browser session');
      response.resolve(Response.json(completionUser()));
      body.resolve(completionUser());
      await drain();
      expect(controller.user).toBeNull();
      expect(peer.readCredential()?.refreshToken).toBe('post-timeout-proof');
      expect(f.lock.maximum).toBe(1);
    });
  }

  test('disposal of a held /me releases the shared lock without publishing its late user', async () => {
    const f = fixture(), response = deferred<Response>();
    let reading = false;
    let signal: AbortSignal | undefined;
    mock((url, init) => {
      if (url.endsWith('/auth/refresh')) return rotated();
      reading = true;
      signal = init?.signal ?? undefined;
      return response.promise;
    });
    const controller = startup(f.environment);
    await waitFor(() => reading);
    const peer = coordinator(f.environment);
    const rotation = peer.runExclusive(async () => {
      peer.commitSession('post-disposal-proof', 'startup-family', 'refresh');
    });
    controller.dispose();
    await rotation;
    expect(signal?.aborted).toBe(true);
    response.resolve(Response.json(completionUser()));
    await drain();
    expect(controller.user).toBeNull();
    expect(peer.readCredential()?.refreshToken).toBe('post-disposal-proof');
    expect(f.lock.maximum).toBe(1);
  });

  test('logout queued during startup runs after hydration and leaves no revived identity', async () => {
    const f = fixture(), response = deferred<Response>();
    let reading = false, logouts = 0;
    let submittedLogout: unknown;
    mock((url, init) => {
      if (url.endsWith('/auth/refresh')) return rotated();
      if (url.endsWith('/auth/me')) { reading = true; return response.promise; }
      logouts++;
      submittedLogout = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    });
    const controller = startup(f.environment);
    await waitFor(() => reading);
    const logout = controller.logout();
    await drain();
    expect(logouts).toBe(0);
    expect(controller.user).toBeNull();
    response.resolve(Response.json(completionUser()));
    await logout;
    await waitFor(() => !controller.isRestoring);
    expect(logouts).toBe(1);
    expect(submittedLogout).toEqual({ refreshToken: 'rotated-proof' });
    expect(controller.user).toBeNull();
    expect(controller.refreshToken).toBeNull();
    expect(controller.authorizationScopeKey).toBeNull();
    expect(f.lock.maximum).toBe(1);
  });

  for (const replacement of ['family', 'logout', 'same-family-uncoordinated'] as const) {
    test(`an uncoordinated ${replacement} change still fences a pending /me result`, async () => {
      const f = fixture(), response = deferred<Response>();
      let reading = false;
      mock((url) => {
        if (url.endsWith('/auth/refresh')) return rotated();
        reading = true;
        return response.promise;
      });
      const controller = startup(f.environment);
      await waitFor(() => reading);
      const peer = coordinator(f.environment);
      // This deliberately bypasses the shared lock: exact durable proof fences
      // must still reject external replacements and hostile/legacy writers.
      if (replacement === 'logout') peer.commitLogout();
      else peer.commitSession('outside-proof', replacement === 'family' ? 'replacement-family' : 'startup-family', 'scope');
      response.resolve(Response.json(completionUser()));
      await drain();
      expect(controller.user).toBeNull();
      expect(peer.readCredential()?.refreshToken).toBe(replacement === 'logout' ? null : 'outside-proof');
      if (replacement === 'same-family-uncoordinated') {
        expect(controller.error).toBe('Unable to restore the browser session');
        expect(controller.isRestoring).toBe(false);
      }
    });
  }
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

function fixture() {
  const lock = { requested: 0, admitted: 0, active: 0, maximum: 0 };
  let tail = Promise.resolve();
  let id = 0;
  const environment: BrowserAuthCoordinationEnvironment = {
    storage: new MemoryStorage(), createChannel: null,
    addStorageListener: () => () => {}, randomId: () => `startup-${++id}`,
    locks: {
      request(_name, _options, callback) {
        lock.requested++;
        const admitted = tail.then(async () => {
          lock.admitted++;
          lock.active++;
          lock.maximum = Math.max(lock.maximum, lock.active);
          try { return await callback(); } finally { lock.active--; }
        });
        tail = admitted.then(() => {}, () => {});
        return admitted;
      },
    },
  };
  const seed = coordinator(environment);
  seed.commitSession('startup-proof', 'startup-family', 'session');
  seed.dispose();
  return { environment, lock };
}

function coordinator(environment: BrowserAuthCoordinationEnvironment) {
  const peer = new BrowserAuthCoordinator(baseUrl, environment);
  peers.add(peer);
  return peer;
}
function startup(coordination: BrowserAuthCoordinationEnvironment, timeout?: number) {
  const controller = new AuthSessionController(baseUrl, { coordination, recoveryRequestTimeoutMs: timeout });
  controllers.add(controller);
  return controller;
}
function mock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input, init) => Promise.resolve().then(() => handler(String(input), init))) as typeof fetch;
}
const rotated = () => Response.json({ accessToken: 'rotated-access', refreshToken: 'rotated-proof' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error('Synthetic startup coordination did not settle.');
}
async function drain() {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}
