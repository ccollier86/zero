/** Delayed scope replacement must never retag old observations with current credentials. */
import { expect, test } from 'bun:test';
import { createLoggingClient } from './logging-client';

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
