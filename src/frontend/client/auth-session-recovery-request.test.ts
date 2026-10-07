import { afterEach, describe, expect, test } from 'bun:test';
import { AuthSessionRecoveryRequest, AUTH_SESSION_RECOVERY_REQUEST_TIMEOUT_MS } from './auth-session-recovery-request';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('bounded session recovery requests', () => {
  test('defaults to 15 seconds without changing ordinary auth request contracts', () => {
    expect(AUTH_SESSION_RECOVERY_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  test('times out an ignored fetch abort and retires its late body', async () => {
    const request = new AuthSessionRecoveryRequest(5);
    let signal: AbortSignal | undefined;
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((next) => { resolve = next; });
    globalThis.fetch = ((_, init) => { signal = init?.signal ?? undefined; return pending; }) as typeof fetch;
    await expect(request.request('http://recovery.test/auth/refresh')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(signal?.aborted).toBe(true);
    let read = false;
    const response = Response.json({ accessToken: 'late' });
    response.json = async () => { read = true; return {}; };
    resolve(response);
    await new Promise((next) => setTimeout(next, 0));
    expect(read).toBe(false);
  });

  test('keeps the deadline active while the JSON body is pending', async () => {
    const request = new AuthSessionRecoveryRequest(5);
    let reading = false;
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_, init) => {
      signal = init?.signal ?? undefined;
      const response = Response.json({});
      response.json = () => { reading = true; return new Promise(() => {}); };
      return Promise.resolve(response);
    }) as typeof fetch;
    await expect(request.request('http://recovery.test/auth/me')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(reading).toBe(true);
    expect(signal?.aborted).toBe(true);
  });

  test('cancellation settles a transport ignoring its signal without waiting for the timeout', async () => {
    const request = new AuthSessionRecoveryRequest();
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as typeof fetch;
    const pending = request.request('http://recovery.test/auth/me');
    await Promise.resolve();
    request.cancel();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
  });

  test('an already-cancelled request never sends credentials', async () => {
    const request = new AuthSessionRecoveryRequest();
    request.cancel();
    let sent = false;
    globalThis.fetch = (() => { sent = true; return Promise.resolve(Response.json({})); }) as unknown as typeof fetch;
    await expect(request.request('http://recovery.test/auth/refresh')).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toBe(false);
  });
});
