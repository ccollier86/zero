/** Private pure LocalDate compiler, not booking authority or an enabled input API.
 * Dates remain authoritative; UTC fields are a frozen occupancy projection, NOT
 * a coercion into normalizeCalendarTimedInterval. Blocks/holds do not admit this
 * kind. Runtime/ICU provenance is not a pinned timezone database guarantee.
 */
import { CalendarError } from './error';
import { normalizeCalendarTimeZone } from './time';
import { calendarInteger, calendarRecord } from './validation';
import { calendarWorkingHoursDateOrdinal } from './working-hours-model';

export interface CalendarAllDayIntervalInput {
  readonly kind: 'all-day-local-v1';
  /** Strict ISO Gregorian YYYY-MM-DD, years 0000–9999. */
  readonly startDate: string;
  /** Exclusive LocalDate boundary; it too must fit four digits. Never clipped. */
  readonly endDate: string;
  readonly timeZone: string;
}
export interface CalendarAllDayInterval extends CalendarAllDayIntervalInput {
  readonly dayCount: number;
  readonly startAt: string;
  readonly endAt: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly bufferBeforeMinutes: 0;
  readonly bufferAfterMinutes: 0;
  readonly occupiedStartMs: number;
  readonly occupiedEndMs: number;
  /** Conversion provenance only, not a future-rule stability certificate. */
  readonly engine: { readonly name: 'temporal-all-day-v1'; readonly runtime: string; readonly icu: string };
}

const DAY_MS = 86_400_000;
const DATE_LIMIT_MS = 8_640_000_000_000_000;
const MAX_LOCAL_DAYS = 31;
/** Same 33-day envelope as existing timed occupancy plus its two one-day buffers.
 * This is an admission bound, NEVER the rule used to compute LocalDate endpoints. */
const MAX_OCCUPIED_DURATION_MS = 33 * DAY_MS;
interface CivilDate { readonly year: number; readonly month: number; readonly day: number }
interface ZonedDateTime extends CivilDate {
  readonly epochMilliseconds: number;
  startOfDay(): ZonedDateTime;
}
interface PlainDate extends CivilDate { toZonedDateTime(timeZone: string): ZonedDateTime }
interface NativeTemporal { readonly PlainDate: { from(value: string): PlainDate } }

function temporal(): NativeTemporal {
  try {
    const engine = (globalThis as typeof globalThis & { Temporal?: NativeTemporal }).Temporal;
    if (engine && typeof engine.PlainDate?.from === 'function') return engine;
  } catch { /* Runtime state is unavailable, not an authored input correction. */ }
  throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
}
function sameDate(left: CivilDate, right: CivilDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}
function firstInstant(engine: NativeTemporal, input: string, timeZone: string): number {
  const date = engine.PlainDate.from(input);
  // The default is the first valid time, not an explicitly requested 00:00.
  // A midnight gap can correctly start at 01:00. A wholly skipped date must
  // roundtrip to a different date and is rejected, including exclusive ends.
  const zoned = date.toZonedDateTime(timeZone).startOfDay();
  if (!sameDate(date, zoned)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return calendarInteger(zoned.epochMilliseconds, -DATE_LIMIT_MS, DATE_LIMIT_MS);
}

export function normalizeCalendarAllDayInterval(input: unknown): Readonly<CalendarAllDayInterval> {
  const value = calendarRecord(input, ['kind', 'startDate', 'endDate', 'timeZone']);
  if (value.kind !== 'all-day-local-v1') throw new CalendarError('CALENDAR_INPUT_INVALID');
  const from = calendarWorkingHoursDateOrdinal(value.startDate), until = calendarWorkingHoursDateOrdinal(value.endDate);
  const dayCount = calendarInteger(until - from, 1, MAX_LOCAL_DAYS);
  const startDate = value.startDate as string, endDate = value.endDate as string;
  const timeZone = normalizeCalendarTimeZone(value.timeZone), engine = temporal();
  try {
    const startMs = firstInstant(engine, startDate, timeZone), endMs = firstInstant(engine, endDate, timeZone);
    calendarInteger(endMs - startMs, 1, MAX_OCCUPIED_DURATION_MS);
    const versions = (globalThis as typeof globalThis & { process?: { versions?: { bun?: string; node?: string; icu?: string } } }).process?.versions;
    return Object.freeze({ kind: 'all-day-local-v1' as const, startDate, endDate, timeZone, dayCount,
      startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString(), startMs, endMs,
      bufferBeforeMinutes: 0 as const, bufferAfterMinutes: 0 as const, occupiedStartMs: startMs, occupiedEndMs: endMs,
      engine: Object.freeze({ name: 'temporal-all-day-v1' as const,
        runtime: versions?.bun ? `bun:${versions.bun}` : versions?.node ? `node:${versions.node}` : 'unknown', icu: versions?.icu ?? 'unknown' }),
    });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  }
}
