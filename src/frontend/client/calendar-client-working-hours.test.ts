/** Actual SDK transport and SSE fixtures; memory-only, no network, browser, files or generated output. */
import { expect, test } from 'bun:test';
import type { CalendarAvailabilityPolicyView, CalendarWeeklyAvailabilityPolicyInput } from '../../calendar/contracts';
import { createCalendarClient } from './calendar-client';
import { CalendarMutationError } from './calendar-mutation';
import type { FetchInit } from './sdk';

const source: CalendarWeeklyAvailabilityPolicyInput = { kind: 'weekly-local-v1', coverage: { from: '2026-11-01', until: '2026-11-03' }, fold: 'later',
  weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] };
const view: CalendarAvailabilityPolicyView = { resourceId: 'resource-a', resourceRevision: 4, timeZone: 'America/New_York', policy: source,
  materialization: { coverage: { startAt: '2026-11-01T04:00:00.000Z', endAt: '2026-11-03T05:00:00.000Z' },
    engine: { name: 'temporal-working-hours-v1', runtime: 'bun:1.4.4', icu: '78.1' }, skippedDates: [], windowCount: 1 } };
const receipt = { requestId: 'original-key', operation: 'resource.availability-policy-changed' as const, id: 'resource-a', revision: 5, changed: true };
const frame = (value: unknown) => new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, value }) + '\n\n');

test('policy get/replace use fixed paths and detached exact native envelopes, preserving no-op and changed revisions', async () => {
  const calls: { path: string; init?: FetchInit }[] = [], signal = new AbortController().signal;
  let changed = true;
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => {
    calls.push({ path, init }); return (init?.method === 'PUT' ? { ...receipt, changed, revision: changed ? 5 : 4 } : view) as T;
  });
  try {
    const read = await client.availability.policy.get('resource-a', { signal });
    expect(read).toEqual(view); expect(read).not.toBe(view); expect(read.policy).not.toBe(source);
    for (const value of [read, read.policy, read.materialization, read.materialization!.coverage, read.materialization!.engine, read.materialization!.skippedDates]) expect(Object.isFrozen(value)).toBe(true);
    const input = structuredClone(source), supplied = { idempotencyKey: 'original-key', expectedRevision: 4, signal };
    const pending = client.availability.policy.replace('resource-a', input, supplied);
    (input.weekly[0]!.windows[0] as { endMinute: number }).endMinute = 600; supplied.expectedRevision = 99; supplied.idempotencyKey = 'replacement-key';
    expect(await pending).toEqual(receipt);
    changed = false; expect(await client.availability.policy.replace('resource-a', source, { idempotencyKey: 'original-key', expectedRevision: 4 })).toEqual({ ...receipt, changed: false, revision: 4 });
    expect(calls.map(call => call.path)).toEqual(Array(3).fill('/api/calendar/availability/resource-a/policy'));
    expect(calls[0]!.init!.method).toBe('GET');
    expect(calls[1]!.init).toMatchObject({ method: 'PUT', body: { policy: source, options: { idempotencyKey: 'original-key', expectedRevision: 4 } } });
    expect(Object.hasOwn((calls[1]!.init!.body as { options: object }).options, 'signal')).toBe(false);
    expect(calls[1]!.init!.signal).toBeInstanceOf(AbortSignal);
  } finally { client.clear(); }
});

test('policy input rejects forged authority, unknown source fields and malformed control data before dispatch', () => {
  let calls = 0, getters = 0;
  const client = createCalendarClient(async <T>() => { calls++; return receipt as T; });
  const control = { idempotencyKey: 'original-key', expectedRevision: 4 };
  try {
    for (const field of ['actor', 'scopeId', 'resourceId', 'revision', 'materialization', 'windows', 'timeZone', 'engine']) {
      expect(() => client.availability.policy.replace('resource-a', { ...source, [field]: 'PRIVATE_FORGED' } as never, control)).toThrow();
    }
    for (const supplied of [{ idempotencyKey: 'original-key' }, { ...control, expectedRevision: 0 }, { ...control, expectedRevision: 4.5 },
      { ...control, actor: 'PRIVATE_FORGED' }]) expect(() => client.availability.policy.replace('resource-a', source, supplied as never)).toThrow();
    const accessor = { ...source }; Object.defineProperty(accessor, 'weekly', { enumerable: true, get() { getters++; return []; } });
    expect(() => client.availability.policy.replace('resource-a', accessor, control)).toThrow();
    expect(() => client.availability.policy.get('bad/id')).toThrow(); expect(calls).toBe(0); expect(getters).toBe(0);
  } finally { client.clear(); }
});

