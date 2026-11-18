/** Native Temporal is required lazily for a rare bounded policy write, never for retained snapshot reads. */
import { CalendarError } from './error';
import type { CalendarWeeklyAvailabilityPolicyInput, CalendarWorkingHoursSnapshot } from './working-hours-contracts';
import { CALENDAR_WORKING_HOURS_MAX_GENERATED_WINDOWS, normalizeCalendarAvailabilityPolicy } from './working-hours-model';

interface CivilDate { readonly year: number; readonly month: number; readonly day: number }
interface ZonedTime extends CivilDate {
  readonly hour: number; readonly minute: number; readonly second: number; readonly millisecond: number;
  readonly epochMilliseconds: number;
  startOfDay(): ZonedTime;
}
interface PlainDate extends CivilDate {
  readonly dayOfWeek: number;
  add(duration: { days: number }): PlainDate;
  toString(): string;
  toZonedDateTime(timeZone: string): ZonedTime;
}
interface NativeTemporal {
  readonly PlainDate: { from(value: string): PlainDate };
  readonly ZonedDateTime: { from(fields: CivilDate & { timeZone: string; hour: number; minute: number; second: number; millisecond: number }, options: { disambiguation: 'earlier' | 'later'; overflow: 'reject' }): ZonedTime };
}

function temporal(): NativeTemporal {
  try {
    const value = (globalThis as typeof globalThis & { Temporal?: NativeTemporal }).Temporal;
    if (value && typeof value.PlainDate?.from === 'function' && typeof value.ZonedDateTime?.from === 'function') return value;
  } catch { /* Unsupported runtime state remains a safe unavailable outcome. */ }
  throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
}
function sameDate(left: CivilDate, right: CivilDate): boolean { return left.year === right.year && left.month === right.month && left.day === right.day; }
function utc(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  return new Date(milliseconds).toISOString();
}
function boundary(engine: NativeTemporal, date: PlainDate, minute: number, timeZone: string, fold: 'earlier' | 'later'): ZonedTime | null {
  const day = minute === 1440 ? date.add({ days: 1 }) : date, actualMinute = minute === 1440 ? 0 : minute;
  // 1440 is this date's exclusive end, never the later occurrence of tomorrow's
  // midnight. Otherwise yesterday's hours can leak into a closed next date or
  // exceed coverage. Authored same-date boundaries still honor the chosen fold.
  const disambiguation = minute === 1440 ? 'earlier' : fold;
  const value = engine.ZonedDateTime.from({ year: day.year, month: day.month, day: day.day, timeZone,
    hour: Math.floor(actualMinute / 60), minute: actualMinute % 60, second: 0, millisecond: 0 }, { disambiguation, overflow: 'reject' });
  // Temporal's earlier/later choices shift gaps. Roundtrip admission deliberately rejects that normalization.
  return sameDate(value, day) && value.hour === Math.floor(actualMinute / 60) && value.minute === actualMinute % 60
    && value.second === 0 && value.millisecond === 0 ? value : null;
}
function startOfDay(date: PlainDate, timeZone: string): ZonedTime {
  const value = date.toZonedDateTime(timeZone).startOfDay();
  // Midnight can be absent while the date exists. A wholly skipped coverage-boundary date is invalid.
  if (!sameDate(value, date)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return value;
}

export function materializeCalendarWorkingHours(input: CalendarWeeklyAvailabilityPolicyInput, timeZone: string): CalendarWorkingHoursSnapshot {
  const policy = normalizeCalendarAvailabilityPolicy(input);
  if (policy.kind !== 'weekly-local-v1' || typeof timeZone !== 'string' || !timeZone || timeZone.length > 128 || /^[+-]/.test(timeZone)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const engine = temporal();
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
  try {
    const from = engine.PlainDate.from(policy.coverage.from), until = engine.PlainDate.from(policy.coverage.until);
    const startMs = startOfDay(from, timeZone).epochMilliseconds, endMs = startOfDay(until, timeZone).epochMilliseconds;
    if (endMs <= startMs) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const weekly = new Map(policy.weekly.map(day => [day.day, day.windows]));
    const overrides = new Map(policy.overrides.map(override => [override.date, override.windows]));
    const generated: { startMs: number; endMs: number }[] = [], skipped = new Set<string>();
    for (let date = from; date.toString() < policy.coverage.until; date = date.add({ days: 1 })) {
      const key = date.toString(), authored = overrides.has(key), windows = overrides.get(key) ?? weekly.get(date.dayOfWeek) ?? [];
      for (const window of windows) {
        const start = boundary(engine, date, window.startMinute, timeZone, policy.fold), end = boundary(engine, date, window.endMinute, timeZone, policy.fold);
        if (!start || !end) {
          if (authored) throw new CalendarError('CALENDAR_INPUT_INVALID');
          skipped.add(key); continue;
        }
        if (end.epochMilliseconds <= start.epochMilliseconds) throw new CalendarError('CALENDAR_INPUT_INVALID');
        if (generated.length >= CALENDAR_WORKING_HOURS_MAX_GENERATED_WINDOWS) throw new CalendarError('CALENDAR_INPUT_INVALID');
        generated.push({ startMs: start.epochMilliseconds, endMs: end.epochMilliseconds });
      }
    }
    generated.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
    const merged: { startMs: number; endMs: number }[] = [];
    for (const window of generated) {
      const prior = merged[merged.length - 1];
      if (prior && window.startMs <= prior.endMs) prior.endMs = Math.max(prior.endMs, window.endMs);
      else merged.push({ ...window });
    }
    const versions = (globalThis as typeof globalThis & { process?: { versions?: { bun?: string; node?: string; icu?: string } } }).process?.versions;
    return Object.freeze({ coverage: Object.freeze({ startAt: utc(startMs), endAt: utc(endMs) }),
      windows: Object.freeze(merged.map(window => Object.freeze({ startAt: utc(window.startMs), endAt: utc(window.endMs) }))),
      engine: Object.freeze({ name: 'temporal-working-hours-v1' as const, runtime: versions?.bun ? `bun:${versions.bun}` : versions?.node ? `node:${versions.node}` : 'unknown', icu: versions?.icu ?? 'unknown' }),
      skippedDates: Object.freeze([...skipped].sort()) });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  }
}
