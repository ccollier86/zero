/** In-memory transport fixtures only. No server, database, browser, dependency install or generated output. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import { CalendarMutationError } from './calendar-mutation';
import type { FetchInit } from './sdk';
const appointment = { resourceIds: ['resource-a'], title: 'Private synthetic appointment', startAt: '2026-11-16T15:00:00.000Z', endAt: '2026-11-16T16:00:00.000Z', timeZone: 'America/New_York' };
const range = { resourceIds: appointment.resourceIds, startAt: appointment.startAt, endAt: appointment.endAt };
const view = { ...appointment, id: 'appointment-a', revision: 1, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'user-a' };
const receipt = { requestId: 'original-key', operation: 'appointment.created', id: 'appointment-a', revision: 1, changed: true };
test('calendar commands use native fetch paths and detach authored inputs/options before awaiting', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return receipt as T; });
  const input = structuredClone(appointment), options = { idempotencyKey: 'original-key' };
  const accepted = client.appointments.create(input, options); input.resourceIds.push('mutated'); input.title = 'mutated'; options.idempotencyKey = 'replacement-key';
  expect(await accepted).toEqual(receipt);
  expect(calls).toHaveLength(1); expect(calls[0]!.path).toBe('/api/calendar/appointments');
  expect(calls[0]!.init!.body).toEqual({ appointment, options: { idempotencyKey: 'original-key' } }); client.clear();
});
test('all core endpoints match the mounted HTTP envelopes, preserve revisions, and exclude browser signals from JSON', async () => {
  const calls: { path: string; init?: FetchInit }[] = [], signal = new AbortController().signal;
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (init?.method === 'POST' && !path.endsWith('/query')) {
      const operation = path.endsWith('/grants') ? 'resource.grant-changed' : path.endsWith('/reschedule') ? 'appointment.rescheduled'
        : path.endsWith('/cancel') ? 'appointment.cancelled' : path.endsWith('/resources') ? 'resource.created' : 'appointment.created';
      return { ...receipt, operation, id: operation.startsWith('resource.') ? 'resource-a' : receipt.id } as T;
    }
    if (path.includes('/resources')) return { items: [], truncated: false, nextAfter: null } as T;
    if (path.includes('/receipts/')) return { receipt } as T;
    return (path.endsWith('/query') ? { items: [], truncated: false } : view) as T;
  });
  const options = { idempotencyKey: 'original-key', signal }, control = { ...options, expectedRevision: 1 };
  await client.resources.list({ after: 'cursor-a', limit: 5 }, { signal });
  await client.resources.create({ label: 'Real resource label', kind: 'room', timeZone: 'UTC' }, options);
  await client.resources.setGrants('resource-a', 'user-a', ['busy', 'book'], control);
  await client.appointments.query(range, { signal }); await client.busy.query(range, { signal });
  await client.appointments.get(view.id, { signal });
  const moved = { startAt: appointment.startAt, endAt: appointment.endAt, timeZone: appointment.timeZone, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 };
  await client.appointments.reschedule(view.id, moved, control); await client.appointments.cancel(view.id, control); await client.receipts.get('original-key', { signal });
  expect(calls.map(call => call.path)).toEqual(['/api/calendar/resources?limit=5&after=cursor-a', '/api/calendar/resources', '/api/calendar/resources/resource-a/grants',
    '/api/calendar/appointments/query', '/api/calendar/busy/query', '/api/calendar/appointments/appointment-a', '/api/calendar/appointments/appointment-a/reschedule', '/api/calendar/appointments/appointment-a/cancel', '/api/calendar/receipts/original-key']);
  expect(calls[1]!.init!.body).toEqual({ resource: { label: 'Real resource label', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'original-key' } });
  expect(calls[2]!.init!.body).toEqual({ userId: 'user-a', grants: ['busy', 'book'], options: { idempotencyKey: 'original-key', expectedRevision: 1 } });
  expect(calls[3]!.init!.body).toEqual({ query: range }); expect(calls[4]!.init!.body).toEqual({ query: range });
  expect(calls[6]!.init!.body).toEqual({ appointment: moved, options: { idempotencyKey: 'original-key', expectedRevision: 1 } });
  expect(calls[7]!.init!.body).toEqual({ options: { idempotencyKey: 'original-key', expectedRevision: 1 } });
  for (const call of calls) expect(call.init?.signal).toBeInstanceOf(AbortSignal); client.clear();
});
test('array accessors, holes and executable iterators are rejected without executing authored code', async () => {
  let touched = 0, calls = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  const getter = ['resource-a']; Object.defineProperty(getter, '0', { get() { touched++; return 'resource-a'; } });
  const iterator = ['resource-a']; Object.defineProperty(iterator, Symbol.iterator, { get() { touched++; return Array.prototype[Symbol.iterator]; } });
  for (const resourceIds of [getter, iterator, Array(1)]) {
    expect(() => client.appointments.create({ ...appointment, resourceIds }, { idempotencyKey: 'original-key' })).toThrow();
  }
  const grants = ['busy'] as ('busy')[]; Object.defineProperty(grants, '0', { get() { touched++; return 'busy'; } });
  expect(() => client.resources.setGrants('resource-a', 'user-a', grants, { idempotencyKey: 'original-key', expectedRevision: 1 })).toThrow();
  expect(touched).toBe(0); expect(calls).toBe(0); client.clear();
});
test('canonical signed-year instants are compared numerically, not lexicographically', async () => {
  let called = 0; const client = createCalendarClient(async <T>() => { called++; return receipt as T; });
  await client.appointments.create({ ...appointment, startAt: '9999-12-31T23:00:00.000Z', endAt: '+010000-01-01T00:00:00.000Z' }, { idempotencyKey: 'original-key' });
  expect(called).toBe(1); client.clear();
});
test('unknown outcomes preserve the caller identity and never automatically retry', async () => {
  let count = 0;
  const client = createCalendarClient(async () => { count++; throw new Error('PRIVATE_PROVIDER_MESSAGE'); });
  const error = await client.appointments.create(appointment, { idempotencyKey: 'original-key' }).catch(error => error);
  expect(error).toBeInstanceOf(CalendarMutationError); expect(error).toMatchObject({ idempotencyKey: 'original-key', outcome: 'unknown', requiresReconciliation: true, requiresSameIdempotencyKey: true });
  expect(String(error)).not.toContain('PRIVATE_'); expect(count).toBe(1); client.clear();
});
test('explicit known rejection retains safe outcome without leaking body or provider messages', async () => {
  const client = createCalendarClient(async () => { throw { status: 409, message: 'PRIVATE', body: { code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed', detail: 'PRIVATE' } }; });
  const error = await client.appointments.create(appointment, { idempotencyKey: 'original-key' }).catch(error => error);
  expect(error).toMatchObject({ outcome: 'not-committed', code: 'CALENDAR_BOOKING_CONFLICT', requiresReconciliation: false }); expect(String(error)).not.toContain('PRIVATE'); client.clear();
});
test('malformed or mismatched acknowledgments remain unknown, not success or safe rollback', async () => {
  for (const supplied of [{ ...receipt, requestId: 'other-key' }, { ...receipt, operation: 'appointment.cancelled' }, { ...receipt, private: 'do not expose' }]) {
    let count = 0; const client = createCalendarClient(async <T>() => { count++; return supplied as T; });
    const error = await client.appointments.create(appointment, { idempotencyKey: 'original-key' }).catch(error => error);
    expect(error).toMatchObject({ outcome: 'unknown', idempotencyKey: 'original-key' }); expect(count).toBe(1); client.clear();
  }
});
test('authority replacement rejects delayed mutation acknowledgments as unknown and read results as retired', async () => {
  let resolve!: (value: unknown) => void;
  const client = createCalendarClient(<T>() => new Promise<T>(done => { resolve = done as (value: unknown) => void; }));
  const mutation = client.appointments.create(appointment, { idempotencyKey: 'original-key' }).catch(error => error);
  client.clear(); resolve(receipt);
  expect(await mutation).toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: 'original-key' });
  const read = client.appointments.get('appointment-a').catch(error => error); client.clear(); resolve(view);
  expect(await read).toMatchObject({ name: 'AbortError' });
});
test('unknown authored keys, getters, duplicate resources and oversize ranges never reach transport', async () => {
  let count = 0, getter = 0; const client = createCalendarClient(async <T>() => { count++; return receipt as T; });
  for (const input of [{ ...appointment, actor: 'forbidden' }, { ...appointment, resourceIds: ['resource-a', 'resource-a'] },
    { ...appointment, get title() { getter++; return 'getter'; } }]) {
    try { await client.appointments.create(input, { idempotencyKey: 'original-key' }); } catch { /* Admission rejection. */ }
  }
  try { await client.appointments.query({ resourceIds: ['resource-a'], startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-03-01T00:00:00.000Z' }); } catch { /* Bounded range. */ }
  expect(count).toBe(0); expect(getter).toBe(0); client.clear();
});
test('busy-only and receipt readers reject private fields and do not publish wire objects', async () => {
  const client = createCalendarClient(async <T>(path: string) => (path.includes('/busy/')
    ? { items: [{ resourceId: 'resource-a', startAt: appointment.startAt, endAt: appointment.endAt, title: 'PRIVATE' }], truncated: false }
    : { receipt: { ...receipt, title: 'PRIVATE' } }) as T);
  await expect(client.busy.query(range)).rejects.toThrow('Calendar data could not be loaded');
  await expect(client.receipts.get('original-key')).rejects.toThrow('Calendar data could not be loaded'); client.clear();
});
test('idle watches release their owned reader immediately when the SDK retires their scope', async () => {
  let opens = 0, cancelled = 0, delivered = 0, errors = 0;
  const client = createCalendarClient(async <T>() => ({}) as T, async path => {
    opens++; expect(path.startsWith('/api/calendar/appointments/live?')).toBe(true);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: { items: [view], truncated: false }, invalidated: true }) + '\n\n'));
    }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = client.appointments.watch(range, () => { delivered++; }, { onError() { errors++; } });
  try { await settle(() => delivered === 1); client.clear(); await settle(() => cancelled === 1); expect(opens).toBe(1); expect(errors).toBe(0); }
  finally { stop(); client.clear(); }
});
test('a terminal invalidation frame withdraws once and does not reconnect into denied authority', async () => {
  let opens = 0, errors = 0, cancelled = 0;
  const client = createCalendarClient(async <T>() => ({}) as T, async () => {
    opens++; return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"version":1,"error":true}\n\n'));
    }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = client.appointments.watch(range, () => { throw new Error('Denied data must not publish.'); }, { onError() { errors++; } });
  try { await settle(() => errors === 1 && cancelled === 1); expect(opens).toBe(1); }
  finally { stop(); client.clear(); }
});
test('reported transport errors are terminal as the public watch contract promises', async () => {
  let opens = 0, error: unknown;
  const client = createCalendarClient(async <T>() => ({}) as T, async () => { opens++; throw new Error('PRIVATE_NETWORK_ERROR'); });
  const stop = client.appointments.watch(range, () => {}, { onError(value) { error = value; } });
  try { await settle(() => error !== undefined); expect(error).toMatchObject({ terminal: true }); expect(String(error)).not.toContain('PRIVATE_'); expect(opens).toBe(1); }
  finally { stop(); client.clear(); }
});
async function settle(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  throw new Error('In-memory calendar transport did not settle.');
}
