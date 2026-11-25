/** Private detached F5 compilation only. No SQL, leases, native writes, policy
 * admission, publication, timers or UTC coverage certificates. Source capture
 * MUST receive a trusted stored generation snapshot from the native broker, not
 * browser JSON. Capture/compilation brands establish local evidence provenance,
 * NOT source ownership or enduring authority. Final writers must freshly fence
 * owner/grant/generation/policy/resources and SYSTEM participant eligibility. */
import { createHash } from 'node:crypto';
import type { CalendarBookingCandidate } from './booking-admission';
import { CalendarError } from './error';
import { advanceCalendarRecurrenceCursor, continueCalendarRecurrenceNominalWindow, createCalendarRecurrenceCursor,
  inspectCalendarRecurrenceCursor, restoreCalendarRecurrenceCursor, type CalendarRecurrenceCheckpoint,
  type CalendarRecurrenceCursor, type CalendarRecurrenceCursorBatch } from './recurrence-cursor';
import { calendarRecurrenceTraversal, CALENDAR_RECURRENCE_MAX_CANDIDATES, CALENDAR_RECURRENCE_MAX_OCCURRENCES,
  type CalendarRecurrenceDateRange, type CalendarRecurrenceOccurrence } from './recurrence-engine';
import { admitCalendarTimedSeriesAuthoring, type CalendarSeriesAuthoringLimits, type CalendarTimedSeriesAuthoring,
  type CalendarTimedSeriesTemplate } from './series-authoring';
import { normalizeCalendarTimedInterval } from './time';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';

