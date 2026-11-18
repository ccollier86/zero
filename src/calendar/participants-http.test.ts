/** Native HTTP/auth + canonical SYSTEM directory + service/runtime/realm, entirely in memory.
 * app.handle only: no listener, physical actor, SQLite file, dependency install or generated fixture.
 */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_AUTH_STORE, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_TENANCY_SERVICE, ZERO_AUTHORIZATION_KERNEL, ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarCommandReceipt, CalendarParticipantDirectoryPage, CalendarParticipantReference, CalendarParticipantsView } from './contracts';
import { createCalendarHttp } from './http';
import { ManagedCalendarParticipantDirectory, type CalendarParticipantDirectory } from './participants-directory';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

interface Account { accessToken: string; user: { userId: string; role: string }; tenant?: { tenantId: string } }
const ref = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });
const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
const later = { startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z', timeZone: 'UTC' };

async function withHttp(run: (input: {
  request(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  register(suffix: string, organizationName?: string): Promise<Account>;
  runtime: ZeroAppRuntime;
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
}) => Promise<void>, tenancy: 'single' | 'multi' = 'single') {
  const runtime = new ZeroAppRuntime('synthetic-participants-native-http');
  let directory: ManagedCalendarParticipantDirectory | undefined, app: Elysia | undefined;
  // Auth starts on first native request. This proxy only defers construction;
  // every operation uses the actual managed canonical implementation, not test target decisions.
  const current = () => directory ??= new ManagedCalendarParticipantDirectory({ db: fixture.system, config: fixture.config,
    users: runtime.require(ZERO_AUTH_STORE), kernel: runtime.require(ZERO_AUTHORIZATION_KERNEL),
    tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE), roles: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
    assertCurrent: () => runtime.require(ZERO_AUTH_TOKEN_SERVICE).assertCurrentProfile() });
  const lazy: CalendarParticipantDirectory = {
    list: (...args) => current().list(...args), resolve: (...args) => current().resolve(...args),
    assertBindable: (...args) => current().assertBindable(...args), subscribe: (...args) => current().subscribe(...args),
  };
  const fixture = memoryCalendarServiceFixture({ tenancy, config: { participants: { userEligibility: 'user' } }, participantDirectory: lazy });
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, fixture.service);
    app = new Elysia().use(createAuthPlugin({ db: fixture.system, runtime, bootstrap: 'public', registration: { mode: 'public' }, tenancy }))
      .use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    await run({ request, fixture, runtime, async register(suffix, organizationName) {
      const response = await request('POST', '/auth/register', { username: 'synthetic-participants-' + suffix,
        email: 'synthetic-participants-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!',
        firstName: 'PRIVATE_NATIVE_' + suffix, ...(organizationName ? { organizationName } : {}) });
      expect(response.status).toBe(200); return response.json() as Promise<Account>;
    } });
  } finally {
    try { await fixture.service.close(); directory?.close(); if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await fixture.close(); }
  }
}
async function receipt(response: Response): Promise<CalendarCommandReceipt> {
  expect(response.status).toBe(200); const value = await response.json() as CalendarCommandReceipt;
  expect(Object.keys(value).sort()).toEqual(['changed', 'id', 'operation', 'requestId', 'revision']); return value;
}

