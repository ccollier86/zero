/** Pure native Temporal qualification: no files, databases, timers, providers, actors, caches or installations. */
import { expect, test } from 'bun:test';
import type { RepeatRule } from '../components/calendar/models/recurrence-model';
import { CalendarError, type CalendarErrorCode } from './error';
import { normalizeCalendarInstant, normalizeCalendarTimedInterval } from './time';
import { CALENDAR_RECURRENCE_MAX_CANDIDATES, CALENDAR_RECURRENCE_MAX_OCCURRENCES, CALENDAR_RECURRENCE_MAX_RANGE_DAYS,
  materializeCalendarRecurrence, normalizeCalendarTimedRecurrence, type CalendarTimedRecurrenceInput, type CalendarRecurrenceRule } from './recurrence-engine';

function source(patch: Partial<CalendarTimedRecurrenceInput> = {}): CalendarTimedRecurrenceInput {
  return { kind: 'timed-local-v1', localStart: '2026-01-01T09:07:03.125', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 37 * 60_000,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'never' } }, range: { from: '2026-01-01', until: '2026-01-05' }, ...patch };
}
const dates = (input: CalendarTimedRecurrenceInput) => materializeCalendarRecurrence(input).occurrences.map(value => value.localStart.slice(0, 10));
function rejects(input: unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID'): void {
  try { materializeCalendarRecurrence(input as CalendarTimedRecurrenceInput); throw new Error('invalid recurrence accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); expect((error as Error).message).not.toContain('private-diagnostic'); }
}

test('closed normalized authoring contract is detached, frozen, exact and structurally compatible with the UI rule, not its engine', () => {
  const rule: RepeatRule = { frequency: 'weekly', interval: 1, weekdays: [0, 4], end: { kind: 'after', count: 2 } };
  const input = source({ rule }), admitted = normalizeCalendarTimedRecurrence(input), result = materializeCalendarRecurrence(input);
  expect(rule.weekdays).toEqual([0, 4]); expect(admitted.rule).toEqual({ ...rule, weekdays: [4, 0] });
  expect(result.occurrences[0]).toEqual({ nominalKey: 'timed-v1:2026-01-01T09:07:03.125', localStart: input.localStart,
    timeZone: 'UTC', fold: 'earlier', offset: '+00:00', startAt: '2026-01-01T09:07:03.125Z', endAt: '2026-01-01T09:44:03.125Z' });
  expect(result.engine).toEqual({ name: 'temporal-recurrence-v1', runtime: `bun:${Bun.version}`, icu: process.versions.icu ?? 'unknown' });
  expect(Object.hasOwn(result.engine, 'tzdb')).toBe(false);
  for (const value of [admitted, admitted.rule, admitted.rule.end, admitted.range, result, result.requestedRange, result.coverage,
    result.occurrences, result.occurrences[0], result.skipped, result.engine]) expect(Object.isFrozen(value)).toBe(true);
  if (admitted.rule.frequency !== 'weekly') throw new Error('expected admitted weekly rule');
  expect(Object.isFrozen(admitted.rule.weekdays)).toBe(true);
  (input.range as { from: string }).from = '2025-01-01'; rule.weekdays.push(1);
  expect(admitted.range.from).toBe('2026-01-01'); expect(result.requestedRange.from).toBe('2026-01-01');
});

test('daily interval and COUNT include DTSTART exactly once, including a range starting after it', () => {
  const input = source({ rule: { frequency: 'daily', interval: 2, end: { kind: 'after', count: 3 } }, range: { from: '2026-01-01', until: '2026-01-09' } });
  expect(dates(input)).toEqual(['2026-01-01', '2026-01-03', '2026-01-05']);
  expect(dates({ ...input, range: { from: '2026-01-04', until: '2026-01-09' } })).toEqual(['2026-01-05']);
  expect(dates({ ...input, range: { from: '2026-01-06', until: '2026-01-09' } })).toEqual([]);
});

test('weekly multiple weekdays use fixed Monday week start and interval anchor, not weeks from the query', () => {
  const input = source({ localStart: '2026-01-06T09:00:00.000',
    rule: { frequency: 'weekly', interval: 2, weekdays: [0, 2], end: { kind: 'after', count: 4 } }, range: { from: '2026-01-01', until: '2026-02-01' } });
  expect(dates(input)).toEqual(['2026-01-06', '2026-01-11', '2026-01-20', '2026-01-25']);
  expect(dates({ ...input, rule: { ...input.rule, end: { kind: 'never' } }, range: { from: '2026-01-12', until: '2026-01-26' } }))
    .toEqual(['2026-01-20', '2026-01-25']);
});

test('invalid generated month days skip without clamping, consuming COUNT or drifting the anchor', () => {
  const input = source({ localStart: '2026-01-31T09:00:00.000', rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 31 }, end: { kind: 'after', count: 3 } },
    range: { from: '2026-01-01', until: '2026-07-01' } });
  const result = materializeCalendarRecurrence(input);
  expect(dates(input)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']); expect(result.skipped.invalidDates).toBe(2);
  expect(dates({ ...input, range: { from: '2026-05-01', until: '2026-07-01' } })).toEqual(['2026-05-31']);
  expect(dates({ ...input, rule: { ...input.rule, interval: 2 } })).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('monthly fifth and last weekdays are distinct; nonexistent fifth weekdays do not consume COUNT', () => {
  expect(dates(source({ localStart: '2026-03-30T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: 5, weekday: 1 }, end: { kind: 'after', count: 4 } },
    range: { from: '2026-03-01', until: '2026-12-01' } }))).toEqual(['2026-03-30', '2026-06-29', '2026-08-31', '2026-11-30']);
  expect(dates(source({ localStart: '2026-01-26T09:00:00.000',
    rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: -1, weekday: 1 }, end: { kind: 'after', count: 3 } },
    range: { from: '2026-01-01', until: '2026-04-01' } }))).toEqual(['2026-01-26', '2026-02-23', '2026-03-30']);
});

test('yearly leap-day COUNT skips invalid years, including century exceptions and ISO year zero', () => {
  const leap = source({ localStart: '2024-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 3 } },
    range: { from: '2032-02-01', until: '2032-03-01' } });
  expect(dates(leap)).toEqual(['2032-02-29']); expect(materializeCalendarRecurrence(leap).skipped.invalidDates).toBe(6);
  expect(dates({ ...leap, rule: { ...leap.rule, end: { kind: 'after', count: 2 } } })).toEqual([]);
  expect(dates({ ...leap, localStart: '2096-02-29T09:00:00.000', range: { from: '2104-02-01', until: '2104-03-01' },
    rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 2 } } })).toEqual(['2104-02-29']);
  expect(dates({ ...leap, localStart: '0000-02-29T09:00:00.000', range: { from: '0004-02-01', until: '0004-03-01' },
    rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 2 } } })).toEqual(['0004-02-29']);
});