export interface CalendarSeriesResourceRevision { readonly id: string; readonly revision: number }
export interface CalendarSeriesCompilationSnapshot {
  readonly kind: 'calendar-series-source-snapshot-v1';
  readonly scopeId: string;
  readonly ownerId: string;
  readonly rootHash: string;
  readonly realmFingerprint: string;
  readonly sourceId: string;
  readonly seriesId: string;
  /** Stable logical identity across authored generations/time-only edits. */
  readonly segmentId: string;
  /** The immutable generation's physical segment row, not nominal identity. */
  readonly segmentRecordId: string;
  readonly generationId: string;
  readonly sourceGeneration: number;
  readonly controlRevision: number;
  readonly exceptionRevision: number;
  readonly preparationId: string;
  readonly basePublicationId: string | null;
  readonly planManifestDigest: string;
  /** Retained immutable preparation expiry, not a pure compiler clock check. */
  readonly preparationExpiresAtMs: number;
  readonly intentDigest: string;
  readonly authoringDigest: string;
  /** Hash of the actual continuation engine, including compiler semantics. */
  readonly engineGeneration: string;
  readonly policyGeneration: string;
  readonly authoring: CalendarTimedSeriesAuthoring;
  readonly grant: { readonly grantId: string; readonly grantEpoch: number; readonly authorityDigest: string; readonly resourceDigest: string };
  /** Complete exact resource set, never a subset or lookup of mutable defaults. */
  readonly resourceRevisions: readonly CalendarSeriesResourceRevision[];
}
declare const sourceBrand: unique symbol, contributionBrand: unique symbol;
export interface CalendarSeriesCompilationSource { readonly [sourceBrand]: true }
export interface CalendarSeriesCompilationContribution { readonly [contributionBrand]: true }
export interface CalendarSeriesCompiledOccurrence {
  /** Stable within lineage/segment, independent of effective time, generation,
   * policy, cursor batch size and output rank. A later moved exception must reuse
   * this retained nominal key, never derive a new one from its effective UTC. */
  readonly id: string;
  readonly nominalKey: string;
  /** Zero-based NOMINAL candidate index, including invalid periods/pre-start
   * weekly slots; this is not an emitted rank or valid RRULE COUNT. */
  readonly nominalRank: number;
  readonly occurrence: CalendarRecurrenceOccurrence;
  readonly booking: Readonly<CalendarBookingCandidate>;
  readonly title: string;
  readonly participants: CalendarTimedSeriesTemplate['participants'];
}
export interface CalendarSeriesCompilationBinding extends Omit<CalendarSeriesCompilationSnapshot, 'kind' | 'authoring'> {
  readonly snapshotDigest: string;
  readonly recurrenceDigest: string;
  readonly originalDigest: string;
  /** Exact original authored selections, not copied live catalog snapshots. */
  readonly selections: Pick<CalendarTimedSeriesTemplate, 'resourceIds' | 'appointmentType' | 'visit' | 'participants'>;
}
export interface CalendarSeriesCompilationEvidence {
  readonly kind: 'calendar-series-compilation-v1';
  readonly binding: CalendarSeriesCompilationBinding;
  readonly engine: CalendarRecurrenceCheckpoint['engine'];
  readonly progress: { readonly beforeDigest: string; readonly afterDigest: string; readonly checkpoint: CalendarRecurrenceCheckpoint;
    /** Present only on the first batch from the actual branded forward-window
     * transition, never on a fresh seek that merely has similar counters. */
    readonly continuation?: CalendarSeriesCompilationContinuation };
  readonly work: { readonly candidateLimit: number; readonly occurrenceLimit: number; readonly evaluatedCandidates: number;
    readonly skipped: CalendarRecurrenceCursorBatch['skipped']; readonly stop: CalendarRecurrenceCursorBatch['stop'];
    readonly completion: 'incomplete' | 'nominal-range-complete' | 'nominal-source-complete' };
  readonly candidates: readonly CalendarSeriesCompiledOccurrence[];
  /** Domain-separated digest of metadata and EVERY ordered candidate digest.
   * Incremental hashing bounds the digest input without a hidden 32KB batch cap. */
  readonly batchDigest: string;
}
export interface CalendarSeriesCompilationContinuation {
  readonly kind: 'calendar-series-window-transition-v1';
  readonly previousDigest: string;
  readonly previousCheckpoint: CalendarRecurrenceCheckpoint;
  readonly initialDigest: string;
  readonly initialCheckpoint: CalendarRecurrenceCheckpoint;
}
export interface CalendarSeriesCompilationBatch {
  readonly contribution: CalendarSeriesCompilationContribution;
  readonly cursor: CalendarRecurrenceCursor;
  readonly evidence: CalendarSeriesCompilationEvidence;
}
interface SourceState {
  readonly snapshot: CalendarSeriesCompilationSnapshot;
  readonly binding: CalendarSeriesCompilationBinding;
  readonly traversal: ReturnType<typeof calendarRecurrenceTraversal>;
}
const sources = new WeakMap<object, SourceState>();
const contributions = new WeakMap<object, { readonly snapshotDigest: string; readonly cursor: CalendarRecurrenceCursor;
  readonly evidence: CalendarSeriesCompilationEvidence }>();
const continuations = new WeakMap<object, { readonly snapshotDigest: string; readonly evidence: CalendarSeriesCompilationContinuation }>();
const SNAPSHOT_FIELDS = ['kind', 'scopeId', 'ownerId', 'rootHash', 'realmFingerprint', 'sourceId', 'seriesId', 'segmentId', 'segmentRecordId', 'generationId', 'sourceGeneration',
  'controlRevision', 'exceptionRevision', 'preparationId', 'basePublicationId', 'planManifestDigest', 'preparationExpiresAtMs',
  'intentDigest', 'authoringDigest', 'engineGeneration', 'policyGeneration', 'authoring', 'grant', 'resourceRevisions'] as const;
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function stale(): never { throw new CalendarError('CALENDAR_REVISION_CONFLICT'); }
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid(); return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function sourceState(source: CalendarSeriesCompilationSource): SourceState {
  const state = source !== null && typeof source === 'object' ? sources.get(source) : undefined;
  if (!state) throw new CalendarError('CALENDAR_FORBIDDEN'); state.traversal.assertCurrent(); return state;
}
function cursorInput(state: SourceState, range: CalendarRecurrenceDateRange) {
  const s = state.snapshot;
  return { binding: { scopeId: s.scopeId, seriesId: s.seriesId, segmentId: s.segmentId, sourceGeneration: s.sourceGeneration },
    source: s.authoring.recurrence, range };
}
function inspectBoundCursor(state: SourceState, cursor: CalendarRecurrenceCursor) {
  const progress = inspectCalendarRecurrenceCursor(cursor), expected = cursorInput(state, progress.checkpoint.range);
  if (calendarHash(progress.checkpoint.binding) !== calendarHash(expected.binding) || progress.checkpoint.sourceDigest !== state.binding.recurrenceDigest) return stale();
  if (progress.checkpoint.originalDigest !== state.binding.originalDigest || calendarHash(progress.checkpoint.engine) !== state.snapshot.engineGeneration)
    throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  return progress;
}

