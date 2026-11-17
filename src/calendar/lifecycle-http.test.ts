/** Real native auth/routes/Guardian/runtime/realm, memory only. Never listens or creates fixtures. */
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
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-lifecycle-http-memory');
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
      const response = await request('POST', '/auth/register', { username: 'synthetic-lifecycle-' + suffix,
        email: 'synthetic-lifecycle-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}

test('native lifecycle routes enforce session authority, exact envelopes and safe revision/policy/reason rejections', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    for (const path of ['/api/calendar/lifecycle', '/api/calendar/lifecycle/live', '/api/calendar/appointments/missing/transitions', '/api/calendar/appointments/missing/transitions/live']) {
      expect((await request('GET', path)).status).toBe(401);
    }
    const owner = await register('owner'), delegate = await register('delegate'), token = owner.accessToken;
    const initial = await request('GET', '/api/calendar/lifecycle', undefined, token); expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' });
    expect(fixture.stats().planes).toBe(0);
    for (const path of ['/api/calendar/lifecycle', '/api/calendar/lifecycle/live']) expect((await request('GET', path, undefined, delegate.accessToken)).status).toBe(403);
    const policy = { extended: true, cancellationReason: 'required', noShowReason: 'required' };
    expect((await request('PUT', '/api/calendar/lifecycle', { policy, options: { idempotencyKey: 'denied', expectedRevision: 1 } }, delegate.accessToken)).status).toBe(403);
    for (const body of [{ policy: { ...policy, actor: {} }, options: { idempotencyKey: 'bad', expectedRevision: 1 } },
      { policy: { extended: true }, options: { idempotencyKey: 'bad', expectedRevision: 1 } },
      { policy, options: { idempotencyKey: 'bad', expectedRevision: 1 }, scopeId: 'forged' }]) {
      expect((await request('PUT', '/api/calendar/lifecycle', body, token)).status).toBe(400);
    }
    for (const suffix of ['scopeId=forged', 'revision=1&revision=2']) {
      expect((await request('GET', '/api/calendar/lifecycle?' + suffix, undefined, token)).status).toBe(400);
      expect((await request('GET', '/api/calendar/lifecycle/live?' + suffix, undefined, token)).status).toBe(400);
    }
    const changed = await request('PUT', '/api/calendar/lifecycle', { policy, options: { idempotencyKey: 'policy', expectedRevision: 1 } }, token);
    expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ operation: 'lifecycle.policy-changed', id: 'policy', revision: 2 });
    const resourceResponse = await request('POST', '/api/calendar/resources', { resource: { label: 'Synthetic', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    expect(resourceResponse.status).toBe(200); const resource = await resourceResponse.json() as { id: string };
    const appointment = { resourceIds: [resource.id], title: 'Private synthetic', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC' };
    const created = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'appointment' } }, token);
    expect(created.status).toBe(200); const booking = await created.json() as { id: string }, path = '/api/calendar/appointments/' + booking.id;
    const current = await request('GET', path + '/transitions', undefined, token); expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ id: booking.id, revision: 1, policyRevision: 2, status: 'confirmed' });
    expect((await request('GET', path + '/transitions', undefined, delegate.accessToken)).status).toBe(404);
    expect((await request('GET', path + '/transitions/live', undefined, delegate.accessToken)).status).toBe(404);
    for (const suffix of ['actor=forged', 'id=other&id=another']) {
      expect((await request('GET', path + '/transitions?' + suffix, undefined, token)).status).toBe(400);
      expect((await request('GET', path + '/transitions/live?' + suffix, undefined, token)).status).toBe(400);
    }
    const transition = (input: unknown, key: string) => request('POST', path + '/transition', { transition: input, options: { idempotencyKey: key, expectedRevision: 1 } }, token);
    for (const [input, code] of [[{ status: 'cancelled', policyRevision: 1 }, 'CALENDAR_POLICY_STALE'],
      [{ status: 'cancelled', policyRevision: 2 }, 'CALENDAR_REASON_REQUIRED'], [{ status: 'confirmed', policyRevision: 2 }, 'CALENDAR_TRANSITION_INVALID']] as const) {
      const rejected = await transition(input, code); expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ code, outcome: 'not-committed' });
    }
    expect((await transition({ status: 'cancelled', policyRevision: 2, actor: {} }, 'invalid')).status).toBe(400);
    expect((await request('POST', path + '/cancel', { options: { idempotencyKey: 'missing-reason', expectedRevision: 1 } }, token)).status).toBe(409);
    const cancelled = await request('POST', path + '/cancel', { reason: '  PRIVATE_CANCEL_REASON  ', options: { idempotencyKey: 'cancel', expectedRevision: 1 } }, token);
    expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ operation: 'appointment.cancelled', id: booking.id, revision: 2 });
    const view = await (await request('GET', path, undefined, token)).json();
    expect(view).toMatchObject({ status: 'cancelled', lifecycle: { status: 'cancelled', revision: 2, policyRevision: 2, reason: 'PRIVATE_CANCEL_REASON' } });
    const projection = await (await request('GET', path + '/transitions', undefined, token)).json();
    expect(projection).toMatchObject({ status: 'cancelled', allowed: [] }); expect(JSON.stringify(projection)).not.toContain('PRIVATE_CANCEL_REASON');
    expect(fixture.stats().activeLeases).toBe(0);
  });
});

