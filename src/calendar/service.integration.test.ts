/** Real canonical facade + Guardian + runtime + native memory realm. Not file, actor or installed-package qualification. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { CalendarAppointmentInput, CalendarAppointmentPage, CalendarRescheduleInput, CalendarWatchUpdate } from './contracts';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const range = { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
const appointment = (resourceIds: readonly string[], overrides: Partial<CalendarAppointmentInput> = {}): CalendarAppointmentInput => ({
  resourceIds, title: 'PRIVATE_INTEGRATION_TITLE', startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z',
  timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, ...overrides,
});
const move: CalendarRescheduleInput = { startAt: '2026-11-16T13:00:00.000Z', endAt: '2026-11-16T14:00:00.000Z',
  timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
const rejected = async (run: () => unknown, code: string) => {
  await expect(Promise.resolve().then(run)).rejects.toMatchObject({ code });
};

test('actual facade reads never provision an empty scope and denied first commands allocate no memory plane', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    expect(await owner.api.resources.list()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(await owner.api.busy.query({ resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    expect(await owner.api.appointments.query({ resourceIds: [], ...range })).toEqual({ items: [], truncated: false });
    expect(await owner.api.receipts.get('never-accepted')).toBeNull();
    await rejected(() => owner.api.appointments.get('missing'), 'CALENDAR_NOT_FOUND');
    await rejected(() => owner.api.appointments.create(appointment(['missing']), { idempotencyKey: 'rejected-booking' }), 'CALENDAR_NOT_FOUND');
    await rejected(() => owner.api.resources.create({ label: 'Unadmitted room', kind: 'room', timeZone: 'UTC' },
      { idempotencyKey: 'rejected-room' }), 'CALENDAR_FORBIDDEN');
    expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0, releases: 0, activeLeases: 0 });
  } finally { await f.close(); }
});

for (const tenancy of ['single', 'multi'] as const) {
  test(`canonical calendar namespaces complete the actual resource/grant/booking lifecycle (${tenancy})`, async () => {
    const f = memoryCalendarServiceFixture({ tenancy }), owner = f.session('owner'), reader = f.session('reader');
    try {
      const resourceInput = { label: 'Synthetic owner calendar', kind: 'person' as const, timeZone: 'UTC' };
      const resource = await owner.api.resources.create(resourceInput, { idempotencyKey: 'create-resource' });
      expect(resource).toMatchObject({ operation: 'resource.created', changed: true, revision: 1 });
      expect(await owner.api.resources.create(resourceInput, { idempotencyKey: 'create-resource' })).toEqual(resource);
      expect((await owner.api.resources.list()).items).toMatchObject([{ id: resource.id, ownerId: owner.userId, revision: 1 }]);
      expect((await reader.api.resources.list()).items).toEqual([]);

      const input = appointment([resource.id], { bufferBeforeMinutes: 5, bufferAfterMinutes: 15 });
      const created = await owner.api.appointments.create(input, { idempotencyKey: 'create-appointment' });
      expect(created).toMatchObject({ operation: 'appointment.created', changed: true, revision: 1 });
      expect(await owner.api.appointments.create(input, { idempotencyKey: 'create-appointment' })).toEqual(created);
      expect(await owner.api.receipts.get('create-appointment')).toEqual(created);
      expect(JSON.stringify(created)).not.toContain('PRIVATE_INTEGRATION_TITLE');
      expect((await owner.api.appointments.get(created.id)).title).toBe(input.title);
      expect((await owner.api.appointments.query({ resourceIds: [resource.id], ...range })).items.map(item => item.id)).toEqual([created.id]);

      const busyGrant = await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'],
        { idempotencyKey: 'grant-busy', expectedRevision: 1 });
      expect(busyGrant.revision).toBe(2);
      expect(await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'],
        { idempotencyKey: 'grant-busy', expectedRevision: 1 })).toEqual(busyGrant);
      expect((await reader.api.resources.list()).items.map(item => item.id)).toEqual([resource.id]);
      const busy = await reader.api.busy.query({ resourceIds: [resource.id], ...range });
      expect(busy.items).toEqual([{ resourceId: resource.id, startAt: '2026-11-16T09:55:00.000Z', endAt: '2026-11-16T11:15:00.000Z' }]);
      expect(Object.keys(busy.items[0]!).sort()).toEqual(['endAt', 'resourceId', 'startAt']);
      expect(JSON.stringify(busy)).not.toContain(created.id); expect(JSON.stringify(busy)).not.toContain(input.title);
      await rejected(() => reader.api.appointments.get(created.id), 'CALENDAR_NOT_FOUND');
      await rejected(() => reader.api.appointments.query({ resourceIds: [resource.id], ...range }), 'CALENDAR_NOT_FOUND');
      await rejected(() => reader.api.appointments.create(appointment([resource.id], { startAt: '2026-11-16T12:00:00.000Z',
        endAt: '2026-11-16T13:00:00.000Z' }), { idempotencyKey: 'reader-denied' }), 'CALENDAR_NOT_FOUND');

      await owner.api.resources.setGrants(resource.id, reader.userId, ['details', 'book'],
        { idempotencyKey: 'grant-details-book', expectedRevision: 2 });
      expect((await reader.api.appointments.get(created.id)).title).toBe(input.title);
      const delegated = await reader.api.appointments.create(appointment([resource.id], { startAt: '2026-11-16T12:00:00.000Z',
        endAt: '2026-11-16T13:00:00.000Z' }), { idempotencyKey: 'delegated-booking' });
      expect(await reader.api.receipts.get('delegated-booking')).toEqual(delegated);
      expect(await owner.api.receipts.get('delegated-booking')).toBeNull();
      await rejected(() => reader.api.appointments.cancel(created.id, { idempotencyKey: 'denied-cancel', expectedRevision: 1 }), 'CALENDAR_NOT_FOUND');

      const moved = await owner.api.appointments.reschedule(created.id, move, { idempotencyKey: 'move', expectedRevision: 1 });
      expect(moved).toMatchObject({ operation: 'appointment.rescheduled', revision: 2, changed: true });
      expect((await owner.api.appointments.get(created.id)).startAt).toBe(move.startAt);
      expect(await owner.api.appointments.reschedule(created.id, move, { idempotencyKey: 'move', expectedRevision: 1 })).toEqual(moved);
      const cancelled = await owner.api.appointments.cancel(created.id, { idempotencyKey: 'cancel', expectedRevision: 2 });
      expect(cancelled).toMatchObject({ operation: 'appointment.cancelled', revision: 3, changed: true });
      expect(await owner.api.appointments.cancel(created.id, { idempotencyKey: 'cancel', expectedRevision: 2 })).toEqual(cancelled);
      expect(await owner.api.receipts.get('cancel')).toEqual(cancelled);
      expect((await owner.api.appointments.get(created.id)).status).toBe('cancelled');
      expect((await owner.api.appointments.query({ resourceIds: [resource.id], ...range })).items.map(item => item.id)).toEqual([delegated.id]);
      expect((await owner.api.busy.query({ resourceIds: [resource.id], ...range })).items).toEqual([
        { resourceId: resource.id, startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' },
      ]);
      expect(await owner.api.appointments.cancel(created.id, { idempotencyKey: 'cancel-noop', expectedRevision: 3 }))
        .toMatchObject({ changed: false, revision: 3 });
      expect(f.stats()).toMatchObject({ planes: 1, ownerRows: 1, activeLeases: 0 });
      expect(f.stats().acquisitions).toBe(f.stats().releases);
    } finally { await f.close(); }
  });
}

test('actual scopes isolate private realms and stale/forged authority cannot retarget the facade', async () => {
  const f = memoryCalendarServiceFixture(), alpha = f.session('owner', { tenantId: 'alpha' }), beta = f.session('owner', { tenantId: 'beta' });
  try {
    const input = { label: 'Scoped owner calendar', kind: 'person' as const, timeZone: 'UTC' };
    const a = await alpha.api.resources.create(input, { idempotencyKey: 'same-key' });
    const b = await beta.api.resources.create(input, { idempotencyKey: 'same-key' });
    expect(a.id).not.toBe(b.id);
    const booked = await alpha.api.appointments.create(appointment([a.id]), { idempotencyKey: 'private-alpha' });
    expect((await beta.api.resources.list()).items.map(item => item.id)).toEqual([b.id]);
    await rejected(() => beta.api.appointments.get(booked.id), 'CALENDAR_NOT_FOUND');
    await rejected(() => beta.api.busy.query({ resourceIds: [a.id], ...range }), 'CALENDAR_NOT_FOUND');
    expect(await beta.api.receipts.get('private-alpha')).toBeNull();
    const forged = f.service.forAuthority({ ...alpha.authority, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'beta' }) });
    const before = f.stats().acquisitions;
    await rejected(() => forged.resources.list(), 'CALENDAR_FORBIDDEN');
    expect(f.stats().acquisitions).toBe(before);
    alpha.replaceScope('beta');
    await rejected(() => alpha.api.resources.list(), 'AUTH_STATE_CHANGED');
    expect((await beta.api.resources.list()).items.map(item => item.id)).toEqual([b.id]);
    beta.revoke(); await rejected(() => beta.api.appointments.query({ resourceIds: [b.id], ...range }), 'AUTH_STATE_CHANGED');
    expect(f.stats()).toMatchObject({ planes: 2, ownerRows: 2, activeLeases: 0 });
  } finally { await f.close(); }
});

test('real transaction conflicts and revision errors leave no accepted receipt and preserve the original booking', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  try {
    const resource = await owner.api.resources.create({ label: 'Owner', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const created = await owner.api.appointments.create(appointment([resource.id]), { idempotencyKey: 'booked' });
    await rejected(() => owner.api.appointments.create(appointment([resource.id]), { idempotencyKey: 'competing' }), 'CALENDAR_BOOKING_CONFLICT');
    expect(await owner.api.receipts.get('competing')).toBeNull();
    await rejected(() => owner.api.appointments.create(appointment([resource.id], { title: 'Changed command' }), { idempotencyKey: 'booked' }), 'CALENDAR_INTENT_CONFLICT');
    await rejected(() => owner.api.appointments.reschedule(created.id, move, { idempotencyKey: 'stale-move', expectedRevision: 99 }), 'CALENDAR_REVISION_CONFLICT');
    expect(await owner.api.receipts.get('stale-move')).toBeNull();
    expect((await owner.api.appointments.get(created.id))).toMatchObject({ revision: 1, startAt: '2026-11-16T10:00:00.000Z', title: 'PRIVATE_INTEGRATION_TITLE' });
    expect((await owner.api.appointments.query({ resourceIds: [resource.id], ...range })).items).toHaveLength(1);
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('Guardian management admits shared resources while real multi-resource conflicts and detail grants stay atomic', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), viewer = f.session('viewer');
  try {
    const person = await owner.api.resources.create({ label: 'Person', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'person' });
    const room = await manager.api.resources.create({ label: 'Shared room', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'room' });
    expect((await manager.api.resources.list()).items).toHaveLength(2);
    const input = appointment([person.id, room.id]);
    await rejected(() => owner.api.appointments.create(input, { idempotencyKey: 'no-room-grant' }), 'CALENDAR_NOT_FOUND');
    await manager.api.resources.setGrants(room.id, owner.userId, ['book', 'details', 'manage'], { idempotencyKey: 'grant-room', expectedRevision: 1 });
    const booked = await owner.api.appointments.create(input, { idempotencyKey: 'dual-resource' });
    expect((await owner.api.busy.query({ resourceIds: [person.id, room.id], ...range })).items).toHaveLength(2);
    expect((await owner.api.appointments.get(booked.id)).resourceIds).toEqual([person.id, room.id].sort());
    await rejected(() => owner.api.appointments.create(appointment([room.id]), { idempotencyKey: 'room-conflict' }), 'CALENDAR_BOOKING_CONFLICT');
    expect(await owner.api.receipts.get('room-conflict')).toBeNull();

    await owner.api.resources.setGrants(person.id, viewer.userId, ['details'], { idempotencyKey: 'view-person', expectedRevision: 1 });
    // Unselected co-resource permission is checked BEFORE query limit/truncation; a selected person grant is not enough.
    expect(await viewer.api.appointments.query({ resourceIds: [person.id], ...range, limit: 1 })).toEqual({ items: [], truncated: false });
    await rejected(() => viewer.api.appointments.get(booked.id), 'CALENDAR_NOT_FOUND');
    await manager.api.resources.setGrants(room.id, viewer.userId, ['details'], { idempotencyKey: 'view-room', expectedRevision: 2 });
    expect((await viewer.api.appointments.query({ resourceIds: [person.id], ...range, limit: 1 })).items.map(item => item.id)).toEqual([booked.id]);

    await owner.api.appointments.reschedule(booked.id, move, { idempotencyKey: 'move-dual', expectedRevision: 1 });
    expect((await owner.api.busy.query({ resourceIds: [person.id, room.id], ...range })).items.every(item => item.startAt === move.startAt)).toBe(true);
    await owner.api.appointments.cancel(booked.id, { idempotencyKey: 'cancel-dual', expectedRevision: 2 });
    expect((await owner.api.busy.query({ resourceIds: [person.id, room.id], ...range })).items).toEqual([]);
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('configured page/range/selection and retained-scope ceilings are enforced by the real facade and broker', async () => {
  const f = memoryCalendarServiceFixture({ config: { maxPageSize: 1, maxRangeDays: 1, maxResources: 1, maxActiveDatabases: 1, maxDatabaseFiles: 1 } });
  const owner = f.session('owner');
  try {
    const first = await owner.api.resources.create({ label: 'First', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'first' });
    const second = await owner.api.resources.create({ label: 'Second', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'second' });
    const page = await owner.api.resources.list();
    expect(page.items).toHaveLength(1); expect(page.truncated).toBe(true); expect(page.nextAfter).toBe(page.items[0]!.id);
    const next = await owner.api.resources.list({ after: page.nextAfter! });
    expect(next.items).toHaveLength(1); expect(next.truncated).toBe(false);
    expect(new Set([page.items[0]!.id, next.items[0]!.id])).toEqual(new Set([first.id, second.id]));
    await owner.api.appointments.create(appointment([first.id]), { idempotencyKey: 'appointment-one' });
    await owner.api.appointments.create(appointment([first.id], { startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z' }), { idempotencyKey: 'appointment-two' });
    expect(await owner.api.appointments.query({ resourceIds: [first.id], ...range })).toMatchObject({ truncated: true });
    expect((await owner.api.appointments.query({ resourceIds: [first.id], ...range })).items).toHaveLength(1);
    expect((await owner.api.busy.query({ resourceIds: [first.id], ...range })).items).toHaveLength(1);
    await rejected(() => owner.api.resources.list({ limit: 2 }), 'CALENDAR_INPUT_INVALID');
    for (const api of [owner.api.appointments, owner.api.busy]) {
      await rejected(() => api.query({ resourceIds: [first.id], ...range, limit: 2 }), 'CALENDAR_INPUT_INVALID');
      await rejected(() => api.query({ resourceIds: [first.id, second.id], ...range }), 'CALENDAR_INPUT_INVALID');
      await rejected(() => api.query({ resourceIds: [first.id], ...range, endAt: '2026-11-18T00:00:00.000Z' }), 'CALENDAR_INPUT_INVALID');
    }
    await rejected(() => owner.api.appointments.create(appointment([first.id, second.id]), { idempotencyKey: 'too-many-resources' }), 'CALENDAR_INPUT_INVALID');
    const other = f.session('other', { tenantId: 'tenant-b' });
    await rejected(() => other.api.resources.create({ label: 'Other scope', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'over-file-limit' }), 'CALENDAR_CAPACITY');
    expect(f.stats()).toMatchObject({ planes: 1, ownerRows: 1, activeLeases: 0 });
  } finally { await f.close(); }
});

test('real committed create/reschedule/cancel updates a watch while exact replay adds no hint', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner');
  let stop = () => {};
  try {
    const resource = await owner.api.resources.create({ label: 'Watched', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const pages: CalendarAppointmentPage[] = [], updates: (CalendarWatchUpdate | undefined)[] = [], errors: unknown[] = [];
    stop = owner.api.appointments.watch({ resourceIds: [resource.id], ...range }, (page, update) => { pages.push(page); updates.push(update); }, { onError: error => errors.push(error) });
    await eventuallyCalendar(() => pages.length === 1);
    expect(pages[0]!.items).toEqual([]); expect(updates[0]!.invalidated).toBe(false);
    const input = appointment([resource.id]);
    const created = await owner.api.appointments.create(input, { idempotencyKey: 'create' });
    await eventuallyCalendar(() => pages.length === 2);
    expect(pages[1]!.items[0]!.id).toBe(created.id); expect(updates[1]!.invalidated).toBe(true);
    await owner.api.appointments.create(input, { idempotencyKey: 'create' });
    expect(pages).toHaveLength(2);
    await owner.api.appointments.reschedule(created.id, move, { idempotencyKey: 'move', expectedRevision: 1 });
    await eventuallyCalendar(() => pages.length === 3);
    expect(pages[2]!.items[0]!).toMatchObject({ revision: 2, startAt: move.startAt });
    await owner.api.appointments.cancel(created.id, { idempotencyKey: 'cancel', expectedRevision: 2 });
    await eventuallyCalendar(() => pages.length === 4);
    expect(pages[3]!.items).toEqual([]); expect(errors).toEqual([]);
    stop(); expect(f.stats().subscriptions).toBe(0);
  } finally { stop(); await f.close(); }
});

test('an unchanged watch revalidates quietly and a real grant revocation retires its private snapshot', async () => {
  const f = memoryCalendarServiceFixture(), owner = f.session('owner'), reader = f.session('reader');
  let stop = () => {};
  try {
    const resource = await owner.api.resources.create({ label: 'Private watched resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const created = await owner.api.appointments.create(appointment([resource.id]), { idempotencyKey: 'appointment' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['details'], { idempotencyKey: 'grant-details', expectedRevision: 1 });
    const pages: CalendarAppointmentPage[] = [], errors: unknown[] = [];
    stop = reader.api.appointments.watch({ resourceIds: [resource.id], ...range }, page => pages.push(page), { onError: error => errors.push(error) });
    await eventuallyCalendar(() => pages.length === 1);
    const initialReads = f.stats().appointmentQueries;
    expect(pages[0]!.items[0]!.id).toBe(created.id);
    // This waits for one REAL bounded 5s authority/domain revalidation, not a fake-timer or broker-spy event.
    await eventuallyCalendar(() => f.stats().appointmentQueries > initialReads, 7_000);
    expect(pages).toHaveLength(1); expect(errors).toEqual([]);
    await owner.api.resources.setGrants(resource.id, reader.userId, [], { idempotencyKey: 'revoke-details', expectedRevision: 2 });
    await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0);
    expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(pages).toHaveLength(1);
    await rejected(() => reader.api.appointments.get(created.id), 'CALENDAR_NOT_FOUND');
    expect((await owner.api.appointments.get(created.id)).title).toBe('PRIVATE_INTEGRATION_TITLE');
  } finally { stop(); await f.close(); }
}, 15_000);
