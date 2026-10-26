/** Delayed scope replacement must never retag old observations with current credentials. */
import { expect, test } from 'bun:test';
import { createLoggingClient } from './logging-client';
import { readLoggingExportJob } from '../../logging/logging-export-result';
import { loggingEvent } from '../../logging/test-support/logging-fixture';

test('retired collector bindings fail before transport and in-flight results cannot cross an auth generation', async () => {
  const calls: unknown[] = []; let resolve!: (value: unknown) => void;
  const client = createLoggingClient(async (_path, init) => { calls.push(init); return await new Promise(r => { resolve = r; }) as any; });
  const writer = client.bindObservations();
  const pending = writer.observe([]); client.clear(); resolve({ accepted: 0 });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await expect(writer.observe([])).rejects.toMatchObject({ name: 'AbortError' }); expect(calls).toHaveLength(1);
});
test('request bodies detach before yielding and invalid policy cannot create aggressive timers', async () => {
  const calls: any[] = [];
  const client = createLoggingClient(async (path, init) => { calls.push(init); return path.endsWith('/policy') ? { enabled: true, capture: {}, heartbeatMs: 0, idleMs: 0 } as any : { accepted: 1 } as any; });
  const observation = { id: 'a', collectorId: 'c', action: 'print.requested' as const, occurredAt: 1 };
  const p = client.observe([observation]); observation.id = 'mutated'; await p;
  expect(calls[0].body.observations[0].id).toBe('a');
  await expect(client.collectionPolicy()).rejects.toThrow('Invalid logging collection policy');
});

test('committed SSE projections stream through the existing SDK transport, validate packets and cancel ownership', async () => {
  let sender!: ReadableStreamDefaultController<Uint8Array>, ready!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; }), seen: number[] = [], states: string[] = [];
  const client = createLoggingClient(async (path, init) => {
    expect(path).toBe('/api/_zero/logging/stream'); expect(init?.json).toBe(false);
    return new Response(new ReadableStream({ start(c) { sender = c; init?.signal?.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true }); ready(); } }), { headers: { 'Content-Type': 'text/event-stream' } }) as any;
  });
  let delivered!: () => void; const received = new Promise<void>(resolve => { delivered = resolve; });
  const stop = client.watch('audit', {}, p => { seen.push(p.highWaterOrdinal); delivered(); }, { onStatus: state => states.push(state) });
  await opened;
  sender.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, page: { events: [], highWaterOrdinal: 2, hasMore: false, nextBeforeOrdinal: null } }) + '\n\n'));
  await received; expect(seen).toEqual([2]); expect(states).toContain('live');
  stop(); client.clear();
});

test('live append delivery resumes the exact committed cursor and never reclassifies snapshot rows as INSERTs', async () => {
  const cursors: number[] = [], seen: number[] = [];
  let complete!: () => void; const completed = new Promise<void>(resolve => { complete = resolve; });
  const client = createLoggingClient(async (_path, init) => {
    const after = (init!.body as { afterOrdinal: number }).afterOrdinal; cursors.push(after);
    const values = after === 5 ? [6, 7] : [8];
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const send = (packet: unknown) => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, ...packet as object }) + '\n\n'));
      send({ afterOrdinal: after, page: { events: [{ ordinal: 4, ingestedAt: 1, event: loggingEvent('old') }], highWaterOrdinal: values.at(-1)!, hasMore: false, nextBeforeOrdinal: null } });
      send({ changes: { afterOrdinal: after, throughOrdinal: values.at(-1)!, highWaterOrdinal: values.at(-1)!, hasMore: false,
        events: values.map(ordinal => ({ ordinal, ingestedAt: 1, event: loggingEvent('new-' + ordinal) })) } });
      controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } }) as any;
  });
  const stop = client.watch('audit', {}, () => {}, { afterOrdinal: 5, onChanges(page) {
    seen.push(...page.events.map(row => row.ordinal)); if (page.throughOrdinal === 8) complete();
  } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([completed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Live cursor reconnect timed out')), 3000); })]);
    expect(cursors).toEqual([5, 7]); expect(seen).toEqual([6, 7, 8]);
  }
  finally { clearTimeout(timer); stop(); client.clear(); }
});

test('strict observation acknowledgment cannot be missing, stale or for a different policy', async () => {
  const responses = [{ accepted: 0 }, { accepted: 0, admission: { policyVersion: 'other', expiresAt: Date.now() + 60000 } },
    { accepted: 0, admission: { policyVersion: 'current', expiresAt: Date.now() - 1 } }];
  for (const response of responses) {
    const client = createLoggingClient(async () => response as any);
    await expect(client.observe([], { policyVersion: 'current' })).rejects.toThrow();
  }
});

test('export receipts reject malformed state, timing and checksums without invoking accessors', () => {
  const valid = { id: 'export-test', stream: 'audit', state: 'ready', createdAt: 1000, expiresAt: 3000, completedAt: 2000,
    highWaterOrdinal: 20, count: 2, complete: true, nextBeforeOrdinal: null, sha256: 'a'.repeat(64) } as const;
  expect(readLoggingExportJob(valid)).toEqual(valid);
  for (const patch of [{ sha256: null }, { count: 1001 }, { expiresAt: 1000 }, { completedAt: null }, { nextBeforeOrdinal: 30 }, { extra: true }]) {
    expect(() => readLoggingExportJob({ ...valid, ...patch })).toThrow();
  }
  let ran = false;
  expect(() => readLoggingExportJob({ ...valid, get sha256() { ran = true; return 'a'.repeat(64); } })).toThrow(); expect(ran).toBe(false);
});

test('private downloads verify exact bytes, reject corruption and retire old-scope streams before reading', async () => {
  const data = new TextEncoder().encode('{"synthetic":true}\n'), hash = new Bun.CryptoHasher('sha256').update(data).digest('hex');
  const response = (expected = hash) => new Response(data, { headers: { 'Content-Type': 'application/x-ndjson', 'X-Zero-Logging-Sha256': expected } });
  const client = createLoggingClient(async () => response() as any);
  expect(await (await client.downloadExport('export-test')).text()).toBe('{"synthetic":true}\n');
  const corrupt = createLoggingClient(async () => response('0'.repeat(64)) as any);
  await expect(corrupt.downloadExport('export-test')).rejects.toThrow('integrity');
  let release!: (value: any) => void, cancelled = false;
  const scoped = createLoggingClient(async () => new Promise(resolve => { release = resolve; }));
  const pending = scoped.downloadExport('export-test'); scoped.clear();
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/x-ndjson', 'X-Zero-Logging-Sha256': hash } }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancelled).toBe(true);
});
