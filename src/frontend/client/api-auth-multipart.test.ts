/**
 * Regression coverage for authenticated Eden multipart requests.
 *
 * These tests intentionally exercise createApi() and the real AuthClient
 * together. Testing either layer alone would miss duplicate, case-variant
 * Authorization values introduced where the two transports compose.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { AuthClient } from './auth-client';
import { createApi } from './api';

const originalFetch = globalThis.fetch;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const REFRESH_TOKEN_KEY = '__platform_refresh_token';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

describe('authenticated Eden multipart transport', () => {
  it('sends one current bearer value and preserves the FormData body', async () => {
    const uploads: CapturedUpload[] = [];

    mockFetch((url, init) => {
      if (url.endsWith('/auth/login')) return loginResponse('access-1', 'refresh-1');
      if (url.endsWith('/auth/refresh')) return refreshResponse('access-2', 'refresh-2');

      if (url.endsWith('/api/staff/document-tools/pdf-text')) {
        const upload = captureUpload(init);
        uploads.push(upload);
        return upload.authorization === 'Bearer access-1'
          ? Response.json({ text: 'parsed' })
          : unauthorizedResponse();
      }

      return Response.json({ ok: true });
    });

    const auth = new AuthClient('http://zero.test');
    await auth.login('ada', 'password');
    const api = createApi('http://zero.test', auth);
    const file = pdfFile();

    const result = await api.api.staff['document-tools']['pdf-text'].post({ file });

    expect(result.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.authorization).toBe('Bearer access-1');
    expect(uploads[0]!.contentType).toBeNull();
    expect(uploads[0]!.body).toBeInstanceOf(FormData);
    await expectPdfFile(uploads[0]!.body.get('file'));
  });

  it('replaces an expired bearer value with only the refreshed value on retry', async () => {
    const uploads: CapturedUpload[] = [];

    mockFetch((url, init) => {
      if (url.endsWith('/auth/login')) return loginResponse('access-1', 'refresh-1');
      if (url.endsWith('/auth/refresh')) return refreshResponse('access-2', 'refresh-2');

      if (url.endsWith('/api/staff/document-tools/pdf-text')) {
        const upload = captureUpload(init);
        uploads.push(upload);

        if (uploads.length === 1) return unauthorizedResponse();
        return upload.authorization === 'Bearer access-2'
          ? Response.json({ text: 'parsed' })
          : unauthorizedResponse();
      }

      return Response.json({ ok: true });
    });

    const auth = new AuthClient('http://zero.test');
    await auth.login('ada', 'password');
    const api = createApi('http://zero.test', auth);
    const file = pdfFile();

    const result = await api.api.staff['document-tools']['pdf-text'].post({ file });

    expect(result.status).toBe(200);
    expect(uploads.map((upload) => upload.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-2',
    ]);
    expect(uploads[0]!.body).toBe(uploads[1]!.body);
    await expectPdfFile(uploads[1]!.body.get('file'));
  });

  it('waits for an in-flight stored-session refresh before the first upload', async () => {
    const storage = new MemoryStorage();
    storage.setItem(REFRESH_TOKEN_KEY, 'refresh-stored');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });

    const pendingRefresh = deferred<Response>();
    const uploads: CapturedUpload[] = [];

    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return pendingRefresh.promise;
      if (url.endsWith('/auth/me')) return Response.json(authUser());

      if (url.endsWith('/api/staff/document-tools/pdf-text')) {
        const upload = captureUpload(init);
        uploads.push(upload);
        return upload.authorization === 'Bearer access-restored'
          ? Response.json({ text: 'parsed' })
          : unauthorizedResponse();
      }

      return Response.json({ ok: true });
    });

    const auth = new AuthClient('http://zero.test');
    const api = createApi('http://zero.test', auth);
    const request = api.api.staff['document-tools']['pdf-text'].post({ file: pdfFile() });

    await flushMicrotasks();
    expect(uploads).toHaveLength(0);

    pendingRefresh.resolve(refreshResponse('access-restored', 'refresh-rotated'));
    const result = await request;

    expect(result.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.authorization).toBe('Bearer access-restored');
    expect(storage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-rotated');
    await expectPdfFile(uploads[0]!.body.get('file'));
  });
});

interface CapturedUpload {
  authorization: string | null;
  contentType: string | null;
  body: FormData;
}

function captureUpload(init?: RequestInit): CapturedUpload {
  if (!(init?.body instanceof FormData)) {
    throw new Error('Expected Eden to retain the multipart FormData body');
  }

  const headers = new Headers(init.headers);
  return {
    authorization: headers.get('Authorization'),
    contentType: headers.get('Content-Type'),
    body: init.body,
  };
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function pdfFile(): File {
  return new File(['%PDF-1.7'], 'HIV.pdf', { type: 'application/pdf' });
}

async function expectPdfFile(value: FormDataEntryValue | null): Promise<void> {
  expect(value).toBeInstanceOf(File);
  const file = value as File;
  expect(file.name).toBe('HIV.pdf');
  expect(file.type).toBe('application/pdf');
  expect(await file.text()).toBe('%PDF-1.7');
}

function unauthorizedResponse(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function refreshResponse(accessToken: string, refreshToken: string): Response {
  return Response.json({ accessToken, refreshToken });
}

function loginResponse(accessToken: string, refreshToken: string): Response {
  return Response.json({
    user: authUser(),
    accessToken,
    refreshToken,
  });
}

function authUser() {
  return {
    userId: 'u_1',
    username: 'ada',
    email: 'ada@example.com',
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
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
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
