/** Private pure timed recurrence spike, NOT a general RRULE parser or a reservation/coverage guarantee.
 * RFC 5545 §§3.3.10/3.8.5.3: invalid generated dates/times do not consume COUNT;
 * DTSTART must match the rule. The reviewed authoring dialect uses an inclusive
 * local end DATE, not an untyped iCalendar UNTIL. No ICS serialization is implied.
 * https://www.rfc-editor.org/rfc/rfc5545.html#section-3.3.10
 * https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.5.3
 */
import { CalendarError } from './error';
import { normalizeCalendarInstant, normalizeCalendarTimeZone } from './time';
import { calendarInteger, calendarRecord, calendarValue } from './validation';

export type CalendarRecurrenceEnd = { readonly kind: 'never' }
  | { readonly kind: 'on'; readonly date: string } | { readonly kind: 'after'; readonly count: number };
/** Structurally compatible with the local editor's preferences; never imports its preview engine. Weekdays: Sunday=0. */
export type CalendarRecurrenceRule = { readonly interval: number; readonly end: CalendarRecurrenceEnd } & (
  { readonly frequency: 'daily' | 'yearly' }
  | { readonly frequency: 'weekly'; readonly weekdays: readonly number[] }
  | { readonly frequency: 'monthly'; readonly pattern: { readonly kind: 'day'; readonly day: number }
    | { readonly kind: 'weekday'; readonly ordinal: number; readonly weekday: number } });
export interface CalendarRecurrenceDateRange { readonly from: string; readonly until: string }
/** Authored recurrence only: query ranges and work/output budgets are never source facts. */
export interface CalendarTimedRecurrenceSource {
  readonly kind: 'timed-local-v1';
  /** Exact ISO civil wall datetime, YYYY-MM-DDTHH:mm:ss.SSS, ISO calendar, years 0000–9999. */
  readonly localStart: string;
  readonly timeZone: string;
  /** Mandatory and visible: exactly one occurrence is generated in a repeated local hour. */
  readonly fold: 'earlier' | 'later';
  /** Same exact elapsed duration for each occurrence (DTEND-style), not nominal civil DURATION. */
  readonly durationMilliseconds: number;
  readonly rule: CalendarRecurrenceRule;
}
export interface CalendarTimedRecurrenceInput extends CalendarTimedRecurrenceSource {
  /** Half-open NOMINAL local-start-date range. Not a UTC overlap/free-busy query. */
  readonly range: CalendarRecurrenceDateRange;
  readonly limit?: number;
}
export interface CalendarRecurrenceOccurrence {
  /** Series-local immutable nominal identity. Never derive it from effective UTC time or a retry. */
  readonly nominalKey: string;
  readonly localStart: string;
  readonly timeZone: string;
  readonly fold: 'earlier' | 'later';
  readonly offset: string;
  /** Canonical Calendar UTC instant; unlike local source dates, UTC can use signed six-digit boundary years. */
  readonly startAt: string;
  /** Exclusive canonical Calendar UTC end; exact duration can cross midnight, a zone transition or local year 9999. */
  readonly endAt: string;
}
/** DTSTART qualification, not a persisted series, resource admission or reservation/coverage promise. */
export interface CalendarTimedRecurrenceSourceAdmission {
  readonly source: Readonly<CalendarTimedRecurrenceSource>;
  readonly original: CalendarRecurrenceOccurrence;
}
export interface CalendarRecurrenceExpansion {
  readonly kind: 'timed-local-v1';
  readonly requestedRange: CalendarRecurrenceDateRange;
  /** Only these nominal dates were fully evaluated. This reserves no resources and guarantees no free slot. */
  readonly coverage: CalendarRecurrenceDateRange;
  readonly occurrences: readonly CalendarRecurrenceOccurrence[];
  readonly truncated: boolean;
  readonly truncationReason: 'occurrence-limit' | 'candidate-limit' | null;
  readonly evaluatedCandidates: number;
  readonly skipped: { readonly invalidDates: number; readonly nonexistentTimes: number };
  /** Runtime/ICU provenance, NOT a pinned IANA rules database or future reservation promise. */
  readonly engine: { readonly name: 'temporal-recurrence-v1'; readonly runtime: string; readonly icu: string };
}

