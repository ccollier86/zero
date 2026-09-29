import { describe, test, expect, afterEach } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Elysia } from 'elysia';
import { createSyncPlugin } from './sync.plugin';
import type { ServerMessage } from './types';
import { STATE_LIMITS, SYNC_OUTGOING_BACKPRESSURE_LIMIT } from './types';

// ─── Helpers ───────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp> | null = null;

function createApp(opts?: { stateSync?: boolean }) {
  return new Elysia()
    .use(
      createSyncPlugin({
        db: { mode: 'memory', ringBufferDepth: 100 },
        tables: {
          todos: {
            id: 'text primary key',
            title: 'text not null',
            done: 'integer default 0',
          },
        },
        stateSync: opts?.stateSync ?? true,
      })
    )
    .listen(0);
}

function getUrl(app: ReturnType<typeof createApp>): string {
  const { hostname, port } = app.server!;
  return `ws://${hostname}:${port}/sync`;
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
  close: () => void;
}> {
  const messages: ServerMessage[] = [];
  const waiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];

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
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for message'));
      }, timeout);

      waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject,
      });
    });
  }

  return {
    ws,
    messages,
    waitForMessage,
    close: () => ws.close(),
  };
}

/**
 * Helper to set authContext on the connection.
 * Since there's no auth plugin in these tests, state handlers require
 * authContext to be set. We'll inject it by sending a sync.subscribe first
 * (which works without auth) and then manually test state operations.
 *
 * For actual state tests, we need the ws.data.authContext to be set.
 * Since we can't do that from the client side without an auth plugin,
 * we'll test the state-manager and state-handler directly for auth-dependent
 * behavior, and test the WS layer for message routing.
 */

afterEach(async () => {
  if (app) await app.stop(true);
  app = null;
});

// ─── State Manager via Handler (direct unit tests) ───────────────────────

/**
 * These tests exercise the state-handler functions directly with a mock WS.
 * This avoids needing auth middleware for the integration layer.
 */
import { createReactiveDB, type ReactiveDB } from './reactive-db';
import { StateManager } from './state-manager';
import {
  handleStateSubscribe,
  handleStateSet,
  handleStateDelete,
  handleStateClear,
} from './state-handler';
import type { SyncSocketData, StateAckMessage, StateSnapshotMessage } from './types';

function createMockWs(userId: string | null = 'test-user') {
  const sent: string[] = [];
  const subscribed: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];

  const data: SyncSocketData = {
    connectionId: 'conn_1',
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: userId ? { userId, email: 'test@test.com', role: 'user' } : null,
    authResolved: true,
    authorizationFingerprint: null,
    authorizationScope: null,
    allowedTables: new Set(),
    resourceRowFilters: new Map(),
    rowFilteredSubscribedTables: new Set(),
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set<string>(),
  };

  const ws = {
    data,
    send: (msg: string) => sent.push(msg),
    subscribe: (topic: string) => {
      subscribed.push(topic);
      data.subscribedTopics.add(topic);
    },
    close: (code?: number, reason?: string) => closed.push({ code, reason }),
  };

  return { ws: ws as any, sent, subscribed, closed, data };
}

function createMockServer() {
  const published: Array<{ topic: string; data: string }> = [];
  return {
    server: {
      publish: (topic: string, data: string) => published.push({ topic, data }),
    },
    published,
  };
}

