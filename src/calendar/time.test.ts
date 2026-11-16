/** Memory-only admission tests; no files, fixtures, databases, dependencies, actors, servers or timers are allocated. */
import { expect, test } from 'bun:test';
import { CalendarError } from './error';
import { calendarIntervalsConflict, normalizeCalendarInstant, normalizeCalendarTimedInterval, normalizeCalendarTimeZone } from './time';

const startAt = '2026-11-16T10:00:00.000Z';
const endAt = '2026-11-16T11:00:00.000Z';
const interval = { startAt, endAt, timeZone: 'America/New_York' };

function invalid(run: () => unknown): void {
  expect(run).toThrow(CalendarError);
  try { run(); } catch (error) { expect((error as CalendarError).code).toBe('CALENDAR_INPUT_INVALID'); }
}

test('instants preserve exact canonical UTC milliseconds and normalize finite integer epoch milliseconds', () => {
  for (const text of [startAt, '2024-02-29T23:59:59.999Z', '0000-01-01T00:00:00.000Z', '+010000-01-01T00:00:00.000Z', '-000001-01-01T00:00:00.000Z']) {
    expect(normalizeCalendarInstant(text)).toBe(text);
    expect(normalizeCalendarInstant(Date.parse(text))).toBe(text);
  }
  expect(normalizeCalendarInstant(0)).toBe('1970-01-01T00:00:00.000Z');
  expect(normalizeCalendarInstant(-1)).toBe('1969-12-31T23:59:59.999Z');
  for (const ms of [-8_640_000_000_000_000, 8_640_000_000_000_000]) {
    expect(normalizeCalendarInstant(ms)).toBe(new Date(ms).toISOString());
  }
});

test('instant admission rejects offsets, implicit precision, invalid leap dates, leap seconds and normalization', () => {
  for (const text of [
    '2026-11-16T10:00:00Z', '2026-11-16T10:00:00.00Z', '2026-11-16T10:00:00.0000Z',
    '2026-11-16T10:00:00.000+00:00', '2026-11-16T10:00:00.000-05:00', '2026-11-16T10:00:00.000z',
    '2026-11-16 10:00:00.000Z', '2026-11-16T10:00:00.000', '2026-11-16',
    '2023-02-29T10:00:00.000Z', '1900-02-29T10:00:00.000Z', '2026-04-31T10:00:00.000Z',
    '2026-13-01T10:00:00.000Z', '2026-01-00T10:00:00.000Z', '2026-01-01T24:00:00.000Z',
    '2026-01-01T23:59:60.000Z', '+002026-11-16T10:00:00.000Z', '-000000-01-01T00:00:00.000Z',
    ' 2026-11-16T10:00:00.000Z', '2026-11-16T10:00:00.000Z\n',
  ]) invalid(() => normalizeCalendarInstant(text));
});

test('instant admission rejects unsafe or out-of-Date-range numbers and never coerces objects', () => {
  for (const input of [NaN, Infinity, -Infinity, 0.1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
    8_640_000_000_000_001, -8_640_000_000_000_001, null, undefined, true, 0n, new Date(startAt),
    { toString() { throw new Error('must not run'); }, valueOf() { throw new Error('must not run'); } }]) {
    invalid(() => normalizeCalendarInstant(input));
  }
});

test('scheduling zones are explicit runtime-supported IANA names, with aliases normalized', () => {
  for (const timeZone of ['UTC', 'America/New_York', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'US/Eastern']) {
    expect(normalizeCalendarTimeZone(timeZone)).toBe(new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone);
  }
  for (const input of [undefined, null, '', ' ', 'Not/A_Zone', '+05:45', '-04:00', '+00:00', 'UTC+05:00', ' UTC', 'UTC\n', 0,
    { toString() { throw new Error('must not run'); } }]) invalid(() => normalizeCalendarTimeZone(input));
});

