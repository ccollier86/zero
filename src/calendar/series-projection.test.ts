/** Pure native Temporal/cache-off tests. No filesystem fixtures, DB, servers,
 * generated dependencies or build output are allocated by this file. */
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { normalizeCalendarTimedSeriesAuthoring, type CalendarTimedSeriesAuthoring } from './series-authoring';
import { captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch, createCalendarSeriesCompilationCursor,
  type CalendarSeriesCompilationSnapshot, type CalendarSeriesCompilationSource } from './series-compilation';
import { advanceCalendarSeriesProjection, createCalendarSeriesProjection, inspectCalendarSeriesProjection, inspectCalendarSeriesProjectionCompilation, inspectCalendarSeriesProjectionStep,
  restoreCalendarSeriesProjection, type CalendarSeriesProjection, type CalendarSeriesProjectionInstruction } from './series-projection';
import { CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES, CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES } from './series-projection';
import { calendarHash } from './validation';

const limits = { maxResources: 16, maxParticipants: 100 };
const range = { from: '2026-01-01', until: '2026-01-03' };
type MutableAuthoring = { -readonly [Key in keyof CalendarTimedSeriesAuthoring]: CalendarTimedSeriesAuthoring[Key] };
function authoring(): MutableAuthoring {
  return { kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2026-01-01T23:30:00.000', timeZone: 'UTC', fold: 'earlier',
    durationMilliseconds: 60 * 60_000, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1 } } },
    template: { resourceIds: ['b', 'a'], title: 'PRIVATE_TITLE', bufferBeforeMinutes: 2, bufferAfterMinutes: 3,
      appointmentType: { id: 'consult', revision: 2 }, visit: { mode: 'in-person', location: { id: 'office', revision: 3 } },
      participants: [{ kind: 'guardian-user', userId: 'user-a' }] } };
}
function snapshot(input = authoring(), patch: Partial<CalendarSeriesCompilationSnapshot> = {}): CalendarSeriesCompilationSnapshot {
  const normalized = normalizeCalendarTimedSeriesAuthoring(input, limits);
  return { kind: 'calendar-series-source-snapshot-v1', scopeId: 'tenant:projection', ownerId: 'established-owner', rootHash: calendarHash('actual-root'),
    realmFingerprint: 'sha256:' + calendarHash('actual-realm'), sourceId: 'series-source', seriesId: 'lineage', segmentId: 'logical-segment',
    segmentRecordId: 'segment-row-generation-1', generationId: 'generation-1', sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0,
    preparationId: 'preparation', basePublicationId: null, planManifestDigest: calendarHash('accepted-plan'), preparationExpiresAtMs: 1_900_000_000_000,
    intentDigest: calendarHash('human-intent'), authoringDigest: calendarHash(normalized), engineGeneration: calendarHash(calendarRecurrenceTraversal(normalized.recurrence).engine),
    policyGeneration: calendarHash('current-policy'), authoring: input,
    grant: { grantId: 'fixed-grant', grantEpoch: 1, authorityDigest: calendarHash('original-authority'), resourceDigest: calendarHash(normalized.template.resourceIds) },
    resourceRevisions: normalized.template.resourceIds.map((id, index) => ({ id, revision: index + 2 })), ...patch };
}
function fixture(input = authoring(), window = range, occurrenceLimit = 100) {
  const stored = snapshot(input), source = captureCalendarSeriesCompilationSource(stored, limits);
  const batch = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, window), { occurrenceLimit });
  return { stored, source, batch, cursor: createCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }) };
}
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID') {
  try { run(); throw new Error('invalid projection accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); }
}
function drain(cursor: CalendarSeriesProjection, budget = { instructionLimit: 256, rowLimit: 256 }) {
  const instructions: CalendarSeriesProjectionInstruction[] = [];
  for (let count = 0; ; count++) {
    expect(count).toBeLessThan(1000);
    const step = advanceCalendarSeriesProjection(cursor, budget); instructions.push(...step.instructions); cursor = step.cursor;
    expect(step.instructions.length).toBeLessThanOrEqual(budget.instructionLimit); expect(step.rowCount).toBeLessThanOrEqual(budget.rowLimit);
    expect(step.rowCount).toBe(step.instructions.reduce((sum, value) => sum + value.rowCount, 0));
    if (step.progress.checkpoint.phase === 'complete') return { instructions, evidence: inspectCalendarSeriesProjection(cursor), cursor };
    expect(step.instructions.length).toBeGreaterThan(0);
  }
}
function portableNodes(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  return 1 + Object.values(value).reduce<number>((total, child) => total + portableNodes(child), 0);
}

test('verified branded compilation produces source-bound immutable instructions, complete claims and clipped UTC day members', () => {
  const { source, batch, cursor } = fixture(), result = drain(cursor), binding = result.evidence.binding, c = batch.evidence.candidates[0]!;
  expect(binding.source).toBe(batch.evidence.binding); expect(binding.source.rootHash).toBe(calendarHash('actual-root'));
  expect(binding.source.realmFingerprint).toBe('sha256:' + calendarHash('actual-realm'));
  expect(binding.source.selections).toEqual({ resourceIds: ['a', 'b'], appointmentType: c.booking.appointmentType ?? null, visit: c.booking.visit ?? null, participants: c.participants });
  expect(result.instructions.map(value => value.kind)).toEqual(['occurrence', 'version', 'resource', 'cell-member', 'cell-member', 'resource', 'cell-member', 'cell-member']);
  const occurrence = result.instructions[0]!, version = result.instructions[1]!;
  expect(occurrence).toMatchObject({ id: c.id, logicalSegmentId: 'logical-segment', nominalKey: c.nominalKey, appointmentId: c.id });
  expect(version).toMatchObject({ occurrenceId: c.id, booking: c.booking, title: 'PRIVATE_TITLE', participants: c.participants });
  const interval = c.booking.interval, claims = result.instructions.filter(value => value.kind === 'resource');
  expect(claims.map(value => value.resourceId)).toEqual(['a', 'b']);
  for (const claim of claims) expect(claim).toMatchObject({ rowCount: 2, fromMs: interval.occupiedStartMs, untilMs: interval.occupiedEndMs, expiresAtMs: binding.source.preparationExpiresAtMs });
  const cells = result.instructions.filter(value => value.kind === 'cell-member');
  expect(cells.slice(0, 2).map(value => [value.cellStartMs, value.fromMs, value.untilMs])).toEqual([
    [Date.parse('2026-01-01T00:00:00.000Z'), interval.occupiedStartMs, Date.parse('2026-01-02T00:00:00.000Z')],
    [Date.parse('2026-01-02T00:00:00.000Z'), Date.parse('2026-01-02T00:00:00.000Z'), interval.occupiedEndMs] ]);
  for (const [index, instruction] of result.instructions.entries()) {
    const { digest, ...facts } = instruction;
    expect(digest).toBe(calendarHash(['calendar-series-projection-instruction-v1', facts]));
    expect(instruction).toMatchObject({ bindingDigest: binding.bindingDigest, batchDigest: batch.evidence.batchDigest,
      candidateDigest: calendarHash(c), resourceVectorDigest: calendarHash(binding.source.resourceRevisions), candidateOrdinal: 0, instructionOrdinal: index });
    expect(Object.isFrozen(instruction)).toBe(true);
  }
  for (const name of ['coverage', 'accepted', 'applied', 'reservation', 'free']) expect(result.evidence).not.toHaveProperty(name);
  expect(inspectCalendarSeriesProjection(cursor).checkpoint.instructionCount).toBe(0);
  expect(source).toBeDefined();
});

test('step and row budgets make deterministic progress across resource/cell boundaries with partition-independent manifest roots', () => {
  const { cursor } = fixture(), together = drain(cursor), split = drain(cursor, { instructionLimit: 1, rowLimit: 5 });
  expect(split.instructions).toEqual(together.instructions); expect(split.evidence).toEqual(together.evidence);
  const first = advanceCalendarSeriesProjection(cursor, { instructionLimit: 2, rowLimit: 6 });
  const resource = advanceCalendarSeriesProjection(first.cursor, { instructionLimit: 256, rowLimit: 6 });
  expect(resource.instructions.map(value => value.kind)).toEqual(['resource', 'cell-member']); expect(resource.rowCount).toBe(6);
  expect(resource.progress.checkpoint).toMatchObject({ phase: 'cell', resourceOrdinal: 0, cellOrdinal: 1, instructionCount: 4, rowCount: 12 });
  expect(advanceCalendarSeriesProjection(cursor, { instructionLimit: 2, rowLimit: 6 })).toEqual(first);
  const differentBudget = advanceCalendarSeriesProjection(cursor, { instructionLimit: 1, rowLimit: 5 });
  expect(differentBudget.originalStepKey).toBe(first.originalStepKey); expect(differentBudget.stepDigest).not.toBe(first.stepDigest);
  for (const bad of [{ instructionLimit: 0 }, { instructionLimit: 257 }, { rowLimit: 0 }, { rowLimit: 1 }, { rowLimit: 2 }, { rowLimit: 3 }, { rowLimit: 4 }, { rowLimit: 257 }, { candidateLimit: 1 }])
    rejects(() => advanceCalendarSeriesProjection(cursor, bad));
});

test('100 legal 544-cell candidates are streamed in independently bounded steps, never treated as one short writer', () => {
  const raw = authoring();
  raw.recurrence = { ...raw.recurrence, localStart: '2026-01-01T12:00:00.000', durationMilliseconds: 31 * 86_400_000,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 100 } } };
  raw.template = { ...raw.template, resourceIds: Array.from({ length: 16 }, (_, index) => `r${index.toString().padStart(2, '0')}`), bufferBeforeMinutes: 1440, bufferAfterMinutes: 1440 };
  const f = fixture(raw, { from: '2026-01-01', until: '2026-05-01' }); expect(f.batch.evidence.candidates.length).toBe(100);
  let cursor = f.cursor, total = 0, cells = 0, rows = 0, resourceClaims = 0, steps = 0, maximumInstructions = 0;
  for (;;) {
    const step = advanceCalendarSeriesProjection(cursor); cursor = step.cursor; steps++;
    expect(step.instructions.length).toBeLessThanOrEqual(256); expect(step.rowCount).toBeLessThanOrEqual(256);
    maximumInstructions = Math.max(maximumInstructions, step.instructions.length);
    total += step.instructions.length; rows += step.rowCount;
    for (const value of step.instructions) { if (value.kind === 'cell-member') cells++; if (value.kind === 'resource') resourceClaims++; }
    if (step.progress.checkpoint.phase === 'complete') break;
    expect(steps).toBeLessThan(1000);
  }
  expect(cells).toBe(54_400); expect(resourceClaims).toBe(1600); expect(total).toBe(56_200); expect(rows).toBe(224_200); expect(steps).toBeGreaterThan(850);
  expect(maximumInstructions).toBeGreaterThan(50); // No global small-instruction throttle.
  expect(inspectCalendarSeriesProjection(cursor).checkpoint).toMatchObject({ phase: 'complete', candidateOrdinal: 100, resourceOrdinal: 0, cellOrdinal: 0, rowCount: rows, instructionCount: total });
}, 20_000); // Maximum legal projection stress, not a five-second latency claim.

