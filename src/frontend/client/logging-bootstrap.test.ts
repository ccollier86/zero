import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { bootstrapLoggingDelivery } from './logging-bootstrap';

const transport = spyOn(globalThis, 'fetch');
afterEach(() => transport.mockReset());
afterAll(() => transport.mockRestore());
const signal = () => new AbortController().signal;
const receipt = () => ({ accepted: 0, admission: { policyVersion: 'policy-a', expiresAt: Date.now() + 60000 } });
const respond = (body: unknown, status = 200) => transport.mockResolvedValueOnce(Response.json(body, { status }));

test('bootstrap can send only the fixed empty same-origin cookie recovery ceremony', async () => {
  const result = receipt(); respond(result);
  await expect(bootstrapLoggingDelivery('policy-a', signal())).resolves.toEqual(result.admission);
  const [url, init] = transport.mock.calls[0]!;
  expect(url).toBe('/api/_zero/logging/observations');
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  expect(new Headers(init?.headers).get('X-Zero-Logging-Recovery')).toBe('1');
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  expect(JSON.parse(String(init?.body))).toEqual({ observations: [], policyVersion: 'policy-a' });
});

test('bootstrap never accepts a stale, malformed, overlong or interrupted acknowledgment', async () => {
  for (const result of [null, {}, { ...receipt(), accepted: 1 },
    { accepted: 0, admission: { policyVersion: 'different-policy', expiresAt: Date.now() + 60000 } },
    { accepted: 0, admission: { policyVersion: 'policy-a', expiresAt: Date.now() - 1 } },
    { accepted: 0, admission: { policyVersion: 'policy-a', expiresAt: Date.now() + 121000 } },
    { accepted: 0, admission: { policyVersion: 'policy-a', expiresAt: 'tomorrow' } }]) {
    respond(result);
    await expect(bootstrapLoggingDelivery('policy-a', signal())).rejects.toThrow();
  }
  respond(receipt(), 503);
  await expect(bootstrapLoggingDelivery('policy-a', signal())).rejects.toThrow();
  const controller = new AbortController(); controller.abort(); respond(receipt());
  await expect(bootstrapLoggingDelivery('policy-a', controller.signal)).rejects.toThrow();
});