export const CALENDAR_RECURRENCE_MAX_RANGE_DAYS = 366;
export const CALENDAR_RECURRENCE_MAX_OCCURRENCES = 1000;
export const CALENDAR_RECURRENCE_MAX_CANDIDATES = 4096;
const DAY_MS = 86_400_000;
const SOURCE_FIELDS = ['kind', 'localStart', 'timeZone', 'fold', 'durationMilliseconds', 'rule'] as const;
interface CivilDate { readonly year: number; readonly month: number; readonly day: number }
interface PlainDate extends CivilDate {
  readonly dayOfWeek: number;
  add(duration: { days: number }): PlainDate;
  toString(): string;
}
interface ZonedTime extends CivilDate {
  readonly hour: number; readonly minute: number; readonly second: number; readonly millisecond: number;
  readonly epochMilliseconds: number; readonly offset: string;
}
interface NativeTemporal {
  readonly PlainDate: { from(value: string): PlainDate };
  readonly ZonedDateTime: { from(fields: CivilDate & { timeZone: string; hour: number; minute: number; second: number; millisecond: number },
    options: { disambiguation: 'earlier' | 'later'; overflow: 'reject' }): ZonedTime };
}
interface Normalized extends Omit<CalendarTimedRecurrenceInput, 'limit'> { readonly limit: number }
interface Candidate { readonly date: PlainDate | null; readonly boundary: PlainDate }
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function daysInMonth(year: number, month: number): number {
  return month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function civilDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return invalid();
  return value;
}
/** UTC is used only as a Gregorian date ordinal/serialization, never a host-zone wall-time converter. */
function ordinal(date: string): number { return Date.parse(date + 'T00:00:00.000Z') / DAY_MS; }
function key(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function normalizeRule(input: unknown, start: string): CalendarRecurrenceRule {
  const raw = calendarRecord(input, ['frequency', 'interval', 'end', 'weekdays', 'pattern']);
  const interval = calendarInteger(raw.interval, 1, 99), ending = calendarRecord(raw.end, ['kind', 'date', 'count']);
  let end: CalendarRecurrenceEnd;
  if (ending.kind === 'never') { if (Object.keys(ending).length !== 1) return invalid(); end = { kind: 'never' }; }
  else if (ending.kind === 'after') {
    if (Object.keys(ending).length !== 2 || ending.date !== undefined) return invalid();
    end = { kind: 'after', count: calendarInteger(ending.count, 1, 999) };
  } else if (ending.kind === 'on') {
    if (Object.keys(ending).length !== 2 || ending.count !== undefined) return invalid();
    const date = civilDate(ending.date); if (date < start) return invalid(); end = { kind: 'on', date };
  } else return invalid();
  Object.freeze(end);
  if (raw.frequency === 'weekly') {
    if (Object.keys(raw).length !== 4 || Object.hasOwn(raw, 'pattern') || !Array.isArray(raw.weekdays)
      || raw.weekdays.length < 1 || raw.weekdays.length > 7) return invalid();
    const weekdays = raw.weekdays.map(value => calendarInteger(value, 0, 6));
    if (new Set(weekdays).size !== weekdays.length) return invalid();
    return Object.freeze({ frequency: raw.frequency, interval, end, weekdays: Object.freeze(weekdays.sort((a, b) => (a + 6) % 7 - (b + 6) % 7)) });
  }
  if (raw.frequency === 'monthly') {
    if (Object.keys(raw).length !== 4 || Object.hasOwn(raw, 'weekdays')) return invalid();
    const p = calendarRecord(raw.pattern, ['kind', 'day', 'ordinal', 'weekday']);
    if (p.kind === 'day' && Object.keys(p).length === 2) return Object.freeze({ frequency: raw.frequency, interval, end,
      pattern: Object.freeze({ kind: p.kind, day: calendarInteger(p.day, 1, 31) }) });
    if (p.kind !== 'weekday' || Object.keys(p).length !== 3 || Object.hasOwn(p, 'day')) return invalid();
    const nth = calendarInteger(p.ordinal, -1, 5); if (nth === 0) return invalid();
    return Object.freeze({ frequency: raw.frequency, interval, end,
      pattern: Object.freeze({ kind: p.kind, ordinal: nth, weekday: calendarInteger(p.weekday, 0, 6) }) });
  }
  if ((raw.frequency !== 'daily' && raw.frequency !== 'yearly') || Object.keys(raw).length !== 3) return invalid();
  return Object.freeze({ frequency: raw.frequency, interval, end });
}

function sourceStart(r: Record<string, unknown>): Pick<CalendarTimedRecurrenceSource, 'kind' | 'localStart' | 'fold'> & { readonly date: string } {
  if (r.kind !== 'timed-local-v1' || typeof r.localStart !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/.test(r.localStart)
    || r.fold !== 'earlier' && r.fold !== 'later') return invalid();
  return { kind: r.kind, localStart: r.localStart, fold: r.fold, date: civilDate(r.localStart.slice(0, 10)) };
}
function sourceFields(r: Record<string, unknown>, start: ReturnType<typeof sourceStart>): Readonly<CalendarTimedRecurrenceSource> {
  return Object.freeze({ kind: start.kind, localStart: start.localStart, timeZone: normalizeCalendarTimeZone(r.timeZone), fold: start.fold,
    durationMilliseconds: calendarInteger(r.durationMilliseconds, 1, 31 * DAY_MS), rule: normalizeRule(r.rule, start.date) });
}
/** Closed source-only structural normalization, deliberately independent of native Temporal availability and query limits. */
export function normalizeCalendarTimedRecurrenceSource(input: unknown): Readonly<CalendarTimedRecurrenceSource> {
  const r = calendarRecord(calendarValue(input), SOURCE_FIELDS);
  return sourceFields(r, sourceStart(r));
}
/** Legacy combined structural API: preserve DTSTART -> range -> zone/duration/rule -> limit validation ordering. */
export function normalizeCalendarTimedRecurrence(input: unknown): Readonly<Normalized> {
  const r = calendarRecord(calendarValue(input), [...SOURCE_FIELDS, 'range', 'limit']);
  const start = sourceStart(r);
  const range = calendarRecord(r.range, ['from', 'until']), from = civilDate(range.from), until = civilDate(range.until);
  calendarInteger(ordinal(until) - ordinal(from), 1, CALENDAR_RECURRENCE_MAX_RANGE_DAYS);
  return Object.freeze({ ...sourceFields(r, start),
    range: Object.freeze({ from, until }), limit: r.limit === undefined ? 100 : calendarInteger(r.limit, 1, CALENDAR_RECURRENCE_MAX_OCCURRENCES) });
}
function temporal(): NativeTemporal {
  try {
    const t = (globalThis as typeof globalThis & { Temporal?: NativeTemporal }).Temporal;
    if (t && typeof t.PlainDate?.from === 'function' && typeof t.ZonedDateTime?.from === 'function') return t;
  } catch { /* An unsupported runtime must not expose its raw diagnostics. */ }
  throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
}
function resolveWallTime(t: NativeTemporal, date: PlainDate, source: CalendarTimedRecurrenceSource): ZonedTime | null {
  const hour = Number(source.localStart.slice(11, 13)), minute = Number(source.localStart.slice(14, 16)),
    second = Number(source.localStart.slice(17, 19)), millisecond = Number(source.localStart.slice(20));
  const z = t.ZonedDateTime.from({ year: date.year, month: date.month, day: date.day, hour, minute, second, millisecond, timeZone: source.timeZone },
    { disambiguation: source.fold, overflow: 'reject' });
  // Temporal earlier/later resolves a gap by shifting: reject that roundtrip for
  // authored DTSTART, skip it for generated instances. No assumed one-hour DST.
  return z.year === date.year && z.month === date.month && z.day === date.day && z.hour === hour && z.minute === minute
    && z.second === second && z.millisecond === millisecond ? z : null;
}
function monthCandidate(t: NativeTemporal, year: number, month: number, rule: Extract<CalendarRecurrenceRule, { frequency: 'monthly' }>): Candidate {
  const first = t.PlainDate.from(key(year, month, 1)), days = daysInMonth(year, month), pattern = rule.pattern;
  let day: number;
  if (pattern.kind === 'day') day = pattern.day;
  else if (pattern.ordinal === -1) {
    const lastWeekday = (first.dayOfWeek % 7 + days - 1) % 7;
    day = days - (lastWeekday - pattern.weekday + 7) % 7;
  } else day = 1 + (pattern.weekday - first.dayOfWeek % 7 + 7) % 7 + (pattern.ordinal - 1) * 7;
  return { boundary: first, date: day <= days ? t.PlainDate.from(key(year, month, day)) : null };
}
function matchesStart(t: NativeTemporal, start: PlainDate, rule: CalendarRecurrenceRule): boolean {
  if (rule.frequency === 'weekly') return rule.weekdays.includes(start.dayOfWeek % 7);
  if (rule.frequency === 'monthly') return monthCandidate(t, start.year, start.month, rule).date?.toString() === start.toString();
  return true;
}
function admittedStart(t: NativeTemporal, source: CalendarTimedRecurrenceSource): { readonly start: PlainDate; readonly instant: ZonedTime } {
  const start = t.PlainDate.from(source.localStart.slice(0, 10));
  if (!matchesStart(t, start, source.rule)) return invalid();
  const instant = resolveWallTime(t, start, source);
  if (!instant) return invalid();
  return { start, instant };
}
function occurrence(source: CalendarTimedRecurrenceSource, localStart: string, instant: ZonedTime): CalendarRecurrenceOccurrence {
  const end = instant.epochMilliseconds + source.durationMilliseconds;
  if (!Number.isSafeInteger(instant.epochMilliseconds) || !Number.isSafeInteger(end)) throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  return Object.freeze({ nominalKey: 'timed-v1:' + localStart, localStart, timeZone: source.timeZone, fold: source.fold,
    offset: instant.offset, startAt: normalizeCalendarInstant(instant.epochMilliseconds), endAt: normalizeCalendarInstant(end) });
}
/** Qualify exactly the authored DTSTART without inventing a query range or expanding a prefix. No authority is conferred. */
export function admitCalendarTimedRecurrenceSource(input: unknown): CalendarTimedRecurrenceSourceAdmission {
  const source = normalizeCalendarTimedRecurrenceSource(input), t = temporal();
  try {
    const { instant } = admittedStart(t, source);
    return Object.freeze({ source, original: occurrence(source, source.localStart, instant) });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  }
}
/** Direct seeking for uncounted rules never walks elapsed history. COUNT must
 * qualify valid earlier instances, so its scan starts at DTSTART but hard-stops.
 * The period/candidate budget is independent of source age and requested range.
 */
function* candidates(t: NativeTemporal, start: PlainDate, source: Normalized): Generator<Candidate> {
  const rule = source.rule, target = t.PlainDate.from(source.range.from), counted = rule.end.kind === 'after';
  if (rule.frequency === 'daily') {
    const first = counted ? 0 : Math.max(0, Math.floor((ordinal(target.toString()) - ordinal(start.toString())) / rule.interval));
    for (let i = first; ; i++) { const date = start.add({ days: i * rule.interval }); if (date.year > 9999) return; yield { date, boundary: date }; }
  } else if (rule.frequency === 'weekly') {
    const monday = start.add({ days: -(start.dayOfWeek - 1) });
    const first = counted ? 0 : Math.max(0, Math.floor((ordinal(target.toString()) - ordinal(monday.toString())) / (7 * rule.interval)));
    for (let i = first; ; i++) {
      const week = monday.add({ days: i * rule.interval * 7 });
      for (const weekday of rule.weekdays) { const date = week.add({ days: (weekday + 6) % 7 }); if (date.year > 9999) return; yield { date, boundary: date }; }
    }
  } else if (rule.frequency === 'monthly') {
    const base = start.year * 12 + start.month - 1;
    const first = counted ? 0 : Math.max(0, Math.floor((target.year * 12 + target.month - 1 - base) / rule.interval));
    for (let i = first; ; i++) {
      const month = base + i * rule.interval, year = Math.floor(month / 12);
      if (year > 9999) return;
      yield monthCandidate(t, year, month % 12 + 1, rule);
    }
  } else {
    const first = counted ? 0 : Math.max(0, Math.floor((target.year - start.year) / rule.interval));
    for (let i = first; ; i++) {
      const year = start.year + i * rule.interval; if (year > 9999) return;
      const boundary = t.PlainDate.from(key(year, start.month, 1));
      yield { boundary, date: start.day <= daysInMonth(year, start.month) ? t.PlainDate.from(key(year, start.month, start.day)) : null };
    }
  }
}
function provenance(): CalendarRecurrenceExpansion['engine'] {
  const versions = (globalThis as typeof globalThis & { process?: { versions?: { bun?: string; node?: string; icu?: string } } }).process?.versions;
  return Object.freeze({ name: 'temporal-recurrence-v1', runtime: versions?.bun ? `bun:${versions.bun}` : versions?.node ? `node:${versions.node}` : 'unknown', icu: versions?.icu ?? 'unknown' });
}

/** Pure bounded expansion only. No files, clocks, timers, providers, actors, leases, callbacks or domain writes. */
export function materializeCalendarRecurrence(input: CalendarTimedRecurrenceInput): CalendarRecurrenceExpansion {
  const source = normalizeCalendarTimedRecurrence(input), t = temporal();
  try {
    const { start } = admittedStart(t, source);
    const occurrences: CalendarRecurrenceOccurrence[] = [];
    let evaluatedCandidates = 0, invalidDates = 0, nonexistentTimes = 0, counted = 0;
    let until = source.range.until, truncationReason: CalendarRecurrenceExpansion['truncationReason'] = null;
    for (const candidate of candidates(t, start, source)) {
      const boundary = candidate.boundary.toString(), date = candidate.date?.toString();
      if (boundary >= source.range.until || source.rule.end.kind === 'after' && counted >= source.rule.end.count) break;
      if (source.rule.end.kind === 'on' && boundary > source.rule.end.date) break;
      // A known next nominal date outside the range/end proves this query is
      // complete even at the work ceiling; it requires no further time/count admission.
      if (date && (date >= source.range.until || source.rule.end.kind === 'on' && date > source.rule.end.date)) break;
      if (evaluatedCandidates >= CALENDAR_RECURRENCE_MAX_CANDIDATES) {
        const unqualifiedFrom = date ?? boundary;
        truncationReason = 'candidate-limit'; until = unqualifiedFrom < source.range.from ? source.range.from : unqualifiedFrom; break;
      }
      evaluatedCandidates++;
      if (!date) { invalidDates++; continue; }
      if (date < start.toString()) continue;
      const instant = resolveWallTime(t, candidate.date!, source);
      if (!instant) { nonexistentTimes++; continue; }
      counted++;
      if (date < source.range.from) continue;
      if (occurrences.length >= source.limit) { truncationReason = 'occurrence-limit'; until = date; break; }
      occurrences.push(occurrence(source, date + source.localStart.slice(10), instant));
    }
    return Object.freeze({ kind: 'timed-local-v1', requestedRange: source.range,
      coverage: Object.freeze({ from: source.range.from, until }), occurrences: Object.freeze(occurrences),
      truncated: truncationReason !== null, truncationReason, evaluatedCandidates,
      skipped: Object.freeze({ invalidDates, nonexistentTimes }), engine: provenance() });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('CALENDAR_TIME_RULES_UNAVAILABLE');
  }
}
