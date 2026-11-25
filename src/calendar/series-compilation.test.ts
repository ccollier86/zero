/** Actual native Temporal, pure/cache-off diagnostics: no files, servers, DBs or generated output. */
import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import { calendarRecurrenceTraversal, type CalendarTimedRecurrenceSource } from './recurrence-engine';
import { createCalendarRecurrenceCursor, inspectCalendarRecurrenceCursor } from './recurrence-cursor';
import { normalizeCalendarTimedSeriesAuthoring, type CalendarTimedSeriesAuthoring } from './series-authoring';
import { calendarSeriesNominalOccurrenceId, captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch,
  continueCalendarSeriesCompilationWindow, createCalendarSeriesCompilationCursor, inspectCalendarSeriesCompilationContribution,
  inspectCalendarSeriesCompilationSource, restoreCalendarSeriesCompilationCursor,
  type CalendarSeriesCompilationContribution, type CalendarSeriesCompilationEvidence, type CalendarSeriesCompilationSnapshot,
  type CalendarSeriesCompilationSource } from './series-compilation';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash } from './validation';

const limits = { maxResources: 16, maxParticipants: 100 };
const range = { from: '2026-01-01', until: '2026-01-05' };
function authoring(recurrence: Partial<CalendarTimedRecurrenceSource> = {}): CalendarTimedSeriesAuthoring {
  return { kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: '2026-01-01T09:07:03.125', timeZone: 'UTC', fold: 'earlier',
    durationMilliseconds: 37 * 60_000, rule: { frequency: 'daily', interval: 1, end: { kind: 'never' } }, ...recurrence },
    template: { resourceIds: ['b', 'a'], title: 'PRIVATE_TITLE', bufferBeforeMinutes: 2, bufferAfterMinutes: 3,
      appointmentType: { id: 'consult', revision: 2 }, visit: { mode: 'in-person', location: { id: 'office', revision: 3 } },
      participants: [{ kind: 'guardian-user', userId: 'user-b' }, { kind: 'guardian-user', userId: 'user-a' }] } };
}
function snapshot(input = authoring(), patch: Partial<CalendarSeriesCompilationSnapshot> = {}): CalendarSeriesCompilationSnapshot {
  const normalized = normalizeCalendarTimedSeriesAuthoring(input, limits), resources = normalized.template.resourceIds.map(id => ({ id, revision: id === 'a' ? 7 : 9 }));
  return { kind: 'calendar-series-source-snapshot-v1', scopeId: 'tenant:compilation', ownerId: 'calendar-owner', rootHash: calendarHash('actual-root'),
    realmFingerprint: 'sha256:' + calendarHash('actual-realm'), sourceId: 'source-1', seriesId: 'series-1',
    segmentId: 'segment-1', segmentRecordId: 'segment-row-1', generationId: 'generation-1', sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0,
    preparationId: 'preparation-1', basePublicationId: null, planManifestDigest: calendarHash('accepted-plan'), preparationExpiresAtMs: 1_800_000_000_000,
    intentDigest: calendarHash('accepted-human-intent'), authoringDigest: calendarHash(normalized),
    engineGeneration: calendarHash(calendarRecurrenceTraversal(normalized.recurrence).engine), policyGeneration: calendarHash('current-series-policy'), authoring: input,
    grant: { grantId: 'grant-1', grantEpoch: 1, authorityDigest: calendarHash('original-authority'), resourceDigest: calendarHash(normalized.template.resourceIds) },
    resourceRevisions: resources, ...patch };
}
function capture(input = snapshot()) { return captureCalendarSeriesCompilationSource(input, limits); }
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID') {
  try { run(); throw new Error('invalid compilation accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC'); }
}
function deepFrozen(value: unknown) {
  if (value !== null && typeof value === 'object') { expect(Object.isFrozen(value)).toBe(true); for (const child of Object.values(value)) deepFrozen(child); }
}
function batchHash(evidence: CalendarSeriesCompilationEvidence, candidates = evidence.candidates) {
  const { candidates: _candidates, batchDigest: _digest, ...metadata } = evidence;
  const hash = createHash('sha256').update('calendar-series-batch-v1\0').update(calendarHash({ ...metadata, candidateCount: candidates.length }));
  for (const candidate of candidates) hash.update('\0candidate:').update(calendarHash(candidate)); return hash.digest('hex');
}