describe('state handler — subscribe', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('sends snapshot of current user state', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    mgr.set('test-user', 'theme', 'dark');
    mgr.set('test-user', 'lang', 'en');

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    handleStateSubscribe(ws, mgr, server);

    expect(sent).toHaveLength(1);
    const snapshot = JSON.parse(sent[0]) as StateSnapshotMessage;
    expect(snapshot.type).toBe('state.snapshot');
    expect(snapshot.entries).toEqual({ theme: 'dark', lang: 'en' });
  });

  test('binds the socket to the exact state principal without a Bun topic', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, subscribed } = createMockWs('test-user');
    const { server } = createMockServer();

    handleStateSubscribe(ws, mgr, server);

    expect(subscribed).toEqual([]);
    expect(ws.data.stateSubscribed).toBe(true);
    expect(ws.data.statePrincipal).toBe('test-user');
  });

  test('sends empty snapshot for user with no state', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('new-user');
    const { server } = createMockServer();

    handleStateSubscribe(ws, mgr, server);

    const snapshot = JSON.parse(sent[0]) as StateSnapshotMessage;
    expect(snapshot.entries).toEqual({});
  });

  test('ignores unauthenticated connections', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs(null);
    const { server } = createMockServer();

    handleStateSubscribe(ws, mgr, server);

    expect(sent).toHaveLength(0);
  });

  test('idempotent — subscribing twice refreshes the snapshot without a topic', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, subscribed } = createMockWs('test-user');
    const { server } = createMockServer();

    handleStateSubscribe(ws, mgr, server);
    handleStateSubscribe(ws, mgr, server);

    expect(subscribed).toEqual([]);
    expect(ws.data.stateSubscribed).toBe(true);
  });

  test('queues a near-limit snapshot within the bounded outgoing ceiling', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    const value = 'x'.repeat(60_000);
    for (let index = 0; index < 174; index++) {
      expect(mgr.set('test-user', `key-${index}`, value)).toEqual({ ok: true });
    }

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();
    handleStateSubscribe(ws, mgr, server);

    expect(sent).toHaveLength(1);
    const wireBytes = Buffer.byteLength(sent[0]!, 'utf8');
    expect(wireBytes).toBeGreaterThan(10_000_000);
    expect(wireBytes).toBeLessThan(SYNC_OUTGOING_BACKPRESSURE_LIMIT);
    expect(ws.data.stateSubscribed).toBe(true);
  });

  test('16 MiB outgoing ceiling bounds maximum key escaping at the 10 MiB contract', () => {
    const entries = Object.create(null) as Record<string, string>;
    const value = 'x'.repeat(10_227);
    let storedBytes = 0;

    for (let index = 0; index < STATE_LIMITS.maxKeys; index += 1) {
      // A one-byte NUL becomes the longest six-byte JSON key escape. Preserve
      // four printable characters for uniqueness while using the max length.
      const key = `${'\0'.repeat(252)}${String(index).padStart(4, '0')}`;
      entries[key] = value;
      storedBytes += Buffer.byteLength(key, 'utf8')
        + Buffer.byteLength(JSON.stringify(value), 'utf8');
    }

    expect(storedBytes).toBeLessThanOrEqual(STATE_LIMITS.maxTotalSize);
    expect(STATE_LIMITS.maxTotalSize - storedBytes).toBeLessThan(1_000);
    const wireBytes = Buffer.byteLength(JSON.stringify({
      type: 'state.snapshot',
      entries,
    }), 'utf8');
    expect(wireBytes).toBeGreaterThan(STATE_LIMITS.maxTotalSize);
    expect(wireBytes).toBeLessThan(SYNC_OUTGOING_BACKPRESSURE_LIMIT);
  });

  test('clears the subscription binding when the snapshot cannot be queued', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    const { ws, closed } = createMockWs('test-user');
    const { server } = createMockServer();
    ws.send = () => 0;

    handleStateSubscribe(ws, mgr, server);

    expect(closed).toEqual([{ code: 1013, reason: 'Sync delivery interrupted' }]);
    expect(ws.data.stateSubscribed).toBe(false);
    expect(ws.data.statePrincipal).toBeNull();
    expect(ws.data.stateLastSeq).toBe(0);
  });
});

describe('state handler — set', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('persists value and sends ok ack', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('test-user');
    const { server, published } = createMockServer();

    handleStateSet(
      ws,
      { type: 'state.set', ref: 'ref-1', key: 'theme', value: 'dark' },
      mgr,
      server
    );

    // Check ack
    expect(sent).toHaveLength(1);
    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.type).toBe('state.ack');
    expect(ack.ref).toBe('ref-1');
    expect(ack.ok).toBe(true);

    // State delivery is owned by ReactiveDB's ordered onChange path.
    expect(published).toEqual([]);

    // Check persisted
    expect(mgr.getUserState('test-user').get('theme')).toBe('dark');
  });

  test('returns error ack for unauthenticated', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs(null);
    const { server, published } = createMockServer();

    handleStateSet(
      ws,
      { type: 'state.set', ref: 'ref-1', key: 'theme', value: 'dark' },
      mgr,
      server
    );

    expect(sent).toHaveLength(1);
    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('UNAUTHORIZED');
    expect(published).toHaveLength(0);
  });

  test('returns error ack when value too large', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('test-user');
    const { server, published } = createMockServer();

    const bigValue = 'x'.repeat(100_000);
    handleStateSet(
      ws,
      { type: 'state.set', ref: 'ref-1', key: 'big', value: bigValue },
      mgr,
      server
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('VALUE_TOO_LARGE');
    expect(published).toHaveLength(0);
  });
});

