/** Real Auth -> compiled app.handle -> SDK -> CalendarService -> native019 MEMORY.
 * No listener, provider, file or real identity. Every stream/client/DB is owned.
 */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { createCalendarClient } from '../frontend/client/calendar-client';
import { CalendarReadError } from '../frontend/client/calendar-mutation';
import type { FetchInit } from '../frontend/client/sdk';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_AUTH_STORE, ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarConfig } from './config';
import type { CalendarAppointmentCreateInput, CalendarOverrideGrantView, CalendarOverrideReview, CalendarAppointmentOverride } from './contracts';
import { createCalendarHttp } from './http';
import { memoryCalendarServiceFixture, eventuallyCalendar } from './test-support/memory-service-fixture';

type Account = { accessToken: string; user: { userId: string } };
type Client = ReturnType<typeof createCalendarClient>;
interface HttpFixture {
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
  request(method: string, path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<Response>;
  register(suffix: string): Promise<Account>;
  client(token: string): Client;
  suspend(userId: string): void;
}
const enabled: CalendarConfig = { overrides: { kind: 'appointment-overlap-v1', use: 'user', manageGrants: { platformRole: ['user', 'admin'] } } };
const proposed = (resourceIds: readonly string[]): CalendarAppointmentCreateInput => ({ title: 'PRIVATE_HTTP_TITLE', resourceIds,
  startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' });
function exception(value: CalendarOverrideReview): CalendarAppointmentOverride {
  if (value.status !== 'reviewable') throw new Error('Synthetic expected reviewable');
  return { policyVersion: value.policyVersion, decisionToken: value.decisionToken, reason: 'PRIVATE_HTTP_REASON' };
}
async function readRefusal(pending: Promise<unknown>, code: string, status: number): Promise<void> {
  try { await pending; throw new Error('Expected readonly refusal'); }
  catch (error) {
    expect(error).toBeInstanceOf(CalendarReadError);
    if (!(error instanceof CalendarReadError)) throw error;
    expect(error.code).toBe(code); expect(error.status).toBe(status);
  }
}
async function withHttp(run: (input: HttpFixture) => Promise<void>, config: CalendarConfig = enabled): Promise<void> {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single', config }), runtime = new ZeroAppRuntime('synthetic-calendar-override-http');
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
        if (!response.ok) throw { status: response.status, body }; return body as T;
      }, (path, init) => request(init.method ?? 'GET', path, undefined, token, init.signal ?? undefined));
      clients.push(value); return value;
    };
    // Consume only the framework bootstrap account. Actual test identities are
    // ordinary users, so ownership is not accidentally a global admin grant.
    expect((await request('POST', '/auth/register', { username: 'synthetic-override-bootstrap',
      email: 'synthetic-override-bootstrap@example.test', password: 'SyntheticOnly-Calendar-123!' })).status).toBe(200);
    await run({ fixture, request, client, suspend(userId) {
      expect(runtime.require(ZERO_AUTH_STORE).updateUser(userId, { status: 'suspended' })?.status).toBe('suspended');
    }, async register(suffix) {
      const response = await request('POST', '/auth/register', { username: 'synthetic-override-' + suffix,
        email: 'synthetic-override-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); const account = await response.json() as Account;
      fixture.session(account.user.userId); // Register this synthetic native target with the MEMORY fixture's roster.
      return account;
    } });
  } finally {
    for (const client of clients) client.clear();
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await fixture.close(); }
  }
}