test('trusted snapshot capture produces exact detached booking candidates and binds every original authority/policy/progress fact', () => {
  const stored = snapshot(), source = capture(stored), cursor = createCalendarSeriesCompilationCursor(source, range), before = inspectCalendarRecurrenceCursor(cursor);
  const batch = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 2, occurrenceLimit: 1 }), evidence = batch.evidence;
  expect(evidence.binding).toMatchObject({ scopeId: stored.scopeId, ownerId: stored.ownerId, sourceId: stored.sourceId, seriesId: stored.seriesId,
    rootHash: stored.rootHash, realmFingerprint: stored.realmFingerprint, segmentId: stored.segmentId, segmentRecordId: stored.segmentRecordId,
    generationId: stored.generationId, sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0,
    preparationId: stored.preparationId, basePublicationId: null, planManifestDigest: stored.planManifestDigest, preparationExpiresAtMs: stored.preparationExpiresAtMs,
    intentDigest: stored.intentDigest, authoringDigest: stored.authoringDigest, policyGeneration: stored.policyGeneration, engineGeneration: stored.engineGeneration,
    resourceRevisions: stored.resourceRevisions, grant: stored.grant });
  expect(evidence.binding.selections).toEqual({ resourceIds: ['a', 'b'], appointmentType: stored.authoring.template.appointmentType,
    visit: stored.authoring.template.visit, participants: [...stored.authoring.template.participants].reverse() });
  expect(evidence.engine).toEqual(before.checkpoint.engine); expect(evidence.progress.beforeDigest).toBe(before.digest);
  expect(evidence.progress.afterDigest).toBe(inspectCalendarRecurrenceCursor(batch.cursor).digest);
  expect(evidence.work).toEqual({ candidateLimit: 2, occurrenceLimit: 1, evaluatedCandidates: 1,
    skipped: { invalidDates: 0, nonexistentTimes: 0 }, stop: 'occurrence-limit', completion: 'incomplete' });
  const candidate = evidence.candidates[0]!;
  const appointmentType = stored.authoring.template.appointmentType, visit = stored.authoring.template.visit;
  if (appointmentType === null || visit === null) throw new Error('fixture requires explicit type/visit selections');
  expect(candidate).toMatchObject({ id: calendarSeriesNominalOccurrenceId(source, 'timed-v1:2026-01-01T09:07:03.125'),
    nominalKey: 'timed-v1:2026-01-01T09:07:03.125', nominalRank: 0, title: 'PRIVATE_TITLE' });
  expect(candidate.booking).toEqual({ resourceIds: ['a', 'b'], interval: normalizeCalendarTimedInterval({ startAt: candidate.occurrence.startAt,
    endAt: candidate.occurrence.endAt, timeZone: 'UTC', bufferBeforeMinutes: 2, bufferAfterMinutes: 3 }),
    appointmentType, visit });
  expect(evidence.batchDigest).toBe(batchHash(evidence));
  expect(inspectCalendarSeriesCompilationContribution(source, batch.contribution, evidence.batchDigest)).toBe(evidence);
  expect(inspectCalendarSeriesCompilationContribution(capture(snapshot()), batch.contribution, evidence.batchDigest)).toBe(evidence);
  for (const key of ['coverage', 'grant', 'publication', 'accepted', 'applied', 'reservation', 'free']) expect(evidence).not.toHaveProperty(key);
  deepFrozen(batch); deepFrozen(evidence.binding); deepFrozen(evidence.candidates);
});

