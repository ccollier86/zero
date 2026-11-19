/** Pure MEMORY conversion/admission only. No runtime, files, actors or booking writes. */
import { expect, test } from 'bun:test';
import { normalizeCalendarAllDayInterval } from './all-day-time';
import { normalizeCalendarTimedInterval, normalizeCalendarTimeZone, calendarOverlapSearchStart } from './time';

const DAY = 86_400_000;
const input = (startDate = '2026-11-18', endDate = '2026-11-19', timeZone = 'UTC') => ({
  kind: 'all-day-local-v1' as const, startDate, endDate, timeZone });
const hours = (start: string, end: string, zone: string) => {
  const value = normalizeCalendarAllDayInterval(input(start, end, zone));
  return (value.endMs - value.startMs) / 3_600_000;
};

test('a frozen LocalDate authority has separate derived occupancy and honest conversion provenance', () => {
  const authored = input(), value = normalizeCalendarAllDayInterval(authored);
  expect(value).toMatchObject({ ...authored, dayCount: 1, startAt: '2026-11-18T00:00:00.000Z', endAt: '2026-11-19T00:00:00.000Z',
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, engine: { name: 'temporal-all-day-v1' } });
  expect(value.occupiedStartMs).toBe(value.startMs); expect(value.occupiedEndMs).toBe(value.endMs);
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.engine)).toBe(true);
  expect(value.engine.runtime).toMatch(/^(bun:|node:|unknown$)/); expect(typeof value.engine.icu).toBe('string');
  authored.startDate = '2027-01-01'; expect(value.startDate).toBe('2026-11-18');
  for (const key of ['actor', 'scope', 'resourceIds', 'allowed', 'ready', 'tzdbVersion']) expect(value).not.toHaveProperty(key);
  expect(() => normalizeCalendarTimedInterval(value)).toThrow();
});

test('23/25-hour New York dates and 23.5/24.5-hour Lord Howe dates are not 24-hour multiplication', () => {
  expect(hours('2026-03-08', '2026-03-09', 'America/New_York')).toBe(23);
  expect(hours('2026-11-01', '2026-11-02', 'America/New_York')).toBe(25);
  expect(hours('2026-10-04', '2026-10-05', 'Australia/Lord_Howe')).toBe(23.5);
  expect(hours('2026-04-05', '2026-04-06', 'Australia/Lord_Howe')).toBe(24.5);
});

test('a midnight gap uses the first valid instant of that same day, not a guessed midnight or blanket gap rejection', () => {
  const value = normalizeCalendarAllDayInterval(input('2018-11-04', '2018-11-05', 'America/Sao_Paulo'));
  expect(value.startAt).toBe('2018-11-04T03:00:00.000Z'); expect(value.endAt).toBe('2018-11-05T02:00:00.000Z');
  expect((value.endMs - value.startMs) / 3_600_000).toBe(23); expect(value.startDate).toBe('2018-11-04');
});

test('a repeated midnight begins at its first occurrence and occupies both repeated hours', () => {
  const value = normalizeCalendarAllDayInterval(input('2026-10-25', '2026-10-26', 'Atlantic/Azores'));
  expect(value.startAt).toBe('2026-10-25T00:00:00.000Z'); expect(value.endAt).toBe('2026-10-26T01:00:00.000Z');
  expect(value.endMs - value.startMs).toBe(25 * 3_600_000);
});

