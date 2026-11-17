/** Pure timed-instant admission only: no local wall-time conversion, all-day records or recurrence expansion. */
import { CalendarError } from './error';
import { calendarInteger, calendarRecord, calendarText } from './validation';

const DATE_LIMIT_MS = 8_640_000_000_000_000;
const MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const MAX_BUFFER_MINUTES = 1_440;
/** Every admitted occupied interval is bounded by the same writer invariant. */
const MAX_OCCUPIED_DURATION_MS = MAX_DURATION_MS + 2 * MAX_BUFFER_MINUTES * MINUTE_MS;
const CANONICAL_UTC = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface CalendarTimedInterval {
  readonly startAt: string;
  readonly endAt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly occupiedStartMs: number;
  readonly occupiedEndMs: number;
}

/** Accept canonical UTC ISO milliseconds or integer epoch milliseconds, never a local date/time or UTC offset string. */
export function normalizeCalendarInstant(input: unknown): string {
  if (typeof input === 'number') {
    return new Date(calendarInteger(input, -DATE_LIMIT_MS, DATE_LIMIT_MS)).toISOString();
  }
  const text = calendarText(input, 27);
  if (!CANONICAL_UTC.test(text)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const instant = new Date(text);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== text) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return text;
}

/** Use the runtime's supported IANA database; aliases are normalized, and numeric UTC offsets are not scheduling zones. */
export function normalizeCalendarTimeZone(input: unknown): string {
  const timeZone = calendarText(input, 128);
  if (/^[+-]/.test(timeZone)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new CalendarError('CALENDAR_INPUT_INVALID');
  }
}

/** Start/end instants and the scheduling zone are explicit; the zone does not reinterpret or prove local wall-time intent. */
export function normalizeCalendarTimedInterval(input: unknown): CalendarTimedInterval {
  const record = calendarRecord(input, ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']);
  const startAt = normalizeCalendarInstant(record.startAt);
  const endAt = normalizeCalendarInstant(record.endAt);
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  calendarInteger(endMs - startMs, 1, MAX_DURATION_MS);
  const bufferBeforeMinutes = record.bufferBeforeMinutes === undefined ? 0 : calendarInteger(record.bufferBeforeMinutes, 0, MAX_BUFFER_MINUTES);
  const bufferAfterMinutes = record.bufferAfterMinutes === undefined ? 0 : calendarInteger(record.bufferAfterMinutes, 0, MAX_BUFFER_MINUTES);
  const occupiedStartMs = calendarInteger(startMs - bufferBeforeMinutes * MINUTE_MS, -DATE_LIMIT_MS, DATE_LIMIT_MS);
  const occupiedEndMs = calendarInteger(endMs + bufferAfterMinutes * MINUTE_MS, -DATE_LIMIT_MS, DATE_LIMIT_MS);
  return Object.freeze({
    startAt, endAt, startMs, endMs, timeZone: normalizeCalendarTimeZone(record.timeZone),
    bufferBeforeMinutes, bufferAfterMinutes, occupiedStartMs, occupiedEndMs,
  });
}

/** Compare normalized intervals only. Half-open occupancy permits exact adjacency, including declared buffers. */
export function calendarIntervalsConflict(left: CalendarTimedInterval, right: CalendarTimedInterval): boolean {
  return left.occupiedStartMs < right.occupiedEndMs && right.occupiedStartMs < left.occupiedEndMs;
}

/**
 * An interval older than this bound cannot overlap startMs: commands admit at
 * most 31 days plus two one-day buffers. Pair this lower bound with the exact
 * half-open overlap predicates so indexed lookups never scan all older history.
 * This is deliberately conservative at the boundary and changes no conflicts.
 */
export function calendarOverlapSearchStart(startMs: number): number {
  return Math.max(-DATE_LIMIT_MS, calendarInteger(startMs, -DATE_LIMIT_MS, DATE_LIMIT_MS) - MAX_OCCUPIED_DURATION_MS);
}
