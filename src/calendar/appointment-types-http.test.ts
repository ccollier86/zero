/** Real native auth/routes/Guardian/runtime/realm, memory only. Never listens or writes fixtures. */
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
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-types-http-memory');
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
      const response = await request('POST', '/auth/register', { username: 'synthetic-types-' + suffix,
        email: 'synthetic-types-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}

test('native appointment types use exact routes/envelopes, retain typed history and reject authored query/authority keys', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    expect((await request('GET', '/api/calendar/types')).status).toBe(401);
    const account = await register('lifecycle'), token = account.accessToken;
    const empty = await request('GET', '/api/calendar/types', undefined, token); expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [], truncated: false, nextAfter: null }); expect(fixture.stats().planes).toBe(0);
    for (const body of [{ type: { label: 'Visit', durationMinutes: 0 }, options: { idempotencyKey: 'invalid' } },
      { type: { label: 'Visit', durationMinutes: 30, actor: {} }, options: { idempotencyKey: 'invalid' } },
      { type: { label: 'Visit', durationMinutes: 30 }, options: { idempotencyKey: 'invalid' }, scopeId: 'forged' }]) {
      expect((await request('POST', '/api/calendar/types', body, token)).status).toBe(400);
    }
    expect(fixture.stats().planes).toBe(0);
    const creating = await request('POST', '/api/calendar/types', { type: { label: 'Visit', durationMinutes: 30, bufferBeforeMinutes: 5 }, options: { idempotencyKey: 'type' } }, token);
    expect(creating.status).toBe(200); const type = await creating.json() as { id: string };
    expect(type).toMatchObject({ operation: 'type.created', revision: 1 });
    const current = await (await request('GET', '/api/calendar/types/' + type.id, undefined, token)).json();
    expect(current).toMatchObject({ label: 'Visit', durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 0, active: true, colorKey: null });
    const resourceResponse = await request('POST', '/api/calendar/resources', { resource: { label: 'Native', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    expect(resourceResponse.status).toBe(200); const resource = await resourceResponse.json() as { id: string };
    const path = '/api/calendar/resources/' + resource.id + '/types';
    expect(await (await request('GET', path, undefined, token)).json()).toEqual({ resourceId: resource.id, resourceRevision: 1, mode: 'unrestricted', typeIds: [] });
    const assigned = await request('PUT', path, { mode: 'required', typeIds: [type.id], options: { idempotencyKey: 'policy', expectedRevision: 1 } }, token);
    expect(assigned.status).toBe(200); expect(await assigned.json()).toMatchObject({ operation: 'resource.types-changed', revision: 2, id: resource.id });
    for (const suffix of ['actor=forged', 'resourceIds=x&resourceIds=y', 'limit=1&limit=2', 'resourceIds=x,x']) {
      expect((await request('GET', '/api/calendar/types?' + suffix, undefined, token)).status).toBe(400);
      expect((await request('GET', '/api/calendar/types/live?' + suffix, undefined, token)).status).toBe(400);
    }
    for (const detail of ['/api/calendar/types/' + type.id, path]) expect((await request('GET', detail + '?scopeId=forged', undefined, token)).status).toBe(400);
    expect(await (await request('GET', '/api/calendar/types?resourceIds=', undefined, token)).json()).toEqual({ items: [], truncated: false, nextAfter: null });
    const appointment = { resourceIds: [resource.id], title: 'Typed', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T10:30:00.000Z', timeZone: 'UTC' };
    const missing = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'missing' } }, token);
    expect(missing.status).toBe(409); expect(await missing.json()).toMatchObject({ code: 'CALENDAR_TYPE_CONFLICT', outcome: 'not-committed' });
    const stale = await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, appointmentType: { id: type.id, revision: 2 } }, options: { idempotencyKey: 'stale' } }, token);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CALENDAR_TYPE_STALE', outcome: 'not-committed' });
    const created = await request('POST', '/api/calendar/appointments', { appointment: { ...appointment, appointmentType: { id: type.id, revision: 1 } }, options: { idempotencyKey: 'booking' } }, token);
    expect(created.status).toBe(200); const booking = await created.json() as { id: string };
    const view = await (await request('GET', '/api/calendar/appointments/' + booking.id, undefined, token)).json();
    expect(view).toMatchObject({ bufferBeforeMinutes: 5, bufferAfterMinutes: 0, appointmentType: { id: type.id, revision: 1, label: 'Visit', durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 0, colorKey: null } });
    const replacement = { label: 'Retired', durationMinutes: 45, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: false };
    expect((await request('PUT', '/api/calendar/types/' + type.id, { type: replacement, options: { idempotencyKey: 'replace', expectedRevision: 1 } }, token)).status).toBe(200);
    expect(await (await request('GET', '/api/calendar/appointments/' + booking.id, undefined, token)).json()).toEqual(view);
    expect((await request('PUT', '/api/calendar/types/' + type.id, { type: { label: 'Missing', durationMinutes: 30 }, options: { idempotencyKey: 'invalid', expectedRevision: 2 } }, token)).status).toBe(400);
  });
});

test('native type live routes preauthorize and terminally retire selected catalogs/policies after grant loss', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('live-owner'), delegate = await register('live-reader'), token = delegate.accessToken;
    const manager = fixture.session('catalog-manager', { manager: true });
    const type = await manager.api.types.create({ label: 'Live', durationMinutes: 30 }, { idempotencyKey: 'type' });
    const resourceResponse = await request('POST', '/api/calendar/resources', { resource: { label: 'Native', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, owner.accessToken);
    const resource = await resourceResponse.json() as { id: string };
    const selected = '/api/calendar/types/live?resourceIds=' + resource.id, policy = '/api/calendar/resources/' + resource.id + '/types/live';
    expect((await request('GET', selected, undefined, token)).status).toBe(404);
    expect((await request('GET', policy, undefined, token)).status).toBe(404);
    expect((await request('GET', '/api/calendar/types/' + type.id + '/live', undefined, token)).status).toBe(403);
    expect((await request('POST', '/api/calendar/types', { type: { label: 'Denied', durationMinutes: 30 }, options: { idempotencyKey: 'denied' } }, token)).status).toBe(403);
    const grant = (grants: string[], revision: number, key: string) => request('POST', '/api/calendar/resources/' + resource.id + '/grants',
      { userId: delegate.user.userId, grants, options: { idempotencyKey: key, expectedRevision: revision } }, owner.accessToken);
    expect((await grant(['book'], 1, 'book')).status).toBe(200);
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const path of [selected, policy]) {
        const response = await request('GET', path, undefined, token); expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store'); readers.push(response.body!.getReader());
      }
      expect(await streamText(readers[0]!)).toContain(type.id); expect(await streamText(readers[1]!)).toContain(resource.id);
      expect((await grant([], 2, 'revoke')).status).toBe(200);
      for (const reader of readers) {
        const frame = await streamText(reader); expect(frame).toContain('event: invalidated'); expect(frame).not.toContain(type.id);
        expect((await reader.read()).done).toBe(true);
      }
    } finally { for (const reader of readers) { await reader.cancel(); reader.releaseLock(); } }
    await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
  });
});

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic type HTTP stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic type HTTP stream retired before expected frame.'); return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}
