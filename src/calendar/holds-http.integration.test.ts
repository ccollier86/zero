/** Native private HTTP over real Guardian/runtime/native-memory realm. No listener, actor or disk fixture. */
import { expect, spyOn, test } from 'bun:test';
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
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-holds-http-memory');
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
      const response = await request('POST', '/auth/register', { username: 'synthetic-holds-' + suffix,
        email: 'synthetic-holds-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}
function hold(resourceId: string, now = Date.now()) {
  return { resourceIds: [resourceId], startAt: new Date(now + 3_600_000).toISOString(), endAt: new Date(now + 7_200_000).toISOString(),
    timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ttlSeconds: 120 };
}

test('private hold HTTP lifecycle rejects forged authority and confirms into a server-created appointment receipt', async () => {
  await withHttp(async ({ request, register }) => {
    expect((await request('POST', '/api/calendar/holds', {})).status).toBe(401);
    expect((await request('GET', '/api/calendar/holds/missing')).status).toBe(401);
    const owner = await register('lifecycle'), token = owner.accessToken;
    const createdResource = await request('POST', '/api/calendar/resources', { resource: { label: 'Hold calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    expect(createdResource.status).toBe(200); const resource = await createdResource.json() as { id: string };
    const input = hold(resource.id), options = { idempotencyKey: 'hold' };
    for (const field of ['actor', 'scopeId', 'id', 'appointmentId', 'expiresAt', 'now']) {
      const denied = await request('POST', '/api/calendar/holds', { hold: { ...input, [field]: 'forged' }, options }, token);
      expect(denied.status).toBe(400); expect(await denied.json()).toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    const created = await request('POST', '/api/calendar/holds', { hold: input, options }, token);
    expect(created.status).toBe(200); const acquired = await created.json() as { id: string };
    expect(acquired).toMatchObject({ operation: 'hold.acquired', revision: 1, changed: true });
    const detail = await request('GET', '/api/calendar/holds/' + acquired.id, undefined, token);
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ id: acquired.id, status: 'held', appointmentId: null, createdBy: owner.user.userId });
    const query = { resourceIds: [resource.id], startAt: input.startAt, endAt: input.endAt };
    const page = await request('POST', '/api/calendar/holds/query', { query }, token);
    expect(page.status).toBe(200); expect(await page.json()).toMatchObject({ items: [{ id: acquired.id }], truncated: false });
    const control = { idempotencyKey: 'original-confirm', expectedRevision: 1 };
    const forged = await request('POST', '/api/calendar/holds/' + acquired.id + '/confirm', { appointment: { title: 'Title', appointmentId: 'chosen' }, options: control }, token);
    expect(forged.status).toBe(400);
    const confirm = () => request('POST', '/api/calendar/holds/' + acquired.id + '/confirm', { appointment: { title: 'PRIVATE_HTTP_CONFIRM' }, options: control }, token);
    const accepted = await confirm(); expect(accepted.status).toBe(200); const receipt = await accepted.json() as { id: string };
    expect(receipt).toMatchObject({ requestId: 'original-confirm', operation: 'appointment.created', revision: 1, changed: true }); expect(receipt.id).not.toBe(acquired.id);
    expect(await (await confirm()).json()).toEqual(receipt);
    expect(await (await request('GET', '/api/calendar/receipts/original-confirm', undefined, token)).json()).toEqual({ receipt });
    expect(await (await request('GET', '/api/calendar/holds/' + acquired.id, undefined, token)).json()).toMatchObject({ status: 'confirmed', appointmentId: receipt.id, revision: 2 });
    expect(await (await request('GET', '/api/calendar/appointments/' + receipt.id, undefined, token)).json()).toMatchObject({ title: 'PRIVATE_HTTP_CONFIRM' });
    expect(await (await request('POST', '/api/calendar/holds/query', { query }, token)).json()).toEqual({ items: [], truncated: false });
    const invalidRelease = await request('POST', '/api/calendar/holds/' + acquired.id + '/release', { options: { idempotencyKey: 'confirmed-release', expectedRevision: 2 } }, token);
    expect(invalidRelease.status).toBe(409); expect(await invalidRelease.json()).toMatchObject({ code: 'CALENDAR_HOLD_STALE', outcome: 'not-committed' });
  });
});

test('hold HTTP release and expiry preserve history and closed stable errors', async () => {
  await withHttp(async ({ request, register }) => {
    const owner = await register('expiry'), token = owner.accessToken;
    const createdResource = await request('POST', '/api/calendar/resources', { resource: { label: 'Expiry calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    const resource = await createdResource.json() as { id: string }, input = hold(resource.id);
    const acquired = await (await request('POST', '/api/calendar/holds', { hold: input, options: { idempotencyKey: 'release-hold' } }, token)).json() as { id: string };
    const released = await request('POST', '/api/calendar/holds/' + acquired.id + '/release', { options: { idempotencyKey: 'release', expectedRevision: 1 } }, token);
    expect(released.status).toBe(200); expect(await released.json()).toMatchObject({ id: acquired.id, operation: 'hold.released', revision: 2 });
    expect(await (await request('GET', '/api/calendar/holds/' + acquired.id, undefined, token)).json()).toMatchObject({ status: 'released', appointmentId: null });
    const now = Date.now(), clock = spyOn(Date, 'now').mockReturnValue(now);
    try {
      const expiring = await request('POST', '/api/calendar/holds', { hold: { ...input, ttlSeconds: 1 }, options: { idempotencyKey: 'expire-hold' } }, token);
      expect(expiring.status).toBe(200); const expired = await expiring.json() as { id: string }; clock.mockReturnValue(now + 1_000);
      const confirm = await request('POST', '/api/calendar/holds/' + expired.id + '/confirm', { appointment: { title: 'Too late' }, options: { idempotencyKey: 'expired-confirm', expectedRevision: 1 } }, token);
      expect(confirm.status).toBe(409); expect(await confirm.json()).toMatchObject({ code: 'CALENDAR_HOLD_EXPIRED', outcome: 'not-committed' });
      expect(await (await request('GET', '/api/calendar/holds/' + expired.id, undefined, token)).json()).toMatchObject({ status: 'expired', revision: 1 });
    } finally { clock.mockRestore(); }
  });
});

test('hold SSE preauthorizes, removes revoked subject rows and terminates denied authority', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('live-owner'), delegate = await register('live-delegate');
    const createdResource = await request('POST', '/api/calendar/resources', { resource: { label: 'Private hold live', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, owner.accessToken);
    const resource = await createdResource.json() as { id: string }, input = hold(resource.id);
    const params = new URLSearchParams({ resourceIds: resource.id, startAt: input.startAt, endAt: input.endAt }), path = '/api/calendar/holds/live?' + params;
    expect((await request('GET', path)).status).toBe(401);
    const denied = await request('GET', path, undefined, delegate.accessToken); expect(denied.status).toBe(404); expect(denied.headers.get('Content-Type')).not.toContain('text/event-stream');
    expect(fixture.stats().subscriptions).toBe(0);
    const grant = (grants: string[], revision: number, key: string) => request('POST', '/api/calendar/resources/' + resource.id + '/grants',
      { userId: delegate.user.userId, grants, options: { idempotencyKey: key, expectedRevision: revision } }, owner.accessToken);
    expect((await grant(['details', 'book'], 1, 'grant')).status).toBe(200);
    const created = await request('POST', '/api/calendar/holds', { hold: input, options: { idempotencyKey: 'delegate-hold' } }, delegate.accessToken);
    expect(created.status).toBe(200); const acquired = await created.json() as { id: string };
    const response = await request('GET', path, undefined, delegate.accessToken); expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store'); const reader = response.body!.getReader();
    try {
      expect(await streamText(reader)).toContain(acquired.id);
      expect((await grant(['details'], 2, 'revoke-book')).status).toBe(200);
      const withdrawn = await streamText(reader); expect(withdrawn).toContain('"items":[]'); expect(withdrawn).not.toContain(acquired.id);
      expect((await grant([], 3, 'revoke-details')).status).toBe(200);
      const invalidated = await streamText(reader); expect(invalidated).toContain('event: invalidated'); expect(invalidated).not.toContain(acquired.id);
      expect((await reader.read()).done).toBe(true); await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
    } finally { await reader.cancel(); reader.releaseLock(); }
  });
});

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic hold HTTP stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic hold stream retired before its expected frame.');
    return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}

test('range live transports admit explicit page limits through composed native auth and reject authored or repeated query keys', async () => {
  await withHttp(async ({ request, register, fixture }) => {
    const owner = await register('bounded-range'), token = owner.accessToken;
    const response = await request('POST', '/api/calendar/resources', { resource: { label: 'Bounded live calendar', kind: 'person', timeZone: 'UTC' },
      options: { idempotencyKey: 'resource' } }, token);
    expect(response.status).toBe(200); const resource = await response.json() as { id: string };
    const parameters = new URLSearchParams({ resourceIds: resource.id, startAt: '2030-01-01T00:00:00.000Z', endAt: '2030-01-02T00:00:00.000Z', limit: '1' });
    for (const kind of ['appointments', 'blocks', 'holds'] as const) {
      const path = '/api/calendar/' + kind + '/live?' + parameters;
      for (const invalid of [path + '&tenantId=forged', path + '&limit=2']) {
        const denied = await request('GET', invalid, undefined, token);
        expect(denied.status).toBe(400); expect(denied.headers.get('Content-Type')).not.toContain('text/event-stream');
      }
      const live = await request('GET', path, undefined, token); expect(live.status).toBe(200);
      const reader = live.body!.getReader();
      try { expect(await streamText(reader)).toContain('"items":[]'); }
      finally { await reader.cancel(); reader.releaseLock(); }
    }
    await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
  });
});
