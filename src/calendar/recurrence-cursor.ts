/** Private F5 compiler progress, NOT a grant, booking admission or UTC coverage certificate.
 * Checkpoints are source-owned evidence. Never accept browser JSON or a caller's
 * self-reported digest as trusted persisted progress; native write authority must
 * independently bind the source generation and exact contribution at commit. */
import { CalendarError } from './error';
import { calendarRecurrenceTraversal, compareCalendarRecurrenceDates, normalizeCalendarTimedRecurrence, normalizeCalendarTimedRecurrenceSource,
  CALENDAR_RECURRENCE_MAX_CANDIDATES, CALENDAR_RECURRENCE_MAX_OCCURRENCES,
  type CalendarRecurrenceDateRange, type CalendarRecurrenceOccurrence,
  type CalendarTimedRecurrenceSource } from './recurrence-engine';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarValue } from './validation';

export interface CalendarRecurrenceCursorBinding {
  readonly scopeId: string;
  readonly seriesId: string;
  readonly segmentId: string;
  readonly sourceGeneration: number;
}
export interface CalendarRecurrenceCursorInput {
  readonly binding: CalendarRecurrenceCursorBinding;
  readonly source: CalendarTimedRecurrenceSource;
  /** Nominal start dates only, never an occupancy slab or availability proof. */
  readonly range: CalendarRecurrenceDateRange;
}
export interface CalendarRecurrenceCheckpoint {
  readonly kind: 'calendar-recurrence-cursor-v1';
  readonly binding: CalendarRecurrenceCursorBinding;
  readonly sourceDigest: string;
  readonly originalDigest: string;
  readonly engine: ReturnType<typeof calendarRecurrenceTraversal>['engine'];
  readonly range: CalendarRecurrenceDateRange;
  /** Next nominal period/weekday slot, including slots with no valid civil date. */
  readonly nextCandidate: number;
  readonly examinedCandidates: number;
  /** RRULE valid-instance prefix only; null for directly sought uncounted rules.
   * EXDATE never refunds this count; additional dates never consume it. Neither
   * exception family is applied by this compiler. */
  readonly rruleCount: number | null;
  readonly skipped: { readonly invalidDates: number; readonly nonexistentTimes: number };
  readonly status: 'active' | 'range-complete' | 'source-complete';
}
declare const cursorBrand: unique symbol;
/** Runtime-branded opaque handle: spreading/JSON parsing cannot reconstruct it. */
export interface CalendarRecurrenceCursor { readonly [cursorBrand]: true }
export interface CalendarRecurrenceCursorEvidence {
  readonly checkpoint: CalendarRecurrenceCheckpoint;
  readonly digest: string;
}
export interface CalendarRecurrenceCursorBatch extends CalendarRecurrenceCursorEvidence {
  readonly cursor: CalendarRecurrenceCursor;
  readonly occurrences: readonly CalendarRecurrenceOccurrence[];
  readonly evaluatedCandidates: number;
  readonly skipped: { readonly invalidDates: number; readonly nonexistentTimes: number };
  readonly stop: 'candidate-limit' | 'occurrence-limit' | 'range-complete' | 'source-complete';
}
interface State {
  readonly traversal: ReturnType<typeof calendarRecurrenceTraversal>;
  readonly checkpoint: CalendarRecurrenceCheckpoint;
}
const states = new WeakMap<object, State>();
const FIELDS = ['kind', 'binding', 'sourceDigest', 'originalDigest', 'engine', 'range', 'nextCandidate', 'examinedCandidates', 'rruleCount', 'skipped', 'status'] as const;
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function conflict(): never { throw new CalendarError('CALENDAR_REVISION_CONFLICT'); }
function binding(input: unknown): CalendarRecurrenceCursorBinding {
  const r = calendarRecord(input, ['scopeId', 'seriesId', 'segmentId', 'sourceGeneration']);
  return Object.freeze({ scopeId: calendarScope(r.scopeId), seriesId: calendarKey(r.seriesId), segmentId: calendarKey(r.segmentId),
    sourceGeneration: calendarInteger(r.sourceGeneration, 1) });
}
function context(input: unknown) {
  const r = calendarRecord(calendarValue(input), ['binding', 'source', 'range']), identity = binding(r.binding);
  const source = normalizeCalendarTimedRecurrenceSource(r.source);
  const { range } = normalizeCalendarTimedRecurrence({ ...source, range: r.range }), traversal = calendarRecurrenceTraversal(source);
  return { traversal, base: Object.freeze({ kind: 'calendar-recurrence-cursor-v1' as const, binding: identity,
    sourceDigest: calendarHash(traversal.source), originalDigest: calendarHash(traversal.original), engine: traversal.engine, range }) };
}
function checkpoint(value: CalendarRecurrenceCheckpoint): CalendarRecurrenceCheckpoint {
  return Object.freeze({ ...value, skipped: Object.freeze({ ...value.skipped }) });
}
function handle(traversal: State['traversal'], value: CalendarRecurrenceCheckpoint): CalendarRecurrenceCursor {
  const token = Object.freeze({}) as CalendarRecurrenceCursor;
  states.set(token, { traversal, checkpoint: checkpoint(value) }); return token;
}
function state(cursor: CalendarRecurrenceCursor): State {
  const value = cursor !== null && typeof cursor === 'object' ? states.get(cursor) : undefined;
  if (!value) throw new CalendarError('CALENDAR_FORBIDDEN');
  value.traversal.assertCurrent(); return value;
}
function evidence(value: CalendarRecurrenceCheckpoint): CalendarRecurrenceCursorEvidence {
  return Object.freeze({ checkpoint: value, digest: calendarHash({ domain: 'calendar-recurrence-checkpoint-v1', checkpoint: value }) });
}

