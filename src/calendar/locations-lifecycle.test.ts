/** Native memory domain and Guardian/service boundaries only; no disk, worker, listener or build output. */
import { expect, test } from 'bun:test';
import type { CalendarLocationView, CalendarResourceLocationsView } from './contracts';
import type { CalendarServiceBroker } from './service';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

for (const operation of ['direct', 'detail-watch', 'assignments-watch'] as const) {
  test(`${operation} discards a snapshot whose domain grant was revoked during its final asynchronous delivery`, async () => {
    const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true }), reader = f.session('reader');
    const read = f.runtime.read.bind(f.runtime); let release!: () => void, stop = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    try {
      const resource = await manager.api.resources.create({ label: 'Private directory resource', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
      const location = await manager.api.locations.create({ label: 'PRIVATE_LOCATION', region: 'US-IN' }, { idempotencyKey: 'location' });
      await manager.api.resources.setLocations(resource.id, [location.id], { expectedRevision: 1, idempotencyKey: 'assign' });
      await manager.api.resources.setGrants(resource.id, reader.userId, ['busy'], { expectedRevision: 2, idempotencyKey: 'grant' });
      const queryName = operation === 'assignments-watch' ? 'calendar.resourceLocations' : 'calendar.location';
      f.runtime.read = async <T>(...args: Parameters<CalendarServiceBroker['read']>): Promise<T> => {
        const result = await read<T>(...args);
        if (args[1] === queryName && first) { first = false; await gate; }
        return result;
      };
      const pages: (CalendarLocationView | CalendarResourceLocationsView)[] = [], errors: unknown[] = [];
      const direct = operation === 'direct' ? reader.api.locations.get(location.id).then(value => { pages.push(value); }, error => { errors.push(error); }) : undefined;
      if (operation === 'detail-watch') stop = reader.api.locations.watchLocation(location.id, value => { pages.push(value); }, { onError: error => errors.push(error) });
      if (operation === 'assignments-watch') stop = reader.api.locations.watchForResource(resource.id, value => { pages.push(value); }, { onError: error => errors.push(error) });
      await eventuallyCalendar(() => !first);
      await manager.api.resources.setGrants(resource.id, reader.userId, [], { expectedRevision: 3, idempotencyKey: 'revoke' });
      release(); await direct;
      await eventuallyCalendar(() => errors.length === 1 && f.stats().subscriptions === 0);
      expect(pages).toEqual([]); expect(errors[0]).toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      expect(f.stats().activeLeases).toBe(0);
    } finally { release(); stop(); f.runtime.read = read; await f.close(); }
  });
}

test('direct directory reads bound known-commit retries under continuous mutation and release their subscription', async () => {
  const f = memoryCalendarServiceFixture(), manager = f.session('manager', { manager: true });
  const read = f.runtime.read.bind(f.runtime); let attempts = 0;
  try {
    await manager.api.resources.create({ label: 'Initial', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'initial' });
    f.runtime.read = async <T>(...args: Parameters<CalendarServiceBroker['read']>): Promise<T> => {
      const result = await read<T>(...args);
      if (args[1] === 'calendar.resources') {
        attempts++;
        await manager.api.resources.create({ label: 'Synthetic concurrent write', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'mutate-' + attempts });
      }
      return result;
    };
    await expect(manager.api.resources.list()).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(attempts).toBe(4); expect(f.stats().subscriptions).toBe(0); expect(f.stats().activeLeases).toBe(0);
  } finally { f.runtime.read = read; await f.close(); }
});
