/** Guardian/service/runtime/realm integration with native memory handles closed in finally. */
import { expect, test } from 'bun:test';
import type { CalendarCommandReceipt, CalendarLocationPage } from './contracts';
import { CalendarService, type CalendarServiceBroker } from './service';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const interval = { startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
test('visit locations require explicit book/manage authorization for every resource and return only common active assignments', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  try {
    const common = await manager.api.locations.create({ label: 'Common', region: 'US.NY' }, { idempotencyKey: 'common' });
    const exclusive = await manager.api.locations.create({ label: 'Only one resource' }, { idempotencyKey: 'exclusive' });
    const person = await owner.api.resources.create({ label: 'Owned person', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'person' });
    const room = await manager.api.resources.create({ label: 'Room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'room' });
    await manager.api.resources.setLocations(person.id, [common.id, exclusive.id], { idempotencyKey: 'person-locations', expectedRevision: 1 });
    await manager.api.resources.setLocations(room.id, [common.id], { idempotencyKey: 'room-locations', expectedRevision: 1 });
    for (const api of [manager.api, owner.api, reader.api]) expect(await api.locations.forVisit({ resourceIds: [] })).toEqual({ items: [], truncated: false, nextAfter: null });
    await expect(manager.api.locations.forVisit({} as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(reader.api.locations.forVisit({ resourceIds: [person.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await owner.api.resources.setGrants(person.id, reader.userId, ['busy', 'details'], { idempotencyKey: 'details', expectedRevision: 2 });
    await expect(reader.api.locations.forVisit({ resourceIds: [person.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await owner.api.resources.setGrants(person.id, reader.userId, ['book'], { idempotencyKey: 'book', expectedRevision: 3 });
    expect((await reader.api.locations.forVisit({ resourceIds: [person.id] })).items.map(item => item.id)).toEqual([common.id, exclusive.id].sort());
    await expect(reader.api.locations.forVisit({ resourceIds: [person.id, room.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await manager.api.resources.setGrants(room.id, reader.userId, ['book'], { idempotencyKey: 'room-book', expectedRevision: 2 });
    expect((await reader.api.locations.forVisit({ resourceIds: [person.id, room.id] })).items.map(item => item.id)).toEqual([common.id]);
    // Catalog management is not an assignment override.
    expect((await manager.api.locations.forVisit({ resourceIds: [person.id, room.id] })).items.map(item => item.id)).toEqual([common.id]);
    await manager.api.locations.replace(common.id, { label: 'Retired', region: null, active: false }, { idempotencyKey: 'retire', expectedRevision: 1 });
    expect((await reader.api.locations.forVisit({ resourceIds: [person.id, room.id] })).items).toEqual([]);
    const other = f.session('manager', { manager: true, tenantId: 'other' });
    await expect(other.api.locations.forVisit({ resourceIds: [person.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
  } finally { await f.close(); }
}, 30_000);

test('visits survive facade create/hold/confirmation/reschedule without inferred modes or authored confirmation changes', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true });
  try {
    const location = await manager.api.locations.create({ label: 'Retained visit', region: 'US.NY' }, { idempotencyKey: 'location' });
    const resource = await manager.api.resources.create({ label: 'Resource', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assignment', expectedRevision: 1 });
    const visit = { mode: 'in-person' as const, location: { id: location.id, revision: 1 } }, resourceIds = [resource.id];
    const made = await manager.api.appointments.create({ ...interval, resourceIds, title: 'Visit', visit }, { idempotencyKey: 'appointment' });
    const expected = { ...visit, location: { ...visit.location, label: 'Retained visit', region: 'US.NY' } };
    expect((await manager.api.appointments.get(made.id)).visit).toEqual(expected);
    const moved = { startAt: '2026-12-01T11:00:00.000Z', endAt: '2026-12-01T11:30:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await manager.api.appointments.reschedule(made.id, moved, { idempotencyKey: 'move', expectedRevision: 1 });
    expect((await manager.api.appointments.get(made.id)).visit).toEqual(expected);
    await manager.api.appointments.reschedule(made.id, { ...moved, visit: null }, { idempotencyKey: 'clear', expectedRevision: 2 });
    expect(await manager.api.appointments.get(made.id)).not.toHaveProperty('visit');
    await manager.api.appointments.reschedule(made.id, { ...moved, visit: { mode: 'video' } }, { idempotencyKey: 'video', expectedRevision: 3 });
    expect((await manager.api.appointments.get(made.id)).visit).toEqual({ mode: 'video' });
    const held = await manager.api.holds.acquire({ ...interval, resourceIds, visit, ttlSeconds: 30 }, { idempotencyKey: 'hold' });
    expect((await manager.api.holds.get(held.id)).visit).toEqual(expected);
    await expect(manager.api.holds.confirm(held.id, { title: 'Confirmed', visit: { mode: 'phone' } } as never, { idempotencyKey: 'invalid-confirm', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    const confirmed = await manager.api.holds.confirm(held.id, { title: 'Confirmed' }, { idempotencyKey: 'confirm', expectedRevision: 1 });
    expect((await manager.api.appointments.get(confirmed.id)).visit).toEqual(expected);
  } finally { await f.close(); }
}, 30_000);

test('visit references and selection detach before admission; malformed authored states never reach the broker', async () => {
  const f = memoryCalendarServiceFixture(), session = f.session('manager', { manager: true });
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const broker: CalendarServiceBroker = {
    async read<T>(...args: Parameters<CalendarServiceBroker['read']>): Promise<T> { calls.push({ name: args[1], body: args[2] as Record<string, unknown> }); return {} as T; },
    async write<T>(...args: Parameters<CalendarServiceBroker['write']>): Promise<T> {
      const [, name, input, key] = args, body = input as Record<string, unknown>; calls.push({ name, body });
      return { requestId: key, operation: name === 'calendar.hold.acquire' ? 'hold.acquired' : name === 'calendar.appointment.reschedule' ? 'appointment.rescheduled' : 'appointment.created', id: body.id, revision: 1, changed: true } as CalendarCommandReceipt as T;
    },
  };
  const service = new CalendarService(broker, f.config, new AbortController().signal), api = service.forAuthority({ ...session.authority,
    async assertCurrentAuthority() { entered(); await gate; session.authority.assertCurrentAuthoritySync(); } });
  try {
    const reference = { mode: 'in-person' as const, location: { id: 'location-a', revision: 2 } }, query = { resourceIds: ['resource-b', 'resource-a'], limit: 2 };
    const booking = api.appointments.create({ ...interval, resourceIds: ['resource-a'], title: 'Visit', visit: reference }, { idempotencyKey: 'booking' });
    const holding = api.holds.acquire({ ...interval, resourceIds: ['resource-a'], visit: reference }, { idempotencyKey: 'holding' });
    const reading = api.locations.forVisit(query); await ready; reference.location.revision = 99; query.resourceIds[0] = 'retargeted'; release();
    await Promise.all([booking, holding, reading]);
    expect(calls.find(call => call.name === 'calendar.visitLocations')!.body).toMatchObject({ resourceIds: ['resource-a', 'resource-b'], limit: 2 });
    for (const name of ['calendar.appointment.create', 'calendar.hold.acquire']) expect(calls.find(call => call.name === name)!.body).toMatchObject({ visit: { mode: 'in-person', location: { id: 'location-a', revision: 2 } } });
    const count = calls.length;
    for (const visit of [null, {}, { mode: 'remote' }, { mode: 'video', location: null }, { mode: 'in-person', location: { id: 'location-a', revision: 0 } }, { mode: 'in-person', location: { id: 'location-a', revision: 2, label: 'Authored' } }]) {
      await expect(api.appointments.create({ ...interval, resourceIds: ['resource-a'], title: 'Visit', visit } as never, { idempotencyKey: 'invalid' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    await expect(api.locations.forVisit({} as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(api.locations.forVisit({ resourceIds: ['same', 'same'] })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(calls).toHaveLength(count);
  } finally { release(); await service.close(); await f.close(); }
}, 30_000);

test('visit location watches detach selected routing and terminally withdraw on any book permission loss', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  const pages: CalendarLocationPage[] = [], errors: unknown[] = []; let stop = () => {};
  try {
    const location = await manager.api.locations.create({ label: 'Private selection' }, { idempotencyKey: 'location' });
    const resource = await owner.api.resources.create({ label: 'Resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assignment', expectedRevision: 1 });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['book'], { idempotencyKey: 'book', expectedRevision: 2 });
    const query = { resourceIds: [resource.id] }; stop = reader.api.locations.watchForVisit(query, page => pages.push(page), { onError: error => errors.push(error) }); query.resourceIds[0] = 'retargeted';
    await eventuallyCalendar(() => pages.length === 1); expect(pages[0]!.items[0]!.id).toBe(location.id);
    await owner.api.resources.setGrants(resource.id, reader.userId, ['details'], { idempotencyKey: 'revoke-book', expectedRevision: 3 });
    await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0);
    expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' }); expect(pages).toHaveLength(1);
  } finally { stop(); await f.close(); }
}, 30_000);