describe('state handler — delete', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('deletes key and acks without blind topic publication', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    mgr.set('test-user', 'theme', 'dark');

    const { ws, sent } = createMockWs('test-user');
    const { server, published } = createMockServer();

    handleStateDelete(
      ws,
      { type: 'state.delete', ref: 'ref-1', key: 'theme' },
      mgr,
      server
    );

    // Ack
    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(true);

    expect(published).toEqual([]);

    // State updated
    expect(mgr.getUserState('test-user').has('theme')).toBe(false);
  });

  test('returns error ack for unauthenticated', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs(null);
    const { server } = createMockServer();

    handleStateDelete(
      ws,
      { type: 'state.delete', ref: 'ref-1', key: 'theme' },
      mgr,
      server
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('UNAUTHORIZED');
  });
});

describe('state handler — clear', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('clears all state and acks without blind topic publication', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    mgr.set('test-user', 'a', 1);
    mgr.set('test-user', 'b', 2);

    const { ws, sent } = createMockWs('test-user');
    const { server, published } = createMockServer();

    handleStateClear(
      ws,
      { type: 'state.clear', ref: 'ref-1' },
      mgr,
      server
    );

    // Ack
    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(true);

    expect(published).toEqual([]);

    // State cleared
    expect(mgr.getUserState('test-user').size).toBe(0);
  });

  test('returns error ack for unauthenticated', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs(null);
    const { server } = createMockServer();

    handleStateClear(
      ws,
      { type: 'state.clear', ref: 'ref-1' },
      mgr,
      server
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(false);
    expect(ack.error).toBe('UNAUTHORIZED');
  });
});

// ─── Message Routing via routeMessage ────────────────────────────────────

import { routeMessage } from './message-handler';

