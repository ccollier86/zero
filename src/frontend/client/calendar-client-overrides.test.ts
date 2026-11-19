/** Synthetic closed DTO/transport tests. Tokens are structural fixtures, never private conflict descriptors. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import { calendarOverrideReview } from './calendar-client-overrides';
import type { FetchInit } from './sdk';
const appointment = { resourceIds: ['resource'], title: 'Synthetic', startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
export const syntheticToken = 'co1.1.9999999999999.' + 'a'.repeat(32) + '.' + 'b'.repeat(64);
const review = { status: 'reviewable', categories: ['appointment-overlap'], policyVersion: 'appointment-overlap-v1', decisionToken: syntheticToken, expiresAt: '2099-01-01T00:00:00.000Z' } as const;
const override = { policyVersion: 'appointment-overlap-v1', decisionToken: syntheticToken, reason: 'PRIVATE_REASON' } as const;
test('review calls are detached reads with proposed keys; reasoned create/update alone gain override without changing ordinary wire', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init });
    if (path.includes('review')) return review as T;
    const options = (init!.body as { options: { idempotencyKey: string } }).options;
    return { requestId: options.idempotencyKey, operation: path.endsWith('/appointments') ? 'appointment.created' : 'appointment.updated', id: 'appointment', revision: path.endsWith('/appointments') ? 1 : 2, changed: true } as T;
  });
  try {
    const input = { ...appointment, resourceIds: ['resource'] }, checking = client.appointments.reviewCreate(input, { idempotencyKey: 'proposed' }); input.resourceIds[0] = 'later';
    expect(await checking).toEqual(review); expect(calls[0]!.init!.body).toEqual({ appointment, options: { idempotencyKey: 'proposed' } });
    await client.appointments.reviewUpdate('appointment', { title: 'New' }, { idempotencyKey: 'proposed-update', expectedRevision: 1 });
    expect(calls[1]).toMatchObject({ path: '/api/calendar/appointments/appointment/review', init: { method: 'POST', body: { patch: { title: 'New' }, options: { idempotencyKey: 'proposed-update', expectedRevision: 1 } } } });
    await client.appointments.create(appointment, { idempotencyKey: 'ordinary' }); expect(calls[2]!.init!.body).toEqual({ appointment, options: { idempotencyKey: 'ordinary' } });
    const authored = { ...override, reason: '  PRIVATE_REASON  ' }, saving = client.appointments.update('appointment', { title: 'New' }, { idempotencyKey: 'proposed-update', expectedRevision: 1, override: authored }); authored.reason = 'later'; await saving;
    expect(calls[3]!.init!.body).toEqual({ appointment: { title: 'New' }, options: { idempotencyKey: 'proposed-update', expectedRevision: 1, override } });
  } finally { client.clear(); }
});
test('forged review/override authorship, private/server fields, malformed tokens/reasons and legacy override options fail before transport', () => {
  let calls = 0, getters = 0; const client = createCalendarClient(async <T>() => { calls++; return review as T; });
  try {
    for (const value of [undefined, null, { ...override, force: true }, { ...override, policyVersion: 'all-conflicts' }, { ...override, reason: ' ' },
      { ...override, reason: 'x'.repeat(1025) }, { ...override, reason: 'x\nprivate' }, { ...override, decisionToken: 'base64PRIVATE' },
      { ...override, get decisionToken() { getters++; return syntheticToken; } },
    ]) expect(() => client.appointments.create(appointment, { idempotencyKey: 'bad', override: value } as never)).toThrow();
    expect(() => client.appointments.reviewCreate(appointment, { idempotencyKey: 'bad', override } as never)).toThrow();
    expect(() => client.appointments.reschedule('appointment', { startAt: appointment.startAt, endAt: appointment.endAt, timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }, { idempotencyKey: 'bad', expectedRevision: 1, override } as never)).toThrow();
    expect(() => client.holds.acquire({ ...appointment }, { idempotencyKey: 'bad', override } as never)).toThrow();
    expect(() => client.overrides.grants.replace('resource', 'user', { categories: ['appointment-overlap', 'appointment-overlap'] }, { idempotencyKey: 'bad', expectedRevision: 1 })).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});
test('review responses are coarse and closed; unsupported categories and private conflict/count fields never publish', () => {
  for (const response of [{ status: 'clear', count: 0 }, { status: 'limit' }, { status: 'non-reviewable', reason: 'hold' },
    { ...review, categories: [] }, { ...review, categories: ['block-overlap'] }, { ...review, conflicts: ['PRIVATE_ID'] },
    { ...review, decisionToken: 'co1.private-json' }, { ...review, expiresAt: '2099-01-01' },
  ]) expect(() => calendarOverrideReview(response)).toThrow();
  expect(calendarOverrideReview({ status: 'clear' })).toEqual({ status: 'clear' }); expect(calendarOverrideReview({ status: 'non-reviewable' })).toEqual({ status: 'non-reviewable' });
});
test('review timeout/denial is a read failure, and SDK retirement discards delayed review responses without mutation uncertainty', async () => {
  const denied = createCalendarClient(async () => { throw { status: 409, body: { code: 'CALENDAR_OVERRIDE_NOT_ALLOWED', outcome: 'not-started' } }; });
  try { await expect(denied.appointments.reviewCreate(appointment, { idempotencyKey: 'proposed' })).rejects.toMatchObject({ name: 'CalendarReadError', code: 'CALENDAR_OVERRIDE_NOT_ALLOWED' }); }
  finally { denied.clear(); }
  let resolve!: (value: unknown) => void; const pending = new Promise(done => { resolve = done; });
  const client = createCalendarClient(async <T>() => await pending as T), task = client.appointments.reviewCreate(appointment, { idempotencyKey: 'proposed' }); void task.catch(() => {});
  try { client.clear(); resolve(review); await expect(task).rejects.toMatchObject({ name: 'AbortError' }); }
  finally { resolve(review); await task.catch(() => {}); client.clear(); }
});
test('separate grants bind both resource and user, keep resource CAS and use their singular receipt operation', async () => {
  const view = { resourceId: 'resource', userId: 'user', resourceRevision: 4, categories: ['appointment-overlap'] as const }, calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return (init?.method === 'PUT'
    ? { requestId: 'grant', operation: 'resource.override-grant-changed', id: 'resource', revision: 5, changed: true } : view) as T; });
  try {
    expect(await client.overrides.grants.get('resource', 'user')).toEqual(view);
    await client.overrides.grants.replace('resource', 'user', { categories: ['appointment-overlap'] }, { idempotencyKey: 'grant', expectedRevision: 4 });
    expect(calls[1]).toMatchObject({ path: '/api/calendar/resources/resource/override-grants/user', init: { method: 'PUT', body: { grants: { categories: ['appointment-overlap'] }, options: { idempotencyKey: 'grant', expectedRevision: 4 } } } });
  } finally { client.clear(); }
  const wrong = createCalendarClient(async <T>() => ({ ...view, userId: 'other' }) as T);
  try { await expect(wrong.overrides.grants.get('resource', 'user')).rejects.toMatchObject({ name: 'CalendarReadError' }); }
  finally { wrong.clear(); }
});
test('grant watches bind both target identities and retire malformed frames without private publication', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, seen = 0, errors = 0, cancelled = 0;
  const view = { resourceId: 'resource', userId: 'user', resourceRevision: 2, categories: ['appointment-overlap'] };
  const client = createCalendarClient(async () => { throw new Error('No watch side fetch.'); }, async (path) => {
    expect(path).toBe('/api/calendar/resources/resource/override-grants/user/live');
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = client.overrides.grants.watch('resource', 'user', () => { seen++; }, { onError() { errors++; } });
  const frame = (value: unknown) => new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value }) + '\n\n');
  try {
    controller.enqueue(frame(view)); for (let i = 0; i < 30 && !seen; i++) await new Promise<void>(done => setTimeout(done, 1)); expect(seen).toBe(1);
    controller.enqueue(frame({ ...view, userId: 'PRIVATE_OTHER_USER' }));
    for (let i = 0; i < 30 && !cancelled; i++) await new Promise<void>(done => setTimeout(done, 1));
    expect(errors).toBe(1); expect(seen).toBe(1); expect(cancelled).toBe(1);
  } finally { stop(); client.clear(); }
});