test('strict response DTOs reject forged resource identity, private windows, uncanonical policies and malformed snapshot metadata', async () => {
  const snapshot = view.materialization!;
  const malformed: unknown[] = [
    { ...view, resourceId: 'another-resource' }, { ...view, resourceRevision: 0 }, { ...view, resourceRevision: 1.5 },
    { ...view, rootDirectory: 'PRIVATE_ROOT' }, { ...view, timeZone: '+05:45' },
    { ...view, policy: { ...source, scopeId: 'PRIVATE_SCOPE' } },
    { ...view, policy: { ...source, weekly: [{ day: 1, windows: [{ startMinute: 600, endMinute: 1020 }, { startMinute: 540, endMinute: 600 }] }] } },
    { ...view, materialization: { ...snapshot, windows: [{ startAt: 'PRIVATE_APPOINTMENT' }] } },
    { ...view, materialization: { ...snapshot, private: 'PRIVATE_NOTES' } },
    { ...view, materialization: { ...snapshot, windowCount: -1 } }, { ...view, materialization: { ...snapshot, windowCount: 1025 } },
    { ...view, materialization: { ...snapshot, engine: { ...snapshot.engine, tzdb: 'PRIVATE_PATH' } } },
    { ...view, materialization: { ...snapshot, engine: { ...snapshot.engine, name: 'unapproved-engine' } } },
    { ...view, materialization: { ...snapshot, coverage: { ...snapshot.coverage, endAt: snapshot.coverage.startAt } } },
    { ...view, materialization: { ...snapshot, coverage: { ...snapshot.coverage, startAt: '2026-11-01T04:00:00Z' } } },
    { ...view, materialization: { ...snapshot, skippedDates: ['2026-11-03'] } },
    { ...view, materialization: { ...snapshot, skippedDates: ['2026-11-02', '2026-11-01'] } },
    { ...view, materialization: { ...snapshot, skippedDates: ['2026-11-01', '2026-11-01'] } },
    { ...view, materialization: null },
    { ...view, policy: { kind: 'explicit-utc-v1', mode: 'windows', windows: [] } },
  ];
  for (const wire of malformed) {
    const client = createCalendarClient(async <T>() => wire as T);
    try {
      const error = await client.availability.policy.get('resource-a').catch(error => error);
      expect(error).toMatchObject({ name: 'CalendarReadError' }); expect(String(error)).not.toContain('PRIVATE');
    } finally { client.clear(); }
  }
  const client = createCalendarClient(async <T>() => ({ ...view, policy: { kind: 'explicit-utc-v1', mode: 'windows', windows: [] }, materialization: null }) as T);
  try { expect((await client.availability.policy.get('resource-a')).materialization).toBeNull(); } finally { client.clear(); }
});

test('forged mutation receipts and impossible accepted control revisions require original-key reconciliation', async () => {
  for (const wire of [ { ...receipt, id: 'another-resource' }, { ...receipt, requestId: 'another-key' }, { ...receipt, operation: 'resource.availability-changed' },
    { ...receipt, revision: 4 }, { ...receipt, changed: false, revision: 5 }, { ...receipt, revision: 6 }, { ...receipt, private: 'PRIVATE_BODY' } ]) {
    let calls = 0;
    const client = createCalendarClient(async <T>() => { calls++; return wire as T; });
    try {
      const failure = await client.availability.policy.replace('resource-a', source, { idempotencyKey: 'original-key', expectedRevision: 4 }).catch(error => error);
      expect(failure).toBeInstanceOf(CalendarMutationError);
      expect(failure).toMatchObject({ idempotencyKey: 'original-key', outcome: 'unknown', requiresReconciliation: true });
      expect(String(failure)).not.toContain('PRIVATE'); expect(calls).toBe(1);
    } finally { client.clear(); }
  }
});

