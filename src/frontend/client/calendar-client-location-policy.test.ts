/** Synthetic policy/transport responses only. No server, filesystem or timezone engine. */
import { expect, test } from 'bun:test';
import { createCalendarClient } from './calendar-client';
import { calendarLocationPolicyInput } from './calendar-client-location-policy';
import { normalizeCalendarResourceLocationPolicy } from '../../calendar/location-policy-model';
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView } from '../../calendar/contracts';
import type { FetchInit } from './sdk';
const from = '2026-11-18T10:00:00.000Z', middle = '2026-11-18T11:00:00.000Z', until = '2026-11-18T12:00:00.000Z';
const policy = { kind: 'effective-utc-v1', assignments: [{ locationId: 'location', windows: [{ startAt: from, endAt: until }] }] } as const;
const view: CalendarResourceLocationPolicyView = { resourceId: 'resource', resourceRevision: 4, policy };
const receipt = { requestId: 'policy-change', operation: 'resource.location-policy-changed', id: 'resource', revision: 5, changed: true } as const;
test('browser normalization matches source sorting, adjacency/overlap merging, closed empty coverage and arbitrary long UTC windows', () => {
  const cases: CalendarResourceLocationPolicyInput[] = [
    { kind: 'static-v1', locationIds: ['z', 'a'] }, { kind: 'static-v1', locationIds: [] }, { kind: 'effective-utc-v1', assignments: [] },
    { kind: 'effective-utc-v1', assignments: [{ locationId: 'z', windows: [] }, { locationId: 'a', windows: [
      { startAt: middle, endAt: until }, { startAt: from, endAt: middle }, { startAt: from, endAt: middle },
    ] }] },
    { kind: 'effective-utc-v1', assignments: [{ locationId: 'location', windows: [{ startAt: '0000-02-29T00:00:00.000Z', endAt: '9999-12-31T00:00:00.000Z' }] }] },
  ];
  for (const input of cases) {
    const accepted = calendarLocationPolicyInput(input); expect(accepted).toEqual(normalizeCalendarResourceLocationPolicy(input)); expect(Object.isFrozen(accepted)).toBe(true);
  }
});
test('policy replacement is one detached PUT with native resource CAS, and read codecs verify the exact target and canonical generation', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return (init?.method === 'PUT' ? receipt : view) as T; });
  try {
    const input = { kind: 'effective-utc-v1' as const, assignments: [{ locationId: 'location', windows: [{ startAt: middle, endAt: until }, { startAt: from, endAt: middle }] }] };
    const pending = client.locations.policy.replace('resource', input, { idempotencyKey: receipt.requestId, expectedRevision: 4 });
    input.assignments[0]!.windows[0]!.startAt = 'MUTATED_AFTER_CALL'; await expect(pending).resolves.toEqual(receipt);
    expect(calls[0]).toMatchObject({ path: '/api/calendar/resources/resource/location-policy', init: { method: 'PUT', body: { policy, options: { idempotencyKey: receipt.requestId, expectedRevision: 4 } } } });
    const accepted = await client.locations.policy.get('resource'); expect(accepted).toEqual(view);
    expect(Object.isFrozen(accepted.policy)).toBe(true); expect(calls[1]!.path).toBe('/api/calendar/resources/resource/location-policy');
  } finally { client.clear(); }
});
test('unknown fields, accessors, malformed arrays, duplicate targets and RAW window/total bounds fail with zero transport', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  try {
    const badArray = Object.assign([], { hidden: true }), sparse = new Array(1), repeated = Array.from({ length: 65 }, () => ({ startAt: from, endAt: until }));
    const tooManyTotal = Array.from({ length: 5 }, (_, index) => ({ locationId: 'location-' + index, windows: Array.from({ length: index === 4 ? 1 : 64 }, () => ({ startAt: from, endAt: until })) }));
    for (const input of [undefined, null, {}, { kind: 'static-v1', locationIds: ['a', 'a'] }, { kind: 'static-v1', locationIds: Array.from({ length: 17 }, (_, i) => 'a' + i) },
      { kind: 'static-v1', locationIds: sparse }, { kind: 'static-v1', locationIds: badArray }, { kind: 'static-v1', locationIds: [], actor: 'forged' },
      { get kind() { getters++; return 'static-v1'; }, locationIds: [] }, { kind: 'effective-utc-v1', assignments: [{ get locationId() { getters++; return 'a'; }, windows: [] }] },
      { kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: repeated }] }, { kind: 'effective-utc-v1', assignments: tooManyTotal },
      { kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: [{ startAt: from, endAt: from }] }] },
      { kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: [{ startAt: 1, endAt: 2 }] }] },
      { kind: 'effective-utc-v1', assignments: [{ locationId: 'a', windows: [] }, { locationId: 'a', windows: [] }] },
    ]) expect(() => client.locations.policy.replace('resource', input as never, { idempotencyKey: 'invalid', expectedRevision: 4 })).toThrow();
    expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});