test('inclusive authoring end date includes that date, unlike the exclusive query end', () => {
  const input = source({ rule: { frequency: 'daily', interval: 1, end: { kind: 'on', date: '2026-01-03' } } });
  expect(dates(input)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  expect(dates({ ...input, range: { from: '2026-01-01', until: '2026-01-03' } })).toEqual(['2026-01-01', '2026-01-02']);
  expect(dates({ ...input, range: { from: '2026-01-04', until: '2026-01-05' } })).toEqual([]);
  rejects(source({ rule: { frequency: 'daily', interval: 1, end: { kind: 'on', date: '2025-12-31' } } }));
});

test('New York generated gaps skip in both fold policies and do not count; authored gap rejects', () => {
  for (const fold of ['earlier', 'later'] as const) {
    const input = source({ localStart: '2026-03-07T02:30:00.000', timeZone: 'America/New_York', fold,
      rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } }, range: { from: '2026-03-07', until: '2026-03-12' } });
    const result = materializeCalendarRecurrence(input);
    expect(dates(input)).toEqual(['2026-03-07', '2026-03-09', '2026-03-10']); expect(result.skipped.nonexistentTimes).toBe(1);
    expect(result.occurrences.map(value => value.startAt)).toEqual(['2026-03-07T07:30:00.000Z', '2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
    rejects({ ...input, localStart: '2026-03-08T02:30:00.000' });
  }
});

test('explicit New York folds produce one repeated-hour instance and preserve its nominal identity across offset choice', () => {
  const input = source({ localStart: '2026-11-01T01:30:00.000', timeZone: 'America/New_York', range: { from: '2026-11-01', until: '2026-11-02' } });
  const early = materializeCalendarRecurrence(input).occurrences[0]!, late = materializeCalendarRecurrence({ ...input, fold: 'later' }).occurrences[0]!;
  expect(early.startAt).toBe('2026-11-01T05:30:00.000Z'); expect(late.startAt).toBe('2026-11-01T06:30:00.000Z');
  expect(early.offset).toBe('-04:00'); expect(late.offset).toBe('-05:00'); expect(early.nominalKey).toBe(late.nominalKey);
  expect(materializeCalendarRecurrence(input).occurrences.length).toBe(1);
  rejects({ ...input, fold: undefined }); rejects({ ...input, fold: 'compatible' });
});

test('Lord Howe 30-minute gaps/folds and Kathmandu quarter-hour offsets never assume one-hour changes', () => {
  const fold = source({ localStart: '2026-04-05T01:45:00.000', timeZone: 'Australia/Lord_Howe', range: { from: '2026-04-05', until: '2026-04-06' } });
  const early = materializeCalendarRecurrence(fold).occurrences[0]!, late = materializeCalendarRecurrence({ ...fold, fold: 'later' }).occurrences[0]!;
  expect(Date.parse(late.startAt) - Date.parse(early.startAt)).toBe(30 * 60_000); expect(early.nominalKey).toBe(late.nominalKey);
  const gap = source({ localStart: '2026-10-03T02:15:00.000', timeZone: 'Australia/Lord_Howe', rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 2 } },
    range: { from: '2026-10-03', until: '2026-10-07' } });
  expect(dates(gap)).toEqual(['2026-10-03', '2026-10-05']); rejects({ ...gap, localStart: '2026-10-04T02:15:00.000' });
  expect(materializeCalendarRecurrence(source({ localStart: '2026-01-01T00:00:00.000', timeZone: 'Asia/Kathmandu' })).occurrences[0]!.startAt)
    .toBe('2025-12-31T18:15:00.000Z');
});