test('native enabled directory and appointment binding replacement use canonical accounts and expose safe receipt/private projections only', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    expect((await request('GET', '/api/calendar/participants')).status).toBe(401);
    const manager = await register('manager'), target = await register('participant');
    const discovered = await request('GET', '/api/calendar/participants?search=PRIVATE_NATIVE_participant', undefined, manager.accessToken);
    expect(discovered.status, await discovered.clone().text()).toBe(200); expect(await discovered.json()).toEqual({ items: [{ ref: ref(target.user.userId), availability: 'available', name: 'PRIVATE_NATIVE_participant' }], truncated: false, nextAfter: null });
    expect(fixture.stats().planes).toBe(0); // Directory discovery never provisions a calendar file.
    const resource = await receipt(await request('POST', '/api/calendar/resources', { resource: { label: 'Native room', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'room' } }, manager.accessToken));
    const create = { appointment: { ...timed, resourceIds: [resource.id], title: 'Private native appointment', participants: [ref(target.user.userId)] }, options: { idempotencyKey: 'appointment' } };
    const made = await receipt(await request('POST', '/api/calendar/appointments', create, manager.accessToken));
    const bound = await request('GET', '/api/calendar/appointments/' + made.id + '/participants', undefined, manager.accessToken);
    expect(bound.status).toBe(200); expect(await bound.json()).toEqual({ id: made.id, revision: 1, participants: [{ ref: ref(target.user.userId), availability: 'available', name: 'PRIVATE_NATIVE_participant' }] });
    const detailResponse = await request('GET', '/api/calendar/appointments/' + made.id, undefined, manager.accessToken); expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json();
    expect(detail).not.toHaveProperty('participants'); expect(JSON.stringify(detail)).not.toContain(target.user.userId);
    const busyResponse = await request('POST', '/api/calendar/busy/query', { query: { resourceIds: [resource.id], startAt: timed.startAt, endAt: timed.endAt } }, manager.accessToken); expect(busyResponse.status).toBe(200);
    const busy = await busyResponse.json();
    expect(JSON.stringify(busy)).not.toContain(target.user.userId); expect(JSON.stringify(busy)).not.toContain('PRIVATE_NATIVE_participant');
    const change = { references: [], options: { idempotencyKey: 'remove-participant', expectedRevision: 1 } };
    const changed = await receipt(await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', change, manager.accessToken));
    expect(changed).toMatchObject({ operation: 'appointment.participants-changed', id: made.id, revision: 2 });
    expect(await (await request('GET', '/api/calendar/appointments/' + made.id + '/participants', undefined, manager.accessToken)).json()).toEqual({ id: made.id, revision: 2, participants: [] });
    expect(await (await request('GET', '/api/calendar/receipts/remove-participant', undefined, manager.accessToken)).json()).toEqual({ receipt: changed });
    expect(await receipt(await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', change, manager.accessToken))).toEqual(changed);
    const conflict = await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', { ...change, references: [ref(target.user.userId)] }, manager.accessToken);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT', outcome: 'not-committed' });
  });
}, 30_000);

test('native holds retain exact bindings, fresh canonical target eligibility prevents confirmation, and accepted replay survives revocation', async () => {
  await withHttp(async ({ request, register, runtime }) => {
    const manager = await register('hold-manager'), target = await register('hold-target'), token = manager.accessToken;
    const resource = await receipt(await request('POST', '/api/calendar/resources', { resource: { label: 'Hold room', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'room' } }, token));
    const held = await receipt(await request('POST', '/api/calendar/holds', { hold: { ...timed, resourceIds: [resource.id], participants: [ref(target.user.userId)], ttlSeconds: 120 }, options: { idempotencyKey: 'hold' } }, token));
    const path = '/api/calendar/holds/' + held.id;
    const holdDetail = await request('GET', path, undefined, token); expect(holdDetail.status).toBe(200); expect(await holdDetail.json()).not.toHaveProperty('participants');
    const binding = await request('GET', path + '/participants', undefined, token);
    expect(binding.status, await binding.clone().text()).toBe(200); expect(await binding.json()).toMatchObject({ id: held.id, revision: 1, participants: [{ ref: ref(target.user.userId), availability: 'available' }] });
    runtime.require(ZERO_AUTH_STORE).updateUser(target.user.userId, { status: 'suspended' });
    const confirm = { appointment: { title: 'Native confirmed appointment' }, options: { idempotencyKey: 'confirm', expectedRevision: 1 } };
    const denied = await request('POST', path + '/confirm', confirm, token);
    expect(denied.status).toBe(404); expect(await denied.json()).toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-started' });
    expect(await (await request('GET', '/api/calendar/receipts/confirm', undefined, token)).json()).toEqual({ receipt: null });
    expect(await (await request('GET', path, undefined, token)).json()).toMatchObject({ status: 'held', revision: 1 });
    runtime.require(ZERO_AUTH_STORE).updateUser(target.user.userId, { status: 'active' });
    const accepted = await receipt(await request('POST', path + '/confirm', confirm, token));
    expect(accepted).toMatchObject({ operation: 'appointment.created', revision: 1 });
    const transferred = await (await request('GET', '/api/calendar/appointments/' + accepted.id + '/participants', undefined, token)).json() as CalendarParticipantsView;
    expect(transferred.participants.map(item => item.ref)).toEqual([ref(target.user.userId)]);
    runtime.require(ZERO_AUTH_STORE).updateUser(target.user.userId, { status: 'suspended' });
    expect(await receipt(await request('POST', path + '/confirm', confirm, token))).toEqual(accepted);
    expect(await (await request('GET', '/api/calendar/appointments/' + accepted.id + '/participants', undefined, token)).json()).toEqual({ id: accepted.id, revision: 1, participants: [{ ref: ref(target.user.userId), availability: 'unavailable' }] });
  });
}, 30_000);