describe('routeMessage — state message routing', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('routes state.subscribe through routeMessage', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    mgr.set('test-user', 'theme', 'dark');

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(ws, { type: 'state.subscribe' }, db, server, mgr);

    expect(sent).toHaveLength(1);
    const snapshot = JSON.parse(sent[0]) as StateSnapshotMessage;
    expect(snapshot.type).toBe('state.snapshot');
  });

  test('routes state.set through routeMessage', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(
      ws,
      { type: 'state.set', ref: 'ref-1', key: 'k', value: 'v' },
      db,
      server,
      mgr
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(true);
  });

  test('routes state.delete through routeMessage', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    mgr.set('test-user', 'k', 'v');

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(
      ws,
      { type: 'state.delete', ref: 'ref-1', key: 'k' },
      db,
      server,
      mgr
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(true);
  });

  test('routes state.clear through routeMessage', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(
      ws,
      { type: 'state.clear', ref: 'ref-1' },
      db,
      server,
      mgr
    );

    const ack = JSON.parse(sent[0]) as StateAckMessage;
    expect(ack.ok).toBe(true);
  });

  test('rejects malformed state messages with stable acks and no durable writes', async () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();
    const baseline = db.currentSeq;

    const malformed = [
      { type: 'state.set', ref: 'missing-key', value: 'v' },
      { type: 'state.set', ref: 'missing-value', key: 'k' },
      { type: 'state.set', ref: 'invalid-number', key: 'k', value: Number.NaN },
      { type: 'state.delete', ref: 'null-key', key: null },
      { type: 'state.clear', ref: '' },
      { type: 'state.clear', ref: 'r'.repeat(129) },
    ];

    for (const message of malformed) {
      await routeMessage(ws, message, db, server, mgr);
    }

    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'state.ack', ref: 'missing-key', ok: false, error: 'INVALID_REQUEST' },
      { type: 'state.ack', ref: 'missing-value', ok: false, error: 'INVALID_REQUEST' },
      { type: 'state.ack', ref: 'invalid-number', ok: false, error: 'INVALID_REQUEST' },
      { type: 'state.ack', ref: 'null-key', ok: false, error: 'INVALID_REQUEST' },
      { type: 'state.ack', ref: '', ok: false, error: 'INVALID_REQUEST' },
      { type: 'state.ack', ref: '', ok: false, error: 'INVALID_REQUEST' },
    ]);
    expect(db.currentSeq).toBe(baseline);
  });

  test('applies the shared key limit to set and delete without logging rejects', async () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();
    const key = 'k'.repeat(257);

    await routeMessage(
      ws,
      { type: 'state.set', ref: 'set-long', key, value: true },
      db,
      server,
      mgr,
    );
    await routeMessage(
      ws,
      { type: 'state.delete', ref: 'delete-long', key },
      db,
      server,
      mgr,
    );

    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'state.ack', ref: 'set-long', ok: false, error: 'KEY_TOO_LONG' },
      { type: 'state.ack', ref: 'delete-long', ok: false, error: 'KEY_TOO_LONG' },
    ]);
    expect(db.currentSeq).toBe(0);
  });

  test('passes the synchronous authority fence to snapshots and mutations', async () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);
    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();
    const mutationOrigin = { current: null as string | null };
    const routeWithDeniedAuthority = (message: Record<string, unknown>) => routeMessage(
      ws,
      message,
      db,
      server,
      mgr,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mutationOrigin,
      undefined,
      undefined,
      'single',
      undefined,
      () => false,
    );

    await routeWithDeniedAuthority({ type: 'state.subscribe' });
    await routeWithDeniedAuthority({
      type: 'state.set', ref: 'set', key: 'k', value: 'v',
    });
    await routeWithDeniedAuthority({ type: 'state.delete', ref: 'delete', key: 'k' });
    await routeWithDeniedAuthority({ type: 'state.clear', ref: 'clear' });

    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'state.ack', ref: 'set', ok: false, error: 'UNAUTHORIZED' },
      { type: 'state.ack', ref: 'delete', ok: false, error: 'UNAUTHORIZED' },
      { type: 'state.ack', ref: 'clear', ok: false, error: 'UNAUTHORIZED' },
    ]);
    expect(db.currentSeq).toBe(0);
    expect(mutationOrigin.current).toBeNull();
  });

  test('state messages are ignored when stateManager is null', () => {
    db = createReactiveDB({ mode: 'memory' });

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(
      ws,
      { type: 'state.set', ref: 'ref-1', key: 'k', value: 'v' },
      db,
      server,
      null
    );

    expect(sent).toHaveLength(0);
  });

  test('state messages are ignored when stateManager is undefined', () => {
    db = createReactiveDB({ mode: 'memory' });

    const { ws, sent } = createMockWs('test-user');
    const { server } = createMockServer();

    routeMessage(
      ws,
      { type: 'state.subscribe' },
      db,
      server,
      undefined
    );

    expect(sent).toHaveLength(0);
  });

  test('sync messages still work alongside state messages', async () => {
    db = createReactiveDB({ mode: 'memory' });
    db.defineTable('todos', {
      id: 'text primary key',
      title: 'text not null',
      done: 'integer default 0',
    });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('test-user');
    ws.data.allowedTables = new Set(['todos']);
    const { server } = createMockServer();

    // Subscribe to sync tables
    await routeMessage(
      ws,
      { type: 'sync.subscribe', tables: ['todos'], lastSeq: 0 },
      db,
      server,
      mgr
    );

    // Should get sync snapshot
    expect(sent.length).toBeGreaterThan(0);
    const syncSnapshot = JSON.parse(sent[0]);
    expect(syncSnapshot.type).toBe('sync.snapshot');

    // Now send state subscribe
    await routeMessage(ws, { type: 'state.subscribe' }, db, server, mgr);

    // Should get state snapshot
    const stateSnapshot = JSON.parse(sent[sent.length - 1]);
    expect(stateSnapshot.type).toBe('state.snapshot');
  });
});