test('input mutation cannot alter captured source, authored selections, candidates or immutable replay', () => {
  const stored = snapshot(), source = capture(stored), binding = inspectCalendarSeriesCompilationSource(source);
  const cursor = createCalendarSeriesCompilationCursor(source, range), batch = compileCalendarSeriesBatch(source, cursor, { occurrenceLimit: 1 });
  (stored.authoring.template.resourceIds as string[]).push('later');
  (stored.authoring.template.participants[0] as { userId: string }).userId = 'later';
  (stored.authoring.template as { title: string }).title = 'LATER_TITLE';
  (stored.resourceRevisions[0] as { revision: number }).revision = 99;
  (stored.grant as { grantEpoch: number }).grantEpoch = 99;
  expect(inspectCalendarSeriesCompilationSource(source)).toBe(binding);
  expect(compileCalendarSeriesBatch(source, cursor, { occurrenceLimit: 1 }).evidence).toEqual(batch.evidence);
  expect(batch.evidence.candidates[0]!.booking.resourceIds).toEqual(['a', 'b']); expect(batch.evidence.candidates[0]!.title).toBe('PRIVATE_TITLE');
  expect(batch.evidence.candidates[0]!.participants.map(value => value.userId)).toEqual(['user-a', 'user-b']);
  expect(inspectCalendarRecurrenceCursor(cursor).checkpoint.examinedCandidates).toBe(0);
});

test('a native forward window carries the exact retained checkpoint transition rather than a fresh COUNT seek', () => {
  const source = capture(snapshot(authoring({ localStart: '2026-01-01T09:00:00.000',
    rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 20 } } })));
  const firstRange = { from: '2026-01-01', until: '2026-01-03' }, secondRange = { from: '2026-01-03', until: '2026-01-05' };
  const first = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, firstRange));
  expect(first.evidence.work.completion).toBe('nominal-range-complete');
  const continuedCursor = continueCalendarSeriesCompilationWindow(source, first.cursor, secondRange);
  const continued = compileCalendarSeriesBatch(source, continuedCursor, { occurrenceLimit: 1 });
  expect(continued.evidence.progress.continuation).toEqual({ kind: 'calendar-series-window-transition-v1',
    previousDigest: first.evidence.progress.afterDigest, previousCheckpoint: first.evidence.progress.checkpoint,
    initialDigest: inspectCalendarRecurrenceCursor(continuedCursor).digest, initialCheckpoint: inspectCalendarRecurrenceCursor(continuedCursor).checkpoint });
  expect(continued.evidence.progress.beforeDigest).not.toBe(first.evidence.progress.afterDigest);
  expect(continued.evidence.progress.continuation!.initialCheckpoint.rruleCount).toBe(first.evidence.progress.checkpoint.rruleCount);
  expect(compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, secondRange)).evidence.progress.continuation).toBeUndefined();
  expect(compileCalendarSeriesBatch(source, continued.cursor).evidence.progress.continuation).toBeUndefined();
  expect(continued.evidence.batchDigest).toBe(batchHash(continued.evidence));
  expect(compileCalendarSeriesBatch(source, continuedCursor, { occurrenceLimit: 1 }).evidence).toEqual(continued.evidence);
  deepFrozen(continued.evidence.progress.continuation);
});