test('wholly skipped civil dates skip generated instances, never COUNT, and reject as directly entered DTSTART', () => {
  const input = source({ localStart: '2011-12-29T09:00:00.000', timeZone: 'Pacific/Apia', rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } },
    range: { from: '2011-12-29', until: '2012-01-03' } });
  expect(dates(input)).toEqual(['2011-12-29', '2011-12-31', '2012-01-01']);
  expect(materializeCalendarRecurrence(input).skipped.nonexistentTimes).toBe(1); rejects({ ...input, localStart: '2011-12-30T09:00:00.000' });
});

test('query bounds are nominal dates, not UTC overlap bounds; exact elapsed intervals cross midnight and DST', () => {
  const input = source({ localStart: '2026-01-01T23:30:00.000', durationMilliseconds: 2 * 3_600_000, range: { from: '2026-01-01', until: '2026-01-02' } });
  expect(materializeCalendarRecurrence(input).occurrences[0]!.endAt).toBe('2026-01-02T01:30:00.000Z');
  expect(dates({ ...input, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1 } }, range: { from: '2026-01-02', until: '2026-01-03' } })).toEqual([]);
  const dst = source({ localStart: '2026-03-08T01:30:00.000', timeZone: 'America/New_York', durationMilliseconds: 2 * 3_600_000, range: { from: '2026-03-08', until: '2026-03-09' } });
  const value = materializeCalendarRecurrence(dst).occurrences[0]!;
  expect(value.startAt).toBe('2026-03-08T06:30:00.000Z'); expect(value.endAt).toBe('2026-03-08T08:30:00.000Z');
  expect(Date.parse(value.endAt) - Date.parse(value.startAt)).toBe(2 * 3_600_000);
});

