/** Native auth/routes/service/runtime/realm in memory; no listener or physical fixture. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

async function withHttp(run: (input: {
  request(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  register(suffix: string): Promise<{ accessToken: string; user: { userId: string } }>;
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
}) => Promise<void>) {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-visits-http-memory');
  let app: Elysia | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, fixture.service);
    app = new Elysia().use(createAuthPlugin({ db: fixture.system, runtime, bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'single' }))
      .use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    await run({ request, fixture, async register(suffix) {
      const response = await request('POST', '/auth/register', { username: 'synthetic-visits-' + suffix,
        email: 'synthetic-visits-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}

test('native visit selectors require explicit resource selection, reject raw unknown/duplicate keys and round-trip visit bodies', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    expect((await request('GET', '/api/calendar/visit-locations?resourceIds=')).status).toBe(401);
    const account = await register('native'), token = account.accessToken;
    for (const suffix of ['', '?actor=forged', '?resourceIds=x&resourceIds=y', '?resourceIds=&scopeId=forged', '?resourceIds=&limit=1&limit=2', '?resourceIds=x,x']) {
      for (const path of ['/api/calendar/visit-locations', '/api/calendar/visit-locations/live']) expect((await request('GET', path + suffix, undefined, token)).status).toBe(400);
    }
    expect(await (await request('GET', '/api/calendar/visit-locations?resourceIds=', undefined, token)).json()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(fixture.stats().planes).toBe(0);
    const manager = fixture.session(account.user.userId, { manager: true });
    const location = await manager.api.locations.create({ label: 'Native retained visit', region: 'US.NY' }, { idempotencyKey: 'location' });
    const resource = await manager.api.resources.create({ label: 'Native resource', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    const selection = await request('GET', '/api/calendar/visit-locations?resourceIds=' + resource.id, undefined, token);
    expect(selection.status).toBe(200); expect(await selection.json()).toMatchObject({ items: [{ id: location.id, active: true }] });
    const appointment = { resourceIds: [resource.id], title: 'Native visit', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
    for (const visit of [null, { mode: 'remote' }, { mode: 'video', location: { id: location.id, revision: 1 } }, { mode: 'in-person', location: { id: location.id, revision: 1, label: 'forged' } }]) {
      expect((await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, visit }, options: { idempotencyKey: 'invalid' } }, token)).status).toBe(400);
      expect((await request('POST', '/api/calendar/holds', { hold: { ...appointment, title: undefined, visit }, options: { idempotencyKey: 'invalid' } }, token)).status).toBe(400);
    }
    const visit = { mode: 'in-person', location: { id: location.id, revision: 1 } };
    const stale = await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, visit: { ...visit, location: { id: location.id, revision: 2 } } }, options: { idempotencyKey: 'stale' } }, token);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CALENDAR_VISIT_STALE', outcome: 'not-committed' });
    const created = await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, visit }, options: { idempotencyKey: 'booking' } }, token);
    expect(created.status).toBe(200); const booking = await created.json() as { id: string };
    expect(await (await request('GET', '/api/calendar/appointments/' + booking.id, undefined, token)).json()).toMatchObject({ visit: { mode: 'in-person', location: { id: location.id, revision: 1, label: 'Native retained visit', region: 'US.NY' } } });
    const reschedule = { startAt: appointment.startAt, endAt: appointment.endAt, timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, visit: null };
    expect((await request('POST', '/api/calendar/appointments/' + booking.id + '/reschedule', { appointment: reschedule, options: { idempotencyKey: 'clear', expectedRevision: 1 } }, token)).status).toBe(200);
    expect(await (await request('GET', '/api/calendar/appointments/' + booking.id, undefined, token)).json()).not.toHaveProperty('visit');
  });
}, 30_000);

test('native visit live preauthorization denies details-only callers and invalidates streams after book grant retirement', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('owner'), delegate = await register('reader'), token = delegate.accessToken;
    const manager = fixture.session(owner.user.userId, { manager: true });
    const location = await manager.api.locations.create({ label: 'Selected private location' }, { idempotencyKey: 'location' });
    const resource = await manager.api.resources.create({ label: 'Selected resource', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    await manager.api.resources.setGrants(resource.id, delegate.user.userId, ['details'], { idempotencyKey: 'details', expectedRevision: 2 });
    const path = '/api/calendar/visit-locations/live?resourceIds=' + resource.id;
    expect((await request('GET', path, undefined, token)).status).toBe(404);
    await manager.api.resources.setGrants(resource.id, delegate.user.userId, ['book'], { idempotencyKey: 'book', expectedRevision: 3 });
    const response = await request('GET', path, undefined, token); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    try {
      const initial = new TextDecoder().decode((await reader.read()).value); expect(initial).toContain(location.id); expect(initial).toContain('snapshot');
      await manager.api.resources.setGrants(resource.id, delegate.user.userId, [], { idempotencyKey: 'revoke', expectedRevision: 4 });
      const invalidated = new TextDecoder().decode((await reader.read()).value); expect(invalidated).toContain('invalidated'); expect(invalidated).not.toContain(location.id);
      expect((await reader.read()).done).toBe(true); await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
    } finally { await reader.cancel(); }
  });
}, 30_000);
