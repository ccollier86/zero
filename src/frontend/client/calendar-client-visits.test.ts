/** Strict visit transport and SSE fixtures stay entirely in memory. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';

const interval = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
const input = { ...interval, resourceIds: ['resource-a'], title: 'Synthetic visit' };
const location = { id: 'location-a', revision: 2, label: 'Retained label', region: 'US.NY', active: true };
const { active: _active, ...retainedLocation } = location;
const visit = { mode: 'in-person' as const, location: { id: location.id, revision: location.revision } };
const snapshot = { mode: 'in-person' as const, location: retainedLocation };
const page = { items: [location], truncated: false, nextAfter: null };
const appointment = { ...input, id: 'appointment-a', revision: 1, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'user-a' };
const hold = { ...interval, id: 'hold-a', revision: 1, resourceIds: input.resourceIds, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  status: 'held', createdBy: 'user-a', expiresAt: '2026-12-01T09:59:00.000Z', appointmentId: null };

test('visit commands preserve omitted wire shapes and detach explicit references, replacements and null clears', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init }); const body = init!.body as { options: { idempotencyKey: string } };
    return { requestId: body.options.idempotencyKey, operation: path.includes('reschedule') ? 'appointment.rescheduled' : path.endsWith('/holds') ? 'hold.acquired' : 'appointment.created',
      id: path.includes('reschedule') ? 'appointment-a' : 'generated', revision: 2, changed: true } as T;
  });
  try {
    await client.appointments.create(input, { idempotencyKey: 'plain' });
    expect(calls[0]!.init!.body).toEqual({ appointment: input, options: { idempotencyKey: 'plain' } });
    const reference = { mode: 'in-person' as const, location: { id: location.id, revision: 2 } };
    const creating = client.appointments.create({ ...input, visit: reference }, { idempotencyKey: 'visit' }); reference.location.revision = 99; await creating;
    expect(calls[1]!.init!.body).toMatchObject({ appointment: { visit } });
    await client.holds.acquire({ ...interval, resourceIds: input.resourceIds, visit: { mode: 'video' } }, { idempotencyKey: 'hold' });
    const reschedule = { ...interval, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await client.appointments.reschedule('appointment-a', reschedule, { idempotencyKey: 'preserve', expectedRevision: 1 });
    expect((calls[3]!.init!.body as { appointment: unknown }).appointment).toEqual(reschedule);
    await client.appointments.reschedule('appointment-a', { ...reschedule, visit: null }, { idempotencyKey: 'clear', expectedRevision: 2 });
    expect(calls[4]!.init!.body).toMatchObject({ appointment: { visit: null }, options: { expectedRevision: 2 } });
    await client.appointments.reschedule('appointment-a', { ...reschedule, visit: { mode: 'phone' } }, { idempotencyKey: 'replace', expectedRevision: 3 });
    expect(calls[5]!.init!.body).toMatchObject({ appointment: { visit: { mode: 'phone' } } });
  } finally { client.clear(); }
});

test('malformed visit authorship and non-explicit visit selection reject before dispatch without invoking accessors', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return {} as T; });
  try {
    const invalid = [null, undefined, {}, { mode: 'remote' }, { mode: 'in-person' }, { mode: 'video', location: null }, { mode: 'phone', location: undefined },
      { mode: 'video', url: 'https://private.invalid' }, { mode: 'in-person', location: { id: location.id, revision: 0 } },
      { mode: 'in-person', location: { ...retainedLocation } }, { get mode() { getters++; return 'video'; } },
      { mode: 'in-person', location: { id: location.id, get revision() { getters++; return 2; } } }];
    for (const value of invalid) {
      expect(() => client.appointments.create({ ...input, visit: value } as never, { idempotencyKey: 'invalid' })).toThrow();
      expect(() => client.holds.acquire({ ...interval, resourceIds: input.resourceIds, visit: value } as never, { idempotencyKey: 'invalid' })).toThrow();
    }
    for (const query of [undefined, {}, { resourceIds: undefined }, { resourceIds: ['a', 'a'] }, { resourceIds: ['bad/id'] }, { resourceIds: [], region: 'US.NY' }]) {
      expect(() => client.locations.forVisit(query as never)).toThrow();
    }
    expect(() => client.holds.confirm('hold-a', { title: 'Synthetic', visit: { mode: 'video' } } as never, { idempotencyKey: 'confirm', expectedRevision: 1 })).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('appointment and hold DTOs accept deeply frozen visit snapshots and reject references, provider fields and ambiguous modes', async () => {
  for (const target of ['appointment', 'hold'] as const) {
    const base = target === 'appointment' ? appointment : hold;
    for (const value of [snapshot, { mode: 'video' }, { mode: 'phone' }] as const) {
      const client = createCalendarClient(async <T>() => ({ ...base, visit: value }) as T);
      try {
        const result = target === 'appointment' ? await client.appointments.get('appointment-a') : await client.holds.get('hold-a');
        expect(result.visit).toEqual(value); expect(Object.isFrozen(result.visit)).toBe(true);
        if (result.visit!.mode === 'in-person') expect(Object.isFrozen(result.visit!.location)).toBe(true);
      } finally { client.clear(); }
    }
    for (const value of [null, undefined, {}, visit, { ...snapshot, location: { ...retainedLocation, active: true } },
      { ...snapshot, location: { ...retainedLocation, region: undefined } }, { ...snapshot, location: { ...retainedLocation, label: '' } },
      { mode: 'phone', location: retainedLocation }, { mode: 'video', providerUrl: 'https://private.invalid' }, { mode: 'virtual' }]) {
      const client = createCalendarClient(async <T>() => ({ ...base, visit: value }) as T);
      try { await expect(target === 'appointment' ? client.appointments.get('appointment-a') : client.holds.get('hold-a')).rejects.toThrow('Calendar data could not be loaded'); }
      finally { client.clear(); }
    }
    const client = createCalendarClient(async <T>() => base as T);
    try { expect(await (target === 'appointment' ? client.appointments.get('appointment-a') : client.holds.get('hold-a'))).not.toHaveProperty('visit'); }
    finally { client.clear(); }
  }
});

test('visit location selection is explicit, canonical, detached and correlated with active-only empty and paginated responses', async () => {
  const paths: string[] = [], client = createCalendarClient(async <T>(path: string) => { paths.push(path); return page as T; });
  try {
    const query = { resourceIds: ['resource-b', 'resource-a'], limit: 1 }, reading = client.locations.forVisit(query); query.resourceIds[0] = 'retargeted';
    expect(await reading).toEqual(page); expect(paths).toEqual(['/api/calendar/visit-locations?limit=1&resourceIds=resource-a%2Cresource-b']);
  } finally { client.clear(); }
  for (const [query, wire] of [[{ resourceIds: [] }, page], [{ resourceIds: ['resource-a'] }, { ...page, items: [{ ...location, active: false }] }],
    [{ resourceIds: ['resource-a'], after: 'z' }, page], [{ resourceIds: ['resource-a'], limit: 1 }, { ...page, nextAfter: 'wrong', truncated: true }],
    [{ resourceIds: [] }, { items: [], truncated: true, nextAfter: 'location-a' }]] as const) {
    const client = createCalendarClient(async <T>() => wire as T);
    try { await expect(client.locations.forVisit(query)).rejects.toThrow('Calendar data could not be loaded'); } finally { client.clear(); }
  }
  const empty = createCalendarClient(async <T>(path: string) => { expect(path).toBe('/api/calendar/visit-locations?resourceIds='); return { items: [], truncated: false, nextAfter: null } as T; });
  try { expect((await empty.locations.forVisit({ resourceIds: [] })).items).toEqual([]); } finally { empty.clear(); }
});

test('visit location watches enforce selected-page DTOs and terminally retire on denial or authority replacement', async () => {
  for (const terminal of ['denial', 'invalid', 'retired'] as const) {
    let controller!: ReadableStreamDefaultController<Uint8Array>, signal!: AbortSignal, path = '', delivered = 0, errors = 0;
    const client = createCalendarClient(async () => { throw new Error('No watch fetch.'); }, async (target, init) => {
      path = target; signal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const query = { resourceIds: ['resource-a'] }, stop = client.locations.watchForVisit(query, () => { delivered++; }, { onError() { errors++; } }); query.resourceIds[0] = 'retargeted';
    try {
      expect(path).toBe('/api/calendar/visit-locations/live?resourceIds=resource-a'); controller.enqueue(frame(page)); await settle(() => delivered === 1);
      if (terminal === 'retired') client.clear();
      else if (terminal === 'denial') controller.enqueue(new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n'));
      else controller.enqueue(frame({ ...page, items: [{ ...location, active: false }] }));
      await settle(() => signal.aborted); expect(delivered).toBe(1); expect(errors).toBe(terminal === 'retired' ? 0 : 1);
    } finally { stop(); client.clear(); }
  }
});

test('visit conflicts and stale references retain safe domain codes and the original idempotency identity', async () => {
  for (const code of ['CALENDAR_VISIT_CONFLICT', 'CALENDAR_VISIT_STALE']) {
    const client = createCalendarClient(async () => { throw { status: 409, body: { code, outcome: 'not-committed', message: 'NEVER_RENDER_PRIVATE' } }; });
    try { await expect(client.appointments.create({ ...input, visit }, { idempotencyKey: 'original' })).rejects.toMatchObject({ code, outcome: 'not-committed', idempotencyKey: 'original', requiresReconciliation: false }); }
    finally { client.clear(); }
  }
});
function frame(value: unknown): Uint8Array { return new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n'); }
async function settle(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) { if (check()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
  throw new Error('Synthetic visit client fixture did not settle.');
}
