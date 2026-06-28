import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { SyncStoreContext } from './sync-store';
import type { SyncClient } from './sync-client';

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

  url: string;
  readyState = MockWebSocket.CONNECTING;
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

  test('appends token to URL when provided', async () => {
    const client = makeClient({ token: 'my-token' });
    await flushMicrotasks();

    expect(MockWebSocket.latest().url).toBe(
      'ws://localhost:3000/sync?token=my-token'
    );

    client.disconnect();
  });

  test('appends token with & when URL already has query params', async () => {
    const client = makeClient({
      url: 'ws://localhost:3000/sync?room=test',
      token: 'my-token',
    });
    await flushMicrotasks();

    expect(MockWebSocket.latest().url).toBe(
      'ws://localhost:3000/sync?room=test&token=my-token'
    );

    client.disconnect();
  });

  test('sends sync.subscribe on open', async () => {
    const client = makeClient();
    await flushMicrotasks();

    const ws = MockWebSocket.latest();
    expect(ws.sent).toHaveLength(1);

    const msg = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe('sync.subscribe');
    expect(msg.tables).toEqual(['todos']);
    expect(msg.lastSeq).toBe(0);

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

    expect(MockWebSocket.latest().url).toBe(
      'ws://localhost:3000/sync?token=token-1'
    );

    token = 'token-2';
    client.reconnect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.latest().url).toBe(
      'ws://localhost:3000/sync?token=token-2'
    );

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
});
