import { afterEach, describe, expect, test } from 'bun:test';

import { AuthClient } from './auth-client';
import { AuthSessionController } from './auth-session';

const originalFetch = globalThis.fetch;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
);
const LEGACY_REFRESH_TOKEN_KEY = '__platform_refresh_token';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(
      globalThis,
      'localStorage',
      originalLocalStorageDescriptor,
    );
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

describe('optional-auth restoration barrier', () => {
  test('AuthClient waits for the active stored-session restore before optional fetch', async () => {
    const harness = installRestoreHarness();
    const client = new AuthClient('http://zero.test');

    try {
      const request = client.fetchWithOptionalAuth('/api/optional');
      await flushMicrotasks();
      expect(harness.optionalHeaders).toHaveLength(0);

      harness.refresh.resolve(refreshResponse());
      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(harness.optionalHeaders).toHaveLength(1);
      expect(harness.optionalHeaders[0]!.get('authorization'))
        .toBe('Bearer restored-access');
    } finally {
      client.dispose();
    }
  });

  test('the lower session transport preserves the same optional-auth guarantee', async () => {
    const harness = installRestoreHarness();
    const session = new AuthSessionController('http://zero.test');

    try {
      const request = session.fetchWithOptionalAuth('/api/optional');
      await flushMicrotasks();
      expect(harness.optionalHeaders).toHaveLength(0);

      harness.refresh.resolve(refreshResponse());
      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(harness.optionalHeaders).toHaveLength(1);
      expect(harness.optionalHeaders[0]!.get('authorization'))
        .toBe('Bearer restored-access');
    } finally {
      session.dispose();
    }
  });
});

function installRestoreHarness(): {
  refresh: Deferred<Response>;
  optionalHeaders: Headers[];
} {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_REFRESH_TOKEN_KEY, 'stored-refresh');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  const refresh = deferred<Response>();
  const optionalHeaders: Headers[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/auth/refresh')) return refresh.promise;
    if (url.endsWith('/auth/me')) return Response.json(authUser());
    if (url.endsWith('/api/optional')) {
      optionalHeaders.push(new Headers(init?.headers));
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Unexpected request' }, { status: 500 });
  }) as typeof fetch;

  return { refresh, optionalHeaders };
}

function refreshResponse(): Response {
  return Response.json({
    accessToken: 'restored-access',
    refreshToken: 'rotated-refresh',
  });
}

function authUser() {
  return {
    userId: 'u_restore',
    username: 'restore-user',
    email: 'restore@example.com',
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
  } as const;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