test('native HTTP/SDK readonly review has zero writes, then same-key create/update commits one sealed ordinary outcome', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('workflow'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    const resource = await api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await api.overrides.grants.replace(resource.id, owner.user.userId, { categories: ['appointment-overlap'] }, { idempotencyKey: 'grant', expectedRevision: 1 });
    const input = proposed([resource.id]);
    expect(await api.appointments.reviewCreate(input, { idempotencyKey: 'unspent-clear' })).toEqual({ status: 'clear' });
    await api.appointments.create(input, { idempotencyKey: 'existing' });
    const seq = fixture.sourceSequence(scope), receipts = fixture.sourceRows(scope, '_calendar_receipts'), admissions = fixture.sourceRows(scope, '_calendar_override_admissions');
    const review = await api.appointments.reviewCreate(input, { idempotencyKey: 'future-create' });
    expect(review.status).toBe('reviewable'); expect(Object.isFrozen(review)).toBe(true);
    expect(JSON.stringify(review)).not.toMatch(/PRIVATE_|resourceId|appointmentId|witnessCount|reason/);
    expect(fixture.sourceSequence(scope)).toBe(seq); expect(fixture.sourceRows(scope, '_calendar_receipts')).toEqual(receipts);
    expect(fixture.sourceRows(scope, '_calendar_override_admissions')).toEqual(admissions);
    const ignored = new AbortController(); ignored.abort();
    await expect(api.appointments.reviewCreate(input, { idempotencyKey: 'cancelled-review', signal: ignored.signal })).rejects.toBeDefined();
    expect(fixture.sourceSequence(scope)).toBe(seq);
    const options = { idempotencyKey: 'future-create', override: exception(review) }, accepted = await api.appointments.create(input, options);
    expect(accepted).toMatchObject({ operation: 'appointment.created', revision: 1, changed: true });
    const after = fixture.sourceSequence(scope); expect(await api.appointments.create(input, options)).toEqual(accepted);
    expect(fixture.sourceSequence(scope)).toBe(after);
    const view = await api.appointments.get(accepted.id); expect(view.title).toBe('PRIVATE_HTTP_TITLE');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE_HTTP_REASON|decisionToken|override|witness/);
    const patch = { startAt: '2030-01-01T10:15:00.000Z', endAt: '2030-01-01T10:45:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const updateReview = await api.appointments.reviewUpdate(accepted.id, patch, { idempotencyKey: 'future-update', expectedRevision: 1 });
    const updated = await api.appointments.update(accepted.id, patch, { idempotencyKey: 'future-update', expectedRevision: 1, override: exception(updateReview) });
    expect(updated).toMatchObject({ operation: 'appointment.updated', revision: 2 });
    expect(fixture.sourceRows(scope, '_calendar_override_admissions')).toHaveLength(2);
    expect(fixture.sourceRows(scope, '_calendar_appointment_override_history')).toHaveLength(2);
    expect(fixture.sourceRows(scope, '_calendar_override_witnesses')).toHaveLength(2);
    const grantRevoke = await api.overrides.grants.replace(resource.id, owner.user.userId, { categories: [] }, { idempotencyKey: 'revoke', expectedRevision: 2 });
    expect(grantRevoke).toMatchObject({ operation: 'resource.override-grant-changed', revision: 3 });
    expect(await api.appointments.create(input, options)).toEqual(accepted);
    await api.appointments.update(accepted.id, { title: 'Grandfathered title' }, { idempotencyKey: 'title', expectedRevision: 2 });
    expect(fixture.sourceRows(scope, '_calendar_override_admissions')).toHaveLength(2);
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('actual auth SYSTEM suspension refuses fresh target grants, but original grant replay and explicit revocation remain factual', async () => {
  await withHttp(async ({ fixture, register, client, suspend }) => {
    const owner = await register('target-owner'), target = await register('target-subject'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    const resource = await api.resources.create({ label: 'Synthetic target scope', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const grants = { categories: ['appointment-overlap'] as const }, options = { idempotencyKey: 'target-grant', expectedRevision: 1 };
    const accepted = await api.overrides.grants.replace(resource.id, target.user.userId, grants, options);
    expect(accepted).toMatchObject({ revision: 2 }); suspend(target.user.userId);
    const before = fixture.sourceSequence(scope), history = fixture.sourceRows(scope, '_calendar_override_grant_history');
    expect(await api.overrides.grants.replace(resource.id, target.user.userId, grants, options)).toEqual(accepted);
    expect(fixture.sourceSequence(scope)).toBe(before);
    await expect(api.overrides.grants.replace(resource.id, target.user.userId, grants, { idempotencyKey: 'suspended-target', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-started' });
    expect(fixture.sourceRows(scope, '_calendar_override_grant_history')).toEqual(history); expect(fixture.sourceSequence(scope)).toBe(before);
    expect(await api.receipts.get('suspended-target')).toBeNull();
    expect(await api.overrides.grants.replace(resource.id, target.user.userId, { categories: [] }, { idempotencyKey: 'revoke-unavailable', expectedRevision: 2 }))
      .toMatchObject({ revision: 3, changed: true });
    expect((await api.overrides.grants.get(resource.id, target.user.userId)).categories).toEqual([]);
    expect(fixture.sourceRows(scope, '_calendar_override_grant_history')).toHaveLength(2);
    expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('native review routes conceal independent authority and co-resources before conflict outcomes; forged fields never acquire source', async () => {
  await withHttp(async ({ fixture, request, register, client }) => {
    expect((await request('POST', '/api/calendar/appointments/review-create', { appointment: proposed(['r']), options: { idempotencyKey: 'x' } })).status).toBe(401);
    const owner = await register('privacy-owner'), other = await register('privacy-other'), api = client(owner.accessToken), viewer = client(other.accessToken);
    await readRefusal(api.appointments.reviewCreate(proposed(['missing']), { idempotencyKey: 'never-owned-review' }), 'CALENDAR_NOT_FOUND', 404);
    expect(fixture.stats().planes).toBe(0); expect(fixture.stats().ownerRows).toBe(0);
    const resource = await api.resources.create({ label: 'PRIVATE_VISIBLE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const hidden = await viewer.resources.create({ label: 'PRIVATE_HIDDEN', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'hidden' });
    await api.appointments.create(proposed([resource.id]), { idempotencyKey: 'existing' });
    await readRefusal(api.appointments.reviewCreate(proposed([resource.id]), { idempotencyKey: 'owner-not-grant' }), 'CALENDAR_OVERRIDE_NOT_ALLOWED', 409);
    await api.overrides.grants.replace(resource.id, owner.user.userId, { categories: ['appointment-overlap'] }, { idempotencyKey: 'grant', expectedRevision: 1 });
    await readRefusal(api.appointments.reviewCreate(proposed([resource.id, hidden.id]), { idempotencyKey: 'hidden-co-resource' }), 'CALENDAR_NOT_FOUND', 404);
    await expect(viewer.overrides.grants.get(resource.id, owner.user.userId)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const acquisitions = fixture.stats().acquisitions, path = '/api/calendar/appointments/review-create', body = { appointment: proposed([resource.id]), options: { idempotencyKey: 'invalid' } };
    for (const invalid of [
      { ...body, actor: {} }, { ...body, appointment: { ...body.appointment, id: 'forged' } },
      { ...body, appointment: { ...body.appointment, actor: {} } }, { ...body, options: { ...body.options, scopeId: 'forged' } },
      { ...body, options: { ...body.options, override: { policyVersion: 'appointment-overlap-v1', decisionToken: 'fake', reason: 'fake' } } },
    ]) expect((await request('POST', path, invalid, owner.accessToken)).status).toBe(400);
    expect((await request('POST', path + '?actor=forged', body, owner.accessToken)).status).toBe(400);
    expect((await request('PUT', '/api/calendar/resources/' + resource.id + '/override-grants/' + owner.user.userId,
      { grants: { categories: ['block-overlap'] }, options: { idempotencyKey: 'bad-grant', expectedRevision: 2 } }, owner.accessToken)).status).toBe(400);
    expect(fixture.stats().acquisitions).toBe(acquisitions); expect(fixture.stats().activeLeases).toBe(0);
    const scope = fixture.session(owner.user.userId).scope, sequence = fixture.sourceSequence(scope);
    // Duplicate selection is a canonical semantic rejection. It may use a
    // readonly lease, but cannot spend the proposed key or mutate a source.
    expect((await request('POST', path, { ...body, appointment: { ...body.appointment, resourceIds: [resource.id, resource.id] } }, owner.accessToken)).status).toBe(400);
    expect(fixture.sourceSequence(scope)).toBe(sequence); expect(fixture.stats().activeLeases).toBe(0);
  });
}, 30_000);

test('native readonly review stays disabled by default and never treats ordinary owner powers as the independent capability', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('disabled'), api = client(owner.accessToken), scope = fixture.session(owner.user.userId).scope;
    const resource = await api.resources.create({ label: 'Own', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const before = fixture.sourceSequence(scope);
    expect((await api.capabilities.get()).appointmentOverrides).toBe(false);
    await expect(api.appointments.reviewCreate(proposed([resource.id]), { idempotencyKey: 'disabled-review' })).rejects.toMatchObject({ code: 'CALENDAR_OVERRIDE_NOT_ALLOWED' });
    await expect(api.overrides.grants.replace(resource.id, owner.user.userId, { categories: ['appointment-overlap'] }, { idempotencyKey: 'disabled-grant', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_OVERRIDE_NOT_ALLOWED' });
    const acquisitions = fixture.stats().acquisitions;
    await readRefusal(api.appointments.reviewCreate(proposed([resource.id, 'second']), { idempotencyKey: 'configured-selection-bound' }), 'CALENDAR_INPUT_INVALID', 400);
    expect(fixture.stats().acquisitions).toBe(acquisitions);
    expect(fixture.sourceSequence(scope)).toBe(before);
  }, { maxResources: 1 });
}, 30_000);

test('native grant SSE publishes current replacement and withdraws on ordinary management revocation', async () => {
  await withHttp(async ({ fixture, register, client }) => {
    const owner = await register('stream-owner'), other = await register('stream-other'), api = client(owner.accessToken), viewer = client(other.accessToken);
    const resource = await api.resources.create({ label: 'Synthetic stream', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    await api.resources.setGrants(resource.id, other.user.userId, ['manage'], { idempotencyKey: 'ordinary-manager', expectedRevision: 1 });
    const pages: CalendarOverrideGrantView[] = [], errors: unknown[] = [];
    const stop = viewer.overrides.grants.watch(resource.id, other.user.userId, page => pages.push(page), { onError: error => errors.push(error) });
    try {
      await eventuallyCalendar(() => pages.length === 1 && fixture.stats().subscriptions === 1);
      expect(pages[0]!.categories).toEqual([]);
      await api.overrides.grants.replace(resource.id, other.user.userId, { categories: ['appointment-overlap'] }, { idempotencyKey: 'exception-grant', expectedRevision: 2 });
      await eventuallyCalendar(() => pages.at(-1)?.categories.length === 1);
      expect(pages.at(-1)!.resourceRevision).toBe(3); expect(Object.isFrozen(pages.at(-1))).toBe(true);
      await api.resources.setGrants(resource.id, other.user.userId, [], { idempotencyKey: 'revoke-manager', expectedRevision: 3 });
      await eventuallyCalendar(() => errors.length === 1 && fixture.stats().subscriptions === 0);
      await expect(viewer.overrides.grants.get(resource.id, other.user.userId)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      expect(fixture.stats().activeLeases).toBe(0);
    } finally { stop(); viewer.clear(); }
  });
}, 30_000);
