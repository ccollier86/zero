import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { SyncStoreContext } from './sync-store';
import type { SyncClient } from './sync-client';
import { SYNC_ACK_ERROR_CODES } from '../types';
import { createNativeSyncAuth } from '../../native/sync-auth';
import { createNativeTestHarness } from '../../native/test-support';

// ─── WebSocket Mock ────────────────────────────────────────────────────────

/**
 * Mock WebSocket that captures sent messages and allows simulating
 * server responses. Installed globally before tests, restored after.
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];
  static autoOpen = true;
  static autoAuthReady = true;
  static autoBaseline = true;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  bufferedAmount = 0;
  sent: string[] = [];

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);

    if (MockWebSocket.autoOpen) {
      // Simulate async open
      queueMicrotask(() => {
        if (this.readyState === MockWebSocket.CONNECTING) {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }
      });
    }
  }

  send(data: string) {
    this.sent.push(data);

    try {
      const message = JSON.parse(data) as {
        type?: string;
        token?: string;
        lastSeq?: number;
        epoch?: string;
        scope?: string;
        snapshot?: string[];
      };
      if (message.type === 'sync.auth') {
        if (!MockWebSocket.autoAuthReady) return;
        this.simulateMessage(JSON.stringify({
          type: 'sync.auth.ready',
          authenticated: Boolean(message.token),
        }));
      } else if (message.type === 'sync.subscribe' && MockWebSocket.autoBaseline) {
        const epoch = message.epoch ?? 'test-epoch';
        const scope = message.scope ?? 'test-scope';
        this.simulateMessage(JSON.stringify(message.epoch ? {
          type: 'sync.catchup', changes: [], seq: message.lastSeq ?? 0,
          prevSeq: message.lastSeq ?? 0, epoch, scope,
        } : {
          type: 'sync.snapshot', tables: Object.fromEntries(
            (message.snapshot ?? []).map((table) => [table, {}]),
          ),
          seq: 0, epoch, scope, reset: 'preserve-pending',
        }));
      }
    } catch {}
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    // Don't fire onclose if it was nulled out (intentional disconnect)
    this.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason }));
  }

  // Test helper: simulate server sending a message
  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  // Test helper: simulate connection close from server
  simulateClose(code = 1006, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.autoOpen = true;
    MockWebSocket.autoAuthReady = true;
    MockWebSocket.autoBaseline = true;
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// ─── Setup ─────────────────────────────────────────────────────────────────

const OriginalWebSocket = globalThis.WebSocket;

function getCtx(client: SyncClient): SyncStoreContext {
  return client.store.getSnapshot().context as SyncStoreContext;
}

// We need to dynamically import createSyncClient after mocking WebSocket
let createSyncClient: typeof import('./sync-client').createSyncClient;

beforeEach(async () => {
  MockWebSocket.reset();
  (globalThis as any).WebSocket = MockWebSocket;
  // Fresh import each time to ensure clean state
  const mod = await import('./sync-client');
  createSyncClient = mod.createSyncClient;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

// ─── Helper ────────────────────────────────────────────────────────────────

function makeClient(overrides?: Partial<Parameters<typeof createSyncClient>[0]>) {
  return createSyncClient({
    url: 'ws://localhost:3000/sync',
    tables: {
      todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
    },
    ackTimeout: 60_000, // High timeout for tests (we test timeout separately)
    maxReconnectAttempts: 0, // Disable reconnect in most tests
    ...overrides,
  });
}

async function flushMicrotasks() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

async function waitForSocketCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (MockWebSocket.instances.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Expected ${count} WebSocket instances`);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createSyncClient', () => {
  test('connects immediately on creation', async () => {
    const client = makeClient();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');

    client.disconnect();
  });

  test('does not open a socket until connect when autoConnect is false', async () => {
    const client = makeClient({ autoConnect: false });
    expect(MockWebSocket.instances).toHaveLength(0);

    client.connect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(client.connected).toBe(true);

    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    client.disconnect();
  });

  test('sends the token in the first message without placing it in the URL', async () => {
    const client = makeClient({ token: 'my-token' });
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    expect(ws.url).toBe('ws://localhost:3000/sync');
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'sync.auth',
      token: 'my-token',
    });

    client.disconnect();
  });

  test('preserves non-auth query params without appending the bearer token', async () => {
    const client = makeClient({
      url: 'ws://localhost:3000/sync?room=test',
      token: 'my-token',
    });
    await flushMicrotasks();

    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync?room=test');

    client.disconnect();
  });

  test('sends sync.subscribe after the server accepts the auth handshake', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    expect(ws.sent).toHaveLength(2);

    const msg = JSON.parse(ws.sent[1]);
    expect(msg.type).toBe('sync.subscribe');
    expect(msg.tables).toEqual(['todos']);
    expect(msg.lastSeq).toBe(0);
    expect(msg.cursors).toEqual({ default: { lastSeq: 0 } });

    client.disconnect();
  });

  test('opts into state.subscribe on every accepted auth handshake', async () => {
    const client = makeClient({ stateSync: true, token: 'state-token' });
    await flushMicrotasks();

    expect(MockWebSocket.latest().sent.map((item) => JSON.parse(item).type)).toEqual([
      'sync.auth',
      'sync.subscribe',
      'state.subscribe',
    ]);

    client.reconnect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.latest().sent.map((item) => JSON.parse(item).type)).toEqual([
      'sync.auth',
      'sync.subscribe',
      'state.subscribe',
    ]);

    client.disconnect();
  });

  test('does not send state.subscribe for an anonymous auth resolution', async () => {
    const client = makeClient({ stateSync: true });
    await flushMicrotasks();

    expect(MockWebSocket.latest().sent.map((item) => JSON.parse(item).type)).toEqual([
      'sync.auth',
      'sync.subscribe',
    ]);

    client.disconnect();
  });

  test('does not subscribe, flush, or report connected before auth is ready', async () => {
    MockWebSocket.autoAuthReady = false;
    const client = makeClient({ token: 'my-token' });
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    expect(ws.sent.map((item) => JSON.parse(item).type)).toEqual(['sync.auth']);
    expect(client.connected).toBe(false);
    client.insert('todos', { id: 'waiting', title: 'Buffered', done: 0 });
    expect(ws.sent.map((item) => JSON.parse(item).type)).toEqual(['sync.auth']);

    ws.simulateMessage(JSON.stringify({
      type: 'sync.auth.ready',
      authenticated: true,
    }));

    expect(ws.sent.map((item) => JSON.parse(item).type))
      .toEqual(['sync.auth', 'sync.subscribe', 'sync.mutate']);
    expect(client.connected).toBe(true);

    client.disconnect();
  });

  test('sets connected state on open', async () => {
    const client = makeClient();
    await flushMicrotasks();

    expect(getCtx(client)._sync.connected).toBe(true);

    client.disconnect();
  });

  test('reads getToken when opening and reconnecting the socket', async () => {
    let token = 'token-1';
    const client = makeClient({
      token: 'stale-token',
      getToken: () => token,
    });
    await flushMicrotasks();

    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');
    expect(JSON.parse(MockWebSocket.latest().sent[0]).token).toBe('token-1');

    token = 'token-2';
    client.reconnect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');
    expect(JSON.parse(MockWebSocket.latest().sent[0]).token).toBe('token-2');

    client.disconnect();
  });

  test('awaits an async access-token provider before opening the socket', async () => {
    let resolveToken!: (token: string) => void;
    const client = makeClient({
      getToken: () => new Promise((resolve) => { resolveToken = resolve; }),
    });
    await flushMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(0);

    resolveToken('async-token');
    await flushMicrotasks();
    await flushMicrotasks();
    expect(JSON.parse(MockWebSocket.latest().sent[0]).token).toBe('async-token');
    client.disconnect();
  });

  test('refreshes and reconnects after a short-lived token closes with 4001', async () => {
    let token = 'short-lived';
    let refreshes = 0;
    const client = makeClient({
      getToken: async () => token,
      refreshAuth: async () => {
        refreshes += 1;
        token = 'refreshed-token';
        return token;
      },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    MockWebSocket.latest().simulateClose(4001, 'Invalid auth token');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshes).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(JSON.parse(MockWebSocket.latest().sent[0]).token).toBe('refreshed-token');
    client.disconnect();
  });

  for (const reason of [
    'Sync access changed',
    'Auth context changed',
    'Sync read authority changed',
  ]) {
    test(`purges authorization-scoped rows and mutations on ${reason}`, async () => {
      let token = 'access-before-policy-change';
      const client = makeClient({
        getToken: async () => token,
        refreshAuth: async () => {
          token = 'access-after-policy-change';
          return token;
        },
      });
      await flushMicrotasks();
      await flushMicrotasks();
      const firstSocket = MockWebSocket.latest();
      firstSocket.simulateMessage(JSON.stringify({
        type: 'sync.snapshot', seq: 8,
        tables: { todos: { private: {
          id: 'private', title: 'No longer allowed', done: 0,
        } } },
      }));
      client.update('todos', 'private', { title: 'Pending' });
      client.update('todos', 'private', { title: 'Queued' });

      firstSocket.simulateClose(4001, reason);
      await waitForSocketCount(2);
      await flushMicrotasks();

      expect(getCtx(client).todos).toEqual({});
      expect(getCtx(client)._sync.pending).toEqual([]);
      expect(getCtx(client)._sync.lastSeq).toBe(0);
      const recovered = MockWebSocket.latest();
      recovered.simulateMessage(JSON.stringify({
        type: 'sync.snapshot', seq: 9,
        tables: { todos: { private: {
          id: 'private', title: 'Allowed again', done: 0,
        } } },
      }));
      recovered.sent.length = 0;
      client.update('todos', 'private', { done: 1 });
      expect(recovered.sent).toHaveLength(1);
      client.disconnect();
    });
  }

  test('invalidates authorization data before refreshing and reconnecting a revoked manager', async () => {
    let token = 'manager-token';
    const order: string[] = [];
    const client = makeClient({
      getToken: async () => token,
      refreshAuth: async () => {
        order.push('refresh');
        token = 'owner-only-token';
        return token;
      },
      onAuthorizationDataInvalidated: () => order.push('invalidate'),
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const managerSocket = MockWebSocket.latest();
    managerSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', seq: 4,
      tables: { todos: { peer: {
        id: 'peer', title: 'Manager-visible peer row', done: 0,
      } } },
    }));

    managerSocket.simulateClose(4001, 'Sync read authority changed');

    expect(order[0]).toBe('invalidate');
    expect(getCtx(client).todos).toEqual({});
    expect(getCtx(client)._sync.lastSeq).toBe(0);
    await waitForSocketCount(2);
    await flushMicrotasks();
    expect(order).toEqual(['invalidate', 'refresh']);
    expect(JSON.parse(MockWebSocket.latest().sent[0]!).token).toBe('owner-only-token');
    expect(getCtx(client).todos).toEqual({});
    client.disconnect();
  });

  test('retains cache across an ordinary expired-token refresh', async () => {
    let token = 'expiring-token';
    const client = makeClient({
      getToken: async () => token,
      refreshAuth: async () => {
        token = 'replacement-token';
        return token;
      },
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.latest();
    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', seq: 4,
      tables: { todos: { retained: {
        id: 'retained', title: 'Still authorized', done: 0,
      } } },
    }));
    client.update('todos', 'retained', { done: 1 });

    firstSocket.simulateClose(4001, 'Invalid auth token');
    await waitForSocketCount(2);

    expect((getCtx(client).todos as Record<string, unknown>).retained).toEqual({
      id: 'retained', title: 'Still authorized', done: 1,
    });
    expect(getCtx(client)._sync.pending).toHaveLength(1);
    expect(getCtx(client)._sync.lastSeq).toBe(4);
    client.disconnect();
  });

  test('reports revoked auth when refresh fails without reconnecting', async () => {
    const errors: string[] = [];
    const client = makeClient({
      getToken: async () => 'revoked-token',
      refreshAuth: async () => { throw new Error('revoked'); },
      onAuthFailure: (error) => errors.push(error),
    });
    await flushMicrotasks();
    await flushMicrotasks();
    MockWebSocket.latest().simulateClose(4001, 'Invalid auth token');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(errors[0]).toContain('Auth refresh failed');
    client.disconnect();
  });

  test('reset closes the socket and clears local table state', async () => {
    const client = makeClient();
    await flushMicrotasks();

    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'Sensitive', done: 0 } },
        },
        seq: 5,
      })
    );

    expect((getCtx(client).todos as Record<string, unknown>)['1']).toBeDefined();

    client.reset();

    expect(client.connected).toBe(false);
    expect(getCtx(client)._sync.lastSeq).toBe(0);
    expect(getCtx(client)._sync.pending).toEqual([]);
    expect(getCtx(client).todos).toEqual({});

    client.disconnect();
  });

  test('freezes writes, purges old rows, and waits for a replacement-scope baseline', async () => {
    let token = 'tenant-a-token';
    const client = makeClient({ getToken: () => token });
    await flushMicrotasks();
    MockWebSocket.latest().simulateMessage(JSON.stringify({
      type: 'sync.snapshot',
      tables: {
        todos: { old: { id: 'old', title: 'Tenant A', done: 0 } },
      },
      seq: 4,
    }));
    client.update('todos', 'old', { done: 1 });

    client.beginAuthorizationScopeTransition();
    expect(getCtx(client).todos).toEqual({});
    expect(getCtx(client)._sync.pending).toEqual([]);
    expect(() => client.insert('todos', {
      id: 'blocked', title: 'Must not cross tenants', done: 0,
    })).toThrow('authorization scope transition');

    token = 'tenant-b-token';
    client.completeAuthorizationScopeTransition(true);
    await waitForSocketCount(2);
    await client.waitForAuthorizationBaseline();

    expect(JSON.parse(MockWebSocket.latest().sent[0]!).token).toBe('tenant-b-token');
    expect(getCtx(client).todos).toEqual({});
    expect(() => client.insert('todos', {
      id: 'allowed', title: 'Tenant B', done: 0,
    })).not.toThrow();
    client.disconnect();
  });

  test('native account switching and sign-out purge data before reconnect', async () => {
    const harness = await createNativeTestHarness();
    await harness.auth.signIn();
    const client = makeClient({ ...createNativeSyncAuth(harness.auth) });
    await waitForSocketCount(1);
    MockWebSocket.latest().simulateMessage(JSON.stringify({
      type: 'sync.snapshot', seq: 1,
      tables: { todos: { private: { id: 'private', title: 'User 1', done: 0 } } },
    }));
    expect((getCtx(client).todos as Record<string, unknown>).private).toBeDefined();

    harness.setSubject('user-2');
    await harness.auth.signIn();
    await waitForSocketCount(2);

    expect(getCtx(client).todos).toEqual({});
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(JSON.parse(MockWebSocket.latest().sent[0]).token).toBe('access-initial-2');

    await harness.auth.signOut();
    expect(client.connected).toBe(false);
    expect(getCtx(client).todos).toEqual({});
    client.disconnect();
  });

  test('ignores stale-socket data after an authorization reset', async () => {
    const client = makeClient();
    await flushMicrotasks();
    const staleSocket = MockWebSocket.latest();

    client.reset();
    client.connect();
    await waitForSocketCount(2);
    await flushMicrotasks();
    staleSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', seq: 99,
      tables: { todos: { leaked: {
        id: 'leaked', title: 'Previous authorization', done: 0,
      } } },
    }));

    expect(getCtx(client).todos).toEqual({});
    expect(getCtx(client)._sync.lastSeq).toBe(0);
    client.disconnect();
  });

  test('native bridge never opens an unauthenticated socket during cold start', async () => {
    const harness = await createNativeTestHarness();
    const client = makeClient({ ...createNativeSyncAuth(harness.auth) });
    expect(MockWebSocket.instances).toHaveLength(0);

    await flushMicrotasks();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.auth.state.status).toBe('anonymous');
    expect(MockWebSocket.instances).toHaveLength(0);
    client.disconnect();
  });

  test('routes auth close codes to onAuthFailure when provided', async () => {
    const errors: string[] = [];
    const client = makeClient({
      onAuthFailure: (error) => errors.push(error),
    });
    await flushMicrotasks();

    MockWebSocket.latest().simulateClose(4001, 'Invalid auth token');

    expect(errors).toEqual(['Auth failed (code 4001): Invalid auth token']);

    client.disconnect();
  });
});

describe('mutations', () => {
  test('insert sends optimistic event + WS message', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    ws.sent.length = 0; // Clear subscribe message

    client.insert('todos', { id: '1', title: 'Test', done: 0 });

    // Optimistic state applied immediately
    const todos = getCtx(client).todos as Record<string, any>;
    expect(todos['1']).toEqual({ id: '1', title: 'Test', done: 0 });

    // Pending mutation created
    expect(getCtx(client)._sync.pending).toHaveLength(1);
    expect(getCtx(client)._sync.pending[0].op).toBe('INSERT');

    // WS message sent
    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe('sync.mutate');
    expect(msg.op).toBe('INSERT');
    expect(msg.table).toBe('todos');
    expect(msg.plane).toBeUndefined();

    client.disconnect();
  });

  test('update sends optimistic event + WS message', async () => {
    const client = makeClient();
    await flushMicrotasks();

    // Need an existing row for update to work
    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'Original', done: 0 } },
        },
        seq: 1,
      })
    );

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.update('todos', '1', { done: 1 });

    const todos = getCtx(client).todos as Record<string, any>;
    expect(todos['1'].done).toBe(1);
    expect(todos['1'].title).toBe('Original'); // preserved

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.op).toBe('UPDATE');
    expect(msg.rowId).toBe('1');

    client.disconnect();
  });

  test('delete sends optimistic event + WS message', async () => {
    const client = makeClient();
    await flushMicrotasks();

    // Insert first
    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'To Delete', done: 0 } },
        },
        seq: 1,
      })
    );

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.delete('todos', '1');

    expect((getCtx(client).todos as Record<string, any>)['1']).toBeUndefined();

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.op).toBe('DELETE');

    client.disconnect();
  });

  test('throws on unknown table', async () => {
    const client = makeClient();
    await flushMicrotasks();

    expect(() =>
      client.insert('nonexistent', { id: '1', name: 'Test' })
    ).toThrow('Unknown table: nonexistent');

    client.disconnect();
  });

  test('generates a primary key when insert row omits one', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.insert('todos', { title: 'No ID', done: 0 });

    const todos = getCtx(client).todos as Record<string, any>;
    const generatedIds = Object.keys(todos);
    expect(generatedIds).toHaveLength(1);

    const generatedId = generatedIds[0];
    expect(generatedId.length).toBeGreaterThan(0);
    expect(todos[generatedId]).toEqual({
      id: generatedId,
      title: 'No ID',
      done: 0,
    });

    expect(ws.sent).toHaveLength(1);
    const msg = JSON.parse(ws.sent[0]);
    expect(msg.row).toEqual({
      id: generatedId,
      title: 'No ID',
      done: 0,
    });

    client.disconnect();
  });
});

describe('message routing', () => {
  test('rejects a sequence gap and closes the socket for safe recovery', async () => {
    let recoveryError = '';
    const client = makeClient({ onError: (message) => { recoveryError = message; } });
    await flushMicrotasks();
    const ws = MockWebSocket.latest();
    ws.simulateMessage(JSON.stringify({
      type: 'sync.change', seq: 1, prevSeq: 0,
      epoch: 'test-epoch', scope: 'test-scope', table: 'todos', op: 'INSERT',
      rowId: 'kept', row: { id: 'kept', title: 'Kept', done: 0 }, origin: '', ts: 1,
    }));
    ws.simulateMessage(JSON.stringify({
      type: 'sync.change', seq: 3, prevSeq: 2,
      epoch: 'test-epoch', scope: 'test-scope', table: 'todos', op: 'DELETE',
      rowId: 'kept', row: null, origin: '', ts: 2,
    }));

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect((getCtx(client).todos as Record<string, any>).kept).toBeDefined();
    expect(getCtx(client)._sync.lastSeq).toBe(1);
    expect(recoveryError).toContain('Max reconnect attempts');
    client.disconnect();
  });

  test('routes sync.snapshot from server', async () => {
    const client = makeClient();
    await flushMicrotasks();

    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'From Server', done: 0 } },
        },
        seq: 5,
      })
    );

    expect(getCtx(client)._sync.lastSeq).toBe(5);
    expect(
      (getCtx(client).todos as Record<string, any>)['1'].title
    ).toBe('From Server');

    client.disconnect();
  });

  test('routes sync.change from server', async () => {
    const client = makeClient();
    await flushMicrotasks();

    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.change',
        seq: 3,
        table: 'todos',
        op: 'INSERT',
        rowId: '1',
        row: { id: '1', title: 'Live', done: 0 },
        origin: 'conn_2',
        ts: Date.now(),
      })
    );

    expect((getCtx(client).todos as Record<string, any>)['1']).toBeDefined();
    expect(getCtx(client)._sync.lastSeq).toBe(3);

    client.disconnect();
  });

  test('routes sync.ack and clears pending', async () => {
    const client = makeClient();
    await flushMicrotasks();

    client.insert('todos', { id: '1', title: 'Test', done: 0 });
    const ref = getCtx(client)._sync.pending[0].ref;

    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.ack',
        ref,
        ok: true,
        seq: 1,
      })
    );

    expect(getCtx(client)._sync.pending).toHaveLength(0);

    client.disconnect();
  });

  test('reports stable mutation rejection details after rollback', async () => {
    const configured: unknown[] = [];
    const observed: unknown[] = [];
    const client = makeClient({
      onMutationRejected: (rejection) => configured.push(rejection),
    });
    const unsubscribe = client.onMutationRejected(
      (rejection) => observed.push(rejection),
    );
    client.onMessage(() => {
      throw new Error('consumer callback failure');
    });
    await flushMicrotasks();

    client.insert('todos', { id: 'rejected', title: 'Nope', done: 0 });
    const ref = getCtx(client)._sync.pending[0].ref;
    MockWebSocket.latest().simulateMessage(JSON.stringify({
      type: 'sync.ack',
      ref,
      ok: false,
      seq: null,
      error: 'Data realm is still being prepared',
      errorCode: SYNC_ACK_ERROR_CODES.dataRealmNotReady,
    }));

    const expected = {
      ref,
      table: 'todos',
      op: 'INSERT',
      rowId: 'rejected',
      plane: undefined,
      error: 'Data realm is still being prepared',
      errorCode: SYNC_ACK_ERROR_CODES.dataRealmNotReady,
      source: 'server',
    };
    expect(configured).toEqual([expected]);
    expect(observed).toEqual([expected]);
    expect(getCtx(client)._sync.pending).toEqual([]);
    expect((getCtx(client).todos as Record<string, unknown>).rejected)
      .toBeUndefined();

    unsubscribe();
    client.disconnect();
  });

  test('ignores malformed JSON', async () => {
    const client = makeClient();
    await flushMicrotasks();

    // Should not throw
    MockWebSocket.latest().simulateMessage('not json{{{');
    MockWebSocket.latest().simulateMessage('');

    client.disconnect();
  });

  test('ignores messages without type field', async () => {
    const client = makeClient();
    await flushMicrotasks();

    MockWebSocket.latest().simulateMessage(JSON.stringify({ foo: 'bar' }));

    client.disconnect();
  });
});

describe('same-row serialization', () => {
  test('queues second mutation for same row until first is acked', async () => {
    const client = makeClient();
    await flushMicrotasks();

    // Provide initial data
    MockWebSocket.latest().simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'Original', done: 0 } },
        },
        seq: 1,
      })
    );

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    // First mutation
    client.update('todos', '1', { title: 'First' });
    const ref1 = getCtx(client)._sync.pending[0].ref;

    // Second mutation to same row — should be queued, not sent
    client.update('todos', '1', { title: 'Second' });

    // Only one WS message sent (the first mutation)
    expect(ws.sent).toHaveLength(1);

    // Only one pending in store (queued mutation not applied yet)
    expect(getCtx(client)._sync.pending).toHaveLength(1);

    // Ack first mutation
    ws.simulateMessage(
      JSON.stringify({ type: 'sync.ack', ref: ref1, ok: true, seq: 2 })
    );

    // Second mutation now applied and sent
    expect(getCtx(client)._sync.pending).toHaveLength(1);
    expect(ws.sent).toHaveLength(2);
    expect((getCtx(client).todos as Record<string, any>)['1'].title).toBe(
      'Second'
    );

    client.disconnect();
  });

  test('different rows are not serialized', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.insert('todos', { id: '1', title: 'A', done: 0 });
    client.insert('todos', { id: '2', title: 'B', done: 0 });

    // Both sent immediately (different rows)
    expect(ws.sent).toHaveLength(2);
    expect(getCtx(client)._sync.pending).toHaveLength(2);

    client.disconnect();
  });
});

describe('send buffering', () => {
  test('waits for the authoritative baseline before flushing offline mutations', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient();
    await flushMicrotasks();
    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.insert('todos', { id: 'offline', title: 'Offline', done: 0 });
    expect(ws.sent).toEqual([]);
    expect(getCtx(client)._sync.pending).toHaveLength(1);

    ws.simulateMessage(JSON.stringify({
      type: 'sync.snapshot',
      tables: { todos: {} },
      seq: 4,
      epoch: 'server-epoch',
      scope: 'user-scope',
      reset: 'preserve-pending',
    }));

    expect(ws.sent.map((item) => JSON.parse(item).type)).toEqual(['sync.mutate']);
    expect((getCtx(client).todos as Record<string, any>).offline.title).toBe('Offline');
    expect(getCtx(client)._sync.pending).toHaveLength(1);
    client.disconnect();
  });

  test('replays an uncertain mutation with the same ref and a fenced attempt', async () => {
    const client = makeClient();
    await flushMicrotasks();
    const firstSocket = MockWebSocket.latest();
    firstSocket.sent.length = 0;

    client.insert('todos', { id: 'uncertain', title: 'Once', done: 0 });
    const first = firstSocket.sent.map((item) => JSON.parse(item)).find(
      (message) => message.type === 'sync.mutate',
    );
    expect(first.attempt).toBe(1);
    expect(first.epoch).toBe('test-epoch');

    client.reconnect();
    await flushMicrotasks();
    const replay = MockWebSocket.latest().sent.map((item) => JSON.parse(item)).find(
      (message) => message.type === 'sync.mutate',
    );
    expect(replay.ref).toBe(first.ref);
    expect(replay.epoch).toBe(first.epoch);
    expect(replay.attempt).toBe(2);
    expect(getCtx(client)._sync.pending[0].attempts).toBe(2);
    client.disconnect();
  });

  test('drops queued mutations when the server reports a changed auth scope', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient();
    await flushMicrotasks();
    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.insert('todos', { id: 'private', title: 'Private', done: 0 });
    ws.simulateMessage(JSON.stringify({
      type: 'sync.snapshot',
      tables: { todos: {} },
      seq: 0,
      epoch: 'server-epoch',
      scope: 'replacement-scope',
      reset: 'purge',
    }));

    expect(ws.sent).toEqual([]);
    expect(getCtx(client)._sync.pending).toEqual([]);
    expect(getCtx(client).todos).toEqual({});
    client.disconnect();
  });

  test('buffers mutations while disconnected and flushes on reconnect', async () => {
    MockWebSocket.autoOpen = false;

    const client = makeClient({ maxReconnectAttempts: 5 });
    const ws1 = MockWebSocket.latest();

    // Open the first connection
    ws1.readyState = MockWebSocket.OPEN;
    ws1.onopen?.(new Event('open'));

    expect(getCtx(client)._sync.connected).toBe(true);

    // Now simulate disconnect
    ws1.simulateClose(1006, 'Connection lost');

    expect(getCtx(client)._sync.connected).toBe(false);

    // Mutate while disconnected — should be buffered
    client.insert('todos', { id: '1', title: 'Buffered', done: 0 });

    // Optimistic state applied
    expect(
      (getCtx(client).todos as Record<string, any>)['1'].title
    ).toBe('Buffered');

    client.disconnect();
  });
});

describe('disconnect', () => {
  test('sets connected to false', async () => {
    const client = makeClient();
    await flushMicrotasks();

    expect(getCtx(client)._sync.connected).toBe(true);

    client.disconnect();

    expect(getCtx(client)._sync.connected).toBe(false);
  });

  test('close is called on the WebSocket', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    client.disconnect();

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  test('mutations are no-ops after disconnect', async () => {
    const client = makeClient();
    await flushMicrotasks();

    client.disconnect();

    // Should not throw, but also should not do anything
    client.insert('todos', { id: '1', title: 'After Disconnect', done: 0 });

    expect(getCtx(client)._sync.pending).toHaveLength(0);
  });

  test('idempotent — calling disconnect twice is safe', async () => {
    const client = makeClient();
    await flushMicrotasks();

    client.disconnect();
    client.disconnect(); // No error

    expect(getCtx(client)._sync.connected).toBe(false);
  });
});

describe('connected getter', () => {
  test('reflects store state', async () => {
    const client = makeClient();
    await flushMicrotasks();

    expect(client.connected).toBe(true);

    client.disconnect();

    expect(client.connected).toBe(false);
  });
});

describe('snapshot clears row queues', () => {
  test('snapshot clears all in-flight tracking', async () => {
    const client = makeClient();
    await flushMicrotasks();

    // Insert a row, creating in-flight tracking
    client.insert('todos', { id: '1', title: 'A', done: 0 });

    // Queue a second mutation for same row
    client.update('todos', '1', { title: 'B' });

    const ws = MockWebSocket.latest();

    // Snapshot arrives — authoritative, clears everything
    ws.simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: { '1': { id: '1', title: 'Server Truth', done: 0 } },
        },
        seq: 10,
      })
    );

    // Pending cleared by snapshot
    expect(getCtx(client)._sync.pending).toHaveLength(0);

    // New mutations should work without being queued
    ws.sent.length = 0;
    client.update('todos', '1', { done: 1 });
    expect(ws.sent).toHaveLength(1); // Sent immediately, not queued

    client.disconnect();
  });

  test('snapshot omitting a lazy table preserves its pending row queue', async () => {
    const client = makeClient({
      tables: {
        todos: { _pk: 'id', id: 'string', title: 'string', done: 'number' },
        notes: { _pk: 'id', _sync: 'lazy', id: 'string', title: 'string' },
      },
    });
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    ws.sent.length = 0;

    client.insert('notes', { id: 'n1', title: 'Optimistic lazy note' });
    const firstRef = getCtx(client)._sync.pending[0].ref;

    ws.simulateMessage(
      JSON.stringify({
        type: 'sync.snapshot',
        tables: {
          todos: {},
        },
        seq: 10,
      })
    );

    expect(getCtx(client)._sync.pending).toHaveLength(1);
    expect((getCtx(client).notes as Record<string, any>)['n1'].title).toBe(
      'Optimistic lazy note'
    );

    client.update('notes', 'n1', { title: 'Queued lazy note update' });
    expect(ws.sent).toHaveLength(1);
    expect(getCtx(client)._sync.pending).toHaveLength(1);

    ws.simulateMessage(
      JSON.stringify({
        type: 'sync.ack',
        ref: firstRef,
        ok: true,
        seq: 11,
      })
    );

    expect(ws.sent).toHaveLength(2);
    expect(getCtx(client)._sync.pending).toHaveLength(1);
    expect((getCtx(client).notes as Record<string, any>)['n1'].title).toBe(
      'Queued lazy note update'
    );

    client.disconnect();
  });
});

describe('onReconnect callback', () => {
  test('does NOT fire on initial connect', async () => {
    let reconnectCalled = false;
    const client = makeClient({
      onReconnect: () => {
        reconnectCalled = true;
      },
    });
    await flushMicrotasks();

    expect(reconnectCalled).toBe(false);

    client.disconnect();
  });
});

describe('onError callback', () => {
  test('fires when max reconnect attempts exceeded', async () => {
    MockWebSocket.autoOpen = false;
    let errorMsg: string | null = null;

    const client = makeClient({
      maxReconnectAttempts: 0,
      onError: (err) => {
        errorMsg = err;
      },
    });

    const ws = MockWebSocket.latest();
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event('open'));

    // Simulate server close
    ws.simulateClose(1006, 'Server shutdown');

    expect(errorMsg!).toContain('Max reconnect attempts');

    client.disconnect();
  });

  test('fires on auth failure close codes', async () => {
    MockWebSocket.autoOpen = false;
    let errorMsg: string | null = null;

    const client = makeClient({
      maxReconnectAttempts: 5,
      onError: (err) => {
        errorMsg = err;
      },
    });

    const ws = MockWebSocket.latest();
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.(new Event('open'));

    // Auth failure close code
    ws.simulateClose(4001, 'Invalid token');

    expect(errorMsg!).toContain('Auth failed');
    expect(errorMsg!).toContain('4001');

    client.disconnect();
  });

  test('reports a terminal data contract failure without reconnecting', async () => {
    let errorMsg: string | null = null;
    const client = makeClient({
      maxReconnectAttempts: 5,
      onError: (err) => { errorMsg = err; },
    });
    await flushMicrotasks();
    const count = MockWebSocket.instances.length;

    MockWebSocket.latest().simulateClose(
      4004,
      'Tenant Sync snapshot cannot fit the transport contract',
    );
    await flushMicrotasks();

    expect(errorMsg!).toContain('Sync stopped (code 4004)');
    expect(MockWebSocket.instances).toHaveLength(count);
    client.disconnect();
  });

  test('reports permanent tenant database capacity once without reconnecting', async () => {
    const errors: string[] = [];
    const client = makeClient({
      maxReconnectAttempts: 5,
      onError: (error) => { errors.push(error); },
    });
    await flushMicrotasks();
    const count = MockWebSocket.instances.length;

    MockWebSocket.latest().simulateClose(
      4004,
      'Tenant Sync database capacity is exhausted',
    );
    await flushMicrotasks();

    expect(errors).toEqual([
      'Sync stopped (code 4004): Tenant Sync database capacity is exhausted',
    ]);
    expect(MockWebSocket.instances).toHaveLength(count);
    client.disconnect();
  });
});

describe('multiplexed default and tenant data planes', () => {
  const tables = {
    platform_users: { _pk: 'id', id: 'string', name: 'string' },
    projects: { _pk: 'id', id: 'string', title: 'string' },
  } as const;
  const tableSyncPlanes = {
    platform_users: 'default',
    projects: 'tenant',
  } as const;

  test('waits for both baselines, routes mutations, and reconnects with independent cursors', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({ tables, tableSyncPlanes });
    await flushMicrotasks();
    const firstSocket = MockWebSocket.latest();
    const subscribe = JSON.parse(firstSocket.sent[1]);

    expect(subscribe.tables).toEqual(['platform_users', 'projects']);
    expect(subscribe.snapshot).toEqual(['platform_users', 'projects']);
    expect(subscribe.lastSeq).toBe(0);
    expect(subscribe.cursors).toEqual({
      default: { lastSeq: 0 },
      tenant: { lastSeq: 0 },
    });

    client.insert('projects', { id: 'p1', title: 'Buffered tenant write' });
    expect(firstSocket.sent.map((item) => JSON.parse(item).type))
      .toEqual(['sync.auth', 'sync.subscribe']);

    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'default',
      tables: { platform_users: {} }, seq: 40,
      epoch: 'platform-epoch', scope: 'shared-scope',
      reset: 'preserve-pending',
    }));
    expect(firstSocket.sent.map((item) => JSON.parse(item).type))
      .toEqual(['sync.auth', 'sync.subscribe']);

    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant', tables: { projects: {} }, seq: 4,
      epoch: 'tenant-epoch', scope: 'shared-scope',
      reset: 'preserve-pending',
    }));
    const tenantMutation = JSON.parse(firstSocket.sent[2]);
    expect(tenantMutation).toMatchObject({
      type: 'sync.mutate', table: 'projects', plane: 'tenant',
      epoch: 'tenant-epoch', attempt: 1,
    });

    client.insert('platform_users', { id: 'u1', name: 'Owner' });
    const defaultMutation = JSON.parse(firstSocket.sent[3]);
    expect(defaultMutation).toMatchObject({
      type: 'sync.mutate', table: 'platform_users', plane: 'default',
      epoch: 'platform-epoch', attempt: 1,
    });

    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.change', plane: 'default', seq: 41, prevSeq: 40,
      epoch: 'platform-epoch', scope: 'shared-scope', table: 'platform_users',
      op: 'INSERT', rowId: 'u2', row: { id: 'u2', name: 'Admin' },
      origin: 'other', ts: 1,
    }));
    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.change', plane: 'tenant', seq: 5, prevSeq: 4,
      epoch: 'tenant-epoch', scope: 'shared-scope', table: 'projects',
      op: 'INSERT', rowId: 'p2', row: { id: 'p2', title: 'Live tenant row' },
      origin: 'other', ts: 2,
    }));

    const firstMeta = getCtx(client)._sync;
    expect(firstMeta.cursors.default.lastSeq).toBe(41);
    expect(firstMeta.cursors.tenant.lastSeq).toBe(5);
    expect(firstMeta.lastSeq).toBe(41);

    client.reconnect();
    await flushMicrotasks();
    const reconnectSubscribe = JSON.parse(MockWebSocket.latest().sent[1]);
    expect(reconnectSubscribe).toMatchObject({
      lastSeq: 41,
      epoch: 'platform-epoch',
      scope: 'shared-scope',
      cursors: {
        default: {
          lastSeq: 41, epoch: 'platform-epoch', scope: 'shared-scope',
        },
        tenant: {
          lastSeq: 5, epoch: 'tenant-epoch', scope: 'shared-scope',
        },
      },
    });
    client.disconnect();
  });

  test('applies a chunked tenant baseline only after its matching end frame', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({ tables, tableSyncPlanes });
    await flushMicrotasks();
    const socket = MockWebSocket.latest();
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'default',
      tables: { platform_users: {} }, seq: 1,
      epoch: 'default-epoch', scope: 'scope', reset: 'preserve-pending',
    }));
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot.begin', snapshotId: 'tenant-baseline', plane: 'tenant',
      tables: ['projects'], seq: 12, epoch: 'tenant-epoch', scope: 'scope',
      reset: 'preserve-pending',
    }));
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot.chunk', snapshotId: 'tenant-baseline', plane: 'tenant',
      table: 'projects', rows: { p1: { id: 'p1', title: 'Staged' } },
    }));
    expect((getCtx(client).projects as Record<string, unknown>).p1).toBeUndefined();

    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot.end', snapshotId: 'tenant-baseline', plane: 'tenant',
    }));

    expect((getCtx(client).projects as Record<string, any>).p1.title).toBe('Staged');
    expect(getCtx(client)._sync.cursors.tenant).toMatchObject({
      lastSeq: 12, epoch: 'tenant-epoch', scope: 'scope',
    });
    client.disconnect();
  });

  test('does not wait for an empty default plane', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({
      tables: { projects: tables.projects },
      tableSyncPlanes: { projects: 'tenant' },
    });
    await flushMicrotasks();
    const socket = MockWebSocket.latest();
    client.insert('projects', { id: 'p1', title: 'Tenant only' });

    const subscribe = JSON.parse(socket.sent[1]);
    expect(subscribe.cursors).toEqual({ tenant: { lastSeq: 0 } });
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant', tables: { projects: {} }, seq: 2,
      epoch: 'tenant-epoch', scope: 'tenant-scope',
      reset: 'preserve-pending',
    }));

    expect(JSON.parse(socket.sent[2])).toMatchObject({
      type: 'sync.mutate', plane: 'tenant', epoch: 'tenant-epoch',
    });
    client.disconnect();
  });

  test('tenant purge clears only tenant queues and cache', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({ tables, tableSyncPlanes });
    await flushMicrotasks();
    const socket = MockWebSocket.latest();
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'default',
      tables: { platform_users: {} }, seq: 1,
      epoch: 'platform-epoch', scope: 'scope', reset: 'preserve-pending',
    }));
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant', tables: { projects: {} }, seq: 1,
      epoch: 'tenant-epoch', scope: 'scope', reset: 'preserve-pending',
    }));

    client.insert('platform_users', { id: 'u1', name: 'Pending owner' });
    client.insert('projects', { id: 'p1', title: 'Pending project' });
    const pending = getCtx(client)._sync.pending;
    const defaultRef = pending.find(({ table }) => table === 'platform_users')!.ref;

    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant', tables: {}, seq: 0,
      epoch: 'tenant-replacement', scope: 'replacement-scope', reset: 'purge',
    }));

    expect(getCtx(client)._sync.pending.map(({ ref }) => ref)).toEqual([defaultRef]);
    expect(getCtx(client).projects).toEqual({});
    expect(getCtx(client).platform_users).toEqual({
      u1: { id: 'u1', name: 'Pending owner' },
    });

    const sentBeforeReplacement = socket.sent.length;
    client.insert('projects', { id: 'p2', title: 'Replacement scope' });
    expect(socket.sent).toHaveLength(sentBeforeReplacement + 1);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'sync.mutate', table: 'projects', plane: 'tenant',
      epoch: 'tenant-replacement',
    });
    client.disconnect();
  });

  test('stale canonical receipt ack settles pending without regressing the row', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({
      tables: { projects: tables.projects },
      tableSyncPlanes: { projects: 'tenant' },
    });
    await flushMicrotasks();
    const socket = MockWebSocket.latest();
    socket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant',
      tables: { projects: { p1: { id: 'p1', title: 'Before' } } }, seq: 5,
      epoch: 'tenant-epoch', scope: 'scope', reset: 'preserve-pending',
    }));
    client.update('projects', 'p1', { title: 'Requested' });
    const ref = getCtx(client)._sync.pending[0].ref;
    socket.simulateMessage(JSON.stringify({
      type: 'sync.change', plane: 'tenant', seq: 6, prevSeq: 5,
      epoch: 'tenant-epoch', scope: 'scope', table: 'projects', op: 'UPDATE',
      rowId: 'p1', row: { id: 'p1', title: 'Newer canonical' },
      origin: 'other', ts: 1,
    }));
    socket.simulateMessage(JSON.stringify({
      type: 'sync.ack', plane: 'tenant', ref, ok: true, seq: 6,
      change: {
        table: 'projects', op: 'UPDATE', rowId: 'p1',
        row: { id: 'p1', title: 'Stale receipt' },
      },
    }));

    expect((getCtx(client).projects as Record<string, any>).p1.title)
      .toBe('Newer canonical');
    expect(getCtx(client)._sync.pending).toEqual([]);
    client.disconnect();
  });

  test('replays an unknown-outcome actor mutation after a 1012 close with the same receipt identity', async () => {
    MockWebSocket.autoBaseline = false;
    const client = makeClient({ tables, tableSyncPlanes, maxReconnectAttempts: 1 });
    await flushMicrotasks();
    const firstSocket = MockWebSocket.latest();
    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'default',
      tables: { platform_users: {} }, seq: 8,
      epoch: 'platform-epoch', scope: 'scope', reset: 'preserve-pending',
    }));
    firstSocket.simulateMessage(JSON.stringify({
      type: 'sync.snapshot', plane: 'tenant', tables: { projects: {} }, seq: 3,
      epoch: 'tenant-epoch', scope: 'scope', reset: 'preserve-pending',
    }));
    client.insert('projects', { id: 'p1', title: 'Unknown outcome' });
    const firstAttempt = JSON.parse(firstSocket.sent.at(-1)!);

    firstSocket.simulateClose(1012, 'Tenant database mutation outcome unknown');
    expect(getCtx(client)._sync.pending.map(({ ref }) => ref))
      .toEqual([firstAttempt.ref]);

    // Exercise the same reconnect path immediately; reconnect() cancels the
    // scheduler installed by the 1012 close so the test remains deterministic.
    client.reconnect();
    await flushMicrotasks();
    const secondSocket = MockWebSocket.latest();
    secondSocket.simulateMessage(JSON.stringify({
      type: 'sync.catchup', plane: 'default', changes: [], seq: 8, prevSeq: 8,
      epoch: 'platform-epoch', scope: 'scope',
    }));
    expect(secondSocket.sent.map((item) => JSON.parse(item).type))
      .toEqual(['sync.auth', 'sync.subscribe']);
    secondSocket.simulateMessage(JSON.stringify({
      type: 'sync.catchup', plane: 'tenant', changes: [], seq: 3, prevSeq: 3,
      epoch: 'tenant-epoch', scope: 'scope',
    }));

    const replay = JSON.parse(secondSocket.sent.at(-1)!);
    expect(replay.attempt).toBe(2);
    expect({ ...replay, attempt: undefined }).toEqual({
      ...firstAttempt,
      attempt: undefined,
    });

    secondSocket.simulateMessage(JSON.stringify({
      type: 'sync.ack', plane: 'tenant', ref: replay.ref, ok: true, seq: 4,
      change: {
        table: 'projects', op: 'INSERT', rowId: 'p1',
        row: { id: 'p1', title: 'Unknown outcome' },
      },
    }));
    expect(getCtx(client)._sync.pending).toEqual([]);
    client.disconnect();
  });

  test('rejects incomplete or extra table-plane catalogs at construction', () => {
    expect(() => makeClient({
      tables,
      tableSyncPlanes: { platform_users: 'default' },
    } as any)).toThrow('missing table');
    expect(() => makeClient({
      tables,
      tableSyncPlanes: {
        platform_users: 'default', projects: 'tenant', unknown: 'tenant',
      },
    } as any)).toThrow('unknown table');
  });
});
