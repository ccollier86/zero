/** Transport qualification is separate from signature/CAS custody validation. */
import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { createHttpLoggingCustodyStore } from './logging-http-custody';
import { LoggingError, type LoggingErrorCode } from './logging-error';
import { deliveryError, deliveryFailure } from './logging-delivery-protocol';

const credentials = { identity: 'separate-custodian', endpoint: 'https://custody.example.test/api/', apiKey: 'test-private-credential' };
const transport = spyOn(globalThis, 'fetch');
afterEach(() => transport.mockReset());
afterAll(() => transport.mockRestore());

test('HTTPS custody uses explicit bearer POSTs without cookies, redirects or implicit environment', async () => {
  transport.mockResolvedValue(new Response(JSON.stringify({ checkpoint: null }), { headers: { 'Content-Type': 'application/json' } }));
  const store = createHttpLoggingCustodyStore(credentials), signal = new AbortController().signal;
  await expect(store.read('ledger-a', 'audit', signal)).resolves.toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init] = transport.mock.calls[0]!;
  expect(url).toBe('https://custody.example.test/api/checkpoint/read');
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-private-credential');
  expect(JSON.parse(String(init?.body))).toEqual({ ledgerId: 'ledger-a', stream: 'audit' });
});

test('custody rejects insecure/credential-bearing URLs, header injection and pre-canceled work', async () => {
  for (const endpoint of ['http://custody.example.test', 'https://user:pass@custody.example.test', 'https://custody.example.test?secret=x', 'https://custody.example.test#fragment']) {
    expect(() => createHttpLoggingCustodyStore({ ...credentials, endpoint })).toThrow();
  }
  expect(() => createHttpLoggingCustodyStore({ ...credentials, apiKey: 'bad\r\nheader' })).toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(createHttpLoggingCustodyStore(credentials).read('ledger-a', 'audit', controller.signal))
    .rejects.toMatchObject({ code: 'LOGGING_AUDIT_UNAVAILABLE', outcome: 'unknown' });
  expect(transport).not.toHaveBeenCalled();
});

test('custody bounds and validates response bytes without reflecting provider bodies', async () => {
  const invalid = [
    new Response('private-error-detail', { status: 503 }),
    new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
    new Response('{"checkpoint":null,"extra":"private-error-detail"}', { headers: { 'Content-Type': 'application/json' } }),
    new Response(new Uint8Array([123, 34, 99, 104, 101, 99, 107, 112, 111, 105, 110, 116, 34, 58, 34, 255, 34, 125]), { headers: { 'Content-Type': 'application/json' } }),
    new Response('x'.repeat(8193), { headers: { 'Content-Type': 'application/json' } }),
  ];
  for (const response of invalid) {
    transport.mockResolvedValueOnce(response);
    const failure = await createHttpLoggingCustodyStore(credentials).read('ledger-a', 'audit', new AbortController().signal).catch(error => error);
    expect(failure).toBeInstanceOf(LoggingError);
    expect(String(failure)).not.toContain('private-error-detail');
    expect(String(failure)).not.toContain(credentials.apiKey);
  }
});

test('delivery errors preserve the complete safe logging-domain vocabulary and unknown outcomes', () => {
  const codes: readonly LoggingErrorCode[] = [
    'LOGGING_CONFIG_INVALID', 'LOGGING_NOT_READY', 'LOGGING_FORBIDDEN', 'LOGGING_AUDIT_UNAVAILABLE',
    'LOGGING_ADMISSION_REQUIRED', 'LOGGING_EVENT_INVALID', 'LOGGING_EVENT_CONFLICT', 'LOGGING_QUERY_INVALID',
    'LOGGING_BACKPRESSURE', 'LOGGING_CLOSED', 'LOGGING_WRITE_FAILED', 'LOGGING_OUTCOME_UNKNOWN',
    'LOGGING_RESPONSE_INVALID', 'LOGGING_INTEGRITY_FAILED',
  ];
  for (const code of codes) {
    const decoded = deliveryError(deliveryFailure(new LoggingError(code, 'private-provider-detail', 'unknown')));
    expect(decoded).toMatchObject({ code, outcome: 'unknown' });
    expect(decoded.message).not.toContain('private-provider-detail');
  }
});
