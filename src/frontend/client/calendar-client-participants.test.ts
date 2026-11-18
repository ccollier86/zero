/** Strict participant JSON/SSE fixtures only. No files, servers, actors or generated output. */
import { expect, test } from 'bun:test';
import type { CalendarParticipantDirectoryPage, CalendarParticipantsView } from '../../calendar/contracts';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const interval = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
const input = { ...interval, resourceIds: ['resource-a'], title: 'Synthetic participants' };
const a = { kind: 'guardian-user' as const, userId: 'account-a' }, b = { kind: 'guardian-user' as const, userId: 'account-b' };
const available = { ref: a, availability: 'available' as const, name: 'Synthetic account' };
const tombstone = { ref: b, availability: 'unavailable' as const };
const bindings: CalendarParticipantsView = { id: 'appointment-a', revision: 3, participants: [available, tombstone] };
const directory: CalendarParticipantDirectoryPage = { items: [available], truncated: true, nextAfter: 'pc_opaque-continuation' };
const control = { idempotencyKey: 'original-request', expectedRevision: 3 };
const receipt = { requestId: control.idempotencyKey, operation: 'appointment.participants-changed' as const, id: bindings.id, revision: 4, changed: true };
const appointment = { ...input, id: bindings.id, revision: 3, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'owner' };
const hold = { ...interval, id: 'hold-a', revision: 1, resourceIds: input.resourceIds, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  status: 'held', createdBy: 'owner', expiresAt: '2026-12-01T09:59:00.000Z', appointmentId: null };

test('participant commands detach canonical references and fixed envelopes while omitted legacy commands stay unchanged', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init });
    if (init?.method === 'GET') return (path.endsWith('/holds/hold-a/participants') ? { ...bindings, id: 'hold-a' }
      : path.endsWith('/appointments/appointment-a/participants') ? bindings : directory) as T;
    const body = init!.body as { options: { idempotencyKey: string } };
    return { ...receipt, requestId: body.options.idempotencyKey,
      operation: init?.method === 'PUT' ? receipt.operation : path.endsWith('/holds') ? 'hold.acquired' : 'appointment.created',
      id: init?.method === 'PUT' ? bindings.id : 'generated', revision: init?.method === 'PUT' ? 4 : 1 } as T;
  });
  try {
    await client.appointments.create(input, { idempotencyKey: 'legacy' });
    expect(calls[0]!.init!.body).toEqual({ appointment: input, options: { idempotencyKey: 'legacy' } });
    const refs = [{ ...b }, { ...a }], creating = client.appointments.create({ ...input, participants: refs }, { idempotencyKey: 'create' });
    refs[0]!.userId = 'retargeted'; refs.push({ ...a }); await creating;
    expect(calls[1]!.init!.body).toEqual({ appointment: { ...input, participants: [a, b] }, options: { idempotencyKey: 'create' } });
    const heldRefs = [{ ...a }], acquiring = client.holds.acquire({ ...interval, resourceIds: input.resourceIds, participants: heldRefs }, { idempotencyKey: 'hold' });
    heldRefs[0]!.userId = 'retargeted'; await acquiring;
    expect(calls[2]!.init!.body).toEqual({ hold: { ...interval, resourceIds: input.resourceIds, participants: [a] }, options: { idempotencyKey: 'hold' } });
    const replacement = [{ ...b }, { ...a }], supplied = { ...control }, replacing = client.participants.replace(bindings.id, replacement, supplied);
    replacement[0]!.userId = 'retargeted'; supplied.idempotencyKey = 'changed'; supplied.expectedRevision = 99;
    expect(await replacing).toEqual(receipt);
    expect(calls[3]).toMatchObject({ path: '/api/calendar/appointments/appointment-a/participants', init: { method: 'PUT',
      body: { references: [a, b], options: control } } });
    await client.participants.forAppointment(bindings.id); await client.participants.forHold('hold-a');
    const query = { search: '  Synthetic & account  ', limit: 1, after: 'pc_prior-cursor' }, reading = client.participants.directory(query);
    query.search = 'retargeted'; query.after = 'pc_changed'; await reading;
    expect(calls.slice(4).map(call => call.path)).toEqual(['/api/calendar/appointments/appointment-a/participants',
      '/api/calendar/holds/hold-a/participants', '/api/calendar/participants?search=Synthetic+%26+account&limit=1&after=pc_prior-cursor']);
    expect(calls.every(call => !JSON.stringify(call.init?.body ?? {}).includes('actor'))).toBe(true);
  } finally { client.clear(); }
});