test('participant-heavy payload limits preserve exact resume and partition-independent instruction/manifests without omitted rows', () => {
  const raw = authoring();
  raw.recurrence = { ...raw.recurrence, localStart: '2026-01-01T09:00:00.000', rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 40 } } };
  raw.template = { ...raw.template, resourceIds: ['a'], bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
    participants: Array.from({ length: 100 }, (_, index) => ({ kind: 'guardian-user' as const, userId: 'user-' + String(index).padStart(3, '0') })) };
  const f = fixture(raw, { from: '2026-01-01', until: '2026-03-01' }), first = advanceCalendarSeriesProjection(f.cursor);
  expect(first.rowCount).toBeLessThan(256); expect(first.instructions.length).toBeGreaterThan(8);
  let cursor = f.cursor;
  for (let count = 0; ; count++) {
    const step = advanceCalendarSeriesProjection(cursor);
    expect(portableNodes(step.instructions)).toBeLessThanOrEqual(CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES);
    expect(Buffer.byteLength(JSON.stringify(step.instructions))).toBeLessThanOrEqual(CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES);
    cursor = step.cursor; if (step.progress.checkpoint.phase === 'complete') break;
    expect(count).toBeLessThan(100);
  }
  const whole = drain(f.cursor), split = drain(f.cursor, { instructionLimit: 7, rowLimit: 256 });
  expect(whole.instructions).toEqual(split.instructions); expect(whole.evidence).toEqual(split.evidence);
  expect(whole.instructions).toHaveLength(160); expect(whole.evidence.checkpoint.rowCount).toBe(400);
  const restored = restoreCalendarSeriesProjection(f.source, f.batch.contribution, f.batch.evidence.batchDigest, { runId: 'native-run' },
    JSON.parse(JSON.stringify(first.progress.checkpoint)), first.progress.afterDigest);
  expect(drain(restored).instructions).toEqual(drain(first.cursor).instructions); expect(drain(restored).evidence).toEqual(drain(first.cursor).evidence);
});

