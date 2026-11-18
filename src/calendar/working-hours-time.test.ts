/** Native Temporal policy-write tests only; no files, databases, processes, actors or timers are allocated. */
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import type { CalendarWeeklyAvailabilityPolicyInput } from './working-hours-contracts';
import { materializeCalendarWorkingHours } from './working-hours-time';

const weekly = (from: string, until: string, startMinute: number, endMinute: number, fold: 'earlier' | 'later' = 'earlier'): CalendarWeeklyAvailabilityPolicyInput => ({
  kind: 'weekly-local-v1', coverage: { from, until }, fold,
  weekly: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, windows: [{ startMinute, endMinute }] })), overrides: [],
});
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID'): void {
  try { run(); throw new Error('accepted invalid policy'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); }
}

test('snapshot is detached/deep-frozen UTC data and records runtime plus ICU provenance, not a tzdb pin', () => {
  const source = weekly('2026-11-02', '2026-11-03', 540, 1020);
  const result = materializeCalendarWorkingHours(source, 'America/New_York');
  expect(result).toEqual({ coverage: { startAt: '2026-11-02T05:00:00.000Z', endAt: '2026-11-03T05:00:00.000Z' },
    windows: [{ startAt: '2026-11-02T14:00:00.000Z', endAt: '2026-11-02T22:00:00.000Z' }],
    engine: { name: 'temporal-working-hours-v1', runtime: `bun:${Bun.version}`, icu: process.versions.icu ?? 'unknown' }, skippedDates: [] });
  for (const value of [result, result.coverage, result.windows, result.windows[0], result.engine, result.skippedDates]) expect(Object.isFrozen(value)).toBe(true);
  expect(Object.hasOwn(result.engine, 'tzdb')).toBe(false);
});

test('generated New York gap boundaries skip whole windows with nominal-date diagnostics and never shift', () => {
  for (const fold of ['earlier', 'later'] as const) {
    const result = materializeCalendarWorkingHours(weekly('2026-03-08', '2026-03-09', 150, 240, fold), 'America/New_York');
    expect(result.windows).toEqual([]); expect(result.skippedDates).toEqual(['2026-03-08']);
    expect(result.coverage).toEqual({ startAt: '2026-03-08T05:00:00.000Z', endAt: '2026-03-09T04:00:00.000Z' });
  }
  expect(materializeCalendarWorkingHours(weekly('2026-03-08', '2026-03-09', 60, 240), 'America/New_York').windows)
    .toEqual([{ startAt: '2026-03-08T06:00:00.000Z', endAt: '2026-03-08T08:00:00.000Z' }]);
});

test('authored override gaps reject correction rather than accepting a shifted or skipped override', () => {
  const source = { ...weekly('2026-03-08', '2026-03-09', 540, 1020), overrides: [{ date: '2026-03-08', windows: [{ startMinute: 150, endMinute: 240 }] }] };
  rejects(() => materializeCalendarWorkingHours(source, 'America/New_York'));
  rejects(() => materializeCalendarWorkingHours({ ...source, overrides: [{ date: '2026-03-08', windows: [{ startMinute: 60, endMinute: 150 }] }] }, 'America/New_York'));
});

test('explicit fold choices select distinct repeated boundaries and spanning folds retain elapsed UTC time', () => {
  expect(materializeCalendarWorkingHours(weekly('2026-11-01', '2026-11-02', 90, 105, 'earlier'), 'America/New_York').windows)
    .toEqual([{ startAt: '2026-11-01T05:30:00.000Z', endAt: '2026-11-01T05:45:00.000Z' }]);
  expect(materializeCalendarWorkingHours(weekly('2026-11-01', '2026-11-02', 90, 105, 'later'), 'America/New_York').windows)
    .toEqual([{ startAt: '2026-11-01T06:30:00.000Z', endAt: '2026-11-01T06:45:00.000Z' }]);
  const span = materializeCalendarWorkingHours(weekly('2026-11-01', '2026-11-02', 0, 180), 'America/New_York');
  expect(Date.parse(span.windows[0]!.endAt) - Date.parse(span.windows[0]!.startAt)).toBe(4 * 3_600_000);
  expect(materializeCalendarWorkingHours({ ...weekly('2026-11-01', '2026-11-02', 540, 1020, 'later'),
    overrides: [{ date: '2026-11-01', windows: [{ startMinute: 90, endMinute: 105 }] }] }, 'America/New_York').windows)
    .toEqual([{ startAt: '2026-11-01T06:30:00.000Z', endAt: '2026-11-01T06:45:00.000Z' }]);
});

test('Lord Howe non-hour gap and fold use real zone transitions', () => {
  const gap = materializeCalendarWorkingHours(weekly('2026-10-04', '2026-10-05', 135, 180), 'Australia/Lord_Howe');
  expect(gap.windows).toEqual([]); expect(gap.skippedDates).toEqual(['2026-10-04']);
  const early = materializeCalendarWorkingHours(weekly('2026-04-05', '2026-04-06', 105, 110, 'earlier'), 'Australia/Lord_Howe');
  const late = materializeCalendarWorkingHours(weekly('2026-04-05', '2026-04-06', 105, 110, 'later'), 'Australia/Lord_Howe');
  expect(Date.parse(late.windows[0]!.startAt) - Date.parse(early.windows[0]!.startAt)).toBe(30 * 60_000);
});

