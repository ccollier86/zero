/** Authenticated HTTP -> real SDK -> CalendarService -> native MEMORY realm.
 * No network listener, physical files, actor launch or external provider.
 */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { createCalendarClient } from '../frontend/client/calendar-client';
import type { FetchInit } from '../frontend/client/sdk';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarConfig } from './config';
import type { CalendarAppointmentPage } from './contracts';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const allDay = { kind: 'all-day-local-v1' as const, startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'America/New_York' };
const shortDate = { kind: 'all-day-local-v1' as const, startDate: '2030-01-01', endDate: '2030-01-02', timeZone: 'Pacific/Kiritimati' };
type Account = { accessToken: string; user: { userId: string } };
type Client = ReturnType<typeof createCalendarClient>;
interface HttpFixture {
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
  request(method: string, path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<Response>;
  register(suffix: string): Promise<Account>;
  client(token: string): Client;
}
async function withHttp(run: (input: HttpFixture) => Promise<void>, config: CalendarConfig = {}): Promise<void> {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single', config }), runtime = new ZeroAppRuntime('synthetic-all-day-http-memory');
  const clients: Client[] = [];
  let app: Elysia | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, fixture.service);
    app = new Elysia().use(createAuthPlugin({ db: fixture.system, runtime, bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'single' }))
      .use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request: HttpFixture['request'] = (method, path, body, token, signal) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}),
    }));
    const client = (token: string) => {
      const value = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
        const response = await request(init?.method ?? 'GET', path, init?.body, token, init?.signal);
        const body = await response.json();
        if (!response.ok) throw { status: response.status, body };
        return body as T;
      }, (path, init) => request(init.method ?? 'GET', path, undefined, token, init.signal ?? undefined));
      clients.push(value); return value;
    };
    await run({ fixture, request, client, async register(suffix) {
      const response = await request('POST', '/auth/register', { username: 'synthetic-all-day-' + suffix,
        email: 'synthetic-all-day-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<Account>;
    } });
  } finally {
    for (const client of clients) client.clear();
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await fixture.close(); }
  }
}