test('native stored checkpoint recovery preserves exact per-resource cell position and requires independent expected digest/CAS binding', () => {
  const { source, stored, batch, cursor } = fixture(), first = advanceCalendarSeriesProjection(cursor, { instructionLimit: 4, rowLimit: 12 });
  const persisted = JSON.parse(JSON.stringify(first.progress.checkpoint)), expected = first.progress.afterDigest;
  const freshSource = captureCalendarSeriesCompilationSource(snapshot(), limits);
  const restored = restoreCalendarSeriesProjection(freshSource, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }, persisted, expected);
  expect(drain(restored).instructions).toEqual(drain(first.cursor).instructions);
  expect(drain(restored).evidence).toEqual(drain(first.cursor).evidence);
  rejects(() => restoreCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId: 'other-run' }, persisted, expected), 'CALENDAR_REVISION_CONFLICT');
  for (const patch of [{ phase: 'resource' }, { cellOrdinal: 0 }, { resourceOrdinal: 1 }, { instructionCount: 99 }, { rowCount: 1 }, { manifestRootDigest: '0'.repeat(64) }])
    rejects(() => restoreCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }, { ...persisted, ...patch }, expected), 'CALENDAR_REVISION_CONFLICT');
  // Even a trusted-store digest must describe canonical positional counters.
  const impossible = { ...persisted, resourceOrdinal: 16 }, impossibleDigest = calendarHash(['calendar-series-projection-progress-v1', impossible]);
  rejects(() => restoreCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }, impossible, impossibleDigest));
  for (const patch of [{ rootHash: calendarHash('new-root') }, { realmFingerprint: 'sha256:' + calendarHash('new-realm') }, { segmentRecordId: 'segment-row-2' },
    { preparationId: 'new-preparation' }, { planManifestDigest: calendarHash('different-plan') }, { policyGeneration: calendarHash('new-policy') }]) {
    const revised = captureCalendarSeriesCompilationSource({ ...stored, ...patch }, limits);
    rejects(() => restoreCalendarSeriesProjection(revised, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }, persisted, expected), 'CALENDAR_REVISION_CONFLICT');
  }
  rejects(() => restoreCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }, persisted, 'bad'));
});

