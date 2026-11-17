/** Memory-only HTTP/SSE fixtures; no listener, file-backed database or generated output. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const type = { id: 'type-a', revision: 2, label: 'Synthetic visit', durationMinutes: 30,
  bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'visit.blue', active: true };
const { active: _active, ...snapshot } = type;
const replacement = { label: type.label, durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: null, active: true };
const page = { items: [type], truncated: false, nextAfter: null };
const policy = { resourceId: 'resource-a', resourceRevision: 3, mode: 'required' as const, typeIds: ['type-a', 'type-b'] };
const input = { resourceIds: ['resource-a'], title: 'Synthetic booking', startAt: '2026-12-01T10:00:00.000Z',
  endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
const { title: _title, ...holding } = input;
const appointment = { ...input, id: 'appointment-a', revision: 1, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
  status: 'confirmed', createdBy: 'user-a', appointmentType: snapshot };
const hold = { ...holding, id: 'hold-a', revision: 1, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
  status: 'held', expiresAt: '2026-12-01T09:59:00.000Z', createdBy: 'user-a', appointmentId: null, appointmentType: snapshot };
const control = { idempotencyKey: 'original-key', expectedRevision: 1 };
const requestOptions = { idempotencyKey: 'original-key' };
const receipt = (operation: string, id = type.id) => ({ requestId: 'original-key', operation, id, revision: 2, changed: true });

test('type native paths preserve selector omission/empty, detach inputs and send no guessed defaults', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (init?.method === 'POST') return receipt('type.created') as T;
    if (init?.method === 'PUT') return receipt(path.includes('/resources/') ? 'resource.types-changed' : 'type.updated', path.includes('/resources/') ? 'resource-a' : type.id) as T;
    return (path.includes('/resources/') ? policy : path.includes('/types/') ? type : path.endsWith('resourceIds=') ? { items: [], truncated: false, nextAfter: null } : page) as T;
  });
  try {
    const value = { label: 'Synthetic visit', durationMinutes: 30 }, supplied = { idempotencyKey: 'original-key' };
    const creating = client.types.create(value, supplied); value.durationMinutes = 60; supplied.idempotencyKey = 'changed'; await creating;
    await client.types.list(); await client.types.list({ resourceIds: [] });
    const selected = { resourceIds: ['resource-b', 'resource-a'], limit: 5, after: 'cursor' };
    const listing = client.types.list(selected); selected.resourceIds[0] = 'retargeted'; selected.after = 'z'; await listing;
    const current = await client.types.get(type.id); expect(Object.isFrozen(current)).toBe(true);
    await client.types.replace(type.id, replacement, control);
    const accepted = await client.types.forResource('resource-a'); expect(Object.isFrozen(accepted.typeIds)).toBe(true);
    const typeIds = ['type-b', 'type-a']; const setting = client.resources.setAppointmentTypes('resource-a', { mode: 'required', typeIds }, control); typeIds[0] = 'changed'; await setting;
    expect(calls.map(call => call.path)).toEqual(['/api/calendar/types', '/api/calendar/types', '/api/calendar/types?resourceIds=',
      '/api/calendar/types?limit=5&after=cursor&resourceIds=resource-a%2Cresource-b', '/api/calendar/types/type-a', '/api/calendar/types/type-a',
      '/api/calendar/resources/resource-a/types', '/api/calendar/resources/resource-a/types']);
    expect(calls[0]!.init!.body).toEqual({ type: { label: type.label, durationMinutes: 30 }, options: { idempotencyKey: 'original-key' } });
    expect(calls[7]!.init).toMatchObject({ method: 'PUT', body: { mode: 'required', typeIds: ['type-a', 'type-b'], options: control } });
  } finally { client.clear(); }
});

test('catalog writes, selections and nested references reject unknown fields/accessors and bounds before dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt('type.created') as T; });
  try {
    for (const extra of ['id', 'actor', 'scopeId', 'revision', 'requestId', 'manageAll']) {
      expect(() => client.types.create({ label: 'Visit', durationMinutes: 30, [extra]: 'forged' }, requestOptions)).toThrow();
      if (extra !== 'id' && extra !== 'revision') expect(() => client.appointments.create({ ...input, appointmentType: { id: type.id, revision: 2, [extra]: 'forged' } }, requestOptions)).toThrow();
    }
    for (const durationMinutes of [0, 44_641, 1.5]) expect(() => client.types.create({ label: 'Visit', durationMinutes }, requestOptions)).toThrow();
    for (const colorKey of ['', '-blue', 'blue color', 'x'.repeat(65)]) expect(() => client.types.create({ label: 'Visit', durationMinutes: 30, colorKey }, requestOptions)).toThrow();
    for (const field of ['label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']) {
      const incomplete: Record<string, unknown> = { ...replacement }; delete incomplete[field];
      expect(() => client.types.replace(type.id, incomplete as never, control)).toThrow();
    }
    expect(() => client.types.create({ get label() { getters++; return 'Visit'; }, durationMinutes: 30 }, requestOptions)).toThrow();
    for (const resourceIds of [['same', 'same'], ['bad/id'], Array.from({ length: 17 }, (_, index) => 'r-' + index)]) expect(() => client.types.list({ resourceIds })).toThrow();
    expect(() => client.types.list({ actor: {} } as never)).toThrow();
    expect(() => client.resources.setAppointmentTypes('resource-a', { mode: 'unrestricted', typeIds: ['type-a'] }, control)).toThrow();
    expect(() => client.resources.setAppointmentTypes('resource-a', { mode: 'required', typeIds: Array.from({ length: 17 }, (_, index) => 't-' + index) }, control)).toThrow();
    for (const appointmentType of [null, undefined, { id: type.id }, { id: type.id, revision: 0 }, { ...snapshot }, { get id() { getters++; return type.id; }, revision: 2 }]) {
      expect(() => client.appointments.create({ ...input, appointmentType } as never, requestOptions)).toThrow();
      expect(() => client.holds.acquire({ ...holding, appointmentType } as never, requestOptions)).toThrow();
    }
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('typed booking refs detach and untyped create/reschedule keysets remain unchanged', async () => {
  const bodies: unknown[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    bodies.push(init!.body); return receipt(path.endsWith('/reschedule') ? 'appointment.rescheduled' : path.endsWith('/holds') ? 'hold.acquired' : 'appointment.created', 'appointment-a') as T;
  });
  try {
    const ref = { id: type.id, revision: 2 };
    const creating = client.appointments.create({ ...input, appointmentType: ref }, requestOptions); ref.revision = 99; await creating;
    await client.holds.acquire({ ...holding, appointmentType: { id: type.id, revision: 2 } }, requestOptions);
    await client.appointments.create(input, requestOptions);
    const reschedule = { startAt: input.startAt, endAt: input.endAt, timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await client.appointments.reschedule('appointment-a', reschedule, control);
    await client.appointments.reschedule('appointment-a', { ...reschedule, appointmentType: null }, control);
    expect(bodies[0]).toEqual({ appointment: { ...input, appointmentType: { id: type.id, revision: 2 } }, options: { idempotencyKey: 'original-key' } });
    expect(bodies[1]).toEqual({ hold: { ...holding, appointmentType: { id: type.id, revision: 2 } }, options: { idempotencyKey: 'original-key' } });
    expect(bodies[2]).toEqual({ appointment: input, options: { idempotencyKey: 'original-key' } });
    expect(bodies[3]).toEqual({ appointment: reschedule, options: control });
    expect(bodies[4]).toEqual({ appointment: { ...reschedule, appointmentType: null }, options: control });
  } finally { client.clear(); }
});

test('typed booking history is exact, detached, frozen and consistent with occupancy; untyped responses omit it', async () => {
  for (const [kind, value] of [['appointments', appointment], ['holds', hold]] as const) {
    const client = createCalendarClient(async <T>() => value as T);
    try {
      const current = await client[kind].get(value.id); expect(current.appointmentType).toEqual(snapshot);
      expect(current.appointmentType).not.toBe(snapshot); expect(Object.isFrozen(current.appointmentType)).toBe(true);
    } finally { client.clear(); }
    for (const appointmentType of [null, undefined, { ...snapshot, active: true }, { ...snapshot, revision: 0 }, { ...snapshot, durationMinutes: 31 },
      { ...snapshot, bufferBeforeMinutes: 0 }, { ...snapshot, colorKey: undefined }, { id: type.id, revision: 2 }]) {
      const invalidClient = createCalendarClient(async <T>() => ({ ...value, appointmentType }) as T);
      try { await expect(invalidClient[kind].get(value.id)).rejects.toThrow('Calendar data could not be loaded'); } finally { invalidClient.clear(); }
    }
    const { appointmentType: _type, ...untyped } = value;
    const untypedClient = createCalendarClient(async <T>() => untyped as T);
    try { expect(await untypedClient[kind].get(value.id)).not.toHaveProperty('appointmentType'); } finally { untypedClient.clear(); }
  }
});

test('type DTOs reject identity, pagination, inactive-selection and policy keyset errors', async () => {
  for (const wire of [{ ...type, id: 'other' }, { ...type, active: undefined }, { ...type, private: 'NEVER' }, { ...type, colorKey: 'bad color' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.types.get(type.id)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const [query, wire] of [[{ after: 'z' }, page], [{ limit: 1 }, { ...page, items: [type, { ...type, id: 'type-b' }] }],
    [{ limit: 2 }, { ...page, truncated: true, nextAfter: type.id }], [{ resourceIds: [] }, page],
    [{ resourceIds: [] }, { items: [], truncated: true, nextAfter: null }],
    [{ resourceIds: [] }, { items: [], truncated: false, nextAfter: type.id }],
    [{ resourceIds: ['resource-a'] }, { ...page, items: [{ ...type, active: false }] }]] as const) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.types.list(query)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  for (const wire of [{ ...policy, resourceId: 'other' }, { ...policy, mode: 'unknown' }, { ...policy, resourceRevision: 0 },
    { ...policy, typeIds: ['type-b', 'type-a'] }, { ...policy, typeIds: ['type-a', 'type-a'] }, { ...policy, mode: 'unrestricted' }, { ...policy, private: 'NEVER' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.types.forResource('resource-a')).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
});

test('catalog mutations retain original-key unknown outcomes on retirement/abort and bind receipt identity', async () => {
  for (const operation of ['create', 'replace', 'policy'] as const) {
    let finish!: (value: unknown) => void, calls = 0;
    const client = createCalendarClient(<T>() => { calls++; return new Promise<T>(resolve => { finish = resolve as (value: unknown) => void; }); });
    const supplied = operation === 'create' ? { ...requestOptions } : { ...control };
    try {
      const pending = (operation === 'create' ? client.types.create(replacement, supplied) : operation === 'replace' ? client.types.replace(type.id, replacement, supplied as typeof control)
        : client.resources.setAppointmentTypes('resource-a', { mode: 'unrestricted', typeIds: [] }, supplied as typeof control)).catch(error => error);
      supplied.idempotencyKey = 'changed'; client.clear(); finish(receipt(operation === 'create' ? 'type.created' : operation === 'replace' ? 'type.updated' : 'resource.types-changed', operation === 'policy' ? 'resource-a' : type.id));
      expect(await pending).toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: 'original-key' }); expect(calls).toBe(1);
    } finally { client.clear(); }
  }
  for (const wire of [receipt('type.created'), receipt('type.updated', 'other'), { ...receipt('type.updated'), requestId: 'other' }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { const failure = await client.types.replace(type.id, replacement, control).catch(error => error);
      expect(failure).toMatchObject({ outcome: 'unknown', idempotencyKey: 'original-key' }); } finally { client.clear(); }
  }
  const abort = new AbortController(); let calls = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt('type.created') as T; });
  try { abort.abort(); await expect(client.types.create(replacement, { idempotencyKey: 'original-key', signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(calls).toBe(0); }
  finally { client.clear(); }
});

test('type watches detach queries, strictly bind detail identities, and retire all private streams', async () => {
  const paths: string[] = [], signals: AbortSignal[] = [], controllers: ReadableStreamDefaultController<Uint8Array>[] = [], values: unknown[] = [], errors: unknown[] = [];
  const client = createCalendarClient(async () => { throw new Error('No watch side reads.'); }, async (path, init) => {
    paths.push(path); signals.push(init.signal as AbortSignal);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stops: (() => void)[] = [], frame = (value: unknown) => new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n');
  try {
    const query = { limit: 2, resourceIds: ['resource-b', 'resource-a'] };
    stops.push(client.types.watch(query, value => values.push(value), { onError: error => errors.push(error) })); query.resourceIds[0] = 'changed'; query.limit = 99;
    stops.push(client.types.watchType(type.id, value => values.push(value), { onError: error => errors.push(error) }));
    stops.push(client.types.watchForResource('resource-a', value => values.push(value), { onError: error => errors.push(error) }));
    expect(paths).toEqual(['/api/calendar/types/live?limit=2&resourceIds=resource-a%2Cresource-b', '/api/calendar/types/type-a/live', '/api/calendar/resources/resource-a/types/live']);
    [page, type, policy].forEach((value, index) => controllers[index]!.enqueue(frame(value))); await settle(() => values.length === 3);
    controllers[1]!.enqueue(frame({ ...type, id: 'other' })); controllers[2]!.enqueue(frame({ ...policy, resourceId: 'other' }));
    await settle(() => errors.length === 2); expect(values).toHaveLength(3); expect(signals[1]!.aborted && signals[2]!.aborted).toBe(true);
    client.clear(); expect(signals[0]!.aborted).toBe(true);
  } finally { stops.forEach(stop => stop()); client.clear(); }
});

async function settle(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic type client fixture timed out.');
}