// ─── Full flow with multiple operations ──────────────────────────────────

describe('state handler — full flows', () => {
  let db: ReactiveDB;
  let mgr: StateManager;

  afterEach(() => {
    db?.dispose();
  });

  test('subscribe → set → set → delete → verify state', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('user-1');
    const { server } = createMockServer();

    // Subscribe
    handleStateSubscribe(ws, mgr, server);
    const snapshot = JSON.parse(sent[0]);
    expect(snapshot.entries).toEqual({});

    // Set two keys
    handleStateSet(ws, { type: 'state.set', ref: 'r1', key: 'a', value: 1 }, mgr, server);
    handleStateSet(ws, { type: 'state.set', ref: 'r2', key: 'b', value: 2 }, mgr, server);

    // Delete one
    handleStateDelete(ws, { type: 'state.delete', ref: 'r3', key: 'a' }, mgr, server);

    // Verify final state
    expect(mgr.getUserStateEntries('user-1')).toEqual({ b: 2 });
  });

  test('two users with independent state', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const ws1 = createMockWs('user-1');
    const ws2 = createMockWs('user-2');
    const { server, published } = createMockServer();

    // User 1 sets
    handleStateSet(ws1.ws, { type: 'state.set', ref: 'r1', key: 'theme', value: 'dark' }, mgr, server);

    // User 2 sets same key differently
    handleStateSet(ws2.ws, { type: 'state.set', ref: 'r2', key: 'theme', value: 'light' }, mgr, server);

    // Independent
    expect(mgr.getUserState('user-1').get('theme')).toBe('dark');
    expect(mgr.getUserState('user-2').get('theme')).toBe('light');

    expect(published).toEqual([]);
  });

  test('isolates the same user state across two tenant-bound sessions', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const alpha = createMockWs('shared-user');
    const beta = createMockWs('shared-user');
    alpha.ws.data.authContext = tenantSyncContext('shared-user', 'ten_alpha', 'mem_alpha');
    beta.ws.data.authContext = tenantSyncContext('shared-user', 'ten_beta', 'mem_beta');
    const { server, published } = createMockServer();

    handleStateSet(
      alpha.ws,
      { type: 'state.set', ref: 'alpha', key: 'workspace', value: 'alpha-only' },
      mgr,
      server,
    );
    handleStateSet(
      beta.ws,
      { type: 'state.set', ref: 'beta', key: 'workspace', value: 'beta-only' },
      mgr,
      server,
    );
    handleStateSubscribe(alpha.ws, mgr, server);
    handleStateSubscribe(beta.ws, mgr, server);

    const alphaSnapshot = JSON.parse(alpha.sent.at(-1)!) as StateSnapshotMessage;
    const betaSnapshot = JSON.parse(beta.sent.at(-1)!) as StateSnapshotMessage;
    expect(alphaSnapshot.entries).toEqual({ workspace: 'alpha-only' });
    expect(betaSnapshot.entries).toEqual({ workspace: 'beta-only' });
    expect(published).toEqual([]);
  });

  test('rejects an identity-only application session in multi mode', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const socket = createMockWs('shared-user');
    socket.ws.data.authContext = {
      userId: 'shared-user',
      email: 'shared-user@example.test',
      role: 'user',
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    };
    const { server, published } = createMockServer();

    handleStateSet(
      socket.ws,
      { type: 'state.set', ref: 'application', key: 'workspace', value: 'unsafe' },
      mgr,
      server,
      'multi',
    );
    handleStateSubscribe(socket.ws, mgr, server, 'multi');

    expect(JSON.parse(socket.sent[0]) as StateAckMessage).toMatchObject({
      ref: 'application',
      ok: false,
      error: 'UNAUTHORIZED',
    });
    expect(socket.sent).toHaveLength(1);
    expect(published).toEqual([]);
    expect(mgr.getUserStateEntries('shared-user')).toEqual({});
  });

  test('clear then set rebuilds state', () => {
    db = createReactiveDB({ mode: 'memory' });
    mgr = new StateManager(db);

    const { ws, sent } = createMockWs('user-1');
    const { server } = createMockServer();

    // Set some state
    handleStateSet(ws, { type: 'state.set', ref: 'r1', key: 'a', value: 1 }, mgr, server);
    handleStateSet(ws, { type: 'state.set', ref: 'r2', key: 'b', value: 2 }, mgr, server);

    // Clear everything
    handleStateClear(ws, { type: 'state.clear', ref: 'r3' }, mgr, server);
    expect(mgr.getUserState('user-1').size).toBe(0);

    // Set new state
    handleStateSet(ws, { type: 'state.set', ref: 'r4', key: 'c', value: 3 }, mgr, server);
    expect(mgr.getUserStateEntries('user-1')).toEqual({ c: 3 });
  });
});