test('native all-day HTTP and SDK retain31 Gregorian dates, replay/no-op facts and explicit kind conversion', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('lifecycle'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    expect((await api.capabilities.get()).allDayAppointments).toBe(true);
    const resource = await api.resources.create({ label: 'Synthetic date calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const input = { resourceIds: [resource.id], title: 'PRIVATE_HTTP_ALL_DAY', interval: allDay };
    const accepted = await api.appointments.create(input, { idempotencyKey: 'create-date' });
    expect(accepted).toMatchObject({ operation: 'appointment.created', revision: 1, changed: true });
    const original = await api.appointments.get(accepted.id);
    expect(original).toMatchObject({ interval: allDay, startAt: '2026-10-15T04:00:00.000Z', endAt: '2026-11-15T05:00:00.000Z',
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(Date.parse(original.endAt) - Date.parse(original.startAt)).toBe(31 * 86_400_000 + 3_600_000);
    const history = fixture.sourceRows(scope, '_calendar_appointment_time_history'), sequence = fixture.sourceSequence(scope);
    const query = { resourceIds: [resource.id], startDate: '2026-11-14', endDate: '2026-11-15' };
    const temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
    try {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
      expect(await api.appointments.create(input, { idempotencyKey: 'create-date' })).toEqual(accepted);
      expect(fixture.sourceSequence(scope)).toBe(sequence); expect(await api.receipts.get('create-date')).toEqual(accepted);
      const selected = await api.appointments.queryDates(query);
      expect(selected.items).toEqual([original]); expect(Object.isFrozen(selected.items)).toBe(true);
      expect(Object.isFrozen(selected.items[0]!.interval)).toBe(true);
      expect(await api.appointments.queryDates({ ...query, startDate: '2026-11-15', endDate: '2026-11-16' })).toEqual({ items: [], truncated: false });
      const updated = await api.appointments.update(accepted.id, { title: 'PRIVATE_CHANGED_TITLE' }, { idempotencyKey: 'title', expectedRevision: 1 });
      expect(updated).toMatchObject({ operation: 'appointment.updated', revision: 2, changed: true });
      expect(await api.appointments.update(accepted.id, { title: 'PRIVATE_CHANGED_TITLE' }, { idempotencyKey: 'title', expectedRevision: 1 })).toEqual(updated);
      const noop = await api.appointments.update(accepted.id, { interval: allDay }, { idempotencyKey: 'same-date', expectedRevision: 2 });
      expect(noop).toMatchObject({ revision: 2, changed: false });
      expect(fixture.sourceRows(scope, '_calendar_appointment_time_history')).toEqual(history);
      expect((await api.appointments.get(accepted.id)).interval).toEqual(allDay);
    } finally { if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal'); }
    const timed = { kind: 'timed-v1' as const, startAt: '2026-11-14T12:00:00.000Z', endAt: '2026-11-14T13:00:00.000Z',
      timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await api.appointments.update(accepted.id, { interval: timed }, { idempotencyKey: 'convert-timed', expectedRevision: 2 });
    expect(await api.appointments.queryDates(query)).toEqual({ items: [], truncated: false });
    expect(await api.appointments.get(accepted.id)).not.toHaveProperty('interval');
    expect(fixture.sourceRows(scope, '_calendar_appointment_time_history')).toHaveLength(2);
    await api.appointments.update(accepted.id, { interval: allDay }, { idempotencyKey: 'convert-date', expectedRevision: 3 });
    expect((await api.appointments.queryDates(query)).items[0]).toMatchObject({ id: accepted.id, revision: 4, interval: allDay });
    expect(fixture.sourceRows(scope, '_calendar_appointment_time_history')).toHaveLength(3);
    await api.appointments.cancel(accepted.id, { idempotencyKey: 'cancel', expectedRevision: 4 });
    expect(await api.appointments.queryDates(query)).toEqual({ items: [], truncated: false });
    expect(await api.appointments.get(accepted.id)).toMatchObject({ status: 'cancelled', interval: allDay });
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('native date routes reject anonymous/forged envelopes and configured range/page/resource widening before private acquisition', async () => {
  await withHttp(async ({ fixture, register, request, client }) => {
    const body = { query: { resourceIds: [], startDate: shortDate.startDate, endDate: shortDate.endDate } };
    expect((await request('POST', '/api/calendar/appointments/query-dates', body)).status).toBe(401);
    expect((await request('GET', '/api/calendar/appointments/dates/live?resourceIds=&startDate=2030-01-01&endDate=2030-01-02')).status).toBe(401);
    const owner = await register('limits'), api = client(owner.accessToken), token = owner.accessToken;
    const resource = await api.resources.create({ label: 'Synthetic narrow calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const query = { ...body.query, resourceIds: [resource.id] }, path = '/api/calendar/appointments/query-dates';
    const before = fixture.stats().acquisitions;
    for (const value of [{ query: { ...query, startDate: '2030-02-30' } }, { query: { ...query, endDate: '2030-01-04' } },
      { query: { ...query, limit: 2 } }, { query: { ...query, resourceIds: [resource.id, 'another'] } },
      { query: { ...query, actor: { manageAll: true } } }, { query: { ...query, timeZone: 'UTC' } },
      { query, scopeId: 'forged' }, { query: { ...query, resourceIds: [resource.id, resource.id] } }]) {
      expect((await request('POST', path, value, token)).status).toBe(400);
    }
    for (const suffix of ['?actor=forged', '?scopeId=forged', '?limit=1&limit=2']) expect((await request('POST', path + suffix, { query }, token)).status).toBe(400);
    const stream = '/api/calendar/appointments/dates/live?' + new URLSearchParams({ resourceIds: resource.id, startDate: shortDate.startDate, endDate: shortDate.endDate });
    for (const suffix of ['&actor=forged', '&resourceIds=another', '&limit=1&limit=2']) expect((await request('GET', stream + suffix, undefined, token)).status).toBe(400);
    expect(fixture.stats().acquisitions).toBe(before); expect(fixture.stats().subscriptions).toBe(0);
    expect(await api.appointments.queryDates({ ...query, endDate: '2030-01-03' })).toEqual({ items: [], truncated: false });
    const appointment = { resourceIds: [resource.id], title: 'Synthetic', interval: shortDate };
    for (const value of [{ appointment: { ...appointment, actor: {} }, options: { idempotencyKey: 'bad' } },
      { appointment: { ...appointment, startAt: '2030-01-01T00:00:00.000Z' }, options: { idempotencyKey: 'bad' } },
      { appointment: { ...appointment, interval: { ...shortDate, engine: 'authored' } }, options: { idempotencyKey: 'bad' } },
      { appointment, options: { idempotencyKey: 'bad', scopeId: 'forged' } }]) {
      expect((await request('POST', '/api/calendar/appointments', value, token)).status).toBe(400);
    }
    expect(fixture.stats().activeLeases).toBe(0);
  }, { maxRangeDays: 2, maxPageSize: 1, maxResources: 1 });
}, 30_000);

test('native date creation cannot consume minute-typed required resources or assign a minute type to all-day facts', async () => {
  await withHttp(async ({ fixture, register, client, request }) => {
    const owner = await register('types'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    const resource = await api.resources.create({ label: 'Synthetic typed resource', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const type = await api.types.create({ label: 'Synthetic thirty minutes', durationMinutes: 30 }, { idempotencyKey: 'type' });
    await api.resources.setAppointmentTypes(resource.id, { mode: 'required', typeIds: [type.id] }, { idempotencyKey: 'required-type', expectedRevision: 1 });
    const before = fixture.sourceSequence(scope), history = fixture.sourceRows(scope, '_calendar_appointment_time_history');
    const appointment = { resourceIds: [resource.id], title: 'PRIVATE_REJECTED_DATE', interval: shortDate };
    await expect(api.appointments.create(appointment, { idempotencyKey: 'missing-type' })).rejects.toMatchObject({ code: 'CALENDAR_TYPE_CONFLICT', outcome: 'not-committed' });
    const typed = await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, appointmentType: { id: type.id, revision: 1 } },
      options: { idempotencyKey: 'minute-date' } }, owner.accessToken);
    expect(typed.status).toBe(409); expect(await typed.json()).toMatchObject({ code: 'CALENDAR_TYPE_CONFLICT', outcome: 'not-committed' });
    expect(fixture.sourceSequence(scope)).toBe(before); expect(fixture.sourceRows(scope, '_calendar_appointment_time_history')).toEqual(history);
    expect(await api.receipts.get('missing-type')).toBeNull(); expect(await api.receipts.get('minute-date')).toBeNull();
    expect(await api.appointments.queryDates({ resourceIds: [resource.id], startDate: shortDate.startDate, endDate: shortDate.endDate })).toEqual({ items: [], truncated: false });
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('real SDK date SSE publishes native commits, withdraws on grant loss and physically retires on SDK scope replacement', async () => {
  await withHttp(async ({ fixture, register, client, request }) => {
    const owner = await register('live-owner'), delegate = await register('live-delegate'), api = client(owner.accessToken), viewer = client(delegate.accessToken);
    const resource = await api.resources.create({ label: 'Synthetic live date calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const query = { resourceIds: [resource.id], startDate: shortDate.startDate, endDate: shortDate.endDate };
    const live = '/api/calendar/appointments/dates/live?' + new URLSearchParams({ resourceIds: resource.id, startDate: shortDate.startDate, endDate: shortDate.endDate });
    const denied = await request('GET', live, undefined, delegate.accessToken);
    expect(denied.status).toBe(404); expect(denied.headers.get('Content-Type')).not.toContain('text/event-stream');
    expect(fixture.stats().subscriptions).toBe(0);
    await api.resources.setGrants(resource.id, delegate.user.userId, ['details'], { idempotencyKey: 'grant', expectedRevision: 1 });
    const created = await api.appointments.create({ resourceIds: [resource.id], title: 'PRIVATE_LIVE_DATE', interval: shortDate }, { idempotencyKey: 'create' });
    const pages: CalendarAppointmentPage[] = [], errors: unknown[] = [];
    let stop = viewer.appointments.watchDates(query, page => pages.push(page), { onError: error => errors.push(error) });
    try {
      await eventuallyCalendar(() => pages.length === 1);
      expect(pages[0]!.items[0]).toMatchObject({ id: created.id, interval: shortDate }); expect(fixture.stats().subscriptions).toBe(1);
      await api.appointments.update(created.id, { title: 'PRIVATE_UPDATED_LIVE_DATE' }, { idempotencyKey: 'title', expectedRevision: 1 });
      await eventuallyCalendar(() => pages.at(-1)?.items[0]?.title === 'PRIVATE_UPDATED_LIVE_DATE');
      await api.resources.setGrants(resource.id, delegate.user.userId, [], { idempotencyKey: 'revoke', expectedRevision: 2 });
      await eventuallyCalendar(() => errors.length === 1 && fixture.stats().subscriptions === 0);
      await expect(viewer.appointments.queryDates(query)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      stop();
      await api.resources.setGrants(resource.id, delegate.user.userId, ['details'], { idempotencyKey: 'restore', expectedRevision: 3 });
      const restored: CalendarAppointmentPage[] = [];
      stop = viewer.appointments.watchDates(query, page => restored.push(page), { onError: error => errors.push(error) });
      await eventuallyCalendar(() => restored.length === 1 && fixture.stats().subscriptions === 1);
      viewer.clear(); await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
      await api.appointments.update(created.id, { title: 'PRIVATE_AFTER_RETIREMENT' }, { idempotencyKey: 'after-retirement', expectedRevision: 2 });
      expect(restored).toHaveLength(1); expect(restored[0]!.items[0]!.title).toBe('PRIVATE_UPDATED_LIVE_DATE');
      expect(errors).toHaveLength(1); expect(fixture.stats().activeLeases).toBe(0);
    } finally { stop(); viewer.clear(); }
  });
}, 30_000);
