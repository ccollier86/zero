/** Native HTTP + real Guardian/services/realm, all memory. Physical Fabric remains the explicit fixture seam, not worker qualification. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { MemoryEventStore } from '../observability/memory-event-store';
import { createCalendarHttp } from './http';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test('native private routes accept real sessions, reject authored authority and preserve core receipts/errors', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-http-memory');
  let app: Elysia | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, f.service);
    app = new Elysia().use(createAuthPlugin({ db: f.system, runtime, bootstrap: 'public', registration: { mode: 'public' },
      tenancy: 'single' })).use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = async (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const anonymous = await request('GET', '/api/calendar/resources'); expect(anonymous.status).toBe(401);
    const registered = await request('POST', '/auth/register', { username: 'synthetic-calendar-http', email: 'calendar-http@example.test', password: 'SyntheticOnly-Calendar-123!' });
    expect(registered.status).toBe(200);
    const account = await registered.json() as { accessToken: string };
    const empty = await request('GET', '/api/calendar/resources', undefined, account.accessToken);
    expect(empty.status).toBe(200); expect(await empty.json()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.stats().planes).toBe(0);
    const rejected = await request('POST', '/api/calendar/resources', { resource: { label: 'Synthetic calendar', kind: 'person', timeZone: 'UTC', actor: { manageAll: true } }, options: { idempotencyKey: 'http-forged' } }, account.accessToken);
    expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ code: 'CALENDAR_INPUT_INVALID', outcome: 'not-started' });
    expect(f.stats().planes).toBe(0);
    const resource = await request('POST', '/api/calendar/resources', { resource: { label: 'Synthetic calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'http-resource' } }, account.accessToken);
    expect(resource.status).toBe(200); const calendar = await resource.json() as { id: string };
    const appointment = { resourceIds: [calendar.id], title: 'Synthetic appointment', startAt: '2026-11-16T15:00:00.000Z', endAt: '2026-11-16T16:00:00.000Z', timeZone: 'UTC' };
    const created = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'http-appointment' } }, account.accessToken);
    expect(created.status).toBe(200); const receipt = await created.json() as { id: string };
    expect(receipt).toMatchObject({ requestId: 'http-appointment', operation: 'appointment.created', revision: 1, changed: true });
    const conflict = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'http-collision' } }, account.accessToken);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
    const detail = await request('GET', '/api/calendar/appointments/' + receipt.id, undefined, account.accessToken);
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ id: receipt.id, title: 'Synthetic appointment' });
    const reconciled = await request('GET', '/api/calendar/receipts/http-appointment', undefined, account.accessToken);
    expect(reconciled.status).toBe(200); expect(await reconciled.json()).toEqual({ receipt });
    const missing = await request('GET', '/api/calendar/appointments/does-not-exist', undefined, account.accessToken);
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-started' });
  } finally {
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await f.close(); }
  }
});