test('coverage/format/time-rule errors retain known non-commit outcomes and never expose server bodies', async () => {
  for (const code of ['CALENDAR_AVAILABILITY_COVERAGE_REQUIRED', 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED', 'CALENDAR_TIME_RULES_UNAVAILABLE']) {
    let calls = 0;
    const client = createCalendarClient(async () => { calls++; throw { status: code === 'CALENDAR_TIME_RULES_UNAVAILABLE' ? 503 : 409,
      message: 'PRIVATE_MESSAGE', body: { code, outcome: 'not-committed', windows: 'PRIVATE_WINDOWS' } }; });
    try {
      const failure = await client.availability.policy.replace('resource-a', source, { idempotencyKey: 'original-key', expectedRevision: 4 }).catch(error => error);
      expect(failure).toMatchObject({ code, outcome: 'not-committed', requiresReconciliation: false, requiresSameIdempotencyKey: false, idempotencyKey: 'original-key' });
      expect(String(failure)).not.toContain('PRIVATE'); expect(calls).toBe(1);
      const read = await client.availability.policy.get('resource-a').catch(error => error);
      expect(read).toMatchObject({ name: 'CalendarReadError', code }); expect(String(read)).not.toContain('PRIVATE');
    } finally { client.clear(); }
  }
});

test('SDK retirement aborts delayed policy reads and keeps delayed mutations unknown with the original key', async () => {
  for (const mutation of [false, true]) {
    let finish!: (value: unknown) => void, signal!: AbortSignal, calls = 0;
    const client = createCalendarClient(<T>(_path: string, init?: FetchInit) => { calls++; signal = init!.signal!;
      return new Promise<T>(resolve => { finish = value => resolve(value as T); }); });
    try {
      const pending = (mutation ? client.availability.policy.replace('resource-a', source, { idempotencyKey: 'original-key', expectedRevision: 4 })
        : client.availability.policy.get('resource-a')).catch(error => error);
      client.clear(); expect(signal.aborted).toBe(true); finish(mutation ? receipt : view);
      expect(await pending).toMatchObject(mutation ? { name: 'AbortError', outcome: 'unknown', idempotencyKey: 'original-key', requiresReconciliation: true } : { name: 'AbortError' });
      expect(calls).toBe(1);
    } finally { client.clear(); }
  }
});

test('policy watch strictly parses snapshots, binds resource identity and cancels the owned reader after malformed private data', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0, opens = 0, signal!: AbortSignal;
  const values: CalendarAvailabilityPolicyView[] = [], errors: unknown[] = [];
  const client = createCalendarClient(async () => { throw new Error('No watch side fetch.'); }, async (path, init) => {
    opens++; expect(path).toBe('/api/calendar/availability/resource-a/policy/live'); signal = init.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = client.availability.policy.watch('resource-a', value => values.push(value), { onError: error => errors.push(error) });
  try {
    controller.enqueue(frame(view)); await eventually(() => values.length === 1);
    expect(Object.isFrozen(values[0]!.materialization)).toBe(true);
    controller.enqueue(frame({ ...view, resourceId: 'forged-resource', private: 'NEVER_DELIVER' }));
    await eventually(() => errors.length === 1 && cancelled === 1 && signal.aborted);
    expect(values).toHaveLength(1); expect(errors[0]).toMatchObject({ name: 'CalendarReadError', terminal: true });
    expect(signal.aborted).toBe(true); expect(opens).toBe(1); expect(String(errors[0])).not.toContain('NEVER_DELIVER');
  } finally { stop(); client.clear(); }
});

test('401 policy watches terminate once and cancel response bodies; SDK retirement cancels an idle accepted watch', async () => {
  for (const denied of [true, false]) {
    let cancelled = 0, opens = 0, errors = 0, signal!: AbortSignal;
    const client = createCalendarClient(async () => { throw new Error('No watch side fetch.'); }, async (_path, init) => {
      opens++; signal = init.signal!;
      return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }), {
        status: denied ? 401 : 200, headers: { 'Content-Type': denied ? 'application/json' : 'text/event-stream' },
      });
    });
    const stop = client.availability.policy.watch('resource-a', () => { throw new Error('Denied/idle watch cannot publish.'); }, { onError() { errors++; } });
    try {
      if (denied) await eventually(() => errors === 1 && cancelled === 1);
      else { await Promise.resolve(); client.clear(); await eventually(() => cancelled === 1); }
      expect(signal.aborted).toBe(true); expect(opens).toBe(1); expect(errors).toBe(denied ? 1 : 0);
    } finally { stop(); client.clear(); }
  }
});

test('browser get/replace/watch operate without reading Temporal or loading the native materializer', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  let temporalReads = 0, cancelled = 0, delivered = 0;
  const client = createCalendarClient(async <T>(_path: string, init?: FetchInit) => (init?.method === 'PUT' ? receipt : view) as T,
    async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(frame(view)); }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  let stop = () => {};
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { temporalReads++; throw new Error('Native Temporal must not enter browser SDK.'); } });
    expect(await client.availability.policy.get('resource-a')).toEqual(view);
    expect(await client.availability.policy.replace('resource-a', source, { idempotencyKey: 'original-key', expectedRevision: 4 })).toEqual(receipt);
    stop = client.availability.policy.watch('resource-a', () => { delivered++; }); await eventually(() => delivered === 1);
    stop(); await eventually(() => cancelled === 1); expect(temporalReads).toBe(0);
  } finally {
    stop(); client.clear();
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
  }
});

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) { if (check()) return; await Promise.resolve(); }
  throw new Error('Memory policy SDK fixture timed out.');
}