test('source responses cannot retarget IDs, repair noncanonical windows or expose extra private fields', async () => {
  for (const response of [{ ...view, resourceId: 'other' }, { ...view, resourceRevision: 0 }, { ...view, actor: 'forged' },
    { ...view, policy: { kind: 'static-v1', locationIds: ['z', 'a'] } },
    { ...view, policy: { kind: 'effective-utc-v1', assignments: [{ locationId: 'location', windows: [{ startAt: from, endAt: middle }, { startAt: middle, endAt: until }] }] } },
    { ...view, policy: { ...policy, reason: 'NEVER_ACCEPT_PRIVATE' } },
  ]) {
    const client = createCalendarClient(async <T>() => response as T);
    try { await expect(client.locations.policy.get('resource')).rejects.toMatchObject({ name: 'CalendarReadError' }); }
    finally { client.clear(); }
  }
});
test('forVisit interval is detached OCCUPIED canonical UTC, positive at most33days; old omission stays the old wire shape', async () => {
  const paths: string[] = [], client = createCalendarClient(async <T>(path: string) => { paths.push(path); return { items: [], truncated: false, nextAfter: null } as T; });
  try {
    await client.locations.forVisit({ resourceIds: ['resource'] }); expect(paths[0]).toBe('/api/calendar/visit-locations?resourceIds=resource');
    const query = { resourceIds: ['resource'], interval: { startAt: from, endAt: until } }, pending = client.locations.forVisit(query); query.interval.startAt = 'MUTATED'; await pending;
    const params = new URL(paths[1]!, 'https://synthetic.invalid').searchParams; expect(params.get('startAt')).toBe(from); expect(params.get('endAt')).toBe(until);
    await client.locations.forVisit({ resourceIds: [], interval: { startAt: from, endAt: new Date(Date.parse(from) + 33 * 86400_000).toISOString() } });
    for (const interval of [undefined, {}, { startAt: from }, { startAt: from, endAt: from }, { startAt: from, endAt: until, timeZone: 'UTC' },
      { startAt: from, endAt: new Date(Date.parse(from) + 33 * 86400_000 + 1).toISOString() }, { startAt: 1, endAt: 2 },
    ]) expect(() => client.locations.forVisit({ resourceIds: ['resource'], interval } as never)).toThrow();
    expect(paths).toHaveLength(3);
  } finally { client.clear(); }
});
test('wrong receipt generation remains unknown while native unsupported-format refusal is known noncommit', async () => {
  const wrong = createCalendarClient(async <T>() => ({ ...receipt, revision: 7 }) as T);
  try { await expect(wrong.locations.policy.replace('resource', policy, { idempotencyKey: receipt.requestId, expectedRevision: 4 })).rejects.toMatchObject({ outcome: 'unknown', idempotencyKey: receipt.requestId }); }
  finally { wrong.clear(); }
  const refused = createCalendarClient(async () => { throw { status: 409, body: { code: 'CALENDAR_LOCATION_FORMAT_UNSUPPORTED', outcome: 'not-committed' } }; });
  try { await expect(refused.locations.policy.replace('resource', policy, { idempotencyKey: receipt.requestId, expectedRevision: 4 })).rejects.toMatchObject({ outcome: 'not-committed', requiresReconciliation: false }); }
  finally { refused.clear(); }
});
test('policy SSE uses its fixed target path and retires late frames on scope clear', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, stopped = 0, seen = 0, signal!: AbortSignal;
  const client = createCalendarClient(async () => { throw new Error('No SSE side fetch.'); }, async (path, init) => {
    expect(path).toBe('/api/calendar/resources/resource/location-policy/live'); signal = init.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { stopped++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = client.locations.policy.watch('resource', () => { seen++; });
  try {
    controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: view }) + '\n\n'));
    for (let index = 0; index < 30 && !seen; index++) await new Promise<void>(done => setTimeout(done, 1));
    expect(seen).toBe(1); client.clear();
    for (let index = 0; index < 30 && !stopped; index++) await new Promise<void>(done => setTimeout(done, 1));
    expect(signal.aborted).toBe(true); expect(stopped).toBe(1); expect(seen).toBe(1);
  } finally { stop(); client.clear(); }
});
