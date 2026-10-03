/**
 * sync-auth.integration.test.ts
 *
 * Exercises WebSocket auth through the real sync Elysia lifecycle. Unit tests
 * cover token resolution directly; this file verifies that the resolved auth
 * context is attached to sockets and used by state sync handlers.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { installAppStopBarrier } from '../frontend/server/app-stop-lifecycle';
import { createSyncPlugin } from './sync.plugin';
import type { ServerMessage, SyncTokenVerifier } from './types';

let app: ReturnType<typeof createApp> | null = null;

function createVerifier(): SyncTokenVerifier {
  return {
    async verifyAccessToken(token: string) {
      if (token === 'user-token') {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      }
      if (token === 'admin-token') {
        return { sub: 'admin-1', email: 'admin@test.local', role: 'admin' };
      }
      return null;
    },
  };
}

function createApp(
  authRequired = false,
  verifier: SyncTokenVerifier = createVerifier(),
  revalidateIntervalMs?: number,
  allowLegacyQueryToken = true,
  invalidationPollIntervalMs?: number,
) {

  return new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: 100 },
        tables: {
          todos: {
            id: 'text primary key',
            title: 'text not null',
          },
        },
        stateSync: true,
        auth: {
          required: authRequired,
          getTokenVerifier: () => verifier,
          revalidateIntervalMs,
          invalidationPollIntervalMs,
          ...(allowLegacyQueryToken ? { allowLegacyQueryToken: true } : {}),
        },
      })
    )
    .listen(0);
}

function getUrl(app: ReturnType<typeof createApp>, token?: string): string {
  const { hostname, port } = app.server!;
  const url = new URL(`ws://${hostname}:${port}/sync`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

async function connectWS(
  url: string
): Promise<{
  ws: WebSocket;
  messages: ServerMessage[];
  waitForMessage: (
    predicate: (msg: ServerMessage) => boolean,
    timeout?: number
  ) => Promise<ServerMessage>;
  waitForClose: (timeout?: number) => Promise<CloseEvent>;
  close: () => void;
}> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
  }> = [];
  const closeWaiters: Array<(event: CloseEvent) => void> = [];
  let closeEvent: CloseEvent | null = null;

  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;

    try {
      const msg = JSON.parse(event.data) as ServerMessage;
      messages.push(msg);

      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    } catch {}
  };

  ws.onclose = (event) => {
    closeEvent = event;
    while (closeWaiters.length > 0) {
      closeWaiters.shift()!(event);
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  function waitForMessage(
    predicate: (msg: ServerMessage) => boolean,
    timeout = 2000
  ): Promise<ServerMessage> {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);

      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  function waitForClose(timeout = 2000): Promise<CloseEvent> {
    if (closeEvent) return Promise.resolve(closeEvent);

    return new Promise<CloseEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeout);

      closeWaiters.push((event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  return {
    ws,
    messages,
    waitForMessage,
    waitForClose,
    close: () => ws.close(),
  };
}

afterEach(async () => {
  if (app) await installAppStopBarrier(app, async () => {}).stop(true);
  app = null;
});

describe('sync WebSocket auth integration', () => {
  test('valid user token enables state sync for that user', async () => {
    app = createApp();
    const conn = await connectWS(getUrl(app, 'user-token'));

    conn.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    const snapshot = await conn.waitForMessage((msg) => msg.type === 'state.snapshot');

    expect(snapshot).toEqual({ type: 'state.snapshot', entries: {} });

    conn.ws.send(JSON.stringify({
      type: 'state.set',
      ref: 'set-theme',
      key: 'theme',
      value: 'dark',
    }));
    const ack = await conn.waitForMessage(
      (msg) => msg.type === 'state.ack' && msg.ref === 'set-theme'
    );

    expect(ack).toEqual({ type: 'state.ack', ref: 'set-theme', ok: true });

    conn.close();
  });

  test('authenticates from the first message without a query-string token', async () => {
    app = createApp(true);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({ type: 'sync.auth', token: 'user-token' }));
    const ready = await conn.waitForMessage((msg) => msg.type === 'sync.auth.ready');
    expect(ready).toEqual({ type: 'sync.auth.ready', authenticated: true });

    conn.ws.send(JSON.stringify({ type: 'state.subscribe' }));
    const snapshot = await conn.waitForMessage((msg) => msg.type === 'state.snapshot');
    expect(snapshot).toEqual({ type: 'state.snapshot', entries: {} });

    conn.close();
  });

  test('rejects query-string bearer tokens unless compatibility is explicit', async () => {
    app = createApp(true, createVerifier(), undefined, false);
    const conn = await connectWS(getUrl(app, 'user-token'));
    const close = await conn.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Query token authentication disabled');
  });

  test('valid admin token enables state sync for the admin user', async () => {
    app = createApp();
    const conn = await connectWS(getUrl(app, 'admin-token'));

    conn.ws.send(JSON.stringify({ type: 'state.set', ref: 'set-panel', key: 'panel', value: 'jobs' }));
    const ack = await conn.waitForMessage(
      (msg) => msg.type === 'state.ack' && msg.ref === 'set-panel'
    );

    expect(ack).toEqual({ type: 'state.ack', ref: 'set-panel', ok: true });

    conn.close();
  });

  test('missing token is rejected when sync auth is required', async () => {
    app = createApp(true);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({
      type: 'sync.subscribe',
      tables: ['todos'],
      lastSeq: 0,
    }));

    const close = await conn.waitForClose();

    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Auth token required');
  });

  test('invalid provided token is rejected', async () => {
    app = createApp();
    const conn = await connectWS(getUrl(app, 'bad-token'));

    const close = await conn.waitForClose();

    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Invalid auth token');
  });

  test('optional missing token keeps standalone sync anonymous', async () => {
    app = createApp();
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({
      type: 'state.set',
      ref: 'anonymous-state',
      key: 'theme',
      value: 'dark',
    }));

    const ack = await conn.waitForMessage(
      (msg) => msg.type === 'state.ack' && msg.ref === 'anonymous-state'
    );

    expect(ack).toEqual({
      type: 'state.ack',
      ref: 'anonymous-state',
      ok: false,
      error: 'UNAUTHORIZED',
    });

    conn.close();
  });

  test('live account revalidation closes an already-active revoked session', async () => {
    let active = true;
    const verifier: SyncTokenVerifier = {
      async resolveAuthContext(token) {
        if (!active || token !== 'live-token') return null;
        return { userId: 'user-1', email: 'user@test.local', role: 'user' };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 10);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({ type: 'sync.auth', token: 'live-token' }));
    await conn.waitForMessage((msg) => msg.type === 'sync.auth.ready');
    active = false;

    const close = await conn.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Invalid auth token');
  });

  test('disconnect releases the stable socket identity and stops authorization polling', async () => {
    let resolutions = 0;
    const verifier: SyncTokenVerifier = {
      async resolveAuthContext(token) {
        resolutions += 1;
        if (token !== 'disconnect-token') return null;
        return { userId: 'user-1', email: 'user@test.local', role: 'user' };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 5);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({
      type: 'sync.auth',
      token: 'disconnect-token',
    }));
    await conn.waitForMessage((msg) => msg.type === 'sync.auth.ready');
    await waitForCondition(() => resolutions >= 3);

    conn.close();
    await conn.waitForClose();

    // A revalidation already in flight at close may finish once. After close
    // processing settles, no timer keyed by an earlier ElysiaWS facade may
    // survive and perform more authorization work for this connection.
    await Bun.sleep(25);
    const settledResolutions = resolutions;
    await Bun.sleep(50);
    expect(resolutions).toBe(settledResolutions);
  });

  test('authorization completing after disconnect cannot reactivate the socket', async () => {
    let resolutions = 0;
    let observeResolution!: () => void;
    let releaseResolution!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => {
      observeResolution = resolve;
    });
    const resolutionBlocked = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    const verifier: SyncTokenVerifier = {
      async resolveAuthContext(token) {
        resolutions += 1;
        observeResolution();
        await resolutionBlocked;
        if (token !== 'pending-disconnect-token') return null;
        return { userId: 'user-1', email: 'user@test.local', role: 'user' };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 10);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({
      type: 'sync.auth',
      token: 'pending-disconnect-token',
    }));
    await resolutionStarted;
    conn.close();
    await conn.waitForClose();

    // Let Elysia's server-side close callback release the raw socket before
    // the external verifier is allowed to settle.
    await Bun.sleep(25);
    releaseResolution();
    await Bun.sleep(100);

    expect(resolutions).toBe(1);
  });

  test('shared authority revision closes revoked sockets without waiting for periodic revalidation', async () => {
    let active = true;
    let authorityRevision = 1;
    const verifier: SyncTokenVerifier = {
      getAuthorityRevision: () => authorityRevision,
      async resolveAuthContext(token) {
        if (!active || token !== 'revision-token') return null;
        return { userId: 'user-1', email: 'user@test.local', role: 'user' };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 60_000, true, 10);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({ type: 'sync.auth', token: 'revision-token' }));
    await conn.waitForMessage((msg) => msg.type === 'sync.auth.ready');
    active = false;
    authorityRevision += 1;

    const close = await conn.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Invalid auth token');
  });

  test('first authority revision baseline revalidates sockets admitted during auth startup', async () => {
    let resolutions = 0;
    const verifier: SyncTokenVerifier = {
      // Model managed composition: Sync starts before Auth exposes its durable
      // clock. The clock first becomes readable after this socket's initial
      // token resolution, while the exact session has already been revoked.
      getAuthorityRevision: () => resolutions === 0 ? null : 2,
      async resolveAuthContext(token) {
        resolutions += 1;
        if (resolutions !== 1 || token !== 'startup-race-token') return null;
        return { userId: 'user-1', email: 'user@test.local', role: 'user' };
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 60_000, true, 10);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({ type: 'sync.auth', token: 'startup-race-token' }));
    const close = await conn.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Invalid auth token');
    expect(resolutions).toBeGreaterThanOrEqual(2);
  });

  test('authority changes queued during an in-flight pass cannot be lost', async () => {
    const context = { userId: 'user-1', email: 'user@test.local', role: 'user' };
    let authorityRevision = 1;
    let resolutions = 0;
    let releaseSecondResolution!: () => void;
    let secondResolutionStarted!: () => void;
    const secondResolutionPending = new Promise<void>((resolve) => {
      releaseSecondResolution = resolve;
    });
    const secondResolutionObserved = new Promise<void>((resolve) => {
      secondResolutionStarted = resolve;
    });
    const verifier: SyncTokenVerifier = {
      getAuthorityRevision: () => authorityRevision,
      async resolveAuthContext(token) {
        if (token !== 'queued-revision-token') return null;
        resolutions += 1;
        if (resolutions === 1) return context;
        if (resolutions === 2) {
          secondResolutionStarted();
          await secondResolutionPending;
          return context;
        }
        return null;
      },
      async verifyAccessToken() {
        return { sub: 'user-1', email: 'user@test.local', role: 'user' };
      },
    };
    app = createApp(true, verifier, 60_000, true, 10);
    const conn = await connectWS(getUrl(app));

    conn.ws.send(JSON.stringify({ type: 'sync.auth', token: 'queued-revision-token' }));
    await conn.waitForMessage((msg) => msg.type === 'sync.auth.ready');
    authorityRevision = 2;
    await secondResolutionObserved;

    // Commit a second invalidation while revision 2 is still resolving. The
    // next poll must queue another pass instead of joining and then forgetting
    // the stale single-flight check.
    authorityRevision = 3;
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseSecondResolution();

    const close = await conn.waitForClose();
    expect(close.code).toBe(4001);
    expect(close.reason).toBe('Invalid auth token');
    expect(resolutions).toBeGreaterThanOrEqual(3);
  });
});

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for Sync test condition.');
    }
    await Bun.sleep(5);
  }
}