test('DTSTART mismatches reject rather than unconditionally injecting an off-pattern first occurrence', () => {
  for (const rule of [
    { frequency: 'weekly', interval: 1, weekdays: [1], end: { kind: 'never' } },
    { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 2 }, end: { kind: 'never' } },
    { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: -1, weekday: 4 }, end: { kind: 'never' } },
  ] satisfies CalendarRecurrenceRule[]) rejects(source({ rule }));
});

test('output cap reports the first omitted nominal date, and exact-cap completion is not falsely truncated', () => {
  const input = source({ limit: 2, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 4 } }, range: { from: '2026-01-01', until: '2026-01-06' } });
  const result = materializeCalendarRecurrence(input);
  expect(result.occurrences.length).toBe(2); expect(result.truncated).toBe(true); expect(result.truncationReason).toBe('occurrence-limit');
  expect(result.coverage).toEqual({ from: '2026-01-01', until: '2026-01-03' });
  const remainder = materializeCalendarRecurrence({ ...input, range: { from: result.coverage.until, until: input.range.until } });
  expect(remainder.occurrences.map(value => value.localStart.slice(0, 10))).toEqual(['2026-01-03', '2026-01-04']); expect(remainder.truncated).toBe(false);
  const exact = materializeCalendarRecurrence({ ...input, rule: { ...input.rule, end: { kind: 'after', count: 2 } } });
  expect(exact.truncated).toBe(false); expect(exact.coverage).toEqual(input.range);
  const gap = materializeCalendarRecurrence(source({ localStart: '2026-03-07T02:30:00.000', timeZone: 'America/New_York', limit: 1,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 2 } }, range: { from: '2026-03-07', until: '2026-03-11' } }));
  expect(gap.coverage.until).toBe('2026-03-09'); expect(gap.skipped.nonexistentTimes).toBe(1);
});

test('ancient uncounted rules seek directly without scanning history; COUNT prefix work is hard bounded and honest', () => {
  const ancient = source({ localStart: '0000-01-01T09:00:00.000', range: { from: '9999-01-01', until: '9999-01-03' } });
  const current = materializeCalendarRecurrence(ancient);
  expect(current.evaluatedCandidates).toBe(2); expect(current.occurrences.length).toBe(2); expect(current.truncated).toBe(false);
  const ended = materializeCalendarRecurrence({ ...ancient, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } } });
  expect(ended.evaluatedCandidates).toBe(3); expect(ended.occurrences).toEqual([]); expect(ended.coverage).toEqual(ancient.range);
  const bounded = materializeCalendarRecurrence(source({ localStart: '0000-02-29T09:00:00.000',
    rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 999 } }, range: { from: '9000-01-01', until: '9000-02-01' } }));
  expect(bounded.evaluatedCandidates).toBe(CALENDAR_RECURRENCE_MAX_CANDIDATES); expect(bounded.truncationReason).toBe('candidate-limit');
  expect(bounded.occurrences).toEqual([]); expect(bounded.coverage).toEqual({ from: '9000-01-01', until: '9000-01-01' });
});

