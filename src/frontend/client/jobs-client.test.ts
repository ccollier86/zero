/** Transport boundaries only. Real managed/Fabric/Torrent behavior has separate native integration coverage. */
import { expect, test } from 'bun:test';
import { createJobsClient } from './jobs-client';
import type { FetchInit } from './sdk';
const accepted = { id: 'job_synthetic', definition: 'synthetic.job', definitionVersion: '1', ownerId: 'synthetic-owner', runAs: 'actor', control: 'active',
  revision: 1, generation: 1, createdAt: 1, updatedAt: 1 } as const;
test('jobs SDK preserves logical request identity, copies inputs and maps native control/read routes', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createJobsClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return structuredClone(path.includes('/receipts/') ? { receipt: accepted } : accepted) as T; });
  const input = { kind: 'original' };
  const result = client.enqueue('synthetic.job', input, { idempotencyKey: 'request-one' }); input.kind = 'changed';
  expect(await result).toEqual(accepted); expect(calls[0]).toMatchObject({ path: '/jobs/enqueue', init: { method: 'POST', body: { input: { kind: 'original' }, idempotencyKey: 'request-one' } } });
  expect(await client.receipts.get('request-one')).toEqual(accepted);
  await client.schedules.pause('job_synthetic', { idempotencyKey: 'pause-one', expectedRevision: 1 });
  expect(calls[2]).toMatchObject({ path: '/jobs/schedules/job_synthetic/pause', init: { body: { expectedRevision: 1, idempotencyKey: 'pause-one' } } });
});
test('scope replacement retires pending jobs acknowledgments even when transport ignores abort', async () => {
  let complete!: (value: unknown) => void;
  const pending = new Promise(resolve => { complete = resolve; });
  let signal: AbortSignal | null | undefined;
  const client = createJobsClient(async <T>(_path: string, init?: FetchInit) => { signal = init?.signal; return await pending as T; });
  const result = client.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' });
  client.clear(); expect(signal!.aborted).toBe(true); complete(accepted);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});
test('uncertain writes are not retried and private/invalid acknowledgments are never published', async () => {
  let calls = 0;
  const client = createJobsClient(async () => { calls++; throw new Error('Synthetic unknown outcome'); });
  await expect(client.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' })).rejects.toThrow('Synthetic unknown outcome'); expect(calls).toBe(1);
  const invalid = createJobsClient(async <T>() => ({ ...accepted, input: 'PRIVATE_INPUT' }) as T);
  await expect(invalid.enqueue('synthetic.job', {}, { idempotencyKey: 'request-one' })).rejects.toThrow('Invalid jobs');
  let network = 0;
  const quiet = createJobsClient(async <T>() => { network++; return accepted as T; });
  await expect(quiet.enqueue('synthetic.job', {}, { idempotencyKey: 'bad key' })).rejects.toThrow();
  await expect(quiet.schedules.list({ limit: 101 })).rejects.toThrow(); expect(network).toBe(0);
});

test('live SDK pages stop readers on account replacement and definitive denial does not reconnect', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0, delivered = 0;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } });
  const client = createJobsClient(async <T>() => accepted as T, async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  const stop = client.schedules.watch(() => { delivered++; });
  try {
    controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: { items: [accepted], total: 1 } }) + '\n\n'));
    const deadline = Date.now() + 1000;
    while (!delivered) { if (Date.now() > deadline) throw new Error('Synthetic jobs stream did not deliver.'); await Bun.sleep(1); }
    client.clear(); await Bun.sleep(5); expect(cancelled).toBe(1); expect(delivered).toBe(1);
  } finally { stop(); }
  let requests = 0, failed = 0;
  const denied = createJobsClient(async <T>() => accepted as T, async () => { requests++; return new Response(null, { status: 403 }); });
  const close = denied.schedules.watch(() => { throw new Error('Denied page must never publish.'); }, { onError() { failed++; } });
  try { await Bun.sleep(15); expect(requests).toBe(1); expect(failed).toBe(1); }
  finally { close(); denied.clear(); }
});