test('copied/proxied handles and caller-rehashed instructions cannot become runtime-owned signer-safe step evidence', () => {
  const { source, batch, cursor } = fixture(), step = advanceCalendarSeriesProjection(cursor);
  expect(inspectCalendarSeriesProjectionStep(step.cursor, step.stepDigest)).toBe(step);
  for (const copied of [{ ...cursor }, JSON.parse(JSON.stringify(cursor)), inspectCalendarSeriesProjection(cursor), step])
    rejects(() => advanceCalendarSeriesProjection(copied as CalendarSeriesProjection), 'CALENDAR_FORBIDDEN');
  rejects(() => inspectCalendarSeriesProjectionStep(cursor, step.stepDigest), 'CALENDAR_FORBIDDEN');
  rejects(() => inspectCalendarSeriesProjectionStep(step.cursor, '0'.repeat(64)), 'CALENDAR_INTENT_CONFLICT');
  const forgery = { ...step, instructions: [], rowCount: 0 };
  expect(inspectCalendarSeriesProjectionStep(forgery.cursor, forgery.stepDigest).instructions).toBe(step.instructions);
  expect(inspectCalendarSeriesProjectionStep(forgery.cursor, forgery.stepDigest).instructions.length).toBeGreaterThan(0);
  rejects(() => createCalendarSeriesProjection(source, batch.evidence as any, batch.evidence.batchDigest, { runId: 'native-run' }), 'CALENDAR_FORBIDDEN');
  rejects(() => createCalendarSeriesProjection({} as CalendarSeriesCompilationSource, batch.contribution, batch.evidence.batchDigest, { runId: 'native-run' }), 'CALENDAR_FORBIDDEN');
  for (const options of [{}, { runId: 'bad run' }, { runId: 'native-run', cells: [] }])
    rejects(() => createCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, options as any));
  let touched = false; const proxy = new Proxy(cursor, { getPrototypeOf() { touched = true; throw new Error('should not touch proxy'); } });
  rejects(() => inspectCalendarSeriesProjection(proxy), 'CALENDAR_FORBIDDEN'); expect(touched).toBe(false);
});