test('direct seeking agrees with qualified COUNT prefix expansion across intervals and civil pattern boundaries', () => {
  const examples: { start: string; rule: CalendarRecurrenceRule }[] = [
    ...[1, 2, 7, 99].map(interval => ({ start: '2026-01-01', rule: { frequency: 'daily' as const, interval, end: { kind: 'never' as const } } })),
    ...[1, 2, 7].map(interval => ({ start: '2026-01-04', rule: { frequency: 'weekly' as const, interval, weekdays: [0, 1, 3], end: { kind: 'never' as const } } })),
    ...[29, 30, 31].flatMap(day => [1, 2, 7].map(interval => ({ start: `2026-01-${day}`, rule: { frequency: 'monthly' as const, interval,
      pattern: { kind: 'day' as const, day }, end: { kind: 'never' as const } } }))),
    ...[1, 2, 3, 4, -1].map((nth, index) => ({ start: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-01-26'][index]!,
      rule: { frequency: 'monthly' as const, interval: 2, pattern: { kind: 'weekday' as const, ordinal: nth, weekday: 1 }, end: { kind: 'never' as const } } })),
    { start: '2026-03-30', rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: 5, weekday: 1 }, end: { kind: 'never' } } },
    { start: '2024-02-29', rule: { frequency: 'yearly', interval: 1, end: { kind: 'never' } } },
  ];
  for (const example of examples) for (const range of [
    { from: '2026-01-02', until: '2026-01-20' }, { from: '2026-05-13', until: '2026-06-17' }, { from: '2026-11-29', until: '2027-01-02' },
  ]) {
    const input = source({ localStart: example.start + 'T09:00:00.000', rule: example.rule, range, limit: 1000 });
    expect(dates(input)).toEqual(dates({ ...input, rule: { ...example.rule, end: { kind: 'after', count: 999 } } }));
  }
});

test('supported maximum calendar year and empty ranges around series bounds never loop or overflow', () => {
  for (const rule of [
    { frequency: 'daily', interval: 99, end: { kind: 'never' } },
    { frequency: 'weekly', interval: 99, weekdays: [0], end: { kind: 'never' } },
    { frequency: 'monthly', interval: 99, pattern: { kind: 'day', day: 31 }, end: { kind: 'never' } },
    { frequency: 'yearly', interval: 99, end: { kind: 'never' } },
  ] satisfies CalendarRecurrenceRule[]) {
    const localStart = '9999-10-31T09:00:00.000';
    const result = materializeCalendarRecurrence(source({ localStart, rule, range: { from: '9999-10-01', until: '9999-12-31' } }));
    expect(result.occurrences.length).toBe(1); expect(result.truncated).toBe(false);
  }
  expect(dates(source({ localStart: '2026-02-01T09:00:00.000' }))).toEqual([]);
});

test('year-zero weekly Monday anchors in the preceding ISO year without counting or emitting pre-DTSTART dates', () => {
  const rule: CalendarRecurrenceRule = { frequency: 'weekly', interval: 1, weekdays: [6, 1], end: { kind: 'after', count: 4 } };
  const input = source({ localStart: '0000-01-01T09:00:00.000', rule, range: { from: '0000-01-01', until: '0000-01-15' } });
  expect(dates(input)).toEqual(['0000-01-01', '0000-01-03', '0000-01-08', '0000-01-10']);
  expect(materializeCalendarRecurrence(input).truncated).toBe(false);
  const biweekly = { ...input, rule: { ...rule, interval: 2 }, range: { from: '0000-01-01', until: '0000-01-25' } };
  expect(dates(biweekly)).toEqual(['0000-01-01', '0000-01-10', '0000-01-15', '0000-01-24']);
  const later = { ...biweekly, range: { from: '0000-01-02', until: '0000-01-20' } };
  expect(dates(later)).toEqual(['0000-01-10', '0000-01-15']);
  expect(dates({ ...later, rule: { ...later.rule, end: { kind: 'never' } } })).toEqual(dates(later));
});