test('forged participant authorship, malformed sets, unsupported variants and accessors reject before dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return null as T; });
  const accessor: unknown[] = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { getters++; return a; } });
  const symbolRef = { ...a, [Symbol('private')]: true };
  try {
    const invalid = [undefined, null, {}, [a, a], Array.from({ length: 101 }, (_, index) => ({ kind: 'guardian-user', userId: 'account-' + index })),
      [{ kind: 'patient', userId: a.userId }], [{ kind: 'guardian-user', userId: 'bad/id' }], [{ ...a, name: 'PRIVATE' }],
      [{ ...a, tenantId: 'forged' }], [{ userId: a.userId }], [{ kind: 'guardian-user', get userId() { getters++; return a.userId; } }],
      [Object.assign(Object.create({ inherited: true }), a)], [symbolRef], new Array(1), accessor];
    for (const participants of invalid) {
      expect(() => client.appointments.create({ ...input, participants } as never, { idempotencyKey: 'invalid' })).toThrow();
      expect(() => client.holds.acquire({ ...interval, resourceIds: input.resourceIds, participants } as never, { idempotencyKey: 'invalid' })).toThrow();
      expect(() => client.participants.replace(bindings.id, participants as never, control)).toThrow();
    }
    expect(() => client.appointments.reschedule(bindings.id, { ...interval, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, participants: [a] } as never, control)).toThrow();
    expect(() => client.holds.confirm('hold-a', { title: 'Synthetic', participants: [a] } as never, control)).toThrow();
    expect(() => client.participants.replace('bad/id', [a], control)).toThrow();
    expect(() => client.participants.replace(bindings.id, [a], { ...control, actor: {} } as never)).toThrow();
    for (const query of [{ search: 'private\nvalue' }, { search: 'x'.repeat(101) }, { limit: 0 }, { limit: 101 }, { after: 'bad/id' }, { tenantId: 'forged' },
      { get search() { getters++; return 'Synthetic'; } }]) expect(() => client.participants.directory(query as never)).toThrow();
    expect(() => client.participants.forAppointment(bindings.id, { actor: {} } as never)).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('participant presentations are exact, detached and deeply frozen; unavailable bindings expose only the reference', async () => {
  const wire = { ...bindings, participants: [{ ...available, ref: { ...a } }, { ...tombstone, ref: { ...b } }] };
  const client = createCalendarClient(async <T>() => wire as T);
  try {
    const result = await client.participants.forAppointment(bindings.id);
    expect(result).toEqual(bindings); expect(result).not.toBe(wire);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.participants)).toBe(true);
    for (const participant of result.participants) { expect(Object.isFrozen(participant)).toBe(true); expect(Object.isFrozen(participant.ref)).toBe(true); }
    wire.participants[0]!.ref.userId = 'retargeted'; expect(result.participants[0]!.ref.userId).toBe(a.userId);
    expect(Object.keys(result.participants[1]!)).toEqual(['ref', 'availability']);
  } finally { client.clear(); }
  let getters = 0;
  const invalid = [
    { ...bindings, id: 'other' }, { ...bindings, revision: 0 }, { ...bindings, revision: 1.5 }, { ...bindings, references: [a] },
    { ...bindings, participants: [available, available] }, { ...bindings, participants: [tombstone, available] },
    { ...bindings, participants: [{ ...tombstone, name: 'PRIVATE_RETIRED_NAME' }] },
    { ...bindings, participants: [{ ...available, email: 'PRIVATE_EMAIL' }] },
    { ...bindings, participants: [{ ...available, avatar: { url: 'PRIVATE_ASSET' } }] },
    { ...bindings, participants: [{ ...available, ref: { ...a, tenantId: 'foreign' } }] },
    { ...bindings, participants: [{ ...available, availability: 'active' }] },
    { ...bindings, participants: [{ ...available, name: '' }] },
    { ...bindings, participants: [{ ref: a, availability: 'available' }] },
    { ...bindings, participants: [{ ref: a, availability: 'unavailable', name: undefined }] },
    { ...bindings, participants: [{ ref: a, availability: 'available', get name() { getters++; return 'PRIVATE'; } }] },
  ];
  for (const value of invalid) {
    const client = createCalendarClient(async <T>() => value as T);
    try {
      await expect(client.participants.forAppointment(bindings.id)).rejects.toThrow('Calendar data could not be loaded');
      await expect(client.participants.forHold(bindings.id)).rejects.toThrow('Calendar data could not be loaded');
    } finally { client.clear(); }
  }
  expect(getters).toBe(0);
});