test('UTC day cells floor negative epochs and exclude an exactly adjacent end regardless of scheduling-zone civil days', () => {
  const raw = authoring(); raw.recurrence = { ...raw.recurrence, localStart: '1969-12-31T23:30:00.000', durationMilliseconds: 30 * 60_000 };
  raw.template = { ...raw.template, resourceIds: ['a'], bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
  const cells = drain(fixture(raw, { from: '1969-12-31', until: '1970-01-01' }).cursor).instructions.filter(value => value.kind === 'cell-member');
  expect(cells).toHaveLength(1); expect(cells[0]).toMatchObject({ cellStartMs: -86_400_000, fromMs: -1_800_000, untilMs: 0 });
  raw.recurrence = { ...raw.recurrence, localStart: '2026-03-08T00:00:00.000', timeZone: 'America/New_York', durationMilliseconds: 86_400_000 };
  const dst = drain(fixture(raw, { from: '2026-03-08', until: '2026-03-09' }).cursor).instructions.filter(value => value.kind === 'cell-member');
  expect(dst).toHaveLength(2); expect(dst[0]!.cellStartMs).toBe(Date.parse('2026-03-08T00:00:00.000Z'));
  expect(dst[1]!.cellStartMs - dst[0]!.cellStartMs).toBe(86_400_000);
  expect(dst.reduce((sum, value) => sum + value.untilMs - value.fromMs, 0)).toBe(86_400_000);
});

test('zero-output invalid-date and exhausted batches terminate projection but never erase compiler progress or claim coverage', () => {
  const raw = authoring(); raw.recurrence = { ...raw.recurrence, localStart: '2026-01-31T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 3 } } };
  const stored = snapshot(raw), source = captureCalendarSeriesCompilationSource(stored, limits), window = { from: '2026-01-01', until: '2026-06-01' };
  const january = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, window), { candidateLimit: 1 });
  const february = compileCalendarSeriesBatch(source, january.cursor, { candidateLimit: 1 }); expect(february.evidence.candidates).toHaveLength(0);
  const cursor = createCalendarSeriesProjection(source, february.contribution, february.evidence.batchDigest, { runId: 'native-run' });
  const before = inspectCalendarSeriesProjection(cursor), step = advanceCalendarSeriesProjection(cursor);
  expect(step.instructions).toEqual([]); expect(step.rowCount).toBe(0); expect(step.progress.beforeDigest).toBe(step.progress.afterDigest);
  expect(step.progress.checkpoint).toMatchObject({ phase: 'complete', candidateOrdinal: 0, instructionCount: 0, rowCount: 0 });
  expect(before.binding.batchDigest).toBe(february.evidence.batchDigest); expect(february.evidence.progress.checkpoint).toMatchObject({ nextCandidate: 2, rruleCount: 1 });
  expect(inspectCalendarSeriesProjectionCompilation(step.cursor)).toEqual({ progress: february.evidence.progress, work: february.evidence.work });
  rejects(() => inspectCalendarSeriesProjectionCompilation({ ...step.cursor } as CalendarSeriesProjection), 'CALENDAR_FORBIDDEN');
  expect(february.evidence.work.completion).toBe('incomplete');
  const ended = fixture(), next = compileCalendarSeriesBatch(ended.source, ended.batch.cursor);
  expect(next.evidence.work.completion).toBe('nominal-source-complete'); expect(next.evidence.candidates).toHaveLength(0);
  expect(advanceCalendarSeriesProjection(createCalendarSeriesProjection(ended.source, next.contribution, next.evidence.batchDigest, { runId: 'native-run' })).instructions).toEqual([]);
});

test('year9999 exclusive sentinel and effective extended-year occupancy retain finite native projection', () => {
  const raw = authoring(); raw.recurrence = { ...raw.recurrence, localStart: '9999-12-31T23:30:00.000', durationMilliseconds: 2 * 86_400_000 };
  raw.template = { ...raw.template, resourceIds: ['a'], bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
  const f = fixture(raw, { from: '9999-12-31', until: '+010000-01-01' }), result = drain(f.cursor);
  expect(f.batch.evidence.candidates[0]!.occurrence.endAt).toBe('+010000-01-02T23:30:00.000Z');
  expect(f.batch.evidence.work.completion).toBe('nominal-source-complete');
  expect(result.instructions.filter(value => value.kind === 'cell-member')).toHaveLength(3);
});

test('replacement runtime engine fails closed even for an already prepared runtime-owned projection and step', () => {
  const { cursor } = fixture(), step = advanceCalendarSeriesProjection(cursor), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  const temporal = (globalThis as any).Temporal;
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: { PlainDate: temporal.PlainDate, ZonedDateTime: temporal.ZonedDateTime } });
    rejects(() => inspectCalendarSeriesProjection(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => advanceCalendarSeriesProjection(cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => inspectCalendarSeriesProjectionStep(step.cursor, step.stepDigest), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  expect(inspectCalendarSeriesProjectionStep(step.cursor, step.stepDigest)).toBe(step);
});