test('native nonmanager and raw query/body admission reject directory/binding authority widening even with resource manage grants', async () => {
  await withHttp(async ({ request, register }) => {
    const manager = await register('admission-manager'), reader = await register('admission-reader'), token = manager.accessToken;
    const resource = await receipt(await request('POST', '/api/calendar/resources', { resource: { label: 'Admission room', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'room' } }, token));
    await receipt(await request('POST', '/api/calendar/resources/' + resource.id + '/grants', { userId: reader.user.userId, grants: ['manage'], options: { idempotencyKey: 'manage', expectedRevision: 1 } }, token));
    const made = await receipt(await request('POST', '/api/calendar/appointments', { appointment: { ...timed, resourceIds: [resource.id], title: 'Private', participants: [ref(reader.user.userId)] }, options: { idempotencyKey: 'appointment' } }, token));
    for (const path of ['/api/calendar/participants', '/api/calendar/participants/live', '/api/calendar/appointments/' + made.id + '/participants', '/api/calendar/appointments/' + made.id + '/participants/live']) {
      const response = await request('GET', path, undefined, reader.accessToken); expect(response.status).toBe(403); expect(response.headers.get('Content-Type')).not.toContain('text/event-stream');
    }
    expect((await request('GET', '/api/calendar/appointments/' + made.id, undefined, reader.accessToken)).status).toBe(200);
    expect((await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', { references: [], options: { idempotencyKey: 'denied', expectedRevision: 1 } }, reader.accessToken)).status).toBe(403);
    expect((await request('POST', '/api/calendar/appointments', { appointment: { ...later, resourceIds: [resource.id], title: 'Denied', participants: [] }, options: { idempotencyKey: 'denied-create' } }, reader.accessToken)).status).toBe(403);
    for (const suffix of ['?actor=forged', '?scopeId=tenant:foreign', '?tenantId=foreign', '?search=a&search=b', '?limit=1&limit=2', '?after=a&after=b']) {
      for (const path of ['/api/calendar/participants', '/api/calendar/participants/live']) expect((await request('GET', path + suffix, undefined, token)).status).toBe(400);
    }
    for (const path of ['/api/calendar/appointments/' + made.id + '/participants', '/api/calendar/appointments/' + made.id + '/participants/live']) {
      expect((await request('GET', path + '?scopeId=foreign', undefined, token)).status).toBe(400);
      expect((await request('GET', path + '?search=x&search=y', undefined, token)).status).toBe(400);
    }
    for (const reference of [{ kind: 'contact', userId: reader.user.userId }, { ...ref(reader.user.userId), eligible: true }, { ...ref(reader.user.userId), name: 'Forged' }])
      expect((await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', { references: [reference], options: { idempotencyKey: 'malformed', expectedRevision: 1 } }, token)).status).toBe(400);
    expect((await request('PUT', '/api/calendar/appointments/' + made.id + '/participants', { references: [ref(reader.user.userId), ref(reader.user.userId)], options: { idempotencyKey: 'duplicate', expectedRevision: 1 } }, token)).status).toBe(400);
  });
}, 30_000);

test('native multi-tenant discovery/binding uses actual exact-tenant membership without application fallback', async () => {
  await withHttp(async ({ request, register, runtime }) => {
    const manager = await register('scope-manager', 'Calendar native organization'), foreign = await register('scope-foreign'), token = manager.accessToken;
    const directory = await request('GET', '/api/calendar/participants', undefined, token); expect(directory.status, await directory.clone().text()).toBe(200);
    const page = await directory.json() as CalendarParticipantDirectoryPage;
    expect(page.items.map(item => item.ref.userId)).toEqual([manager.user.userId]); expect(JSON.stringify(page)).not.toContain(foreign.user.userId);
    const resource = await receipt(await request('POST', '/api/calendar/resources', { resource: { label: 'Scoped room', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'room' } }, token));
    const input = { appointment: { ...timed, resourceIds: [resource.id], title: 'Scope bound', participants: [ref(foreign.user.userId)] }, options: { idempotencyKey: 'scoped' } };
    const denied = await request('POST', '/api/calendar/appointments', input, token); expect(denied.status).toBe(404); expect(await denied.json()).toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-started' });
    expect(await (await request('GET', '/api/calendar/receipts/scoped', undefined, token)).json()).toEqual({ receipt: null });
    expect((await request('GET', '/api/calendar/participants', undefined, foreign.accessToken)).status).not.toBe(200);
    const tenant = runtime.require(ZERO_AUTH_TENANCY_SERVICE).listActiveTenantMembershipsForUser(manager.user.userId)[0];
    expect(tenant).toBeDefined();
    runtime.require(ZERO_AUTH_TENANCY_SERVICE).addMembership({ tenantId: tenant!.tenant.tenantId, userId: foreign.user.userId, roleKey: 'member', createdBy: manager.user.userId });
    const accepted = await receipt(await request('POST', '/api/calendar/appointments', input, token));
    expect((await (await request('GET', '/api/calendar/appointments/' + accepted.id + '/participants', undefined, token)).json() as CalendarParticipantsView).participants.map(item => item.ref)).toEqual([ref(foreign.user.userId)]);
  }, 'multi');
}, 30_000);

test('native participant SSE responds to canonical directory hints, withdraws unavailable names, and terminates on viewer revocation with cancellation cleanup', async () => {
  await withHttp(async ({ request, register, runtime, fixture }) => {
    const manager = await register('stream-manager'), target = await register('stream-target'), token = manager.accessToken;
    const resource = await receipt(await request('POST', '/api/calendar/resources', { resource: { label: 'Stream room', kind: 'room', timeZone: 'UTC' }, options: { idempotencyKey: 'room' } }, token));
    const made = await receipt(await request('POST', '/api/calendar/appointments', { appointment: { ...timed, resourceIds: [resource.id], title: 'Stream', participants: [ref(target.user.userId)] }, options: { idempotencyKey: 'appointment' } }, token));
    const response = await request('GET', '/api/calendar/appointments/' + made.id + '/participants/live', undefined, token);
    expect(response.status, response.status === 200 ? '' : await response.clone().text()).toBe(200); expect(response.headers.get('Content-Type')).toContain('text/event-stream'); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const reader = response.body!.getReader();
    try {
      expect(await streamText(reader)).toContain('PRIVATE_NATIVE_stream-target');
      runtime.require(ZERO_AUTH_STORE).updateUser(target.user.userId, { firstName: 'CURRENT_NATIVE_TARGET' });
      expect(await streamText(reader)).toContain('CURRENT_NATIVE_TARGET');
      runtime.require(ZERO_AUTH_STORE).updateUser(target.user.userId, { status: 'suspended' });
      const tombstone = await streamText(reader); expect(tombstone).toContain('unavailable'); expect(tombstone).not.toContain('CURRENT_NATIVE_TARGET');
      runtime.require(ZERO_AUTH_STORE).revokeAllUserTokens(manager.user.userId);
      const invalidated = await streamText(reader); expect(invalidated).toContain('event: invalidated'); expect(invalidated).not.toContain(target.user.userId);
      expect((await reader.read()).done).toBe(true); await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
    } finally { await reader.cancel(); reader.releaseLock(); }
    // A second native live page owns the same teardown path on consumer cancellation.
    const another = await register('stream-cancel-manager');
    runtime.require(ZERO_AUTH_STORE).updateUser(another.user.userId, { role: 'admin' });
    const login = await request('POST', '/auth/login', { username: 'synthetic-participants-stream-cancel-manager', password: 'SyntheticOnly-Calendar-123!' });
    expect(login.status).toBe(200); const liveToken = (await login.json() as { accessToken: string }).accessToken;
    const live = await request('GET', '/api/calendar/participants/live', undefined, liveToken); expect(live.status).toBe(200);
    const canceled = live.body!.getReader();
    try { expect(await streamText(canceled)).toContain('snapshot'); }
    finally { await canceled.cancel(); canceled.releaseLock(); }
    await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
  });
}, 30_000);

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic participant HTTP stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic participant stream ended before its expected frame.');
    return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}