test('UTC boundary years use the existing signed-six-digit Calendar vocabulary while nominal source dates stay four-digit', () => {
  const upper = materializeCalendarRecurrence(source({ localStart: '9999-12-30T23:30:00.000', durationMilliseconds: 2 * 86_400_000,
    range: { from: '9999-12-30', until: '9999-12-31' }, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1 } } })).occurrences[0]!;
  expect(upper.endAt).toBe('+010000-01-01T23:30:00.000Z');
  const lower = materializeCalendarRecurrence(source({ localStart: '0000-01-01T00:30:00.000', timeZone: 'Etc/GMT-14',
    range: { from: '0000-01-01', until: '0000-01-02' }, rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1 } } })).occurrences[0]!;
  expect(lower.startAt).toBe('-000001-12-31T10:30:00.000Z'); expect(lower.nominalKey).toBe('timed-v1:0000-01-01T00:30:00.000');
  for (const occurrence of [upper, lower]) {
    expect(normalizeCalendarInstant(occurrence.startAt)).toBe(occurrence.startAt); expect(normalizeCalendarInstant(occurrence.endAt)).toBe(occurrence.endAt);
    const canonical = normalizeCalendarTimedInterval({ startAt: occurrence.startAt, endAt: occurrence.endAt, timeZone: occurrence.timeZone });
    expect(canonical.startAt).toBe(occurrence.startAt); expect(canonical.endAt).toBe(occurrence.endAt);
  }
  rejects(source({ localStart: '+010000-01-01T09:00:00.000' }));
  rejects(source({ range: { from: '9999-12-31', until: '+010000-01-01' } }));
});

test('exhausted COUNT proves later empty coverage, but a capped unqualified prefix never masquerades as exhaustion', () => {
  const distant = source({ localStart: '0000-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 994 } },
    range: { from: '9000-01-01', until: '9000-02-01' } });
  const exhausted = materializeCalendarRecurrence(distant);
  expect(exhausted.occurrences).toEqual([]); expect(exhausted.truncated).toBe(false); expect(exhausted.coverage).toEqual(distant.range);
  expect(exhausted.evaluatedCandidates).toBeLessThan(CALENDAR_RECURRENCE_MAX_CANDIDATES);
  const unqualified = materializeCalendarRecurrence({ ...distant, rule: { ...distant.rule, end: { kind: 'after', count: 995 } } });
  expect(unqualified.occurrences).toEqual([]); expect(unqualified.truncated).toBe(true); expect(unqualified.truncationReason).toBe('candidate-limit');
  expect(unqualified.evaluatedCandidates).toBe(CALENDAR_RECURRENCE_MAX_CANDIDATES);
  expect(unqualified.coverage).toEqual({ from: distant.range.from, until: distant.range.from });
  const before = materializeCalendarRecurrence(source({ localStart: '0001-01-01T09:00:00.000', rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 999 } },
    range: { from: '0000-01-01', until: '0001-01-01' } }));
  expect(before.occurrences).toEqual([]); expect(before.truncated).toBe(false); expect(before.evaluatedCandidates).toBe(0);
  expect(before.coverage).toEqual({ from: '0000-01-01', until: '0001-01-01' });
});

test('candidate cap preserves the fully evaluated nominal prefix and range-end proof takes precedence over truncation', () => {
  const input = source({ localStart: '0000-02-29T09:00:00.000', rule: { frequency: 'yearly', interval: 1, end: { kind: 'after', count: 999 } },
    range: { from: '4095-03-01', until: '4096-03-01' } });
  const prefix = materializeCalendarRecurrence(input);
  expect(prefix.evaluatedCandidates).toBe(CALENDAR_RECURRENCE_MAX_CANDIDATES); expect(prefix.truncationReason).toBe('candidate-limit');
  expect(prefix.coverage).toEqual({ from: '4095-03-01', until: '4096-02-29' }); expect(prefix.occurrences).toEqual([]);
  const beforeNext = materializeCalendarRecurrence({ ...input, range: { from: '4096-02-01', until: '4096-02-15' } });
  expect(beforeNext.evaluatedCandidates).toBe(CALENDAR_RECURRENCE_MAX_CANDIDATES); expect(beforeNext.truncated).toBe(false);
  expect(beforeNext.occurrences).toEqual([]); expect(beforeNext.coverage).toEqual(beforeNext.requestedRange);
  const exactPeriodEnd = materializeCalendarRecurrence({ ...input, range: { from: '4095-02-01', until: '4096-02-01' } });
  expect(exactPeriodEnd.truncated).toBe(false); expect(exactPeriodEnd.coverage).toEqual(exactPeriodEnd.requestedRange);
});

