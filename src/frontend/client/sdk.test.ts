/**
 * sdk.test.ts
 *
 * Verifies frontend SDK configuration contracts that do not need a browser
 * renderer. The SDK owns auth transport mode and state-sync prerequisites.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AUTH_DISABLED_MESSAGE } from './auth-client';
import { createClient, getClient } from './sdk';

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
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code: code ?? 1000, reason }));
  }

  static reset(): void {
    MockWebSocket.instances = [];
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
  test('defaults auth to disabled and gives clear auth-action errors', async () => {
    const client = createClient({
      url: 'http://localhost:3000',
      tables,
      autoConnect: false,
    });

    expect(client.user).toBeNull();
    expect(client.isAuthenticated).toBe(false);
    expect(client.token).toBeNull();
    await expect(client.login('alice', 'password')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
    await expect(client.forgotPassword('alice@example.com')).rejects.toThrow(AUTH_DISABLED_MESSAGE);
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
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync?token=access-1');

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
    expect(MockWebSocket.latest().url).toBe('ws://localhost:3000/sync?token=access-1');
  });
});

function mockAuthFetch(): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
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
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
