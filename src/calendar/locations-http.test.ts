/** Native routes with real sessions/Guardian/runtime, all memory; never listens or creates a physical fixture. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { MemoryEventStore } from '../observability/memory-event-store';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { CalendarConfig } from './config';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

async function withHttp(config: CalendarConfig, run: (input: {
  request(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  register(suffix: string): Promise<{ accessToken: string; user: { userId: string } }>;
  fixture: ReturnType<typeof memoryCalendarServiceFixture>;
}) => Promise<void>) {
  const fixture = memoryCalendarServiceFixture({ tenancy: 'single', config }), runtime = new ZeroAppRuntime('synthetic-calendar-locations-http-memory');
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
      const response = await request('POST', '/auth/register', { username: 'synthetic-locations-' + suffix,
        email: 'synthetic-locations-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    } });
  } finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await fixture.close(); } }
}

test('location HTTP catalog and resource assignments use fixed native GET/POST/PUT envelopes and stable revision errors', async () => {
  // The real public-bootstrap policy makes the first registered account the administrator.
  await withHttp({}, async ({ request, register, fixture }) => {
    expect((await request('GET', '/api/calendar/locations')).status).toBe(401);
    expect((await request('POST', '/api/calendar/locations', {})).status).toBe(401);
    const account = await register('lifecycle'), token = account.accessToken;
    const empty = await request('GET', '/api/calendar/locations', undefined, token); expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [], truncated: false, nextAfter: null }); expect(fixture.stats().planes).toBe(0);
    const options = { idempotencyKey: 'location' }, location = { label: 'Native location', region: 'US.NY' };
    for (const body of [{ location: { ...location, actor: { manageAll: true } }, options }, { location, options, tenantId: 'forged' },
      { location: { ...location, region: 'US NY' }, options }]) {
      const rejected = await request('POST', '/api/calendar/locations', body, token); expect(rejected.status).toBe(400);
    }
    expect(fixture.stats().planes).toBe(0);
    const created = await request('POST', '/api/calendar/locations', { location, options }, token); expect(created.status).toBe(200);
    const receipt = await created.json() as { id: string }; expect(receipt).toMatchObject({ operation: 'location.created', revision: 1 });
    expect(await (await request('GET', '/api/calendar/locations/' + receipt.id, undefined, token)).json()).toMatchObject({ ...location, active: true, id: receipt.id });
    const resourceResponse = await request('POST', '/api/calendar/resources', { resource: { label: 'Native resource', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, token);
    expect(resourceResponse.status).toBe(200); const resource = await resourceResponse.json() as { id: string };
    const path = '/api/calendar/resources/' + resource.id + '/locations';
    expect(await (await request('GET', path, undefined, token)).json()).toEqual({ resourceId: resource.id, resourceRevision: 1, locationIds: [] });
    const assigned = await request('PUT', path, { locationIds: [receipt.id], options: { idempotencyKey: 'assign', expectedRevision: 1 } }, token);
    expect(assigned.status).toBe(200); expect(await assigned.json()).toMatchObject({ operation: 'resource.locations-changed', id: resource.id, revision: 2 });
    expect(await (await request('GET', path, undefined, token)).json()).toEqual({ resourceId: resource.id, resourceRevision: 2, locationIds: [receipt.id] });
    const query = new URLSearchParams({ locationIds: receipt.id, regions: 'US.NY', limit: '1' });
    const filtered = await request('GET', '/api/calendar/resources?' + query, undefined, token);
    expect(filtered.status).toBe(200); expect(await filtered.json()).toMatchObject({ items: [{ id: resource.id }], truncated: false, nextAfter: null });
    for (const [suffix, status] of [['regions=US%20NY', 400], ['locationIds=x,x', 400], ['tenantId=forged', 400], ['limit=1&limit=2', 400], ['regions=' + Array(17).fill('US.NY').join(','), 400]] as const) {
      expect((await request('GET', '/api/calendar/resources?' + suffix, undefined, token)).status).toBe(status);
    }
    const replacement = { label: 'Native renamed', region: null, active: false };
    const replaced = await request('PUT', '/api/calendar/locations/' + receipt.id, { location: replacement, options: { idempotencyKey: 'replace', expectedRevision: 1 } }, token);
    expect(replaced.status).toBe(200); const replacedReceipt = await replaced.json();
    expect(replacedReceipt).toMatchObject({ operation: 'location.updated', revision: 2 });
    expect(await (await request('GET', '/api/calendar/receipts/replace', undefined, token)).json()).toEqual({ receipt: replacedReceipt });
    const stale = await request('PUT', '/api/calendar/locations/' + receipt.id, { location: replacement, options: { idempotencyKey: 'stale', expectedRevision: 1 } }, token);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed' });
    const missingFields = await request('PUT', '/api/calendar/locations/' + receipt.id, { location: { label: 'Missing' }, options: { idempotencyKey: 'missing', expectedRevision: 2 } }, token);
    expect(missingFields.status).toBe(400);
  });
});

test('native location/resource live routes preauthorize, replace list snapshots and terminally withdraw detail projections on grant revocation', async () => {
  await withHttp({}, async ({ request, register, fixture }) => {
    const manager = fixture.session('catalog-manager', { manager: true }), owner = await register('live-owner'), delegate = await register('live-reader');
    const location = await manager.api.locations.create({ label: 'Private native catalog', region: 'US.NY' }, { idempotencyKey: 'location' });
    const resourceResponse = await request('POST', '/api/calendar/resources', { resource: { label: 'Private native resource', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, owner.accessToken);
    const resource = await resourceResponse.json() as { id: string };
    await manager.api.resources.setLocations(resource.id, [location.id], { idempotencyKey: 'assign', expectedRevision: 1 });
    const detailPath = '/api/calendar/locations/' + location.id + '/live', assignmentPath = '/api/calendar/resources/' + resource.id + '/locations/live';
    for (const path of [detailPath, assignmentPath]) {
      expect((await request('GET', path)).status).toBe(401);
      const denied = await request('GET', path, undefined, delegate.accessToken); expect(denied.status).toBe(404);
      expect(denied.headers.get('Content-Type')).not.toContain('text/event-stream');
    }
    expect(fixture.stats().subscriptions).toBe(0);
    const writeDenied = await request('POST', '/api/calendar/locations', { location: { label: 'Denied' }, options: { idempotencyKey: 'denied' } }, delegate.accessToken);
    expect(writeDenied.status).toBe(403);
    const grant = (grants: string[], revision: number, key: string) => request('POST', '/api/calendar/resources/' + resource.id + '/grants',
      { userId: delegate.user.userId, grants, options: { idempotencyKey: key, expectedRevision: revision } }, owner.accessToken);
    expect((await grant(['busy'], 2, 'busy')).status).toBe(200);
    const paths = ['/api/calendar/locations/live?limit=5', '/api/calendar/resources/live?locationIds=' + location.id + '&regions=US.NY', detailPath, assignmentPath];
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const path of paths) {
        const response = await request('GET', path, undefined, delegate.accessToken); expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store'); readers.push(response.body!.getReader());
      }
      for (let index = 0; index < readers.length; index++) expect(await streamText(readers[index]!)).toContain(index === 1 || index === 3 ? resource.id : location.id);
      expect((await grant([], 3, 'revoke')).status).toBe(200);
      for (let index = 0; index < readers.length; index++) {
        const withdrawn = await streamText(readers[index]!);
        expect(withdrawn).toContain(index < 2 ? '"items":[]' : 'event: invalidated');
        expect(withdrawn).not.toContain(location.id); expect(withdrawn).not.toContain(resource.id);
        if (index >= 2) expect((await readers[index]!.read()).done).toBe(true);
      }
    } finally { for (const reader of readers) { await reader.cancel(); reader.releaseLock(); } }
    await eventuallyCalendar(() => fixture.stats().subscriptions === 0);
  });
});

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic location HTTP stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic location stream retired before its expected frame.');
    return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}