test('civil coverage starts at actual day start when midnight is missing and rejects wholly absent boundary dates', () => {
  const result = materializeCalendarWorkingHours(weekly('2018-11-04', '2018-11-05', 60, 120), 'America/Sao_Paulo');
  expect(result.coverage).toEqual({ startAt: '2018-11-04T03:00:00.000Z', endAt: '2018-11-05T02:00:00.000Z' });
  rejects(() => materializeCalendarWorkingHours(weekly('2011-12-30', '2011-12-31', 540, 1020), 'Pacific/Apia'));
  rejects(() => materializeCalendarWorkingHours(weekly('2011-12-29', '2011-12-30', 540, 1020), 'Pacific/Apia'));
  const skipped = materializeCalendarWorkingHours(weekly('2011-12-29', '2012-01-01', 540, 1020), 'Pacific/Apia');
  expect(skipped.skippedDates).toEqual(['2011-12-30']); expect(skipped.windows.length).toBe(2);
  rejects(() => materializeCalendarWorkingHours({ ...weekly('2011-12-29', '2012-01-01', 540, 1020), overrides: [{ date: '2011-12-30', windows: [{ startMinute: 540, endMinute: 1020 }] }] }, 'Pacific/Apia'));
});

test('date overrides replace a full day, explicit split overnight hours honor holiday closure, and UTC adjacency merges', () => {
  const result = materializeCalendarWorkingHours({ ...weekly('2026-12-24', '2026-12-27', 0, 1440), overrides: [{ date: '2026-12-25', windows: [] }] }, 'UTC');
  expect(result.windows).toEqual([{ startAt: '2026-12-24T00:00:00.000Z', endAt: '2026-12-25T00:00:00.000Z' },
    { startAt: '2026-12-26T00:00:00.000Z', endAt: '2026-12-27T00:00:00.000Z' }]);
  const overnight: CalendarWeeklyAvailabilityPolicyInput = { kind: 'weekly-local-v1', coverage: { from: '2026-12-24', until: '2026-12-26' }, fold: 'earlier',
    weekly: [{ day: 4, windows: [{ startMinute: 1320, endMinute: 1440 }] }, { day: 5, windows: [{ startMinute: 0, endMinute: 120 }] }], overrides: [] };
  expect(materializeCalendarWorkingHours(overnight, 'UTC').windows).toEqual([{ startAt: '2026-12-24T22:00:00.000Z', endAt: '2026-12-25T02:00:00.000Z' }]);
  expect(materializeCalendarWorkingHours({ ...overnight, overrides: [{ date: '2026-12-25', windows: [] }] }, 'UTC').windows)
    .toEqual([{ startAt: '2026-12-24T22:00:00.000Z', endAt: '2026-12-25T00:00:00.000Z' }]);
});

test('leap dates, year 0000, non-hour offsets and endMinute1440 remain exact', () => {
  expect(materializeCalendarWorkingHours(weekly('2024-02-28', '2024-03-01', 0, 1440), 'UTC').windows)
    .toEqual([{ startAt: '2024-02-28T00:00:00.000Z', endAt: '2024-03-01T00:00:00.000Z' }]);
  expect(materializeCalendarWorkingHours(weekly('0000-02-29', '0000-03-01', 0, 1440), 'UTC').windows)
    .toEqual([{ startAt: '0000-02-29T00:00:00.000Z', endAt: '0000-03-01T00:00:00.000Z' }]);
  expect(materializeCalendarWorkingHours(weekly('2026-01-01', '2026-01-02', 0, 60), 'Asia/Kathmandu').windows)
    .toEqual([{ startAt: '2025-12-31T18:15:00.000Z', endAt: '2025-12-31T19:15:00.000Z' }]);
});

test('more than 1024 generated windows fails without truncating, even with finite source and coverage', () => {
  const source = { ...weekly('2024-01-01', '2025-01-01', 0, 60), weekly: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
    windows: [{ startMinute: 0, endMinute: 60 }, { startMinute: 120, endMinute: 180 }, { startMinute: 240, endMinute: 300 }] })) };
  rejects(() => materializeCalendarWorkingHours(source, 'UTC'));
  const accepted = materializeCalendarWorkingHours({ ...source, coverage: { from: '2024-01-01', until: '2024-12-07' } }, 'UTC');
  expect(accepted.windows.length).toBe(1023);
  const exact = materializeCalendarWorkingHours({ ...source, coverage: { from: '2024-01-01', until: '2024-12-08' },
    overrides: [{ date: '2024-12-07', windows: [{ startMinute: 0, endMinute: 60 }] }] }, 'UTC');
  expect(exact.windows.length).toBe(1024);
  // Cross-date adjacency would merge 1098 generated intervals to 733. The pre-merge budget must still reject it.
  rejects(() => materializeCalendarWorkingHours({ ...source, weekly: source.weekly.map(day => ({ ...day,
    windows: [{ startMinute: 0, endMinute: 60 }, { startMinute: 120, endMinute: 180 }, { startMinute: 240, endMinute: 1440 }] })) }, 'UTC'));
});

test('missing/malformed native Temporal fails safely and globals are restored; explicit sources are not expanded', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    for (const value of [undefined, {}, { PlainDate: { from: 1 } }]) {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, value });
      rejects(() => materializeCalendarWorkingHours(weekly('2026-01-01', '2026-01-02', 0, 60), 'UTC'), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    }
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('private runtime diagnostic'); } });
    rejects(() => materializeCalendarWorkingHours(weekly('2026-01-01', '2026-01-02', 0, 60), 'UTC'), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  expect(materializeCalendarWorkingHours(weekly('2026-01-01', '2026-01-02', 0, 60), 'UTC').windows.length).toBe(1);
  for (const timeZone of ['', '+05:45', '-04:00', 'Not/A_Zone', ' UTC']) rejects(() => materializeCalendarWorkingHours(weekly('2026-01-01', '2026-01-02', 0, 60), timeZone));
  rejects(() => materializeCalendarWorkingHours({ kind: 'explicit-utc-v1', mode: 'windows', windows: [] } as unknown as CalendarWeeklyAvailabilityPolicyInput, 'UTC'));
});
