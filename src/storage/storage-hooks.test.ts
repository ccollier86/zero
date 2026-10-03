/**
 * storage-hooks.test.ts
 *
 * Guards the frontend storage hooks transport boundary. The hooks own UI state,
 * but SDK auth remains the single source for tokens and refresh behavior.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  AuthClient,
  type AuthAuthorizationScopeLifecycle,
} from '../frontend/client/auth-client';
import { getBrowserAuthStorageKeys } from '../frontend/client/auth-browser-coordination';
import type { Client } from '../frontend/client/sdk';
import { sendUploadRequest } from './storage-hooks';

const source = await Bun.file(new URL('./storage-hooks.ts', import.meta.url)).text();
const originalFetch = globalThis.fetch;
const originalXhr = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXhr;
  FakeXMLHttpRequest.instances = [];
});

describe('storage hooks transport contract', () => {
  test('delegates JSON requests to the SDK client instead of browser token storage', () => {
    expect(source).toContain('useClient');
    expect(source).toContain('client).fetch<T>(apiUrl(path), init)');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('access_token');
    expect(source).not.toContain('getItem');
    expect(source).toContain("query.set('search', requestedSearch.trim())");
  });

  test('runs progress uploads through the SDK auth and scope lifecycle', () => {
    expect(source).toContain('XMLHttpRequest');
    expect(source).toContain('requestWithAuthTransport');
    expect(source).toContain('assertAuthorizationScopeCurrent');
    expect(source).toContain('useAuthorizationScopeBoundary');
    expect(source).not.toContain('client.token');
    expect(source).not.toContain('client.refresh()');
  });
});

describe('storage progress upload behavior', () => {
  test('waits for stored-session restoration before sending XHR', async () => {
    const storage = new MemoryStorage();
    const keys = getBrowserAuthStorageKeys('http://zero.test');
    storage.setItem(keys.credential, JSON.stringify({
      version: 1,
      revision: 1,
      refreshToken: 'refresh-stored',
      scopeId: 'scope-stored',
      updatedAt: Date.now(),
    }));
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url.endsWith('/auth/refresh')) return refresh;
      if (url.endsWith('/auth/me')) return Promise.resolve(Response.json(authUser()));
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch;
    installFakeXhr();
    const auth = new AuthClient('http://zero.test', {
      browserAuthCoordination: {
        storage,
        locks: null,
        createChannel: null,
        addStorageListener: () => () => {},
      },
    });

    const request = upload(auth);
    await flushMicrotasks();
    expect(FakeXMLHttpRequest.instances).toHaveLength(0);

    resolveRefresh(Response.json({
      accessToken: 'access-restored',
      refreshToken: 'refresh-rotated',
    }));
    await waitForXhrCount(1);
    expect(FakeXMLHttpRequest.instances[0]!.headers.get('authorization'))
      .toBe('Bearer access-restored');
    FakeXMLHttpRequest.instances[0]!.respond(200, fileResponse());
    await expect(request).resolves.toMatchObject({ id: 'file-1' });
    auth.dispose();
  });

  test('refreshes once and retries XHR with only the replacement bearer', async () => {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url.endsWith('/auth/login')) {
        return Promise.resolve(Response.json({
          user: authUser(),
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
        }));
      }
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(Response.json({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
        }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch;
    installFakeXhr();
    const auth = new AuthClient('http://zero.test');
    await auth.login('ada', 'password');

    const request = upload(auth);
    await waitForXhrCount(1);
    FakeXMLHttpRequest.instances[0]!.respond(401, { error: 'Expired' });
    await waitForXhrCount(2);
    expect(FakeXMLHttpRequest.instances.map((xhr) => (
      xhr.headers.get('authorization')
    ))).toEqual(['Bearer access-1', 'Bearer access-2']);
    FakeXMLHttpRequest.instances[1]!.respond(200, fileResponse());

    await expect(request).resolves.toMatchObject({ id: 'file-1' });
    auth.dispose();
  });

  test('aborts XHR and suppresses completion when its scope is invalidated', async () => {
    const lifecycle = createScopeLifecycle();
    globalThis.fetch = (() => Promise.resolve(Response.json({ ok: true }))) as unknown as typeof fetch;
    installFakeXhr();
    const auth = new AuthClient('http://zero.test', {
      authorizationScopeLifecycle: lifecycle.api,
    });

    const request = upload(auth);
    await waitForXhrCount(1);
    const observed = request.then(
      () => null,
      (error) => error,
    );
    lifecycle.invalidate();

    expect(FakeXMLHttpRequest.instances[0]!.aborted).toBe(true);
    const error = await observed;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Discarded a response from a previous authorization scope',
    );
    auth.dispose();
  });
});

function upload(auth: AuthClient) {
  const client = { url: 'http://zero.test', auth } as unknown as Client;
  return sendUploadRequest(
    client,
    'drive-1',
    new FormData(),
    {},
    { current: null },
  );
}

function installFakeXhr(): void {
  globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  readonly headers = new Map<string, string>();
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseText = '';
  status = 0;
  aborted = false;

  open(): void {}

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(): void {
    FakeXMLHttpRequest.instances.push(this);
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number, body: unknown): void {
    if (this.aborted) return;
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
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

function createScopeLifecycle(): {
  api: AuthAuthorizationScopeLifecycle;
  invalidate(): void;
} {
  let epoch = 0;
  let transitioning = false;
  const cancellations = new Set<() => void>();
  const assertCurrent = (requestEpoch: number) => {
    if (transitioning || requestEpoch !== epoch) {
      throw new Error('[client] Discarded a response from a previous authorization scope.');
    }
  };
  return {
    invalidate() {
      transitioning = true;
      epoch += 1;
      for (const cancel of [...cancellations]) cancel();
      cancellations.clear();
    },
    api: {
      beginTransition() {},
      completeTransition() {},
      abortTransition() {},
      beginRequest: () => epoch,
      assertRequestCurrent: assertCurrent,
      registerRequestCancellation(requestEpoch, cancel) {
        assertCurrent(requestEpoch);
        cancellations.add(cancel);
        return () => cancellations.delete(cancel);
      },
    },
  };
}

async function waitForXhrCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (FakeXMLHttpRequest.instances.length >= count) return;
    await flushMicrotasks();
  }
  throw new Error(`Expected ${count} XHR request(s)`);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function authUser() {
  return {
    userId: 'user-1',
    username: 'ada',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'user',
    status: 'active',
    passwordChangeRequired: false,
    emailVerifiedAt: 1,
    emailVerificationRequired: false,
    mfaRequired: false,
    properties: {},
    createdAt: 1,
    updatedAt: null,
  };
}

function fileResponse() {
  return { id: 'file-1', driveId: 'drive-1', path: 'file.pdf' };
}