/** Trusted-store boundary only. This validates/detaches retained facts; it does
 * not authenticate who supplied them. Never expose this factory through request
 * handlers. All later compilation APIs require its runtime-owned source handle. */
export function captureCalendarSeriesCompilationSource(input: CalendarSeriesCompilationSnapshot,
  limits: CalendarSeriesAuthoringLimits): CalendarSeriesCompilationSource {
  const r = calendarRecord(calendarValue(input), SNAPSHOT_FIELDS);
  if (r.kind !== 'calendar-series-source-snapshot-v1' || SNAPSHOT_FIELDS.some(field => !Object.hasOwn(r, field))) return invalid();
  const admitted = admitCalendarTimedSeriesAuthoring(r.authoring, limits), authoring = admitted.authoring;
  const traversal = calendarRecurrenceTraversal(authoring.recurrence), grant = calendarRecord(r.grant, ['grantId', 'grantEpoch', 'authorityDigest', 'resourceDigest']);
  if (calendarHash(admitted.original) !== calendarHash(traversal.original)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  if (!Array.isArray(r.resourceRevisions) || r.resourceRevisions.length !== authoring.template.resourceIds.length) return invalid();
  const resourceRevisions = r.resourceRevisions.map(value => {
    const entry = calendarRecord(value, ['id', 'revision']);
    return { id: calendarKey(entry.id), revision: calendarInteger(entry.revision, 1) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (resourceRevisions.some((entry, index) => entry.id !== authoring.template.resourceIds[index])) return invalid();
  const snapshot: CalendarSeriesCompilationSnapshot = freeze({ kind: r.kind, scopeId: calendarScope(r.scopeId), ownerId: calendarKey(r.ownerId),
    rootHash: digest(r.rootHash), realmFingerprint: 'sha256:' + digest(typeof r.realmFingerprint === 'string' && r.realmFingerprint.startsWith('sha256:') ? r.realmFingerprint.slice(7) : undefined),
    sourceId: calendarKey(r.sourceId), seriesId: calendarKey(r.seriesId), segmentId: calendarKey(r.segmentId), segmentRecordId: calendarKey(r.segmentRecordId), generationId: calendarKey(r.generationId),
    sourceGeneration: calendarInteger(r.sourceGeneration, 1), controlRevision: calendarInteger(r.controlRevision, 1), exceptionRevision: calendarInteger(r.exceptionRevision),
    preparationId: calendarKey(r.preparationId), basePublicationId: r.basePublicationId === null ? null : calendarKey(r.basePublicationId),
    planManifestDigest: digest(r.planManifestDigest), preparationExpiresAtMs: calendarInteger(r.preparationExpiresAtMs, 1),
    intentDigest: digest(r.intentDigest), authoringDigest: digest(r.authoringDigest), engineGeneration: digest(r.engineGeneration), policyGeneration: digest(r.policyGeneration),
    authoring, grant: { grantId: calendarKey(grant.grantId), grantEpoch: calendarInteger(grant.grantEpoch, 1), authorityDigest: digest(grant.authorityDigest),
      resourceDigest: digest(grant.resourceDigest) }, resourceRevisions });
  if (snapshot.authoringDigest !== calendarHash(authoring) || snapshot.grant.resourceDigest !== calendarHash(authoring.template.resourceIds)) return stale();
  if (snapshot.engineGeneration !== calendarHash(traversal.engine)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  const { kind: _kind, authoring: _authoring, ...facts } = snapshot;
  const binding: CalendarSeriesCompilationBinding = freeze({ ...facts, snapshotDigest: calendarHash(snapshot), recurrenceDigest: calendarHash(authoring.recurrence),
    originalDigest: calendarHash(admitted.original), selections: { resourceIds: authoring.template.resourceIds, appointmentType: authoring.template.appointmentType,
      visit: authoring.template.visit, participants: authoring.template.participants } });
  // The independently bounded metadata must remain valid even at maximum source size.
  calendarHash(binding);
  const source = Object.freeze({}) as CalendarSeriesCompilationSource; sources.set(source, { snapshot, binding, traversal }); return source;
}
export function inspectCalendarSeriesCompilationSource(source: CalendarSeriesCompilationSource): CalendarSeriesCompilationBinding {
  return sourceState(source).binding;
}
export function createCalendarSeriesCompilationCursor(source: CalendarSeriesCompilationSource, range: CalendarRecurrenceDateRange): CalendarRecurrenceCursor {
  return createCalendarRecurrenceCursor(cursorInput(sourceState(source), range));
}
export function restoreCalendarSeriesCompilationCursor(source: CalendarSeriesCompilationSource, range: CalendarRecurrenceDateRange,
  checkpoint: unknown, expectedProgressDigest: string): CalendarRecurrenceCursor {
  const state = sourceState(source), cursor = restoreCalendarRecurrenceCursor(cursorInput(state, range), checkpoint, expectedProgressDigest);
  inspectBoundCursor(state, cursor); return cursor;
}
export function continueCalendarSeriesCompilationWindow(source: CalendarSeriesCompilationSource, cursor: CalendarRecurrenceCursor,
  range: CalendarRecurrenceDateRange): CalendarRecurrenceCursor {
  const state = sourceState(source), previous = inspectBoundCursor(state, cursor), next = continueCalendarRecurrenceNominalWindow(cursor, range);
  const initial = inspectBoundCursor(state, next);
  continuations.set(next, { snapshotDigest: state.binding.snapshotDigest, evidence: freeze({ kind: 'calendar-series-window-transition-v1',
    previousDigest: previous.digest, previousCheckpoint: calendarValue(previous.checkpoint) as unknown as CalendarRecurrenceCheckpoint,
    initialDigest: initial.digest, initialCheckpoint: calendarValue(initial.checkpoint) as unknown as CalendarRecurrenceCheckpoint }) });
  return next;
}
/** Identity does not hash effective time or generation. A move must retain the
 * accepted nominal key supplied by the later canonical exception family. */
export function calendarSeriesNominalOccurrenceId(source: CalendarSeriesCompilationSource, nominalKey: string): string {
  const { snapshot: s } = sourceState(source), key = calendarText(nominalKey, 64);
  if (!/^timed-v1:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(key)) return invalid();
  return calendarHash(['calendar-series-occurrence-v1', s.scopeId, s.seriesId, s.segmentId, key]);
}
function nominalRank(state: SourceState, occurrence: CalendarRecurrenceOccurrence): number {
  const date = occurrence.localStart.slice(0, 10), first = state.traversal.seek(date);
  // Weekly seek anchors at its first selected weekday; at most seven slots.
  for (let index = first; index < first + 7; index++) if (state.traversal.candidate(index)?.date === date) return index;
  throw new CalendarError('CALENDAR_STATE_INVALID');
}
function candidate(source: CalendarSeriesCompilationSource, state: SourceState, occurrence: CalendarRecurrenceOccurrence): CalendarSeriesCompiledOccurrence {
  const t = state.snapshot.authoring.template, interval = normalizeCalendarTimedInterval({ startAt: occurrence.startAt, endAt: occurrence.endAt,
    timeZone: occurrence.timeZone, bufferBeforeMinutes: t.bufferBeforeMinutes, bufferAfterMinutes: t.bufferAfterMinutes });
  const booking: CalendarBookingCandidate = { resourceIds: t.resourceIds, interval,
    ...(t.appointmentType === null ? {} : { appointmentType: t.appointmentType }), ...(t.visit === null ? {} : { visit: t.visit }) };
  return freeze({ id: calendarSeriesNominalOccurrenceId(source, occurrence.nominalKey), nominalKey: occurrence.nominalKey,
    nominalRank: nominalRank(state, occurrence), occurrence, booking, title: t.title, participants: t.participants });
}

/** Compile outside SQL/leases. Work is <= candidateLimit examined slots plus at
 * most seven nominal rank lookups per emitted occurrence; only the cursor does
 * time qualification/COUNT work. Zero-output batches still carry exact progress.
 * No EXDATE/RDATE/move/split transformation or booking admission is implied. */
export function compileCalendarSeriesBatch(source: CalendarSeriesCompilationSource, cursor: CalendarRecurrenceCursor,
  budget: { readonly candidateLimit?: number; readonly occurrenceLimit?: number } = {}): CalendarSeriesCompilationBatch {
  const state = sourceState(source), before = inspectBoundCursor(state, cursor);
  const b = calendarRecord(calendarValue(budget), ['candidateLimit', 'occurrenceLimit']);
  const candidateLimit = b.candidateLimit === undefined ? CALENDAR_RECURRENCE_MAX_CANDIDATES : calendarInteger(b.candidateLimit, 1, CALENDAR_RECURRENCE_MAX_CANDIDATES);
  const occurrenceLimit = b.occurrenceLimit === undefined ? 100 : calendarInteger(b.occurrenceLimit, 1, CALENDAR_RECURRENCE_MAX_OCCURRENCES);
  const batch = advanceCalendarRecurrenceCursor(cursor, { candidateLimit, occurrenceLimit });
  const candidates = Object.freeze(batch.occurrences.map(value => candidate(source, state, value)));
  const completion: CalendarSeriesCompilationEvidence['work']['completion'] = batch.checkpoint.status === 'active' ? 'incomplete'
    : batch.checkpoint.status === 'range-complete' ? 'nominal-range-complete' : 'nominal-source-complete';
  const work: CalendarSeriesCompilationEvidence['work'] = Object.freeze({ candidateLimit, occurrenceLimit,
    evaluatedCandidates: batch.evaluatedCandidates, skipped: batch.skipped, stop: batch.stop, completion });
  const transition = continuations.get(cursor);
  if (transition && transition.snapshotDigest !== state.binding.snapshotDigest) return stale();
  const metadata = freeze({ kind: 'calendar-series-compilation-v1' as const, binding: state.binding, engine: { ...batch.checkpoint.engine },
    progress: { beforeDigest: before.digest, afterDigest: batch.digest, checkpoint: batch.checkpoint,
      ...(transition ? { continuation: transition.evidence } : {}) },
    work, candidateCount: candidates.length });
  const hash = createHash('sha256').update('calendar-series-batch-v1\0').update(calendarHash(metadata));
  for (const value of candidates) hash.update('\0candidate:').update(calendarHash(value));
  const { candidateCount: _count, ...facts } = metadata;
  const evidence: CalendarSeriesCompilationEvidence = Object.freeze({ ...facts, candidates, batchDigest: hash.digest('hex') });
  inspectBoundCursor(state, batch.cursor);
  const contribution = Object.freeze({}) as CalendarSeriesCompilationContribution;
  contributions.set(contribution, { snapshotDigest: state.binding.snapshotDigest, cursor: batch.cursor, evidence });
  return Object.freeze({ contribution, cursor: batch.cursor, evidence });
}

/** Local contribution verification only. A fresh trusted source snapshot must
 * match every retained revision/selection and the expected native batch digest.
 * Copied evidence/digests are never contributions or native-write grants. A real
 * writer must independently redo its current owner/grant/policy/resource and
 * participant/occupancy fences inside the actual commit transaction. */
export function inspectCalendarSeriesCompilationContribution(source: CalendarSeriesCompilationSource,
  contribution: CalendarSeriesCompilationContribution, expectedBatchDigest: string): CalendarSeriesCompilationEvidence {
  const state = sourceState(source), captured = contribution !== null && typeof contribution === 'object' ? contributions.get(contribution) : undefined;
  if (!captured) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (state.binding.snapshotDigest !== captured.snapshotDigest) return stale();
  if (digest(expectedBatchDigest) !== captured.evidence.batchDigest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  inspectBoundCursor(state, captured.cursor); return captured.evidence;
}