test('range, output, interval, source-date/time and dialect budgets reject malformed or unsupported inputs with static errors', () => {
  expect(CALENDAR_RECURRENCE_MAX_RANGE_DAYS).toBe(366); expect(CALENDAR_RECURRENCE_MAX_OCCURRENCES).toBe(1000);
  for (const patch of [
    { kind: 'all-day-v1' }, { allDay: true }, { localStart: '2026-02-30T09:00:00.000' }, { localStart: '2026-01-01' },
    { localStart: '2026-01-01T24:00:00.000' }, { localStart: '2026-01-01T09:00:60.000' }, { localStart: '2026-01-01T09:00:00.000Z' },
    { localStart: '2026-01-01T09:00:00' }, { localStart: '2026-01-01T09:00:00.000[UTC]' }, { timeZone: '+05:45' },
    { timeZone: 'Not/A_Zone' }, { timeZone: '' }, { durationMilliseconds: 0 }, { durationMilliseconds: 31 * 86_400_000 + 1 },
    { durationMilliseconds: 1.5 }, { limit: 0 }, { limit: 1001 }, { limit: NaN }, { rule: 'FREQ=DAILY' },
    { range: { from: '2026-01-01', until: '2026-01-01' } }, { range: { from: '2026-01-01', until: '2027-01-03' } },
    { range: { from: '2026-01-01', until: '2026-01-05', zone: 'UTC' } },
  ]) rejects({ ...source(), ...patch });
  for (const rule of [
    { frequency: 'hourly', interval: 1, end: { kind: 'never' } },
    { frequency: 'daily', interval: 0, end: { kind: 'never' } }, { frequency: 'daily', interval: 100, end: { kind: 'never' } },
    { frequency: 'daily', interval: 1, end: { kind: 'after', count: 1000 } },
    { frequency: 'daily', interval: 1, end: { kind: 'on', date: '2026-01-03', count: 3 } },
    { frequency: 'daily', interval: 1, end: { kind: 'never' }, BYMONTH: [1] },
    { frequency: 'weekly', interval: 1, weekdays: [], end: { kind: 'never' } },
    { frequency: 'weekly', interval: 1, weekdays: [4, 4], end: { kind: 'never' } },
    { frequency: 'weekly', interval: 1, weekdays: [7], end: { kind: 'never' } },
    { frequency: 'weekly', interval: 1, weekdays: [4], weekStart: 0, end: { kind: 'never' } },
    ...[0, 6, -2].map(ordinal => ({ frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal, weekday: 4 }, end: { kind: 'never' } })),
  ]) rejects({ ...source(), rule });
});

test('descriptor admission never executes accessors or accepts cycles, prototypes and malformed containers', () => {
  let called = false;
  const value = { ...source() }; Object.defineProperty(value, 'localStart', { enumerable: true, get() { called = true; throw new Error('private-diagnostic'); } });
  rejects(value); expect(called).toBe(false);
  const rule = Object.create({ frequency: 'daily' }); Object.assign(rule, { interval: 1, end: { kind: 'never' } }); rejects({ ...source(), rule });
  const cycle: Record<string, unknown> = {}; cycle.rule = cycle; rejects({ ...source(), rule: cycle });
  const huge = Array.from({ length: 10_001 }, () => 4); rejects({ ...source(), rule: { frequency: 'weekly', interval: 1, weekdays: huge, end: { kind: 'never' } } });
});

test('native Temporal absence and private runtime diagnostics fail safely and globals are restored', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    for (const value of [undefined, {}, { PlainDate: { from: 1 } }]) {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, value }); rejects(source(), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    }
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('private-diagnostic'); } });
    rejects(source(), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: { PlainDate: { from() { throw new Error('private-diagnostic'); } }, ZonedDateTime: { from() {} } } });
    rejects(source(), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  expect(materializeCalendarRecurrence(source()).occurrences.length).toBe(4);
});