/** Admit the actual DTSTART once; counted rules begin at candidate zero, while
 * uncounted sparse queries seek directly. No source-wide historical replay. */
export function createCalendarRecurrenceCursor(input: CalendarRecurrenceCursorInput): CalendarRecurrenceCursor {
  const { traversal, base } = context(input), counted = traversal.source.rule.end.kind === 'after';
  return handle(traversal, { ...base, nextCandidate: counted ? 0 : traversal.seek(base.range.from), examinedCandidates: 0,
    rruleCount: counted ? 0 : null, skipped: { invalidDates: 0, nonexistentTimes: 0 }, status: 'active' });
}
export function inspectCalendarRecurrenceCursor(cursor: CalendarRecurrenceCursor): CalendarRecurrenceCursorEvidence {
  return evidence(state(cursor).checkpoint);
}

/** Continue NOMINAL compiler progress after an exactly completed window. This
 * neither qualifies UTC occupancy nor claims the intervening disjoint dates were
 * reserved. Only the runtime-owned handle contributes progress/source identity;
 * the caller supplies a later bounded date window, never counters or a source.
 * COUNT retains its qualified prefix, including examined invalid dates/gaps.
 * Uncounted rules explicitly start a fresh direct-seek cursor with reset work
 * statistics rather than pretending skipped history was examined. The 366-day
 * limit applies to each window, not the lifetime of the source. */
export function continueCalendarRecurrenceNominalWindow(cursor: CalendarRecurrenceCursor,
  nextRange: CalendarRecurrenceDateRange): CalendarRecurrenceCursor {
  const { traversal, checkpoint: previous } = state(cursor);
  const { range } = normalizeCalendarTimedRecurrence({ ...traversal.source, range: nextRange });
  if (previous.status !== 'range-complete') return conflict();
  if (compareCalendarRecurrenceDates(range.from, previous.range.until) < 0) return invalid();
  const next = previous.rruleCount !== null ? { ...previous, range, status: 'active' as const }
    : { ...previous, range, status: 'active' as const, nextCandidate: traversal.seek(range.from), examinedCandidates: 0,
      skipped: { invalidDates: 0, nonexistentTimes: 0 } };
  traversal.assertCurrent();
  return handle(traversal, next);
}

/** Recovery requires an independent expected digest selected from the trusted
 * source-owned native store/receipt, not supplied alongside a browser cursor.
 * The digest checks equality, NOT authenticity or write authority. Validating a
 * checkpoint without that independent trust would assert unverified COUNT work.
 * Runtime/ICU/compiler or source changes fail closed; accepted history is never
 * silently recomputed under replacement timezone rules. */
