/** Real authenticated app.handle -> SDK -> facade -> native MEMORY. Never listens or writes files. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { createCalendarClient } from '../frontend/client/calendar-client';
import type { FetchInit } from '../frontend/client/sdk';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarConfig } from './config';
import type { CalendarLocationPage } from './contracts';
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView } from './location-policy-contracts';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

type Account = { accessToken: string; user: { userId: string } };
type Client = ReturnType<typeof createCalendarClient>;
const occupied = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z' };
const effective = (locationId: string, startAt = '2030-01-01T09:00:00.000Z', endAt = '2030-01-01T12:00:00.000Z'): CalendarResourceLocationPolicyInput =>
  ({ kind: 'effective-utc-v1', assignments: [{ locationId, windows: [{ startAt, endAt }] }] });
interface HttpFixture {
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
  request(method: string, path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<Response>;
  register(suffix: string): Promise<Account>;
  client(token: string): Client;
}
async function withHttp(run: (input: HttpFixture) => Promise<void>, config: CalendarConfig = {}): Promise<void> {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single', config }), runtime = new ZeroAppRuntime('synthetic-location-policy-http-memory');
  const clients: Client[] = []; let app: Elysia | undefined;
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
        const response = await request(init?.method ?? 'GET', path, init?.body, token, init?.signal), body = await response.json();
        if (!response.ok) throw { status: response.status, body };
        return body as T;
      }, (path, init) => request(init.method ?? 'GET', path, undefined, token, init.signal ?? undefined));
      clients.push(value); return value;
    };
    await run({ fixture, request, client, async register(suffix) {
      const response = await request('POST', '/auth/register', { username: 'synthetic-location-policy-' + suffix,
        email: 'synthetic-location-policy-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<Account>;
    } });
  } finally {
    for (const client of clients) client.clear();
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await fixture.close(); }
  }
}

test('native policy HTTP/SDK preserve static replay, reject flattening and revalidate buffered booking and captured holds', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('booking'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    const resource = await api.resources.create({ label: 'Synthetic calendar', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const location = await api.locations.create({ label: 'PRIVATE_LOCATION', region: 'north' }, { idempotencyKey: 'location' });
    const original = await api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'static', expectedRevision: 1 });
    expect(await api.locations.policy.get(resource.id)).toEqual({ resourceId: resource.id, resourceRevision: 2, policy: { kind: 'static-v1', locationIds: [location.id] } });
    const visit = { mode: 'in-person' as const, location: { id: location.id, revision: 1 } };
    const hold = await api.holds.acquire({ ...occupied, resourceIds: [resource.id], timeZone: 'UTC', ttlSeconds: 30, visit }, { idempotencyKey: 'hold' });
    const policy = effective(location.id), changed = await api.locations.policy.replace(resource.id, policy, { idempotencyKey: 'effective', expectedRevision: 2 });
    expect(changed).toMatchObject({ operation: 'resource.location-policy-changed', revision: 3, changed: true });
    const current = await api.locations.policy.get(resource.id); expect(current.policy).toEqual(policy); expect(Object.isFrozen(current.policy)).toBe(true);
    const sequence = fixture.sourceSequence(scope);
    expect(await api.locations.policy.replace(resource.id, policy, { idempotencyKey: 'effective', expectedRevision: 2 })).toEqual(changed);
    expect(await api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'static', expectedRevision: 1 })).toEqual(original);
    await expect(api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'flatten', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_LOCATION_FORMAT_UNSUPPORTED', outcome: 'not-committed' });
    expect(fixture.sourceSequence(scope)).toBe(sequence);
    const history = fixture.sourceRows(scope, '_calendar_resource_location_policy_history');
    expect(await api.locations.policy.replace(resource.id, policy, { idempotencyKey: 'policy-noop', expectedRevision: 3 }))
      .toMatchObject({ operation: 'resource.location-policy-changed', revision: 3, changed: false });
    expect(fixture.sourceRows(scope, '_calendar_resource_location_policy_history')).toEqual(history);
    await expect(api.holds.confirm(hold.id, { title: 'Stale capture' }, { idempotencyKey: 'confirm', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_HOLD_STALE', outcome: 'not-committed' });
    await api.holds.release(hold.id, { idempotencyKey: 'release', expectedRevision: 1 });
    const query = { resourceIds: [resource.id], interval: occupied };
    expect((await api.locations.forVisit(query)).items.map(item => item.id)).toEqual([location.id]);
    await expect(api.appointments.create({ ...occupied, title: 'Outside assignment with buffer', resourceIds: [resource.id], timeZone: 'UTC', bufferBeforeMinutes: 61, visit },
      { idempotencyKey: 'buffer-outside' })).rejects.toMatchObject({ code: 'CALENDAR_VISIT_CONFLICT', outcome: 'not-committed' });
    const appointment = await api.appointments.create({ ...occupied, title: 'PRIVATE_VISIT', resourceIds: [resource.id], timeZone: 'UTC', visit }, { idempotencyKey: 'book' });
    await api.locations.policy.replace(resource.id, effective(location.id, '2030-01-01T13:00:00.000Z', '2030-01-01T14:00:00.000Z'),
      { idempotencyKey: 'restrict', expectedRevision: 3 });
    expect((await api.locations.forVisit(query)).items).toEqual([]);
    expect((await api.locations.forVisit({ resourceIds: [resource.id] })).items.map(item => item.id)).toEqual([location.id]);
    expect(await api.appointments.create({ ...occupied, title: 'PRIVATE_VISIT', resourceIds: [resource.id], timeZone: 'UTC', visit }, { idempotencyKey: 'book' })).toEqual(appointment);
    await api.appointments.update(appointment.id, { title: 'PRIVATE_RETAINED_VISIT' }, { idempotencyKey: 'title', expectedRevision: 1 });
    expect(await api.appointments.get(appointment.id)).toMatchObject({ title: 'PRIVATE_RETAINED_VISIT', visit });
    await expect(api.appointments.reschedule(appointment.id, { ...occupied, bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
      startAt: '2030-01-01T12:30:00.000Z', endAt: '2030-01-01T13:30:00.000Z', timeZone: 'UTC' }, { idempotencyKey: 'gap', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_VISIT_CONFLICT', outcome: 'not-committed' });
    await api.locations.policy.replace(resource.id, { kind: 'static-v1', locationIds: [location.id] }, { idempotencyKey: 'explicit-static', expectedRevision: 4 });
    expect((await api.locations.forVisit(query)).items[0]!.id).toBe(location.id);
    expect(await api.resources.setLocations(resource.id, [], { idempotencyKey: 'legacy-after-static', expectedRevision: 5 })).toMatchObject({ revision: 6 });
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('native policy routes enforce closed authoring/configured selection limits without hidden-ID oracles', async () => {
  await withHttp(async ({ fixture, request, register, client }) => {
    expect((await request('GET', '/api/calendar/resources/missing/location-policy')).status).toBe(401);
    const owner = await register('privacy-owner'), delegate = await register('privacy-delegate'), api = client(owner.accessToken), viewer = client(delegate.accessToken);
    const visible = await api.locations.create({ label: 'PRIVATE_VISIBLE' }, { idempotencyKey: 'visible' });
    const hidden = await api.locations.create({ label: 'PRIVATE_HIDDEN' }, { idempotencyKey: 'hidden' });
    const source = await api.resources.create({ label: 'Source', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'source' });
    const target = await api.resources.create({ label: 'Target', kind: 'person', ownerId: delegate.user.userId, timeZone: 'UTC' }, { idempotencyKey: 'target' });
    await api.resources.setLocations(source.id, [visible.id], { idempotencyKey: 'source-assignment', expectedRevision: 1 });
    const scope = fixture.session(owner.user.userId).scope, before = fixture.sourceSequence(scope);
    await expect(viewer.locations.policy.get(source.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(viewer.locations.policy.replace(target.id, effective(hidden.id), { idempotencyKey: 'guess-hidden', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(fixture.sourceSequence(scope)).toBe(before);
    await api.resources.setGrants(source.id, delegate.user.userId, ['busy'], { idempotencyKey: 'directory-only', expectedRevision: 2 });
    expect(await viewer.locations.policy.replace(target.id, effective(visible.id), { idempotencyKey: 'witnessed', expectedRevision: 1 })).toMatchObject({ revision: 2 });
    const path = '/api/calendar/resources/' + target.id + '/location-policy', requestPolicy = effective(visible.id), acquisitions = fixture.stats().acquisitions;
    const invalid = [
      { policy: { ...requestPolicy, actor: {} }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } },
      { policy: { kind: 'static-v1', locationIds: Array.from({ length: 17 }, (_, index) => 'loc-' + index) }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } },
      { policy: effective(visible.id) , options: { idempotencyKey: 'invalid', expectedRevision: 2, scopeId: 'forged' } },
      { policy: { kind: 'effective-utc-v1', assignments: [{ locationId: visible.id, windows: Array.from({ length: 65 }, () => occupied) }] }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } },
      { policy: { kind: 'effective-utc-v1', assignments: Array.from({ length: 5 }, (_, index) => ({ locationId: 'location-' + index,
        windows: Array.from({ length: index === 4 ? 1 : 64 }, () => occupied) })) }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } },
      { policy: requestPolicy, options: { idempotencyKey: 'invalid', expectedRevision: 2 }, actor: {} },
    ];
    for (const body of invalid) expect((await request('PUT', path, body, delegate.accessToken)).status).toBe(400);
    for (const suffix of ['?scopeId=forged', '?actor=forged', '?limit=1&limit=2']) {
      expect((await request('GET', path + suffix, undefined, delegate.accessToken)).status).toBe(400);
      expect((await request('PUT', path + suffix, { policy: requestPolicy, options: { idempotencyKey: 'invalid', expectedRevision: 2 } }, delegate.accessToken)).status).toBe(400);
    }
    const visit = '/api/calendar/visit-locations?' + new URLSearchParams({ resourceIds: target.id, startAt: occupied.startAt, endAt: occupied.endAt });
    for (const suffix of ['&actor=forged', '&startAt=' + occupied.startAt, '&limit=2']) expect((await request('GET', visit + suffix, undefined, delegate.accessToken)).status).toBe(400);
    expect((await request('GET', '/api/calendar/visit-locations?' + new URLSearchParams({ resourceIds: target.id, startAt: occupied.startAt }), undefined, delegate.accessToken)).status).toBe(400);
    expect((await request('GET', '/api/calendar/visit-locations?' + new URLSearchParams({ resourceIds: target.id + ',another', startAt: occupied.startAt, endAt: occupied.endAt }), undefined, delegate.accessToken)).status).toBe(400);
    expect(fixture.stats().acquisitions).toBe(acquisitions); expect(fixture.stats().subscriptions).toBe(0);
    expect((await viewer.locations.forVisit({ resourceIds: [target.id], interval: occupied })).items[0]!.id).toBe(visible.id);
    expect(fixture.stats().activeLeases).toBe(0);
  }, { maxResources: 1, maxPageSize: 1 });
}, 30_000);

test('native policy and interval-aware SDK streams publish current decisions and withdraw after object-grant revocation', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('live-owner'), delegate = await register('live-delegate'), api = client(owner.accessToken), viewer = client(delegate.accessToken);
    const resource = await api.resources.create({ label: 'Synthetic live assignment', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const location = await api.locations.create({ label: 'PRIVATE_LIVE_LOCATION' }, { idempotencyKey: 'location' });
    await api.locations.policy.replace(resource.id, effective(location.id), { idempotencyKey: 'policy', expectedRevision: 1 });
    await api.resources.setGrants(resource.id, delegate.user.userId, ['book'], { idempotencyKey: 'grant', expectedRevision: 2 });
    const policies: CalendarResourceLocationPolicyView[] = [], places: CalendarLocationPage[] = [], errors: unknown[] = [];
    const stops: (() => void)[] = [];
    try {
      stops.push(viewer.locations.policy.watch(resource.id, page => policies.push(page), { onError: error => errors.push(error) }));
      stops.push(viewer.locations.watchForVisit({ resourceIds: [resource.id], interval: occupied }, page => places.push(page), { onError: error => errors.push(error) }));
      await eventuallyCalendar(() => policies.length > 0 && places.length > 0 && fixture.stats().subscriptions === 2);
      expect(places[0]!.items[0]!.id).toBe(location.id); expect(policies[0]!.policy).toEqual(effective(location.id));
      const restricted = effective(location.id, '2030-01-01T12:00:00.000Z', '2030-01-01T13:00:00.000Z');
      await api.locations.policy.replace(resource.id, restricted, { idempotencyKey: 'restrict', expectedRevision: 3 });
      await eventuallyCalendar(() => places.at(-1)?.items.length === 0 && policies.at(-1)?.resourceRevision === 4);
      expect(policies.at(-1)!.policy).toEqual(restricted);
      await api.resources.setGrants(resource.id, delegate.user.userId, [], { idempotencyKey: 'revoke', expectedRevision: 4 });
      await eventuallyCalendar(() => errors.length === 2 && fixture.stats().subscriptions === 0);
      await expect(viewer.locations.policy.get(resource.id)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      await expect(viewer.locations.forVisit({ resourceIds: [resource.id], interval: occupied })).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      expect(fixture.stats().activeLeases).toBe(0);
    } finally { for (const stop of stops) stop(); viewer.clear(); }
  });
}, 30_000);
