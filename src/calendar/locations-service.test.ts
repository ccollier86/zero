/** Real Guardian/service/runtime/realm integration, native-memory SQLite only. No actors or physical fixtures. */
import { expect, test } from 'bun:test';
import type { CalendarCommandReceipt, CalendarLocationPage, CalendarResourcePage } from './contracts';
import { CalendarService, type CalendarServiceBroker } from './service';
import { calendarHash } from './validation';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test('location catalogs, explicit replacements and revision-controlled assignments round-trip through the admitted service', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner');
  try {
    expect(await manager.api.locations.list()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0 });
    const created = await manager.api.locations.create({ label: 'North', region: 'US.NY' }, { idempotencyKey: 'north' });
    expect(created).toMatchObject({ operation: 'location.created', revision: 1, changed: true });
    expect(await manager.api.locations.get(created.id)).toEqual({ id: created.id, label: 'North', region: 'US.NY', active: true, revision: 1 });
    expect(await manager.api.locations.create({ label: 'North', region: 'US.NY' }, { idempotencyKey: 'north' })).toEqual(created);
    const other = await manager.api.locations.create({ label: 'South' }, { idempotencyKey: 'south' });
    expect(await manager.api.locations.get(other.id)).toMatchObject({ region: null, active: true });
    const resource = await owner.api.resources.create({ label: 'Personal resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    expect(await owner.api.locations.forResource(resource.id)).toEqual({ resourceId: resource.id, resourceRevision: 1, locationIds: [] });
    const ids = [other.id, created.id].sort();
    const assigned = await manager.api.resources.setLocations(resource.id, ids, { idempotencyKey: 'assign', expectedRevision: 1 });
    expect(assigned).toMatchObject({ operation: 'resource.locations-changed', id: resource.id, revision: 2 });
    expect(await owner.api.locations.forResource(resource.id)).toEqual({ resourceId: resource.id, resourceRevision: 2, locationIds: ids });
    expect((await owner.api.locations.list()).items.map(item => item.id)).toEqual(ids);
    expect((await owner.api.resources.list({ locationIds: [created.id], regions: ['US.NY'] })).items.map(item => item.id)).toEqual([resource.id]);
    expect((await owner.api.resources.list({ locationIds: [], regions: [] })).items.map(item => item.id)).toEqual([resource.id]);
    expect((await owner.api.resources.list({ regions: ['US.CA'] })).items).toEqual([]);
    const replaced = await manager.api.locations.replace(created.id, { label: 'North renamed', region: null, active: false }, { idempotencyKey: 'replace', expectedRevision: 1 });
    expect(replaced).toMatchObject({ operation: 'location.updated', revision: 2, changed: true });
    expect(await owner.api.locations.get(created.id)).toMatchObject({ label: 'North renamed', region: null, active: false, revision: 2 });
    expect(await manager.api.receipts.get('assign')).toEqual(assigned);
    expect(await manager.api.receipts.get('replace')).toEqual(replaced);
    await expect(owner.api.resources.setLocations(resource.id, [], { idempotencyKey: 'stale', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect((await owner.api.resources.setLocations(resource.id, ids, { idempotencyKey: 'no-op', expectedRevision: 2 })).changed).toBe(false);
    const first = await manager.api.locations.list({ limit: 1 }); expect(first).toMatchObject({ truncated: true, nextAfter: first.items[0]!.id });
    const second = await manager.api.locations.list({ after: first.nextAfter!, limit: 1 });
    expect([...first.items, ...second.items].map(item => item.id)).toEqual(ids); expect(second.truncated).toBe(false);
    expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});

test('locations and geography never supply resource authority, and revoked visibility removes catalog/assignment projections', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  try {
    await expect(owner.api.locations.create({ label: 'Denied' }, { idempotencyKey: 'denied' })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.stats().planes).toBe(0);
    const location = await manager.api.locations.create({ label: 'Private location', region: 'US.NY' }, { idempotencyKey: 'location' });
    const resource = await owner.api.resources.create({ label: 'Private resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    expect(await reader.api.locations.list()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect((await reader.api.resources.list({ locationIds: [location.id], regions: ['US.NY'] })).items).toEqual([]);
    await expect(reader.api.locations.get(location.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(reader.api.locations.forResource(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(reader.api.resources.setLocations(resource.id, [], { idempotencyKey: 'denied-assign', expectedRevision: 2 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(owner.api.locations.replace(location.id, { label: 'Denied', region: null, active: false }, { idempotencyKey: 'denied-edit', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 2 });
    expect(await reader.api.locations.get(location.id)).toMatchObject({ id: location.id });
    expect(await reader.api.locations.forResource(resource.id)).toMatchObject({ resourceRevision: 3, locationIds: [location.id] });
    const otherScope = f.session('manager', { manager: true, tenantId: 'other' });
    await expect(otherScope.api.locations.get(location.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await otherScope.api.receipts.get('location')).toBeNull();
    await owner.api.resources.setGrants(resource.id, reader.userId, [], { idempotencyKey: 'revoke', expectedRevision: 3 });
    expect((await reader.api.locations.list()).items).toEqual([]);
    await expect(reader.api.locations.forResource(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
  } finally { await f.close(); }
});

test('location admission detaches inputs/facets before authority waits and rejects invalid commands before broker dispatch', async () => {
  const f = memoryCalendarServiceFixture(), session = f.session('manager', { manager: true }), calls: { name: string; input: Record<string, unknown> }[] = [];
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const operations: Record<string, CalendarCommandReceipt['operation']> = { 'calendar.location.create': 'location.created', 'calendar.location.replace': 'location.updated', 'calendar.resource.locations': 'resource.locations-changed' };
  const broker: CalendarServiceBroker = {
    async read<T>(...args: Parameters<CalendarServiceBroker['read']>): Promise<T> {
      const [, name, input] = args; calls.push({ name, input: input as Record<string, unknown> }); return {} as T;
    },
    async write<T>(...args: Parameters<CalendarServiceBroker['write']>): Promise<T> {
      const [, name, input, key] = args, body = input as Record<string, unknown>; calls.push({ name, input: body });
      return { requestId: key, operation: operations[name], id: body.id, revision: 1, changed: true } as T; },
  };
  const service = new CalendarService(broker, f.config, new AbortController().signal);
  const api = service.forAuthority({ ...session.authority, async assertCurrentAuthority() { entered(); await gate; session.authority.assertCurrentAuthoritySync(); } });
  try {
    const input = { label: 'Original', region: 'US.NY' }, options = { idempotencyKey: 'original' };
    const ids = ['location-b', 'location-a'], query = { locationIds: ids, regions: ['US.NY'] };
    const writing = api.locations.create(input, options), reading = api.resources.list(query);
    await ready; input.label = 'Changed'; options.idempotencyKey = 'changed'; ids[0] = 'retargeted'; query.regions[0] = 'retargeted'; release();
    const result = await writing; await reading;
    // These independent operations need not resume in invocation order after
    // admission. Correlate each detached envelope by its fixed broker name.
    expect(calls.map(call => call.name).sort()).toEqual(['calendar.location.create', 'calendar.resources']);
    const write = calls.find(call => call.name === 'calendar.location.create')!, read = calls.find(call => call.name === 'calendar.resources')!;
    expect(write.input).toMatchObject({ label: 'Original', region: 'US.NY', requestId: 'original' });
    const actor = write.input.actor as { scopeId: string; principal: string };
    expect(result.id).toBe(calendarHash([actor.scopeId, actor.principal, 'original']));
    expect(read.input).toMatchObject({ locationIds: ['location-a', 'location-b'], regions: ['US.NY'] });
    const count = calls.length;
    for (const input of [{ label: 'Location', actor: {} }, { label: '', region: null }, { label: 'Location', region: 'US NY' }, { label: 'Location', active: 1 }]) {
      await expect(api.locations.create(input as never, { idempotencyKey: 'invalid' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    await expect(api.locations.replace('location-a', { label: 'Missing fields' } as never, { idempotencyKey: 'invalid', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    for (const locationIds of [['same', 'same'], Array.from({ length: 17 }, (_, i) => 'location-' + i)]) {
      await expect(api.resources.setLocations('resource-a', locationIds, { idempotencyKey: 'invalid', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(api.resources.list({ locationIds })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(calls).toHaveLength(count);
    session.revoke(); await expect(api.locations.get('location-a')).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' }); expect(calls).toHaveLength(count);
  } finally { release(); await service.close(); await f.close(); }
});

test('authorized location and filtered resource watches detach routing and withdraw when current assignments/grants change', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  let stopLocations = () => {}, stopResources = () => {};
  try {
    const location = await manager.api.locations.create({ label: 'Live directory', region: 'US.NY' }, { idempotencyKey: 'location' });
    const resource = await owner.api.resources.create({ label: 'Live resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 2 });
    const locations: CalendarLocationPage[] = [], resources: CalendarResourcePage[] = [], errors: unknown[] = [];
    const query = { locationIds: [location.id], regions: ['US.NY'] };
    stopLocations = reader.api.locations.watch({}, page => locations.push(page), { onError: error => errors.push(error) });
    stopResources = reader.api.resources.watch(query, page => resources.push(page), { onError: error => errors.push(error) });
    query.locationIds[0] = 'retargeted'; query.regions[0] = 'retargeted';
    await eventuallyCalendar(() => locations.length === 1 && resources.length === 1);
    expect(locations[0]!.items[0]!.id).toBe(location.id); expect(resources[0]!.items[0]!.id).toBe(resource.id);
    await owner.api.resources.setGrants(resource.id, reader.userId, [], { idempotencyKey: 'revoke', expectedRevision: 3 });
    await eventuallyCalendar(() => locations.length === 2 && resources.length === 2);
    expect(locations[1]!.items).toEqual([]); expect(resources[1]!.items).toEqual([]);
    reader.revoke(); await manager.api.locations.replace(location.id, { label: 'Changed', region: 'US.NY', active: true }, { idempotencyKey: 'update', expectedRevision: 1 });
    await eventuallyCalendar(() => errors.length === 2 && f.stats().subscriptions === 0);
    expect(locations).toHaveLength(2); expect(resources).toHaveLength(2);
  } finally { stopLocations(); stopResources(); await f.close(); }
});

test('detail watches terminate instead of retaining location/assignment metadata after current domain grant revocation', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner'), reader = f.session('reader');
  let stopLocation = () => {}, stopAssignment = () => {};
  try {
    const location = await manager.api.locations.create({ label: 'Private detail' }, { idempotencyKey: 'location' });
    const resource = await owner.api.resources.create({ label: 'Private assignment', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    await owner.api.resources.setGrants(resource.id, reader.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 2 });
    const locations: unknown[] = [], assignments: unknown[] = [], errors: unknown[] = [];
    stopLocation = reader.api.locations.watchLocation(location.id, value => locations.push(value), { onError: error => errors.push(error) });
    stopAssignment = reader.api.locations.watchForResource(resource.id, value => assignments.push(value), { onError: error => errors.push(error) });
    await eventuallyCalendar(() => locations.length === 1 && assignments.length === 1);
    await owner.api.resources.setGrants(resource.id, reader.userId, [], { idempotencyKey: 'revoke', expectedRevision: 3 });
    await eventuallyCalendar(() => errors.length === 2 && f.stats().subscriptions === 0);
    expect(errors).toEqual([expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }), expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' })]);
    expect(locations).toHaveLength(1); expect(assignments).toHaveLength(1);
  } finally { stopLocation(); stopAssignment(); await f.close(); }
});

test('assignment witnesses cannot unlock hidden locations and accepted replay survives witness retirement without changing the original intent', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), owner = f.session('owner');
  try {
    const location = await manager.api.locations.create({ label: 'Witness protected' }, { idempotencyKey: 'location' });
    const witness = await manager.api.resources.create({ label: 'Witness resource', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'witness-resource' });
    const target = await owner.api.resources.create({ label: 'Owned target', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'target' });
    await manager.api.resources.setLocations(witness.id, [location.id], { idempotencyKey: 'seed', expectedRevision: 1 });
    await expect(owner.api.resources.setLocations(target.id, [location.id], { idempotencyKey: 'guessed', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await manager.api.resources.setGrants(witness.id, owner.userId, ['busy'], { idempotencyKey: 'witness-busy', expectedRevision: 2 });
    const control = { idempotencyKey: 'original-assignment', expectedRevision: 1 };
    const assigned = await owner.api.resources.setLocations(target.id, [location.id], control);
    expect(assigned).toMatchObject({ operation: 'resource.locations-changed', revision: 2 });
    await owner.api.resources.setLocations(target.id, [], { idempotencyKey: 'remove-target-location', expectedRevision: 2 });
    await manager.api.resources.setGrants(witness.id, owner.userId, [], { idempotencyKey: 'revoke-witness', expectedRevision: 3 });
    await expect(owner.api.locations.get(location.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await owner.api.resources.setLocations(target.id, [location.id], control)).toEqual(assigned);
    expect(await owner.api.locations.forResource(target.id)).toEqual({ resourceId: target.id, resourceRevision: 3, locationIds: [] });
    await expect(owner.api.resources.setLocations(target.id, [], control)).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    await expect(owner.api.resources.setLocations(target.id, [location.id], { idempotencyKey: 'guessed-again', expectedRevision: 3 })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(await owner.api.receipts.get('original-assignment')).toEqual(assigned); expect(f.stats().activeLeases).toBe(0);
  } finally { await f.close(); }
});
