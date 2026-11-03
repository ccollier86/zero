/** Action-proof inspection is read-only, caller-cancellable and independent of credential issuance. */
import { afterEach, expect, mock, test } from 'bun:test';
import { AuthActionTransport } from './auth-action-transport';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function transport() {
  return new AuthActionTransport({ baseUrl: 'http://proof.example.test',
    beginAuthentication() { throw new Error('Inspection must not begin credential issuance.'); },
    failAuthentication() { throw new Error('Inspection must not settle credential issuance.'); },
    async completeAuthentication(result) { return result; },
  });
}
test('inspection forwards caller cancellation and never sends a password or creates a session', async () => {
  const controller = new AbortController();
  const proof = { valid: true, type: 'password_reset' as const, expiresAt: Date.now() + 1000, user: { userId: 'fixture', username: 'fixture', email: 'fixture@example.test' } };
  const fetcher = mock(async (_input: RequestInfo | URL, options?: RequestInit) => {
    expect(options?.signal).toBe(controller.signal); expect(options?.body).toBeUndefined();
    expect(options?.cache).toBe('no-store'); expect(options?.referrerPolicy).toBe('no-referrer');
    expect(options?.method).toBeUndefined(); return Response.json(proof);
  });
  globalThis.fetch = fetcher as unknown as typeof fetch;
  expect(await transport().inspectActionToken('synthetic-proof', controller.signal)).toEqual(proof);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('an already cancelled inspection makes no network request', async () => {
  const controller = new AbortController(); controller.abort();
  const fetcher = mock(() => Promise.resolve(Response.json({})));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  await expect(transport().inspectActionToken('synthetic-proof', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
test('cancellation of an active read rejects inspection rather than becoming a successful or consumed proof', async () => {
  const controller = new AbortController();
  globalThis.fetch = ((_input: RequestInfo | URL, options?: RequestInit) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
  })) as typeof fetch;
  const pending = transport().inspectActionToken('synthetic-proof', controller.signal);
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