function tenantSyncContext(userId: string, tenantId: string, membershipId: string) {
  return {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    sessionScopeKind: 'tenant' as const,
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
}

// ─── WS-level integration (plugin wiring) ────────────────────────────────

describe('sync plugin — state sync wiring', () => {
  test('state messages without auth do not crash connection', async () => {
    app = createApp({ stateSync: true });
    const url = getUrl(app);
    const conn = await connectWS(url);

    // Send sync.subscribe first to establish baseline
    conn.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        lastSeq: 0,
      })
    );

    const snapshot = await conn.waitForMessage(
      (msg) => msg.type === 'sync.snapshot'
    );
    expect(snapshot.type).toBe('sync.snapshot');

    // Now send state.subscribe — silently ignored (no auth)
    conn.ws.send(JSON.stringify({ type: 'state.subscribe' }));

    // Verify no state.snapshot was received
    // (state.subscribe returns immediately with no response when unauthed)
    const stateSnapshots = conn.messages.filter(
      (m) => m.type === 'state.snapshot'
    );
    expect(stateSnapshots).toHaveLength(0);

    conn.close();
  });

  test('state set without auth returns UNAUTHORIZED ack', async () => {
    app = createApp({ stateSync: true });
    const url = getUrl(app);
    const conn = await connectWS(url);

    conn.ws.send(
      JSON.stringify({
        type: 'state.set',
        ref: 'ref-1',
        key: 'theme',
        value: 'dark',
      })
    );

    // state.set sends an error ack when unauthenticated
    const ack = await conn.waitForMessage(
      (msg) => msg.type === 'state.ack'
    );

    expect(ack.type).toBe('state.ack');
    if (ack.type === 'state.ack') {
      expect(ack.ref).toBe('ref-1');
      expect(ack.ok).toBe(false);
      expect(ack.error).toBe('UNAUTHORIZED');
    }

    conn.close();
  });

  test('sync and state coexist on same WS connection', async () => {
    app = createApp({ stateSync: true });
    const url = getUrl(app);
    const conn = await connectWS(url);

    // Subscribe to sync tables
    conn.ws.send(
      JSON.stringify({
        type: 'sync.subscribe',
        tables: ['todos'],
        lastSeq: 0,
      })
    );

    await conn.waitForMessage((msg) => msg.type === 'sync.snapshot');

    // Sync mutation still works
    conn.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'mut-1',
        table: 'todos',
        op: 'INSERT',
        row: { id: '1', title: 'Test', done: 0 },
      })
    );

    const ack = await conn.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'mut-1'
    );
    expect(ack.type).toBe('sync.ack');
    if (ack.type === 'sync.ack') {
      expect(ack.ok).toBe(true);
    }

    // State messages are handled (even if silently ignored due to no auth)
    conn.ws.send(JSON.stringify({ type: 'state.subscribe' }));

    // No crash, connection still alive
    conn.ws.send(
      JSON.stringify({
        type: 'sync.mutate',
        ref: 'mut-2',
        table: 'todos',
        op: 'INSERT',
        row: { id: '2', title: 'After State', done: 0 },
      })
    );

    const ack2 = await conn.waitForMessage(
      (msg) => msg.type === 'sync.ack' && msg.ref === 'mut-2'
    );
    if (ack2.type === 'sync.ack') {
      expect(ack2.ok).toBe(true);
    }

    conn.close();
  });
});
