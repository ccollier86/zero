/** Native authenticated HTTP -> facade -> MEMORY runtime/realm. No listener, files or actor launch. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createCalendarClient } from '../frontend/client/calendar-client';
import type { FetchInit } from '../frontend/client/sdk';
import { createCalendarHttp } from './http';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test('atomic update native HTTP and real SDK keep closed envelopes, current object authority, CAS and replay', async () => {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-atomic-update-http-memory');
  let app: Elysia | undefined;
  const clients: ReturnType<typeof createCalendarClient>[] = [];
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
    const register = async (suffix: string) => {
      const response = await request('POST', '/auth/register', { username: 'synthetic-atomic-' + suffix,
        email: 'synthetic-atomic-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    };
    expect((await request('PUT', '/api/calendar/appointments/missing', { appointment: { title: 'x' }, options: { idempotencyKey: 'x', expectedRevision: 1 } })).status).toBe(401);
    const owner = await register('owner'), delegate = await register('delegate');
    const client = (token: string) => {
      const sdk = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
        const response = await request(init?.method ?? 'GET', path, init?.body, token);
        const body = await response.json();
        if (!response.ok) throw { status: response.status, body };
        return body as T;
      });
      clients.push(sdk); return sdk;
    };
    const api = client(owner.accessToken), reader = client(delegate.accessToken);
    const resource = await api.resources.create({ label: 'Synthetic', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const made = await api.appointments.create({ resourceIds: [resource.id], title: 'Original', startAt: '2030-01-01T10:00:00.000Z',
      endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' }, { idempotencyKey: 'create' });
    const path = '/api/calendar/appointments/' + made.id, control = { idempotencyKey: 'atomic', expectedRevision: 1 };
    const first = await api.appointments.update(made.id, { title: 'PRIVATE_ATOMIC_HTTP_TITLE', visit: { mode: 'video' } }, control);
    expect(first).toMatchObject({ operation: 'appointment.updated', revision: 2, id: made.id, changed: true });
    expect(await api.appointments.update(made.id, { title: 'PRIVATE_ATOMIC_HTTP_TITLE', visit: { mode: 'video' } }, control)).toEqual(first);
    expect(await api.receipts.get('atomic')).toEqual(first);
    expect(await api.appointments.get(made.id)).toMatchObject({ title: 'PRIVATE_ATOMIC_HTTP_TITLE', visit: { mode: 'video' }, revision: 2 });
    await expect(reader.appointments.update(made.id, { title: 'denied' }, { idempotencyKey: 'denied', expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-committed' });
    for (const suffix of ['?scopeId=forged', '?actor=x', '?revision=1&revision=2']) {
      expect((await request('PUT', path + suffix, { appointment: { title: 'x' }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } }, owner.accessToken)).status).toBe(400);
    }
    for (const body of [{ appointment: {}, options: control },
      { appointment: { title: 'x', id: 'forged' }, options: control },
      { appointment: { startAt: '2030-01-01T12:00:00.000Z' }, options: control },
      { appointment: { resourceIds: [] }, options: control },
      { appointment: { resourceIds: Array.from({ length: 17 }, (_, n) => 'resource-' + n) }, options: control },
      { appointment: { title: 'x' }, options: { ...control, expectedRevision: 0 } },
      { appointment: { title: 'x' }, options: { ...control, scopeId: 'forged' } },
      { appointment: { title: 'x' }, options: control, actor: { manageAll: true } }]) {
      expect((await request('PUT', path, body, owner.accessToken)).status).toBe(400);
    }
    await expect(api.appointments.update(made.id, { title: 'stale' }, { idempotencyKey: 'stale', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed', requiresReconciliation: false });
    await expect(api.appointments.update(made.id, { title: 'changed intent' }, control))
      .rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT', outcome: 'not-committed' });
    await api.resources.setGrants(resource.id, delegate.user.userId, ['manage'], { idempotencyKey: 'grant', expectedRevision: 1 });
    expect(await reader.appointments.update(made.id, { title: 'Delegated' }, { idempotencyKey: 'delegate', expectedRevision: 2 }))
      .toMatchObject({ revision: 3, operation: 'appointment.updated' });
    await expect(reader.appointments.update(made.id, { participants: [] }, { idempotencyKey: 'no-participants', expectedRevision: 3 }))
      .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await api.resources.setGrants(resource.id, delegate.user.userId, [], { idempotencyKey: 'revoke', expectedRevision: 2 });
    const scope = fixture.session(owner.user.userId).scope, sequence = fixture.sourceSequence(scope);
    const deniedReplay = await reader.appointments.update(made.id, { title: 'Delegated' }, { idempotencyKey: 'delegate', expectedRevision: 2 })
      .catch(error => error);
    // The exact transport replay is historically accepted; refusal to publish
    // its receipt under current grants must not relabel it a safe noncommit.
    expect(deniedReplay).toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', status: 503,
      outcome: 'unknown', idempotencyKey: 'delegate', requiresSameIdempotencyKey: true });
    await expect(reader.receipts.get('delegate')).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(fixture.sourceSequence(scope)).toBe(sequence);
    expect(fixture.stats().activeLeases).toBe(0);
  } finally {
    for (const client of clients) client.clear();
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await fixture.close(); }
  }
}, 30_000);
