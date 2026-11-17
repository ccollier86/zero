/** Real Guardian/service/runtime/realm, native memory only; no actors, listener or physical fixture. */
import { expect, test } from 'bun:test';
import type { CalendarAppointmentTypePage, CalendarCommandReceipt, CalendarResourceTypesView } from './contracts';
import { CalendarService, type CalendarServiceBroker } from './service';
import { calendarHash } from './validation';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test('appointment types provision only by managers, round-trip explicit replacements and revision-controlled resource policies', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner');
  try {
    expect(await manager.api.types.list()).toEqual({ items: [], truncated: false, nextAfter: null });
    await expect(owner.api.types.create({ label: 'Denied', durationMinutes: 30 }, { idempotencyKey: 'denied' })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.stats().planes).toBe(0);
    const created = await manager.api.types.create({ label: 'Initial', durationMinutes: 30 }, { idempotencyKey: 'type' });
    expect(created).toMatchObject({ operation: 'type.created', revision: 1, changed: true });
    expect(await manager.api.types.get(created.id)).toEqual({ id: created.id, revision: 1, label: 'Initial', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true });
    expect(await manager.api.types.create({ label: 'Initial', durationMinutes: 30 }, { idempotencyKey: 'type' })).toEqual(created);
    const resource = await owner.api.resources.create({ label: 'Owned person', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    expect(await owner.api.types.forResource(resource.id)).toEqual({ resourceId: resource.id, resourceRevision: 1, mode: 'unrestricted', typeIds: [] });
    await expect(owner.api.resources.setAppointmentTypes(resource.id, { mode: 'required', typeIds: [created.id] }, { idempotencyKey: 'denied-policy', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    const assigned = await manager.api.resources.setAppointmentTypes(resource.id, { mode: 'required', typeIds: [created.id] }, { idempotencyKey: 'policy', expectedRevision: 1 });
    expect(assigned).toMatchObject({ operation: 'resource.types-changed', id: resource.id, revision: 2 });
    expect(await owner.api.types.forResource(resource.id)).toEqual({ resourceId: resource.id, resourceRevision: 2, mode: 'required', typeIds: [created.id] });
    const replacement = { label: 'Retired', durationMinutes: 45, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'visit.blue', active: false };
    const updated = await manager.api.types.replace(created.id, replacement, { idempotencyKey: 'replace', expectedRevision: 1 });
    expect(updated).toMatchObject({ operation: 'type.updated', revision: 2 });
    expect(await manager.api.types.get(created.id)).toEqual({ ...replacement, id: created.id, revision: 2 });
    expect((await manager.api.types.list()).items).toHaveLength(1);
    expect((await owner.api.types.list({ resourceIds: [resource.id] })).items).toEqual([]);
    expect(await manager.api.receipts.get('replace')).toEqual(updated);
    await expect(manager.api.types.replace(created.id, replacement, { idempotencyKey: 'stale', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect((await manager.api.types.replace(created.id, replacement, { idempotencyKey: 'same', expectedRevision: 2 })).changed).toBe(false);
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('selectors require book or details on every resource, omission and explicit empty never grant discovery', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  try {
    const type = await manager.api.types.create({ label: 'Private catalog', durationMinutes: 30 }, { idempotencyKey: 'type' });
    const resource = await owner.api.resources.create({ label: 'Owned', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    expect((await owner.api.types.list()).items).toEqual([]); expect((await manager.api.types.list({ resourceIds: [] })).items).toEqual([]);
    await expect(reader.api.types.list({ resourceIds: [resource.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 1 });
    await expect(reader.api.types.list({ resourceIds: [resource.id] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(reader.api.types.forResource(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['book'], { idempotencyKey: 'book', expectedRevision: 2 });
    expect((await reader.api.types.list({ resourceIds: [resource.id] })).items.map(item => item.id)).toEqual([type.id]);
    await expect(reader.api.types.get(type.id)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(reader.api.types.list({ resourceIds: [resource.id, 'hidden'] })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const other = f.session('manager', { manager: true, tenantId: 'other' });
    expect((await other.api.types.list()).items).toEqual([]); await expect(other.api.types.get(type.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await other.api.receipts.get('type')).toBeNull();
  } finally { await f.close(); }
});

test('new service fields detach before admission await; malformed keys/replacements/refs never dispatch', async () => {
  const f = memoryCalendarServiceFixture(), session = f.session('manager', { manager: true });
  const calls: { name: string; body: Record<string, unknown> }[] = [], operations: Record<string, CalendarCommandReceipt['operation']> = {
    'calendar.type.create': 'type.created', 'calendar.type.replace': 'type.updated', 'calendar.resource.types': 'resource.types-changed', 'calendar.appointment.create': 'appointment.created' };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const broker: CalendarServiceBroker = {
    async read<T>(...args: Parameters<CalendarServiceBroker['read']>): Promise<T> {
      const [, name, input] = args; calls.push({ name, body: input as Record<string, unknown> }); return {} as T; },
    async write<T>(...args: Parameters<CalendarServiceBroker['write']>): Promise<T> {
      const [, name, input, key] = args, body = input as Record<string, unknown>; calls.push({ name, body });
      return { requestId: key, operation: operations[name], id: body.id, revision: 1, changed: true } as T; },
  };
  const service = new CalendarService(broker, f.config, new AbortController().signal), api = service.forAuthority({ ...session.authority,
    async assertCurrentAuthority() { entered(); await gate; session.authority.assertCurrentAuthoritySync(); } });
  try {
    const type = { label: 'Original', durationMinutes: 30 }, options = { idempotencyKey: 'original' }, query = { resourceIds: ['resource-b', 'resource-a'], limit: 2 };
    const policy = { mode: 'required' as const, typeIds: ['type-b', 'type-a'] }, ref = { id: 'type-a', revision: 2 };
    const creating = api.types.create(type, options), reading = api.types.list(query), setting = api.resources.setAppointmentTypes('resource-a', policy, { idempotencyKey: 'policy', expectedRevision: 1 });
    const booking = api.appointments.create({ resourceIds: ['resource-a'], title: 'Booking', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC', appointmentType: ref }, { idempotencyKey: 'booking' });
    await ready; type.label = 'Changed'; options.idempotencyKey = 'changed'; query.resourceIds[0] = 'changed'; policy.typeIds[0] = 'changed'; ref.revision = 99; release();
    const result = await creating; await Promise.all([reading, setting, booking]);
    expect(calls.find(call => call.name === 'calendar.types')!.body).toMatchObject({ resourceIds: ['resource-a', 'resource-b'], limit: 2 });
    expect(calls.find(call => call.name === 'calendar.resource.types')!.body).toMatchObject({ typeIds: ['type-a', 'type-b'], expectedRevision: 1 });
    const create = calls.find(call => call.name === 'calendar.type.create')!.body, actor = create.actor as { scopeId: string; principal: string };
    expect(create).toMatchObject({ label: 'Original', durationMinutes: 30, requestId: 'original' });
    expect(create).not.toHaveProperty('active'); expect(result.id).toBe(calendarHash([actor.scopeId, actor.principal, 'original']));
    expect(calls.find(call => call.name === 'calendar.appointment.create')!.body).toMatchObject({ appointmentType: { id: 'type-a', revision: 2 } });
    const count = calls.length;
    for (const value of [{ label: 'Visit', durationMinutes: 0 }, { label: 'Visit', durationMinutes: 30, actor: {} }, { label: 'Visit', durationMinutes: 30, colorKey: 'bad color' }]) {
      await expect(api.types.create(value as never, { idempotencyKey: 'invalid' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    await expect(api.types.replace('type-a', { label: 'Missing', durationMinutes: 30 } as never, { idempotencyKey: 'invalid', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(api.types.list({ resourceIds: ['same', 'same'] })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(api.resources.setAppointmentTypes('resource-a', { mode: 'unrestricted', typeIds: ['type-a'] }, { idempotencyKey: 'invalid', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(calls).toHaveLength(count);
  } finally { release(); await service.close(); await f.close(); }
});

test('catalog and policy watches detach resource routing then terminally withdraw after current book grant loss', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  const pages: CalendarAppointmentTypePage[] = [], policies: CalendarResourceTypesView[] = [], errors: unknown[] = [];
  const stops: (() => void)[] = [];
  try {
    const type = await manager.api.types.create({ label: 'Watch', durationMinutes: 30 }, { idempotencyKey: 'type' });
    const resource = await owner.api.resources.create({ label: 'Owned', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['book'], { idempotencyKey: 'grant', expectedRevision: 1 });
    const query = { resourceIds: [resource.id] };
    stops.push(reader.api.types.watch(query, value => pages.push(value), { onError: error => errors.push(error) }));
    stops.push(reader.api.types.watchForResource(resource.id, value => policies.push(value), { onError: error => errors.push(error) })); query.resourceIds[0] = 'retargeted';
    await eventuallyCalendar(() => pages.length === 1 && policies.length === 1); expect(pages[0]!.items[0]!.id).toBe(type.id);
    await owner.api.resources.setGrants(resource.id, reader.userId, [], { idempotencyKey: 'revoke', expectedRevision: 2 });
    await eventuallyCalendar(() => errors.length === 2 && f.stats().subscriptions === 0);
    expect(errors).toEqual([expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }), expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' })]);
    expect(pages).toHaveLength(1); expect(policies).toHaveLength(1);
  } finally { stops.forEach(stop => stop()); await f.close(); }
});
