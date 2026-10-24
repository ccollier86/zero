import { expect, test } from 'bun:test';
import { createPaymentsClient, type PaymentsClientTransport } from './client';

test('browser facade preserves operation IDs and uses only the declared current-subject paths', async () => {
  const calls: { path: string; init: unknown }[] = [];
  const transport: PaymentsClientTransport = { request: async <T>(path: string, init: unknown) => { calls.push({ path, init }); return { id: 'fixture' } as T; } };
  const client = createPaymentsClient(transport);
  const command = { operationId: 'stable-operation', offer: 'pro' };
  await client.checkout.create(command); await client.checkout.create(command);
  expect(calls).toEqual([{ path: '/api/_zero/payments/checkout', init: { method: 'POST', body: command } }, { path: '/api/_zero/payments/checkout', init: { method: 'POST', body: command } }]);
  await client.invoices.list({ limit: 5, after: 'in_fixture' }); expect(calls.at(-1)!.path).toBe('/api/_zero/payments/invoices?limit=5&after=in_fixture');
  expect(() => createPaymentsClient(transport, { basePath: 'https://hostile.test' })).toThrow('Invalid payments API path');
});
test('an in-flight result is discarded after a scope/authority transition', async () => {
  let key = 'alpha', release: ((value: unknown) => void) | undefined;
  const client = createPaymentsClient({ boundary: () => ({ key, ready: true }), request: <T>() => new Promise<T>(resolve => { release = resolve as (value: unknown) => void; }) });
  const pending = client.snapshot(); key = 'beta'; release!({ subject: 'alpha' });
  await expect(pending).rejects.toMatchObject({ code: 'PAYMENTS_AUTHORITY_CHANGED' });
});
test('revision streaming handles split UTF-8 chunks and stops with its caller', async () => {
  const abort = new AbortController(), encoder = new TextEncoder(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('event: revision\nda')); controller.enqueue(encoder.encode('ta: {"revision":4}\n\n')); }, cancel() { cancelled = true; } });
  const client = createPaymentsClient({ request: async <T>() => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) as T });
  const iterator = client.watch({ signal: abort.signal })[Symbol.asyncIterator](); expect((await iterator.next()).value).toEqual({ revision: 4 }); abort.abort(); await iterator.return?.(); expect(cancelled).toBe(true);
});
test('stream rejects invalid revisions and refuses late data across an auth boundary', async () => {
  const encoder = new TextEncoder();
  const client = createPaymentsClient({ request: async <T>() => new Response(encoder.encode('event: revision\ndata: {"revision":-1}\n\n'), { headers: { 'Content-Type': 'text/event-stream' } }) as T });
  await expect(client.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'PAYMENTS_STREAM_INVALID' });
});