test('directory pagination accepts opaque scan cursors and empty continuations without accepting hidden/tombstone projections', async () => {
  for (const wire of [directory, { items: [], truncated: true, nextAfter: 'pc_empty-scan' }, { items: [], truncated: false, nextAfter: null }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try {
      const result = await client.participants.directory({ limit: 1, after: 'pc_prior-cursor' });
      expect(result).toEqual(wire); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.items)).toBe(true);
      if (result.items[0]) { expect(Object.isFrozen(result.items[0])).toBe(true); expect(Object.isFrozen(result.items[0].ref)).toBe(true); }
    } finally { client.clear(); }
  }
  for (const value of [{ ...directory, items: [tombstone] }, { ...directory, items: [available, available] },
    { ...directory, items: [{ ...available, ref: b }, available] }, { ...directory, count: 99 },
    { ...directory, nextAfter: null }, { ...directory, truncated: false }, { ...directory, nextAfter: 'pc_prior-cursor' },
    { ...directory, nextAfter: 'private/id' }, { ...directory, items: [{ ...available, email: 'PRIVATE' }] }]) {
    const client = createCalendarClient(async <T>() => value as T);
    try { await expect(client.participants.directory({ limit: 1, after: 'pc_prior-cursor' })).rejects.toThrow('Calendar data could not be loaded'); }
    finally { client.clear(); }
  }
});

test('participant receipts correlate exact request, operation, target and CAS revision, preserving unknown and known outcomes safely', async () => {
  for (const wire of [receipt, { ...receipt, changed: false, revision: 3 }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { expect(await client.participants.replace(bindings.id, [a], control)).toEqual(wire); } finally { client.clear(); }
  }
  for (const wire of [{ ...receipt, requestId: 'other' }, { ...receipt, operation: 'appointment.rescheduled' }, { ...receipt, id: 'other' },
    { ...receipt, revision: 3 }, { ...receipt, revision: 5 }, { ...receipt, changed: false }, { ...receipt, references: [a] }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.participants.replace(bindings.id, [a], control)).rejects.toMatchObject({ outcome: 'unknown',
      idempotencyKey: control.idempotencyKey, requiresReconciliation: true, requiresSameIdempotencyKey: true }); }
    finally { client.clear(); }
  }
  for (const wire of [{ receipt }, { receipt: null }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { expect(await client.receipts.get(control.idempotencyKey)).toEqual(wire.receipt); } finally { client.clear(); }
  }
  for (const wire of [receipt, { receipt, participants: [available] }, { receipt: { ...receipt, requestId: 'other' } }]) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.receipts.get(control.idempotencyKey)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  let calls = 0;
  const client = createCalendarClient(async () => { calls++; throw { status: 404, body: { code: 'CALENDAR_NOT_FOUND', outcome: 'not-committed', message: 'PRIVATE_TARGET' } }; });
  try {
    const error = await client.participants.replace(bindings.id, [a], control).catch(error => error);
    expect(error).toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-committed', idempotencyKey: control.idempotencyKey, requiresReconciliation: false });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_TARGET'); expect(calls).toBe(1);
  } finally { client.clear(); }
});