test('native lifecycle SSE preauthorizes and transitions withdraw after management loss without exposing reason', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('live-owner'), delegate = await register('live-delegate'), token = owner.accessToken;
    const resource = await (await request('POST', '/api/calendar/resources', { resource: { label: 'Live', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token)).json() as { id: string };
    const booking = await (await request('POST', '/api/calendar/appointments', { appointment: { resourceIds: [resource.id], title: 'Private', startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC' }, options: { idempotencyKey: 'appointment' } }, token)).json() as { id: string };
    const grant = (grants: string[], revision: number, key: string) => request('POST', '/api/calendar/resources/' + resource.id + '/grants',
      { userId: delegate.user.userId, grants, options: { idempotencyKey: key, expectedRevision: revision } }, token);
    expect((await grant(['details'], 1, 'details')).status).toBe(200);
    const path = '/api/calendar/appointments/' + booking.id;
    expect((await request('GET', path, undefined, delegate.accessToken)).status).toBe(200);
    expect((await request('GET', path + '/transitions/live', undefined, delegate.accessToken)).status).toBe(404);
    expect((await grant(['manage'], 2, 'manage')).status).toBe(200);
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const [route, accessToken] of [['/api/calendar/lifecycle/live', token], [path + '/transitions/live', delegate.accessToken]]) {
        const response = await request('GET', route!, undefined, accessToken); expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store'); readers.push(response.body!.getReader());
      }
      expect(await streamText(readers[0]!)).toContain('"revision":1'); expect(await streamText(readers[1]!)).toContain(booking.id);
      const policy = { extended: true, cancellationReason: 'required', noShowReason: 'required' };
      expect((await request('PUT', '/api/calendar/lifecycle', { policy, options: { idempotencyKey: 'policy', expectedRevision: 1 } }, token)).status).toBe(200);
      expect(await streamText(readers[0]!)).toContain('"revision":2'); expect(await streamText(readers[1]!)).toContain('"requiresReason":true');
      const changed = await request('POST', path + '/transition', { transition: { status: 'no-show', policyRevision: 2, reason: 'PRIVATE_NO_SHOW_REASON' }, options: { idempotencyKey: 'no-show', expectedRevision: 1 } }, delegate.accessToken);
      expect(changed.status).toBe(200); expect(await changed.json()).toMatchObject({ operation: 'appointment.transitioned', revision: 2 });
      const snapshot = await streamText(readers[1]!); expect(snapshot).toContain('"status":"no-show"'); expect(snapshot).not.toContain('PRIVATE_NO_SHOW_REASON');
      expect((await grant([], 3, 'revoke')).status).toBe(200);
      const denied = await streamText(readers[1]!); expect(denied).toContain('event: invalidated'); expect(denied).not.toContain(booking.id);
      expect((await readers[1]!.read()).done).toBe(true);
    } finally { for (const reader of readers) { await reader.cancel(); reader.releaseLock(); } }
    await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
  });
});

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic lifecycle HTTP stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic lifecycle HTTP stream retired before expected frame.'); return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}
