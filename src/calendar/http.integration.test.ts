/** Native HTTP + real Guardian/services/realm, all memory. Physical Fabric remains the explicit fixture seam, not worker qualification. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthPlugin } from '../auth/auth.plugin';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_CALENDAR_SERVICE, ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { MemoryEventStore } from '../observability/memory-event-store';
import { createCalendarHttp } from './http';
import { eventuallyCalendar, memoryCalendarServiceFixture } from './test-support/memory-service-fixture';

test('native private routes accept real sessions, reject authored authority and preserve core receipts/errors', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-http-memory');
  let app: Elysia | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, f.service);
    app = new Elysia().use(createAuthPlugin({ db: f.system, runtime, bootstrap: 'public', registration: { mode: 'public' },
      tenancy: 'single' })).use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = async (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const anonymous = await request('GET', '/api/calendar/resources'); expect(anonymous.status).toBe(401);
    const registered = await request('POST', '/auth/register', { username: 'synthetic-calendar-http', email: 'calendar-http@example.test', password: 'SyntheticOnly-Calendar-123!' });
    expect(registered.status).toBe(200);
    const account = await registered.json() as { accessToken: string };
    const empty = await request('GET', '/api/calendar/resources', undefined, account.accessToken);
    expect(empty.status).toBe(200); expect(await empty.json()).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(f.stats().planes).toBe(0);
    const rejected = await request('POST', '/api/calendar/resources', { resource: { label: 'Synthetic calendar', kind: 'person', timeZone: 'UTC', actor: { manageAll: true } }, options: { idempotencyKey: 'http-forged' } }, account.accessToken);
    expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ code: 'CALENDAR_INPUT_INVALID', outcome: 'not-started' });
    expect(f.stats().planes).toBe(0);
    const resource = await request('POST', '/api/calendar/resources', { resource: { label: 'Synthetic calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'http-resource' } }, account.accessToken);
    expect(resource.status).toBe(200); const calendar = await resource.json() as { id: string };
    const appointment = { resourceIds: [calendar.id], title: 'Synthetic appointment', startAt: '2026-11-16T15:00:00.000Z', endAt: '2026-11-16T16:00:00.000Z', timeZone: 'UTC' };
    const created = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'http-appointment' } }, account.accessToken);
    expect(created.status).toBe(200); const receipt = await created.json() as { id: string };
    expect(receipt).toMatchObject({ requestId: 'http-appointment', operation: 'appointment.created', revision: 1, changed: true });
    const conflict = await request('POST', '/api/calendar/appointments', { appointment, options: { idempotencyKey: 'http-collision' } }, account.accessToken);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
    const detail = await request('GET', '/api/calendar/appointments/' + receipt.id, undefined, account.accessToken);
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ id: receipt.id, title: 'Synthetic appointment' });
    const reconciled = await request('GET', '/api/calendar/receipts/http-appointment', undefined, account.accessToken);
    expect(reconciled.status).toBe(200); expect(await reconciled.json()).toEqual({ receipt });
    const missing = await request('GET', '/api/calendar/appointments/does-not-exist', undefined, account.accessToken);
    expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ code: 'CALENDAR_NOT_FOUND', outcome: 'not-started' });
  } finally {
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await f.close(); }
  }
});

test('one-off block and explicit availability HTTP routes share current authority, revisions and receipt reconciliation', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-scheduling-http-memory');
  let app: Elysia | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events });
    runtime.set(ZERO_CALENDAR_SERVICE, f.service);
    app = new Elysia().use(createAuthPlugin({ db: f.system, runtime, bootstrap: 'public', registration: { mode: 'public' },
      tenancy: 'single' })).use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost/api/calendar' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    expect((await request('GET', '/availability/resource-a')).status).toBe(401);
    expect((await request('POST', '/blocks/query', { query: { resourceIds: [], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' } })).status).toBe(401);
    const registered = await app.handle(new Request('http://localhost/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'synthetic-calendar-scheduling-http', email: 'calendar-scheduling-http@example.test', password: 'SyntheticOnly-Calendar-123!' }) }));
    expect(registered.status).toBe(200); const { accessToken } = await registered.json() as { accessToken: string };
    const createdResource = await request('POST', '/resources', { resource: { label: 'Synthetic scheduling calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'scheduling-resource' } }, accessToken);
    expect(createdResource.status).toBe(200); const resource = await createdResource.json() as { id: string };
    const initial = await request('GET', '/availability/' + resource.id, undefined, accessToken);
    expect(initial.status).toBe(200); expect(await initial.json()).toEqual({ resourceId: resource.id, resourceRevision: 1, timeZone: 'UTC', mode: 'unrestricted', windows: [] });
    const availability = { mode: 'windows', windows: [{ startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T18:00:00.000Z' }] };
    const replaced = await request('POST', '/availability/' + resource.id, { availability, options: { idempotencyKey: 'http-availability', expectedRevision: 1 } }, accessToken);
    expect(replaced.status).toBe(200); const availabilityReceipt = await replaced.json();
    expect(availabilityReceipt).toMatchObject({ id: resource.id, operation: 'resource.availability-changed', revision: 2, changed: true });
    expect(await (await request('GET', '/availability/' + resource.id, undefined, accessToken)).json()).toEqual({ resourceId: resource.id, resourceRevision: 2, timeZone: 'UTC', ...availability });
    const block = { resourceIds: [resource.id], title: 'PRIVATE_HTTP_BLOCK', startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z', timeZone: 'UTC' };
    const forged = await request('POST', '/blocks', { block: { ...block, actor: { manageAll: true } }, options: { idempotencyKey: 'http-forged-block' } }, accessToken);
    expect(forged.status).toBe(400); expect(await forged.json()).toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    const created = await request('POST', '/blocks', { block, options: { idempotencyKey: 'http-block' } }, accessToken);
    expect(created.status).toBe(200); const receipt = await created.json() as { id: string };
    expect(receipt).toMatchObject({ operation: 'block.created', revision: 1, changed: true }); expect(JSON.stringify(receipt)).not.toContain('PRIVATE');
    const detail = await request('GET', '/blocks/' + receipt.id, undefined, accessToken);
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ id: receipt.id, ...block, status: 'active' });
    const query = { resourceIds: [resource.id], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
    const selected = await request('POST', '/blocks/query', { query }, accessToken);
    expect(selected.status).toBe(200); expect(await selected.json()).toMatchObject({ items: [{ id: receipt.id }], truncated: false });
    const reconciled = await request('GET', '/receipts/http-block', undefined, accessToken);
    expect(reconciled.status).toBe(200); expect(await reconciled.json()).toEqual({ receipt });
    const moved = await request('POST', '/blocks/' + receipt.id + '/reschedule', { block: { startAt: '2026-11-16T14:00:00.000Z', endAt: '2026-11-16T15:00:00.000Z', timeZone: 'UTC' }, options: { idempotencyKey: 'http-block-move', expectedRevision: 1 } }, accessToken);
    expect(moved.status).toBe(200); expect(await moved.json()).toMatchObject({ id: receipt.id, operation: 'block.rescheduled', revision: 2 });
    const stale = await request('POST', '/blocks/' + receipt.id + '/cancel', { options: { idempotencyKey: 'http-block-stale', expectedRevision: 1 } }, accessToken);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed' });
    const cancelled = await request('POST', '/blocks/' + receipt.id + '/cancel', { options: { idempotencyKey: 'http-block-cancel', expectedRevision: 2 } }, accessToken);
    expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ id: receipt.id, operation: 'block.cancelled', revision: 3 });
    expect(await (await request('POST', '/blocks/query', { query }, accessToken)).json()).toEqual({ items: [], truncated: false });
    expect(await (await request('GET', '/blocks/' + receipt.id, undefined, accessToken)).json()).toMatchObject({ status: 'cancelled' });
  } finally {
    try { if (app?.server) await app.stop(); await runtime.dispose(); }
    finally { await f.close(); }
  }
});

test('new native SSE routes preauthorize, publish real commits and terminate both private feeds after grant revocation', async () => {
  const f = memoryCalendarServiceFixture({ tenancy: 'single' }), runtime = new ZeroAppRuntime('synthetic-calendar-live-http-memory');
  let app: Elysia | undefined, blocks: ReadableStreamDefaultReader<Uint8Array> | undefined, availability: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const events = new MemoryEventStore({ maxEvents: 25 });
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { config: { console: false, store: events }, sink: events, store: events }); runtime.set(ZERO_CALENDAR_SERVICE, f.service);
    app = new Elysia().use(createAuthPlugin({ db: f.system, runtime, bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'single' }))
      .use(await createCalendarHttp(runtime)).compile() as Elysia;
    const request = (method: string, path: string, body?: unknown, token?: string) => app!.handle(new Request('http://localhost' + path, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const register = async (suffix: string) => {
      const response = await request('POST', '/auth/register', { username: 'synthetic-calendar-live-' + suffix, email: 'calendar-live-' + suffix + '@example.test', password: 'SyntheticOnly-Calendar-123!' });
      expect(response.status).toBe(200); return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
    };
    const owner = await register('owner'), reader = await register('reader');
    const createdResource = await request('POST', '/api/calendar/resources', { resource: { label: 'Private live calendar', kind: 'person', timeZone: 'UTC' }, options: { idempotencyKey: 'resource' } }, owner.accessToken);
    expect(createdResource.status).toBe(200); const resource = await createdResource.json() as { id: string };
    const params = new URLSearchParams({ resourceIds: resource.id, startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' });
    const blockPath = '/api/calendar/blocks/live?' + params, availabilityPath = '/api/calendar/availability/' + resource.id + '/live';
    for (const path of [blockPath, availabilityPath]) {
      expect((await request('GET', path)).status).toBe(401);
      const denied = await request('GET', path, undefined, reader.accessToken);
      expect(denied.status).toBe(404); expect(denied.headers.get('Content-Type')).not.toContain('text/event-stream');
    }
    expect(f.stats().subscriptions).toBe(0);
    const granted = await request('POST', '/api/calendar/resources/' + resource.id + '/grants', { userId: reader.user.userId, grants: ['details'], options: { idempotencyKey: 'grant', expectedRevision: 1 } }, owner.accessToken);
    expect(granted.status).toBe(200);
    const blockResponse = await request('GET', blockPath, undefined, reader.accessToken), availabilityResponse = await request('GET', availabilityPath, undefined, reader.accessToken);
    for (const response of [blockResponse, availabilityResponse]) {
      expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toContain('text/event-stream'); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    blocks = blockResponse.body!.getReader(); availability = availabilityResponse.body!.getReader();
    expect(await streamText(blocks)).toContain('"items":[]'); expect(await streamText(availability)).toContain('"resourceRevision":2');
    expect(f.stats().subscriptions).toBe(2);
    const policy = { mode: 'windows', windows: [{ startAt: '2026-11-16T09:00:00.000Z', endAt: '2026-11-16T17:00:00.000Z' }] };
    const replaced = await request('POST', '/api/calendar/availability/' + resource.id, { availability: policy, options: { idempotencyKey: 'policy', expectedRevision: 2 } }, owner.accessToken);
    expect(replaced.status).toBe(200);
    expect(await streamText(availability)).toContain('"resourceRevision":3'); expect(await streamText(blocks)).toContain('"invalidated":true');
    const createdBlock = await request('POST', '/api/calendar/blocks', { block: { resourceIds: [resource.id], title: 'PRIVATE_LIVE_BLOCK', startAt: '2026-11-16T12:00:00.000Z', endAt: '2026-11-16T13:00:00.000Z', timeZone: 'UTC' }, options: { idempotencyKey: 'block' } }, owner.accessToken);
    expect(createdBlock.status).toBe(200); const block = await createdBlock.json() as { id: string };
    const blockFrame = await streamText(blocks); expect(blockFrame).toContain(block.id); expect(blockFrame).toContain('PRIVATE_LIVE_BLOCK');
    expect(await streamText(availability)).toContain('"invalidated":true');
    const revoked = await request('POST', '/api/calendar/resources/' + resource.id + '/grants', { userId: reader.user.userId, grants: [], options: { idempotencyKey: 'revoke', expectedRevision: 3 } }, owner.accessToken);
    expect(revoked.status).toBe(200);
    for (const stream of [blocks, availability]) {
      const frame = await streamText(stream); expect(frame).toContain('event: invalidated'); expect(frame).not.toContain('PRIVATE'); expect(frame).not.toContain(block.id);
      expect((await stream.read()).done).toBe(true);
    }
    await eventuallyCalendar(() => f.stats().subscriptions === 0);
  } finally {
    try { await blocks?.cancel(); blocks?.releaseLock(); await availability?.cancel(); availability?.releaseLock(); }
    finally { try { if (app?.server) await app.stop(); await runtime.dispose(); } finally { await f.close(); } }
  }
});

async function streamText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunk = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic HTTP calendar stream timed out.')), 2_000); })]);
    if (chunk.done) throw new Error('Synthetic HTTP calendar stream closed before its expected frame.');
    return new TextDecoder().decode(chunk.value);
  } finally { clearTimeout(timer); }
}