test('JSON, spreads, proxies and self-rehashed copied cells cannot reconstruct source/contribution capabilities', () => {
  const source = capture(), cursor = createCalendarSeriesCompilationCursor(source, range), batch = compileCalendarSeriesBatch(source, cursor);
  for (const forged of [{}, { ...source }, JSON.parse(JSON.stringify(source)), inspectCalendarSeriesCompilationSource(source)]) {
    rejects(() => createCalendarSeriesCompilationCursor(forged as CalendarSeriesCompilationSource, range), 'CALENDAR_FORBIDDEN');
    rejects(() => inspectCalendarSeriesCompilationContribution(forged as CalendarSeriesCompilationSource, batch.contribution, batch.evidence.batchDigest), 'CALENDAR_FORBIDDEN');
  }
  for (const forged of [{ ...batch.contribution }, JSON.parse(JSON.stringify(batch.contribution)), batch.evidence,
    { ...batch.evidence, candidates: [], batchDigest: batchHash(batch.evidence, []) }]) {
    rejects(() => inspectCalendarSeriesCompilationContribution(source, forged as CalendarSeriesCompilationContribution, batch.evidence.batchDigest), 'CALENDAR_FORBIDDEN');
  }
  rejects(() => inspectCalendarSeriesCompilationContribution(source, batch.contribution, '0'.repeat(64)), 'CALENDAR_INTENT_CONFLICT');
  rejects(() => inspectCalendarSeriesCompilationContribution(source, batch.contribution, 'bad-digest'));
  let touched = false;
  const proxy = new Proxy(batch.contribution, { getPrototypeOf() { touched = true; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  rejects(() => inspectCalendarSeriesCompilationContribution(source, proxy, batch.evidence.batchDigest), 'CALENDAR_FORBIDDEN'); expect(touched).toBe(false);
});

test('fresh snapshot verification rejects every changed owner/source/generation/grant/exception/policy/resource/selection binding', () => {
  const source = capture(), batch = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, range));
  for (const patch of [{ ownerId: 'other-owner' }, { scopeId: 'application' }, { sourceId: 'other-source' }, { seriesId: 'other-series' },
    { rootHash: calendarHash('other-root') }, { realmFingerprint: 'sha256:' + calendarHash('other-realm') },
    { segmentId: 'other-segment' }, { segmentRecordId: 'other-segment-row' }, { generationId: 'generation-2' }, { sourceGeneration: 2 }, { controlRevision: 2 }, { exceptionRevision: 1 },
    { preparationId: 'preparation-2' }, { basePublicationId: 'prior-publication' }, { planManifestDigest: calendarHash('other-plan') }, { preparationExpiresAtMs: 1_800_000_000_001 },
    { policyGeneration: calendarHash('replacement-policy') }, { intentDigest: calendarHash('other-intent') }]) {
    rejects(() => inspectCalendarSeriesCompilationContribution(capture(snapshot(authoring(), patch)), batch.contribution, batch.evidence.batchDigest), 'CALENDAR_REVISION_CONFLICT');
  }
  for (const patch of [{ grantId: 'grant-2' }, { grantEpoch: 2 }, { authorityDigest: calendarHash('other-authority') }]) {
    const stored = snapshot(); rejects(() => inspectCalendarSeriesCompilationContribution(capture({ ...stored, grant: { ...stored.grant, ...patch } }),
      batch.contribution, batch.evidence.batchDigest), 'CALENDAR_REVISION_CONFLICT');
  }
  const old = snapshot(), revised = { ...old, resourceRevisions: [{ id: 'a', revision: 8 }, old.resourceRevisions[1]!] };
  rejects(() => inspectCalendarSeriesCompilationContribution(capture(revised), batch.contribution, batch.evidence.batchDigest), 'CALENDAR_REVISION_CONFLICT');
  const changed = authoring(); (changed.template as { title: string }).title = 'changed';
  rejects(() => inspectCalendarSeriesCompilationContribution(capture(snapshot(changed)), batch.contribution, batch.evidence.batchDigest), 'CALENDAR_REVISION_CONFLICT');
});

test('source capture is closed and requires exact complete resource revisions, canonical authored digest and actual engine identity', () => {
  const stored = snapshot();
  for (const resourceRevisions of [[], [{ id: 'a', revision: 7 }], [{ id: 'a', revision: 7 }, { id: 'a', revision: 8 }],
    [{ id: 'a', revision: 7 }, { id: 'extra', revision: 9 }], [{ id: 'a', revision: 0 }, { id: 'b', revision: 9 }],
    [{ id: 'a', revision: 7, label: 'PRIVATE' }, { id: 'b', revision: 9 }]]) rejects(() => capture({ ...stored, resourceRevisions }));
  expect(inspectCalendarSeriesCompilationSource(capture({ ...stored, resourceRevisions: [...stored.resourceRevisions].reverse() })))
    .toEqual(inspectCalendarSeriesCompilationSource(capture(stored)));
  rejects(() => capture({ ...stored, authoringDigest: '0'.repeat(64) }), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => capture({ ...stored, grant: { ...stored.grant, resourceDigest: calendarHash(stored.resourceRevisions) } }), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => capture({ ...stored, engineGeneration: '0'.repeat(64) }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  for (const patch of [{ sourceGeneration: 0 }, { exceptionRevision: -1 }, { policyGeneration: 'not-a-digest' }, { ownerId: 'bad owner' },
    { preparationExpiresAtMs: 0 }, { preparationId: 'bad id' }, { basePublicationId: undefined }, { planManifestDigest: 'bad-digest' },
    { rootHash: 'bad-root' }, { realmFingerprint: calendarHash('missing-prefix') }, { segmentRecordId: 'bad row' },
    { compiledCells: [] }, { authoring: { ...stored.authoring, recurrence: { ...stored.authoring.recurrence, limit: 1 } } }]) rejects(() => capture({ ...stored, ...patch } as CalendarSeriesCompilationSnapshot));
  const missing = { ...stored } as Record<string, unknown>; delete missing.exceptionRevision;
  rejects(() => capture(missing as unknown as CalendarSeriesCompilationSnapshot));
  let touched = false; const getter = { ...stored };
  Object.defineProperty(getter, 'authoring', { enumerable: true, get() { touched = true; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  rejects(() => capture(getter)); expect(touched).toBe(false);
});

test('monthly invalid-date zero-output batches preserve COUNT and stable nominal ranks across recovery and batch budgets', () => {
  const source = capture(snapshot(authoring({ localStart: '2026-01-31T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 3 } } })));
  const window = { from: '2026-01-01', until: '2026-06-01' }, cursor = createCalendarSeriesCompilationCursor(source, window);
  const january = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 1 }), february = compileCalendarSeriesBatch(source, january.cursor, { candidateLimit: 1 });
  expect(february.evidence.candidates).toEqual([]); expect(february.evidence.work).toMatchObject({ evaluatedCandidates: 1, skipped: { invalidDates: 1, nonexistentTimes: 0 }, completion: 'incomplete' });
  expect(february.evidence.progress.checkpoint).toMatchObject({ nextCandidate: 2, rruleCount: 1, examinedCandidates: 2 });
  const restored = restoreCalendarSeriesCompilationCursor(source, window, JSON.parse(JSON.stringify(february.evidence.progress.checkpoint)), february.evidence.progress.afterDigest);
  const march = compileCalendarSeriesBatch(source, restored, { candidateLimit: 1 }), april = compileCalendarSeriesBatch(source, march.cursor, { candidateLimit: 1 });
  const may = compileCalendarSeriesBatch(source, april.cursor, { candidateLimit: 1 });
  expect([january, march, may].map(batch => batch.evidence.candidates[0]!.nominalRank)).toEqual([0, 2, 4]);
  expect(may.evidence.work.completion).toBe('nominal-source-complete'); expect(may.evidence.progress.checkpoint.rruleCount).toBe(3);
  const together = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 10, occurrenceLimit: 10 });
  expect(together.evidence.candidates).toEqual([january.evidence.candidates[0]!, march.evidence.candidates[0]!, may.evidence.candidates[0]!]);
  expect(february.evidence.batchDigest).not.toBe(april.evidence.batchDigest);
});

test('weekly ranks preserve the year-zero Monday anchor and distinguish pre-DTSTART slots from valid COUNT', () => {
  const source = capture(snapshot(authoring({ localStart: '0000-01-01T09:00:00.000',
    rule: { frequency: 'weekly', interval: 1, weekdays: [6, 1], end: { kind: 'after', count: 4 } } })));
  const batch = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, { from: '0000-01-01', until: '0000-01-15' }));
  expect(batch.evidence.candidates.map(value => value.occurrence.localStart.slice(0, 10))).toEqual(['0000-01-01', '0000-01-03', '0000-01-08', '0000-01-10']);
  expect(batch.evidence.candidates.map(value => value.nominalRank)).toEqual([1, 2, 3, 4]);
  expect(batch.evidence.work.evaluatedCandidates).toBe(5); expect(batch.evidence.progress.checkpoint.rruleCount).toBe(4);
  expect(new Set(batch.evidence.candidates.map(value => value.id)).size).toBe(4);
});

test('native DST gaps and long sparse counted prefixes compile bounded zero-output evidence, never fake completion or free coverage', () => {
  const dst = capture(snapshot(authoring({ localStart: '2026-03-07T02:30:00.000', timeZone: 'America/New_York',
    rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } })));
  const march = { from: '2026-03-07', until: '2026-03-11' }, first = compileCalendarSeriesBatch(dst, createCalendarSeriesCompilationCursor(dst, march), { candidateLimit: 1 });
  const gap = compileCalendarSeriesBatch(dst, first.cursor, { candidateLimit: 1 });
  expect(gap.evidence.candidates).toEqual([]); expect(gap.evidence.work.skipped.nonexistentTimes).toBe(1); expect(gap.evidence.progress.checkpoint.rruleCount).toBe(1);
  const rest = compileCalendarSeriesBatch(dst, gap.cursor); expect(rest.evidence.candidates.map(value => value.nominalRank)).toEqual([2, 3]);
  expect(rest.evidence.work.completion).toBe('nominal-source-complete');
  const ancient = capture(snapshot(authoring({ localStart: '0000-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 999 } } })));
  const distant = { from: '9000-01-01', until: '9000-02-01' }, prefix = compileCalendarSeriesBatch(ancient, createCalendarSeriesCompilationCursor(ancient, distant));
  expect(prefix.evidence.candidates).toEqual([]); expect(prefix.evidence.work).toMatchObject({ evaluatedCandidates: 4096, stop: 'candidate-limit', completion: 'incomplete' });
  const recovered = restoreCalendarSeriesCompilationCursor(ancient, distant, prefix.evidence.progress.checkpoint, prefix.evidence.progress.afterDigest);
  const last = compileCalendarSeriesBatch(ancient, recovered); expect(last.evidence.work.evaluatedCandidates).toBeLessThan(100);
  expect(last.evidence.work.completion).toBe('nominal-source-complete'); expect(last.evidence.progress.checkpoint.rruleCount).toBe(999);
  expect(last.evidence).not.toHaveProperty('coverage'); expect(last.evidence.candidates).toEqual([]);
});

test('forward nominal windows retain counted progress and identities without replay, while foreign or tampered progress fails closed', () => {
  const stored = snapshot(authoring({ localStart: '2026-01-31T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 3 } } })), source = capture(stored);
  const firstWindow = { from: '2026-01-01', until: '2026-02-01' }, first = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, firstWindow));
  expect(first.evidence.work.completion).toBe('nominal-range-complete');
  const nextWindow = { from: '2026-03-01', until: '2026-06-01' }, cursor = continueCalendarSeriesCompilationWindow(source, first.cursor, nextWindow);
  const next = compileCalendarSeriesBatch(source, cursor); expect(next.evidence.work.evaluatedCandidates).toBe(4);
  expect(next.evidence.candidates.map(value => value.nominalRank)).toEqual([2, 4]); expect(next.evidence.progress.checkpoint.rruleCount).toBe(3);
  expect(inspectCalendarRecurrenceCursor(first.cursor).digest).toBe(first.evidence.progress.afterDigest);
  rejects(() => continueCalendarSeriesCompilationWindow(source, first.cursor, firstWindow));
  rejects(() => restoreCalendarSeriesCompilationCursor(source, firstWindow, next.evidence.progress.checkpoint, next.evidence.progress.afterDigest), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => restoreCalendarSeriesCompilationCursor(source, nextWindow, { ...next.evidence.progress.checkpoint, rruleCount: 0 }, next.evidence.progress.afterDigest), 'CALENDAR_REVISION_CONFLICT');
  const foreign = createCalendarRecurrenceCursor({ binding: { scopeId: stored.scopeId, seriesId: 'foreign', segmentId: stored.segmentId, sourceGeneration: 1 },
    source: stored.authoring.recurrence, range: nextWindow });
  rejects(() => compileCalendarSeriesBatch(source, foreign), 'CALENDAR_REVISION_CONFLICT');
  rejects(() => continueCalendarSeriesCompilationWindow(source, foreign, nextWindow), 'CALENDAR_REVISION_CONFLICT');
  const wrongSource = capture(snapshot(authoring(), { sourceGeneration: 2 }));
  rejects(() => compileCalendarSeriesBatch(wrongSource, first.cursor), 'CALENDAR_REVISION_CONFLICT');
});

test('nominal ID is independent of effective UTC, generation, policy and output position, but separates scopes/lineages/segments', () => {
  const stored = snapshot(), source = capture(stored), first = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, range));
  const candidate = first.evidence.candidates[0]!, moved = { ...candidate, nominalRank: 999, booking: { ...candidate.booking,
    interval: normalizeCalendarTimedInterval({ startAt: '2027-01-01T12:00:00.000Z', endAt: '2027-01-01T13:00:00.000Z', timeZone: 'UTC' }) } };
  expect(calendarSeriesNominalOccurrenceId(source, moved.nominalKey)).toBe(candidate.id);
  const later = capture(snapshot(authoring({ timeZone: 'America/New_York' }), { sourceGeneration: 2, generationId: 'generation-2',
    segmentRecordId: 'different-generation-segment-record', policyGeneration: calendarHash('new-policy') }));
  const laterCandidate = compileCalendarSeriesBatch(later, createCalendarSeriesCompilationCursor(later, range)).evidence.candidates[0]!;
  expect(laterCandidate.occurrence.startAt).not.toBe(candidate.occurrence.startAt); expect(laterCandidate.id).toBe(candidate.id);
  for (const patch of [{ scopeId: 'application' }, { seriesId: 'other-lineage' }, { segmentId: 'other-segment' }]) {
    expect(calendarSeriesNominalOccurrenceId(capture(snapshot(authoring(), patch)), candidate.nominalKey)).not.toBe(candidate.id);
  }
  rejects(() => calendarSeriesNominalOccurrenceId(source, '2026-01-01'));
});

test('complete ordered batch digest handles more than32KB of bounded candidate output and commits every candidate', () => {
  const raw = authoring(); (raw.template as unknown as { participants: { kind: 'guardian-user'; userId: string }[] }).participants =
    Array.from({ length: 100 }, (_, index) => ({ kind: 'guardian-user', userId: 'participant-' + index.toString().padStart(3, '0') }));
  const source = capture(snapshot(raw)), cursor = createCalendarSeriesCompilationCursor(source, { from: '2026-01-01', until: '2026-05-01' });
  const batch = compileCalendarSeriesBatch(source, cursor, { candidateLimit: 128, occurrenceLimit: 100 });
  expect(batch.evidence.candidates.length).toBe(100); expect(JSON.stringify(batch.evidence).length).toBeGreaterThan(32 * 1024);
  expect(batch.evidence.batchDigest).toBe(batchHash(batch.evidence));
  expect(batchHash(batch.evidence, [...batch.evidence.candidates].reverse())).not.toBe(batch.evidence.batchDigest);
  expect(batchHash(batch.evidence, batch.evidence.candidates.slice(0, 99))).not.toBe(batch.evidence.batchDigest);
  expect(inspectCalendarSeriesCompilationContribution(source, batch.contribution, batch.evidence.batchDigest)).toBe(batch.evidence);
  for (const budget of [{ candidateLimit: 0 }, { candidateLimit: 4097 }, { occurrenceLimit: 0 }, { occurrenceLimit: 1001 }, { sourceGeneration: 99 }]) {
    rejects(() => compileCalendarSeriesBatch(source, cursor, budget));
  }
});

test('maximum normalized template/resource metadata remains bounded independently from large compiled batch output', () => {
  const raw = authoring();
  (raw.template as unknown as { resourceIds: string[] }).resourceIds = Array.from({ length: 16 }, (_, index) => `r${String(index).padStart(2, '0')}` + 'x'.repeat(125));
  (raw.template as unknown as { participants: { kind: 'guardian-user'; userId: string }[] }).participants =
    Array.from({ length: 100 }, (_, index) => ({ kind: 'guardian-user', userId: `p${String(index).padStart(3, '0')}` + 'x'.repeat(124) }));
  const source = capture(snapshot(raw)), batch = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, range), { occurrenceLimit: 2 });
  expect(batch.evidence.binding.resourceRevisions).toHaveLength(16); expect(batch.evidence.binding.selections.participants).toHaveLength(100);
  expect(batch.evidence.candidates).toHaveLength(2); expect(batch.evidence.batchDigest).toBe(batchHash(batch.evidence));
});

test('replacement runtime engine fails closed for source, compilation, window transition and retained contribution inspection', () => {
  const source = capture(), cursor = createCalendarSeriesCompilationCursor(source, range), batch = compileCalendarSeriesBatch(source, cursor);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal'), temporal = (globalThis as any).Temporal;
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: { PlainDate: temporal.PlainDate, ZonedDateTime: temporal.ZonedDateTime } });
    rejects(() => inspectCalendarSeriesCompilationSource(source), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => compileCalendarSeriesBatch(source, cursor), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => continueCalendarSeriesCompilationWindow(source, batch.cursor, { from: range.until, until: '2026-01-07' }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => inspectCalendarSeriesCompilationContribution(source, batch.contribution, batch.evidence.batchDigest), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  expect(inspectCalendarSeriesCompilationContribution(source, batch.contribution, batch.evidence.batchDigest)).toBe(batch.evidence);
});