test('timed intervals detach and freeze canonical instants, zone and bounded buffers', () => {
  const input = { ...interval, startAt: Date.parse(startAt), bufferBeforeMinutes: 15, bufferAfterMinutes: 30 };
  const result = normalizeCalendarTimedInterval(input);
  expect(result).toEqual({
    ...interval, startMs: Date.parse(startAt), endMs: Date.parse(endAt), bufferBeforeMinutes: 15, bufferAfterMinutes: 30,
    occupiedStartMs: Date.parse(startAt) - 15 * 60_000, occupiedEndMs: Date.parse(endAt) + 30 * 60_000,
  });
  expect(Object.isFrozen(result)).toBe(true);
  input.bufferBeforeMinutes = 60;
  expect(result.bufferBeforeMinutes).toBe(15);
  expect(normalizeCalendarTimedInterval(interval)).toMatchObject({ bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
});

test('duration is positive and bounded at exactly 31 days without imposing display hours or a 15-minute grid', () => {
  const startMs = Date.parse(startAt);
  expect(normalizeCalendarTimedInterval({ ...interval, endAt: startMs + 1 }).endMs).toBe(startMs + 1);
  expect(normalizeCalendarTimedInterval({ ...interval, endAt: startMs + 31 * 86_400_000 }).endMs).toBe(startMs + 31 * 86_400_000);
  expect(normalizeCalendarTimedInterval({ ...interval, startAt: '2026-11-16T23:57:13.123Z', endAt: '2026-11-17T00:03:27.456Z' }).endAt)
    .toBe('2026-11-17T00:03:27.456Z');
  for (const end of [startMs, startMs - 1, startMs + 31 * 86_400_000 + 1]) invalid(() => normalizeCalendarTimedInterval({ ...interval, endAt: end }));
  invalid(() => normalizeCalendarTimedInterval({ ...interval, startAt: -8_640_000_000_000_000, endAt: 8_640_000_000_000_000 }));
});

test('buffer limits and extension arithmetic reject invalid values and Date-range overflow', () => {
  expect(normalizeCalendarTimedInterval({ ...interval, bufferBeforeMinutes: 1_440, bufferAfterMinutes: 1_440 })).toMatchObject({
    occupiedStartMs: Date.parse(startAt) - 86_400_000, occupiedEndMs: Date.parse(endAt) + 86_400_000,
  });
  for (const field of ['bufferBeforeMinutes', 'bufferAfterMinutes']) {
    for (const value of [-1, 1_441, 0.5, NaN, Infinity, '15', null]) invalid(() => normalizeCalendarTimedInterval({ ...interval, [field]: value }));
  }
  invalid(() => normalizeCalendarTimedInterval({ startAt: -8_640_000_000_000_000, endAt: -8_640_000_000_000_000 + 1, timeZone: 'UTC', bufferBeforeMinutes: 1 }));
  invalid(() => normalizeCalendarTimedInterval({ startAt: 8_640_000_000_000_000 - 1, endAt: 8_640_000_000_000_000, timeZone: 'UTC', bufferAfterMinutes: 1 }));
});

test('interval shape rejects missing/unknown semantics, accessors and hostile proxies without running getters', () => {
  for (const input of [null, [], new Date(), {}, { ...interval, timeZone: undefined }, { ...interval, allDay: true }, { ...interval, recurrence: 'daily' }]) {
    invalid(() => normalizeCalendarTimedInterval(input));
  }
  let reads = 0;
  const accessor = { ...interval };
  Object.defineProperty(accessor, 'startAt', { enumerable: true, get() { reads++; throw new Error('must not run'); } });
  invalid(() => normalizeCalendarTimedInterval(accessor));
  expect(reads).toBe(0);
  for (const input of [new Proxy(interval, { ownKeys() { throw new Error('private proxy error'); } }),
    new Proxy(interval, { getOwnPropertyDescriptor() { throw new Error('private proxy error'); } }),
    new Proxy(interval, { getPrototypeOf() { throw new Error('private proxy error'); } })]) invalid(() => normalizeCalendarTimedInterval(input));
  const revoked = Proxy.revocable(interval, {}); revoked.revoke();
  invalid(() => normalizeCalendarTimedInterval(revoked.proxy));
});

test('conflicts use symmetric half-open buffered occupancy, allowing exact adjacency', () => {
  const left = normalizeCalendarTimedInterval(interval);
  const adjacent = normalizeCalendarTimedInterval({ ...interval, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z' });
  expect(calendarIntervalsConflict(left, adjacent)).toBe(false);
  expect(calendarIntervalsConflict(adjacent, left)).toBe(false);
  expect(calendarIntervalsConflict(left, left)).toBe(true);
  const overlapping = normalizeCalendarTimedInterval({ ...interval, startAt: Date.parse(endAt) - 1, endAt: Date.parse(endAt) + 1 });
  expect(calendarIntervalsConflict(left, overlapping)).toBe(true);
  expect(calendarIntervalsConflict(overlapping, left)).toBe(true);
  const beforeBuffer = normalizeCalendarTimedInterval({ ...interval, startAt: endAt, endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 1 });
  expect(calendarIntervalsConflict(left, beforeBuffer)).toBe(true);
  const afterBuffer = normalizeCalendarTimedInterval({ ...interval, bufferAfterMinutes: 15 });
  const exactBufferEnd = normalizeCalendarTimedInterval({ ...interval, startAt: '2026-11-16T11:15:00.000Z', endAt: '2026-11-16T12:00:00.000Z' });
  expect(calendarIntervalsConflict(afterBuffer, exactBufferEnd)).toBe(false);
  const combinedBoundary = normalizeCalendarTimedInterval({ ...interval, startAt: '2026-11-16T11:30:00.000Z', endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 15 });
  expect(calendarIntervalsConflict(afterBuffer, combinedBoundary)).toBe(false);
  expect(calendarIntervalsConflict(afterBuffer, normalizeCalendarTimedInterval({ ...interval, startAt: '2026-11-16T11:29:59.999Z', endAt: '2026-11-16T12:00:00.000Z', bufferBeforeMinutes: 15 }))).toBe(true);
});
