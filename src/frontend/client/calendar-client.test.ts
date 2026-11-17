/** In-memory transport fixtures only. No server, database, browser, dependency install or generated output. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import { CalendarMutationError } from './calendar-mutation';
import type { FetchInit } from './sdk';
const appointment = { resourceIds: ['resource-a'], title: 'Private synthetic appointment', startAt: '2026-11-16T15:00:00.000Z', endAt: '2026-11-16T16:00:00.000Z', timeZone: 'America/New_York' };
const range = { resourceIds: appointment.resourceIds, startAt: appointment.startAt, endAt: appointment.endAt };
const view = { ...appointment, id: 'appointment-a', revision: 1, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'user-a' };
const receipt = { requestId: 'original-key', operation: 'appointment.created' as const, id: 'appointment-a', revision: 1, changed: true };
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
test('blocks and availability use fixed native envelopes, detach inputs and retain exact control identities', async () => {
  const calls: { path: string; init?: FetchInit }[] = [], signal = new AbortController().signal;
  const block = { ...appointment, id: 'block-a', revision: 2, status: 'active' as const, createdBy: 'user-a' };
  const availability = { resourceId: 'resource-a', resourceRevision: 3, timeZone: 'UTC', mode: 'windows' as const,
    windows: [{ startAt: appointment.startAt, endAt: appointment.endAt }] };
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (init?.method === 'POST' && !path.endsWith('/query')) {
      const operation = path.includes('/availability/') ? 'resource.availability-changed'
        : path.endsWith('/reschedule') ? 'block.rescheduled' : path.endsWith('/cancel') ? 'block.cancelled' : 'block.created';
      return { ...receipt, operation, id: path.includes('/availability/') ? 'resource-a' : 'block-a' } as T;
    }
    if (path.includes('/availability/')) return availability as T;
    return (path.endsWith('/query') ? { items: [block], truncated: false } : block) as T;
  });
  try {
    const input = structuredClone(appointment), supplied = { idempotencyKey: 'original-key', signal };
    const creating = client.blocks.create(input, supplied); input.resourceIds[0] = 'retargeted'; input.title = 'changed';
    await creating;
    const windows = structuredClone(availability.windows), control = { idempotencyKey: 'original-key', expectedRevision: 3, signal };
    const replacing = client.availability.replace('resource-a', { mode: 'windows', windows }, control);
    windows[0]!.startAt = '2026-01-01T00:00:00.000Z'; control.expectedRevision = 99; await replacing;
    const current = await client.availability.get('resource-a', { signal });
    expect(current).toEqual(availability); expect(Object.isFrozen(current.windows[0])).toBe(true);
    expect(await client.blocks.get('block-a', { signal })).toEqual(block);
    expect(await client.blocks.query(range, { signal })).toEqual({ items: [block], truncated: false });
    const move = { startAt: appointment.startAt, endAt: appointment.endAt, timeZone: appointment.timeZone };
    await client.blocks.reschedule('block-a', move, { idempotencyKey: 'original-key', expectedRevision: 2, signal });
    await client.blocks.cancel('block-a', { idempotencyKey: 'original-key', expectedRevision: 3, signal });
    expect(calls.map(call => call.path)).toEqual(['/api/calendar/blocks', '/api/calendar/availability/resource-a',
      '/api/calendar/availability/resource-a', '/api/calendar/blocks/block-a', '/api/calendar/blocks/query',
      '/api/calendar/blocks/block-a/reschedule', '/api/calendar/blocks/block-a/cancel']);
    expect(calls[0]!.init!.body).toEqual({ block: appointment, options: { idempotencyKey: 'original-key' } });
    expect(calls[1]!.init!.body).toEqual({ availability: { mode: 'windows', windows: availability.windows }, options: { idempotencyKey: 'original-key', expectedRevision: 3 } });
    expect(calls[5]!.init!.body).toEqual({ block: move, options: { idempotencyKey: 'original-key', expectedRevision: 2 } });
    expect(calls[6]!.init!.body).toEqual({ options: { idempotencyKey: 'original-key', expectedRevision: 3 } });
    for (const call of calls) expect(call.init!.signal).toBeInstanceOf(AbortSignal);
  } finally { client.clear(); }
});
test('availability admits unsorted overlapping inputs and long merged windows round-trip without an occupied-interval duration cap', async () => {
  const windows = [{ startAt: '2026-01-15T00:00:00.000Z', endAt: '2026-02-15T00:00:00.000Z' },
    { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T00:00:00.000Z' }];
  const current = { resourceId: 'resource-a', resourceRevision: 2, timeZone: 'UTC', mode: 'windows' as const,
    windows: [{ startAt: windows[1]!.startAt, endAt: windows[0]!.endAt }] };
  const client = createCalendarClient(async <T>(_path: string, init?: FetchInit) => (init?.method === 'POST'
    ? { ...receipt, operation: 'resource.availability-changed', id: 'resource-a' } : current) as T);
  try {
    await client.availability.replace('resource-a', { mode: 'windows', windows }, { idempotencyKey: 'original-key', expectedRevision: 1 });
    expect(await client.availability.get('resource-a')).toEqual(current);
    await client.availability.replace('resource-a', { mode: 'windows', windows: current.windows }, { idempotencyKey: 'original-key', expectedRevision: 2 });
  } finally { client.clear(); }
});
test('new calendar inputs reject routing fields, buffers, accessors, absent controls and exceeded bounds before dispatch', async () => {
  let calls = 0, touched = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  try {
    for (const input of [{ ...appointment, actor: {} }, { ...appointment, bufferBeforeMinutes: 0 },
      { ...appointment, resourceIds: Array.from({ length: 17 }, (_, i) => 'resource-' + i) }]) {
      expect(() => client.blocks.create(input, { idempotencyKey: 'original-key' })).toThrow();
    }
    const window = { startAt: appointment.startAt, get endAt() { touched++; return appointment.endAt; } };
    for (const input of [{ mode: 'windows', windows: [window] }, { mode: 'unrestricted', windows: [{ startAt: appointment.startAt, endAt: appointment.endAt }] },
      { mode: 'windows', windows: Array(101).fill({ startAt: appointment.startAt, endAt: appointment.endAt }) },
      { mode: 'windows', windows: [], timeZone: 'UTC' }]) {
      expect(() => client.availability.replace('resource-a', input as never, { idempotencyKey: 'original-key', expectedRevision: 1 })).toThrow();
    }
    expect(() => client.blocks.cancel('block-a', { idempotencyKey: 'original-key' } as never)).toThrow();
    expect(() => client.availability.replace('resource-a', { mode: 'windows', windows: [] }, { idempotencyKey: 'original-key' } as never)).toThrow();
    expect(calls).toBe(0); expect(touched).toBe(0);
  } finally { client.clear(); }
});
test('block and availability readers fail closed on malformed private DTOs and mismatched target identities', async () => {
  const block = { ...appointment, id: 'block-a', revision: 1, status: 'active', createdBy: 'user-a' };
  const availability = { resourceId: 'resource-a', resourceRevision: 1, timeZone: 'UTC', mode: 'windows',
    windows: [{ startAt: appointment.startAt, endAt: appointment.endAt }] };
  for (const wire of [{ ...block, bufferBeforeMinutes: 5 }, { ...block, status: 'confirmed' }, { ...block, id: 'another-block' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.blocks.get('block-a')).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const wire of [{ ...availability, private: 'hidden' }, { ...availability, resourceId: 'another-resource' },
    { ...availability, windows: [availability.windows[0], availability.windows[0]] }, { ...availability, mode: 'unrestricted' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.availability.get('resource-a')).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
});
test('new mutations keep unknown outcomes and authority retirement bound to the original idempotency key', async () => {
  for (const kind of ['block', 'availability'] as const) {
    let resolve!: (value: unknown) => void, calls = 0;
    const client = createCalendarClient(<T>() => { calls++; return new Promise<T>(done => { resolve = done as (value: unknown) => void; }); });
    try {
      const pending = (kind === 'block' ? client.blocks.create(appointment, { idempotencyKey: 'original-key' })
        : client.availability.replace('resource-a', { mode: 'windows', windows: [] }, { idempotencyKey: 'original-key', expectedRevision: 1 })).catch(error => error);
      client.clear(); resolve({ ...receipt, operation: kind === 'block' ? 'block.created' : 'resource.availability-changed', id: kind === 'block' ? 'block-a' : 'resource-a' });
      expect(await pending).toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: 'original-key', requiresSameIdempotencyKey: true });
      expect(calls).toBe(1);
    } finally { client.clear(); }
  }
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
test('availability conflicts remain known non-commits without leaking private provider bodies', async () => {
  const client = createCalendarClient(async () => { throw { status: 409, body: { code: 'CALENDAR_AVAILABILITY_CONFLICT', outcome: 'not-committed', detail: 'PRIVATE' } }; });
  try {
    const error = await client.blocks.create(appointment, { idempotencyKey: 'original-key' }).catch(error => error);
    expect(error).toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT', outcome: 'not-committed', requiresReconciliation: false, idempotencyKey: 'original-key' });
    expect(String(error)).not.toContain('PRIVATE');
  } finally { client.clear(); }
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
test('appointment and receipt detail reads reject correctly shaped acknowledgments for another requested identity', async () => {
  const client = createCalendarClient(async <T>(path: string) => (path.includes('/receipts/') ? { receipt: { ...receipt, requestId: 'other-key' } }
    : { ...view, id: 'other-appointment' }) as T);
  try {
    await expect(client.appointments.get(view.id)).rejects.toThrow('Calendar data could not be loaded');
    await expect(client.receipts.get('original-key')).rejects.toThrow('Calendar data could not be loaded');
  } finally { client.clear(); }
});

for (const kind of ['blocks', 'availability'] as const) {
  const snapshot = kind === 'blocks' ? { items: [{ ...appointment, id: 'block-a', revision: 1, status: 'active', createdBy: 'user-a' }], truncated: false }
    : { resourceId: 'resource-a', resourceRevision: 1, timeZone: 'UTC', mode: 'windows', windows: [{ startAt: appointment.startAt, endAt: appointment.endAt }] };
  const livePath = kind === 'blocks' ? '/api/calendar/blocks/live?' : '/api/calendar/availability/resource-a/live';
  const frame = (value: unknown) => new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, value, invalidated: true }) + '\n\n');
  test(`${kind} watch uses its fixed endpoint, parses immutable DTOs and releases the reader on SDK retirement`, async () => {
    let opens = 0, cancelled = 0, errors = 0, published: unknown, update: unknown;
    const client = createCalendarClient(async <T>() => ({}) as T, async (path, init) => {
      opens++; expect(path.startsWith(livePath)).toBe(true); expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(frame(snapshot)); }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const listener = (value: unknown, next?: unknown) => { published = value; update = next; }, options = { onError() { errors++; } };
    const stop = kind === 'blocks' ? client.blocks.watch(range, listener, options) : client.availability.watch('resource-a', listener, options);
    try {
      await settle(() => published !== undefined); expect(published).toEqual(snapshot); expect(update).toEqual({ invalidated: true }); expect(Object.isFrozen(published)).toBe(true);
      client.clear(); await settle(() => cancelled === 1); expect(opens).toBe(1); expect(errors).toBe(0);
    } finally { stop(); client.clear(); }
  });
  test(`${kind} watch terminal denial or malformed private DTO withdraws once without reconnecting`, async () => {
    for (const malformed of [false, true]) {
      let opens = 0, cancelled = 0, errors = 0, delivered = 0;
      const value = kind === 'blocks' ? { ...snapshot, private: 'PRIVATE' } : { ...snapshot, resourceId: 'other-resource' };
      const client = createCalendarClient(async <T>() => ({}) as T, async () => {
        opens++; return new Response(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(malformed ? frame(value) : new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n'));
        }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
      });
      const listener = () => { delivered++; }, options = { onError(error: unknown) { errors++; expect(String(error)).not.toContain('PRIVATE'); } };
      const stop = kind === 'blocks' ? client.blocks.watch(range, listener, options) : client.availability.watch('resource-a', listener, options);
      try { await settle(() => errors === 1 && cancelled === 1); expect(opens).toBe(1); expect(delivered).toBe(0); }
      finally { stop(); client.clear(); }
    }
  });
  test(`${kind} reconnect marks fresh snapshots separately and caller abort retires future reconnects`, async () => {
    let opens = 0; const updates: unknown[] = [], abort = new AbortController();
    const client = createCalendarClient(async <T>() => ({}) as T, async () => {
      opens++; return new Response(frame(snapshot), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const listener = (_value: unknown, update?: unknown) => { updates.push(update); if (updates.length === 2) abort.abort(); }, options = { signal: abort.signal };
    const stop = kind === 'blocks' ? client.blocks.watch(range, listener, options) : client.availability.watch('resource-a', listener, options);
    try {
      await settle(() => updates.length === 2, 1_000);
      expect(updates).toEqual([{ invalidated: true }, { invalidated: true, reconnected: true }]); expect(opens).toBe(2);
    } finally { abort.abort(); stop(); client.clear(); }
  });
}
async function settle(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) { if (predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  throw new Error('In-memory calendar transport did not settle.');
}
