/** Native managed auth/routes/service/runtime/realm in memory. No listener, physical actor or disk fixture. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarAvailabilityPolicyView, CalendarCommandReceipt, CalendarWeeklyAvailabilityPolicyInput } from './contracts';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

const policy = (): CalendarWeeklyAvailabilityPolicyInput => ({ kind: 'weekly-local-v1', coverage: { from: '2030-01-01', until: '2030-01-08' },
  fold: 'earlier', weekly: [{ day: 2, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] });

async function withHttp(run: (input: {
  request(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  register(suffix: string): Promise<{ accessToken: string; user: { userId: string } }>;
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
}) => Promise<void>) {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-working-hours-http-memory');
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
      const response = await request('POST', '/auth/register', { username: 'synthetic-hours-' + suffix,
        email: 'synthetic-hours-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}

test('native weekly policy HTTP rejects authored authority/unknown fields and returns bounded policy metadata with original-key reconciliation', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    expect((await request('GET', '/api/calendar/availability/missing/policy')).status).toBe(401);
    expect((await request('PUT', '/api/calendar/availability/missing/policy', { policy: policy(), options: { idempotencyKey: 'denied', expectedRevision: 1 } })).status).toBe(401);
    const owner = await register('roundtrip'), token = owner.accessToken;
    expect((await request('GET', '/api/calendar/availability/missing/policy', undefined, token)).status).toBe(404);
    expect(fixture.stats().planes).toBe(0);
    const created = await request('POST', '/api/calendar/resources', { resource: { label: 'PRIVATE_RESOURCE_LABEL', kind: 'person', timeZone: 'America/New_York' }, options: { idempotencyKey: 'resource' } }, token);
    expect(created.status).toBe(200); const resource = await created.json() as CalendarCommandReceipt;
    const path = '/api/calendar/availability/' + resource.id + '/policy';
    expect(await (await request('GET', path, undefined, token)).json()).toMatchObject({ resourceRevision: 1,
      policy: { kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }, materialization: null });
    const options = { idempotencyKey: 'policy', expectedRevision: 1 };
    for (const suffix of ['?scopeId=forged', '?actor=forged', '?x=1&x=2']) {
      expect((await request('GET', path + suffix, undefined, token)).status).toBe(400);
      expect((await request('GET', path + '/live' + suffix, undefined, token)).status).toBe(400);
      expect((await request('PUT', path + suffix, { policy: policy(), options }, token)).status).toBe(400);
    }
    for (const body of [
      { policy: { ...policy(), engine: { name: 'forged' } }, options },
      { policy: { ...policy(), windows: [{ startAt: '2030-01-01T00:00:00.000Z', endAt: '2031-01-01T00:00:00.000Z' }] }, options },
      { policy: policy(), options, actor: { manageAll: true } },
      { policy: policy(), options: { ...options, scopeId: 'other' } },
      { policy: { ...policy(), weekly: [{ day: 0, windows: [] }] }, options },
      { policy: { ...policy(), coverage: { from: '2030-01-01', until: '2032-01-01' } }, options },
    ]) expect((await request('PUT', path, body, token)).status).toBe(400);
    expect(fixture.sourceRows(fixture.session(owner.user.userId).scope, '_calendar_availability_policy_history')).toEqual([]);
    const response = await request('PUT', path, { policy: policy(), options }, token);
    expect(response.status).toBe(200); const accepted = await response.json() as CalendarCommandReceipt;
    expect(accepted).toMatchObject({ requestId: 'policy', operation: 'resource.availability-policy-changed', id: resource.id, revision: 2, changed: true });
    const viewResponse = await request('GET', path, undefined, token); expect(viewResponse.status).toBe(200);
    const view = await viewResponse.json() as CalendarAvailabilityPolicyView;
    expect(view).toMatchObject({ resourceId: resource.id, resourceRevision: 2, timeZone: 'America/New_York', policy: policy(),
      materialization: { coverage: { startAt: '2030-01-01T05:00:00.000Z', endAt: '2030-01-08T05:00:00.000Z' }, windowCount: 1, skippedDates: [] } });
    expect(view.materialization).not.toHaveProperty('windows'); expect(JSON.stringify(view)).not.toContain('PRIVATE_RESOURCE_LABEL');
    expect(await (await request('PUT', path, { policy: policy(), options }, token)).json()).toEqual(accepted);
    expect(await (await request('GET', '/api/calendar/receipts/policy', undefined, token)).json()).toEqual({ receipt: accepted });
    const stale = await request('PUT', path, { policy: policy(), options: { idempotencyKey: 'stale', expectedRevision: 1 } }, token);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed' });
    const legacy = await request('GET', '/api/calendar/availability/' + resource.id, undefined, token);
    expect(legacy.status).toBe(409); expect(await legacy.json()).toMatchObject({ code: 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED' });
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('native policy HTTP/live reads honor current object grants and close with a content-free invalidation on revocation', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('owner'), delegate = await register('delegate'), token = delegate.accessToken;
    const manager = fixture.session(owner.user.userId, { manager: true });
    const resource = await manager.api.resources.create({ label: 'PRIVATE_WATCH_RESOURCE', kind: 'room', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const path = '/api/calendar/availability/' + resource.id + '/policy';
    await manager.api.resources.setGrants(resource.id, delegate.user.userId, ['busy'], { idempotencyKey: 'busy', expectedRevision: 1 });
    for (const suffix of ['', '/live']) expect((await request('GET', path + suffix, undefined, token)).status).toBe(404);
    expect((await request('PUT', path, { policy: policy(), options: { idempotencyKey: 'denied', expectedRevision: 2 } }, token)).status).toBe(404);
    await manager.api.resources.setGrants(resource.id, delegate.user.userId, ['details'], { idempotencyKey: 'details', expectedRevision: 2 });
    expect((await request('GET', path, undefined, token)).status).toBe(200);
    expect((await request('PUT', path, { policy: policy(), options: { idempotencyKey: 'details-denied', expectedRevision: 3 } }, token)).status).toBe(404);
    await manager.api.resources.setGrants(resource.id, delegate.user.userId, ['book'], { idempotencyKey: 'book', expectedRevision: 3 });
    const response = await request('GET', path + '/live', undefined, token);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader = response.body!.getReader();
    try {
      const initial = new TextDecoder().decode((await reader.read()).value); expect(initial).toContain('event: snapshot'); expect(initial).toContain('explicit-utc-v1');
      await manager.api.availability.policy.replace(resource.id, policy(), { idempotencyKey: 'weekly', expectedRevision: 4 });
      const changed = new TextDecoder().decode((await reader.read()).value); expect(changed).toContain('weekly-local-v1'); expect(changed).toContain('"resourceRevision":5');
      expect(changed).not.toContain('PRIVATE_WATCH_RESOURCE');
      await manager.api.resources.setGrants(resource.id, delegate.user.userId, [], { idempotencyKey: 'revoke', expectedRevision: 5 });
      const invalidated = new TextDecoder().decode((await reader.read()).value);
      expect(invalidated).toContain('event: invalidated'); expect(invalidated).not.toContain(resource.id); expect(invalidated).not.toContain('weekly-local-v1');
      expect((await reader.read()).done).toBe(true); await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
      expect(fixture.stats().activeLeases).toBe(0);
    } finally { await reader.cancel(); }
  });
}, 30_000);

test('native HTTP preserves coverage/engine error codes and accepted replay remains available without Temporal', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('errors'), token = owner.accessToken;
    const created = await request('POST', '/api/calendar/resources', { resource: { label: 'Engine errors', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    const resource = await created.json() as CalendarCommandReceipt, path = '/api/calendar/availability/' + resource.id + '/policy';
    const source = { ...policy(), coverage: { from: '2030-01-01', until: '2030-01-02' } }, options = { idempotencyKey: 'policy', expectedRevision: 1 };
    const acceptedResponse = await request('PUT', path, { policy: source, options }, token); expect(acceptedResponse.status).toBe(200);
    const accepted = await acceptedResponse.json();
    const outside = await request('POST', '/api/calendar/appointments', { appointment: { title: 'Unqualified day', resourceIds: [resource.id],
      startAt: '2030-01-02T10:00:00.000Z', endAt: '2030-01-02T11:00:00.000Z', timeZone: 'UTC' }, options: { idempotencyKey: 'outside' } }, token);
    expect(outside.status).toBe(409); expect(await outside.json()).toMatchObject({ code: 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED', outcome: 'not-committed' });
    expect(await (await request('GET', '/api/calendar/receipts/outside', undefined, token)).json()).toEqual({ receipt: null });
    const temporal = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
    try {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, writable: true, value: undefined });
      expect((await request('GET', path, undefined, token)).status).toBe(200);
      expect(await (await request('PUT', path, { policy: source, options }, token)).json()).toEqual(accepted);
      const changed = await request('PUT', path, { policy: { ...source, fold: 'later' }, options: { idempotencyKey: 'engine-unavailable', expectedRevision: 2 } }, token);
      expect(changed.status).toBe(503); expect(await changed.json()).toMatchObject({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE', outcome: 'not-committed' });
      expect(await (await request('GET', '/api/calendar/receipts/engine-unavailable', undefined, token)).json()).toEqual({ receipt: null });
      expect(fixture.stats().activeLeases).toBe(0);
    } finally { if (temporal) Object.defineProperty(globalThis, 'Temporal', temporal); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  });
}, 30_000);