test('wholly missing Apia boundary dates reject roundtrip; interior skipped dates remain nominal date facts', () => {
  for (const value of [input('2011-12-30', '2011-12-31', 'Pacific/Apia'), input('2011-12-29', '2011-12-30', 'Pacific/Apia')]) {
    expect(() => normalizeCalendarAllDayInterval(value)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  }
  const spanning = normalizeCalendarAllDayInterval(input('2011-12-29', '2011-12-31', 'Pacific/Apia'));
  expect(spanning.dayCount).toBe(2); expect(spanning.startDate).toBe('2011-12-29'); expect(spanning.endDate).toBe('2011-12-31');
  expect(spanning.endMs - spanning.startMs).toBe(DAY);
});

test('31 Gregorian dates crossing fall-back stay admitted above31 elapsed days but inside the unchanged33-day lookback', () => {
  const value = normalizeCalendarAllDayInterval(input('2026-10-15', '2026-11-15', 'America/New_York'));
  expect(value.dayCount).toBe(31); expect(value.endMs - value.startMs).toBe(31 * DAY + 3_600_000);
  expect(value.endMs - value.startMs).toBeLessThanOrEqual(33 * DAY);
  // A query at the final occupied millisecond must still inspect this reservation's start.
  expect(calendarOverlapSearchStart(value.endMs - 1)).toBeLessThanOrEqual(value.startMs);
  expect(() => normalizeCalendarAllDayInterval(input('2026-10-15', '2026-11-16', 'America/New_York'))).toThrow();
});

test('strict Gregorian leap dates and four-digit exclusive year bounds never clip a final day', () => {
  expect(normalizeCalendarAllDayInterval(input('2024-02-28', '2024-03-01')).dayCount).toBe(2);
  expect(normalizeCalendarAllDayInterval(input('0000-02-28', '0000-03-01')).dayCount).toBe(2);
  expect(normalizeCalendarAllDayInterval(input('9999-12-30', '9999-12-31')).endAt).toBe('9999-12-31T00:00:00.000Z');
  for (const value of [input('2023-02-29', '2023-03-01'), input('1900-02-29', '1900-03-01'), input('9999-12-31', '+010000-01-01'),
    input('0000-01-01', '0000-01-01'), input('2026-02-01', '2026-01-31'), input('2026-01-32', '2026-02-02')]) {
    expect(() => normalizeCalendarAllDayInterval(value)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  }
});

test('non-hour zones and explicit aliases normalize without borrowing the host or viewer timezone', () => {
  const value = normalizeCalendarAllDayInterval(input('2026-11-18', '2026-11-19', 'Asia/Kathmandu'));
  expect(value.startAt).toBe('2026-11-17T18:15:00.000Z'); expect(value.endAt).toBe('2026-11-18T18:15:00.000Z');
  const alias = normalizeCalendarAllDayInterval(input('2026-11-18', '2026-11-19', 'Etc/UTC'));
  expect(alias.timeZone).toBe(normalizeCalendarTimeZone('Etc/UTC')); expect(alias.startAt).toBe('2026-11-18T00:00:00.000Z');
  for (const timeZone of [undefined, null, '', '+05:45', 'Invalid/Zone']) expect(() => normalizeCalendarAllDayInterval({ ...input(), timeZone })).toThrow();
});

test('closed own-data input rejects getters, proxies, undefined, mixed timed/buffer fields and executable objects without invoking them', () => {
  let calls = 0;
  const getter = { ...input() }; Object.defineProperty(getter, 'startDate', { enumerable: true, get() { calls++; return '2026-11-18'; } });
  for (const value of [getter, new Proxy(input(), {}), { ...input(), extra: true }, { ...input(), endDate: undefined }, { ...input(), bufferBeforeMinutes: 0 },
    { ...input(), startAt: '2026-11-18T00:00:00.000Z' }, { ...input(), toJSON() { calls++; return input(); } },
    { ...input(), startDate: '2026-11-18T00:00:00Z' }, { ...input(), kind: 'timed-local-v1' }, [], null, true]) {
    expect(() => normalizeCalendarAllDayInterval(value)).toThrow(expect.objectContaining({ code: 'CALENDAR_INPUT_INVALID' }));
  }
  expect(calls).toBe(0);
});

test('absent/incomplete or throwing native Temporal refuses conversion without fallback, restoring the original runtime in finally', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    for (const value of [undefined, {}, { PlainDate: { from() { throw new Error('unavailable'); } } }]) {
      Object.defineProperty(globalThis, 'Temporal', { configurable: true, writable: true, value });
      expect(() => normalizeCalendarAllDayInterval(input())).toThrow(expect.objectContaining({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' }));
    }
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('unavailable'); } });
    expect(() => normalizeCalendarAllDayInterval(input())).toThrow(expect.objectContaining({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
  }
});