export function restoreCalendarRecurrenceCursor(input: CalendarRecurrenceCursorInput, persisted: unknown,
  expectedDigest: string): CalendarRecurrenceCursor {
  const { traversal, base } = context(input), r = calendarRecord(calendarValue(persisted), FIELDS);
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest)) return invalid();
  if (evidence(r as unknown as CalendarRecurrenceCheckpoint).digest !== expectedDigest) return conflict();
  if (r.kind !== base.kind || calendarHash(r.binding) !== calendarHash(base.binding) || r.sourceDigest !== base.sourceDigest
    || calendarHash(r.range) !== calendarHash(base.range)) return conflict();
  if (calendarHash(r.engine) !== calendarHash(base.engine) || r.originalDigest !== base.originalDigest) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  const nextCandidate = calendarInteger(r.nextCandidate, 0, 4_000_000), examinedCandidates = calendarInteger(r.examinedCandidates, 0, nextCandidate);
  if (nextCandidate !== (traversal.source.rule.end.kind === 'after' ? 0 : traversal.seek(base.range.from)) + examinedCandidates) return invalid();
  const skipped = calendarRecord(r.skipped, ['invalidDates', 'nonexistentTimes']);
  const invalidDates = calendarInteger(skipped.invalidDates, 0, examinedCandidates), nonexistentTimes = calendarInteger(skipped.nonexistentTimes, 0, examinedCandidates - invalidDates);
  const end = traversal.source.rule.end, rruleCount = end.kind === 'after' ? calendarInteger(r.rruleCount, 0, end.count) : null;
  if (end.kind !== 'after' && r.rruleCount !== null || rruleCount !== null && rruleCount > examinedCandidates - invalidDates - nonexistentTimes
    || r.status !== 'active' && r.status !== 'range-complete' && r.status !== 'source-complete') return invalid();
  return handle(traversal, { ...base, nextCandidate, examinedCandidates, rruleCount, skipped: { invalidDates, nonexistentTimes }, status: r.status });
}

/** Every batch examines at most candidateLimit slots and emits at most
 * occurrenceLimit results. Invalid dates, gaps and pre-DTSTART weekly slots all
 * advance the index, even in zero-output batches. Input handles are immutable:
 * retrying the same handle/budget produces the exact same checkpoint and results. */
export function advanceCalendarRecurrenceCursor(cursor: CalendarRecurrenceCursor,
  budget: { readonly candidateLimit?: number; readonly occurrenceLimit?: number } = {}): CalendarRecurrenceCursorBatch {
  const { traversal, checkpoint: previous } = state(cursor), b = calendarRecord(calendarValue(budget), ['candidateLimit', 'occurrenceLimit']);
  const candidateLimit = b.candidateLimit === undefined ? CALENDAR_RECURRENCE_MAX_CANDIDATES : calendarInteger(b.candidateLimit, 1, CALENDAR_RECURRENCE_MAX_CANDIDATES);
  const occurrenceLimit = b.occurrenceLimit === undefined ? 100 : calendarInteger(b.occurrenceLimit, 1, CALENDAR_RECURRENCE_MAX_OCCURRENCES);
  const occurrences: CalendarRecurrenceOccurrence[] = [], source = traversal.source, end = source.rule.end;
  let nextCandidate = previous.nextCandidate, rruleCount = previous.rruleCount, evaluatedCandidates = 0, invalidDates = 0, nonexistentTimes = 0;
  let stop: CalendarRecurrenceCursorBatch['stop'] = previous.status === 'active' ? 'candidate-limit' : previous.status;
  if (previous.status === 'active') for (;;) {
    if (end.kind === 'after' && rruleCount! >= end.count) { stop = 'source-complete'; break; }
    const candidate = traversal.candidate(nextCandidate);
    if (!candidate || end.kind === 'on' && (candidate.boundary > end.date || candidate.date !== null && candidate.date > end.date)) { stop = 'source-complete'; break; }
    if (compareCalendarRecurrenceDates(candidate.boundary, previous.range.until) >= 0
      || candidate.date !== null && compareCalendarRecurrenceDates(candidate.date, previous.range.until) >= 0) { stop = 'range-complete'; break; }
    if (evaluatedCandidates >= candidateLimit) { stop = 'candidate-limit'; break; }
    if (occurrences.length >= occurrenceLimit) { stop = 'occurrence-limit'; break; }
    nextCandidate++; evaluatedCandidates++;
    if (candidate.date === null) { invalidDates++; continue; }
    if (candidate.date < source.localStart.slice(0, 10)) continue;
    const occurrence = candidate.resolve();
    if (!occurrence) { nonexistentTimes++; continue; }
    if (rruleCount !== null) rruleCount++;
    if (candidate.date >= previous.range.from) occurrences.push(occurrence);
  }
  const current = checkpoint({ ...previous, nextCandidate, rruleCount, examinedCandidates: previous.examinedCandidates + evaluatedCandidates,
    skipped: { invalidDates: previous.skipped.invalidDates + invalidDates, nonexistentTimes: previous.skipped.nonexistentTimes + nonexistentTimes },
    status: stop === 'range-complete' || stop === 'source-complete' ? stop : 'active' });
  traversal.assertCurrent();
  return Object.freeze({ ...evidence(current), cursor: handle(traversal, current), occurrences: Object.freeze(occurrences), evaluatedCandidates,
    skipped: Object.freeze({ invalidDates, nonexistentTimes }), stop });
}
