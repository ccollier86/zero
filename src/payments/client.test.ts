import { expect, test } from 'bun:test';
import { createPaymentsClient, type PaymentsClientTransport } from './client';

test('browser facade preserves operation IDs and uses only the declared current-subject paths', async () => {
  const calls: { path: string; init: unknown }[] = [];
  const transport: PaymentsClientTransport = { request: async <T>(path: string, init: unknown) => { calls.push({ path, init }); return { id: 'fixture' } as T; } };
  const client = createPaymentsClient(transport);
  const command = { operationId: 'stable-operation', offer: 'pro' };
  await client.checkout.create(command); await client.checkout.create(command);
  expect(calls).toEqual([{ path: '/api/_zero/payments/checkout', init: { method: 'POST', body: command, signal: expect.any(AbortSignal) } }, { path: '/api/_zero/payments/checkout', init: { method: 'POST', body: command, signal: expect.any(AbortSignal) } }]);
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

test('revision streams preserve versions and parse CRLF boundaries split between chunks', async () => {
  const encoder = new TextEncoder(), version = 'a'.repeat(64);
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of ['event: revision\r', '\ndata: {"revision":8,\r', '\ndata: "version":"' + version + '"}\r', '\n\r', '\n']) controller.enqueue(encoder.encode(chunk));
    controller.close();
  } });
  const client = createPaymentsClient({ request: async <T>() => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) as T });
  const events = []; for await (const event of client.watch()) events.push(event);
  expect(events).toEqual([{ revision: 8, version }]);
});

test('malformed events produce a stable client error and release the stream', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('event: revision\ndata: invalid json\n\n')); }, cancel() { cancelled = true; } });
  const client = createPaymentsClient({ request: async <T>() => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) as T });
  await expect(client.watch()[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'PAYMENTS_STREAM_INVALID' });
  expect(cancelled).toBe(true);
});

test('authority changes abort in-flight transport and dispose its boundary subscription', async () => {
  let key = 'first', changed: (() => void) | undefined, released = false, signal: AbortSignal | undefined;
  const client = createPaymentsClient({
    boundary: () => ({ key, ready: true }),
    subscribeBoundary(callback) { changed = callback; return () => { released = true; }; },
    request: <T>(_path: string, init?: { signal?: AbortSignal }) => new Promise<T>((_resolve, reject) => { signal = init?.signal; signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }),
  });
  const pending = client.snapshot(); key = 'second'; changed!();
  await expect(pending).rejects.toMatchObject({ code: 'PAYMENTS_AUTHORITY_CHANGED' });
  expect(signal?.aborted).toBe(true); expect(released).toBe(true);
});