test('ordinary appointment, hold and free/busy DTOs never accept participant identities or counts', async () => {
  const query = { resourceIds: ['resource-a'], startAt: interval.startAt, endAt: interval.endAt };
  for (const [kind, base] of [['appointment', appointment], ['hold', hold]] as const) {
    const clean = createCalendarClient(async <T>() => base as T);
    try {
      const result = kind === 'appointment' ? await clean.appointments.get(bindings.id) : await clean.holds.get('hold-a');
      expect(result).not.toHaveProperty('participants'); expect(result).not.toHaveProperty('participantCount');
    } finally { clean.clear(); }
    for (const field of [{ participants: [available] }, { references: [a] }, { participantCount: 1 }]) {
      const client = createCalendarClient(async <T>() => ({ ...base, ...field }) as T);
      try { await expect(kind === 'appointment' ? client.appointments.get(bindings.id) : client.holds.get('hold-a')).rejects.toThrow('Calendar data could not be loaded'); }
      finally { client.clear(); }
    }
  }
  for (const field of [{ participants: [available] }, { references: [a] }, { participantCount: 1 }]) {
    const client = createCalendarClient(async <T>() => ({ items: [{ resourceId: 'resource-a', startAt: interval.startAt, endAt: interval.endAt, ...field }], truncated: false }) as T);
    try { await expect(client.busy.query(query)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
});

test('participant watch paths detach queries and terminate malformed private frames without leaking or retaining readers', async () => {
  for (const kind of ['directory', 'appointment', 'hold'] as const) {
    let controller!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal, cancelled = 0, path = '';
    const pages: unknown[] = [], errors: unknown[] = [], query = { search: 'Synthetic', after: 'pc_before', limit: 1 };
    const client = createCalendarClient(async () => { throw new Error('No watch side reads.'); }, async (target, init) => {
      path = target; signal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    let stop = () => {};
    try {
      stop = kind === 'directory' ? client.participants.watchDirectory(query, page => pages.push(page), { onError: error => errors.push(error) })
        : kind === 'appointment' ? client.participants.watchForAppointment(bindings.id, page => pages.push(page), { onError: error => errors.push(error) })
        : client.participants.watchForHold('hold-a', page => pages.push(page), { onError: error => errors.push(error) });
      query.search = 'retargeted'; query.after = 'pc_retargeted';
      expect(path).toBe(kind === 'directory' ? '/api/calendar/participants/live?search=Synthetic&limit=1&after=pc_before'
        : kind === 'appointment' ? '/api/calendar/appointments/appointment-a/participants/live' : '/api/calendar/holds/hold-a/participants/live');
      const page = kind === 'directory' ? directory : { ...bindings, id: kind === 'hold' ? 'hold-a' : bindings.id };
      controller.enqueue(frame(page)); await settle(() => pages.length === 1);
      expect(Object.isFrozen(pages[0])).toBe(true);
      controller.enqueue(frame(kind === 'directory' ? { ...directory, items: [tombstone] } : { ...page, id: 'foreign-target' }));
      await settle(() => errors.length === 1 && signal.aborted && cancelled === 1);
      expect(pages).toHaveLength(1); expect(errors[0]).toMatchObject({ terminal: true }); expect(JSON.stringify(errors)).not.toContain('foreign-target');
    } finally { stop(); client.clear(); }
    expect(cancelled).toBe(1);
  }
});

test('clear retires pending participant reads, mutations and late-opened watch responses before any replacement scope can publish', async () => {
  const pending: { path: string; signal: AbortSignal; resolve(value: unknown): void }[] = [];
  const client = createCalendarClient(<T>(path: string, init?: FetchInit) => new Promise<T>(resolve => pending.push({ path, signal: init!.signal!, resolve: value => resolve(value as T) })));
  try {
    const reading = client.participants.forAppointment(bindings.id), writing = client.participants.replace(bindings.id, [a], control);
    const outcomes = Promise.all([reading.catch(error => error), writing.catch(error => error)]);
    client.clear(); expect(pending.every(item => item.signal.aborted)).toBe(true);
    pending[0]!.resolve(bindings); pending[1]!.resolve(receipt);
    const [readError, writeError] = await outcomes;
    expect(readError).toMatchObject({ name: 'AbortError' });
    expect(writeError).toMatchObject({ name: 'AbortError', outcome: 'unknown', idempotencyKey: control.idempotencyKey, requiresReconciliation: true });
    const fresh = client.participants.forHold('hold-a'); expect(pending[2]!.signal.aborted).toBe(false);
    pending[2]!.resolve({ ...bindings, id: 'hold-a' }); expect((await fresh).id).toBe('hold-a');
  } finally { client.clear(); for (const item of pending) item.resolve(null); }

  let release!: (response: Response) => void, signal!: AbortSignal, cancelled = 0, delivered = 0, errors = 0;
  const late = createCalendarClient(async () => { throw new Error('No watch side reads.'); }, async (_path, init) => {
    signal = init.signal as AbortSignal; return new Promise<Response>(resolve => { release = resolve; });
  });
  const stop = late.participants.watchForAppointment(bindings.id, () => { delivered++; }, { onError() { errors++; } });
  try {
    late.clear(); expect(signal.aborted).toBe(true);
    release(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(frame(bindings)); }, cancel() { cancelled++; } }),
      { headers: { 'Content-Type': 'text/event-stream' } }));
    await settle(() => cancelled === 1); expect(delivered).toBe(0); expect(errors).toBe(0);
  } finally { stop(); late.clear(); }
});

test('participant watches enforce the fixed versioned snapshot envelope and terminally withdraw malformed or denied frames', async () => {
  for (const wire of [
    JSON.stringify({ version: 2, value: bindings }),
    JSON.stringify({ version: 1, value: bindings, actor: { userId: 'forged' } }),
    JSON.stringify({ version: 1, value: bindings, invalidated: 'yes' }),
    JSON.stringify({ version: 1, error: true }),
    '{not-json',
  ]) {
    let controller!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal, delivered = 0, errors = 0, cancelled = 0;
    const client = createCalendarClient(async () => { throw new Error('No watch side reads.'); }, async (_path, init) => {
      signal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }),
        { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const stop = client.participants.watchForAppointment(bindings.id, () => { delivered++; }, { onError() { errors++; } });
    try {
      controller.enqueue(new TextEncoder().encode('data: ' + wire + '\n\n'));
      await settle(() => signal.aborted && cancelled === 1);
      expect(delivered).toBe(0); expect(errors).toBe(1);
    } finally { stop(); client.clear(); }
  }
});

function frame(value: unknown): Uint8Array { return new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n'); }
async function settle(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic participant client fixture did not settle.');
}
