/** Memory-only portable normalization; no files, dependencies, databases, actors or timers. */
import { expect, test } from 'bun:test';
import { CalendarError } from './error';
import type { CalendarWeeklyAvailabilityPolicyInput } from './working-hours-contracts';
import { calendarWorkingHoursDateOrdinal, normalizeCalendarAvailabilityPolicy } from './working-hours-model';

const policy = (): CalendarWeeklyAvailabilityPolicyInput => ({ kind: 'weekly-local-v1', coverage: { from: '2026-01-01', until: '2027-01-01' },
  fold: 'earlier', weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }], overrides: [] });
function invalid(input: unknown): void {
  try { normalizeCalendarAvailabilityPolicy(input); throw new Error('accepted invalid policy'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe('CALENDAR_INPUT_INVALID'); }
}

test('weekly source is detached, deeply frozen, sorted and merges adjacent or overlapping same-date windows', () => {
  const source = { ...policy(), weekly: [{ day: 7, windows: [] }, { day: 1, windows: [
    { startMinute: 600, endMinute: 900 }, { startMinute: 540, endMinute: 600 }, { startMinute: 800, endMinute: 1020 },
  ] }], overrides: [{ date: '2026-12-25', windows: [] }, { date: '2026-01-02', windows: [{ startMinute: 0, endMinute: 1440 }] }] };
  const result = normalizeCalendarAvailabilityPolicy(source);
  expect(result).toEqual({ ...source, weekly: [{ day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] }, { day: 7, windows: [] }], overrides: [...source.overrides].reverse() });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.kind !== 'weekly-local-v1') throw new Error('unexpected kind');
  expect(Object.isFrozen(result.coverage)).toBe(true); expect(Object.isFrozen(result.weekly)).toBe(true);
  expect(Object.isFrozen(result.weekly[0]!.windows[0])).toBe(true); expect(Object.isFrozen(result.overrides[0])).toBe(true);
  source.weekly[1]!.windows[0]!.endMinute = 700;
  expect(result.weekly[0]!.windows).toEqual([{ startMinute: 540, endMinute: 1020 }]);
});

test('explicit UTC sources preserve canonical unrestricted/closed policies and legacy normalization', () => {
  expect(normalizeCalendarAvailabilityPolicy({ kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] })).toEqual({ kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] });
  expect(normalizeCalendarAvailabilityPolicy({ kind: 'explicit-utc-v1', mode: 'windows', windows: [] })).toEqual({ kind: 'explicit-utc-v1', mode: 'windows', windows: [] });
  expect(normalizeCalendarAvailabilityPolicy({ kind: 'explicit-utc-v1', mode: 'windows', windows: [
    { startAt: '2026-01-01T01:00:00.000Z', endAt: '2026-01-01T02:00:00.000Z' }, { startAt: Date.parse('2026-01-01T00:00:00.000Z'), endAt: '2026-01-01T01:00:00.000Z' },
  ] })).toEqual({ kind: 'explicit-utc-v1', mode: 'windows', windows: [{ startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-01T02:00:00.000Z' }] });
  for (const input of [
    { kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [{ startAt: 0, endAt: 1 }] },
    { kind: 'explicit-utc-v1', mode: 'windows', windows: [{ startAt: '2026-01-01T00:00:00Z', endAt: 1 }] },
    { kind: 'explicit-utc-v1', mode: 'windows', windows: [{ startAt: 1, endAt: 1 }] },
    { kind: 'explicit-utc-v1', mode: 'windows', windows: Array.from({ length: 101 }, () => ({ startAt: 0, endAt: 1 })) },
    { kind: 'explicit-utc-v1', mode: 'windows', windows: [], weekly: [] },
  ]) invalid(input);
});

test('coverage is strict Gregorian, positive, exclusive and bounded by 366 nominal days without local arithmetic', () => {
  expect(calendarWorkingHoursDateOrdinal('0000-02-29') - calendarWorkingHoursDateOrdinal('0000-02-28')).toBe(1);
  expect(calendarWorkingHoursDateOrdinal('2000-03-01') - calendarWorkingHoursDateOrdinal('2000-02-28')).toBe(2);
  expect(normalizeCalendarAvailabilityPolicy({ ...policy(), coverage: { from: '2024-01-01', until: '2025-01-01' } }).kind).toBe('weekly-local-v1');
  for (const coverage of [
    { from: '2023-02-29', until: '2023-03-01' }, { from: '1900-02-29', until: '1900-03-01' },
    { from: '2026-04-31', until: '2026-05-02' }, { from: '2026-01-00', until: '2026-01-02' },
    { from: '2026-01-01', until: '2026-01-01' }, { from: '2026-01-02', until: '2026-01-01' },
    { from: '2026-01-01', until: '2027-01-03' }, { from: '2026-1-01', until: '2026-02-01' },
    { from: '2026-01-01T00:00:00Z', until: '2026-02-01' }, { from: '2026-01-01', until: '+010000-01-01' },
  ]) invalid({ ...policy(), coverage });
});

test('duplicate weekdays/dates, out-of-coverage overrides and unsupported semantics reject', () => {
  for (const input of [
    { ...policy(), weekly: [{ day: 1, windows: [] }, { day: 1, windows: [] }] },
    { ...policy(), weekly: [{ day: 0, windows: [] }] }, { ...policy(), weekly: [{ day: 8, windows: [] }] },
    { ...policy(), weekly: Array.from({ length: 8 }, (_, index) => ({ day: index + 1, windows: [] })) },
    { ...policy(), overrides: [{ date: '2026-03-01', windows: [] }, { date: '2026-03-01', windows: [] }] },
    { ...policy(), overrides: [{ date: '2025-12-31', windows: [] }] },
    { ...policy(), overrides: [{ date: '2027-01-01', windows: [] }] },
    { ...policy(), fold: undefined }, { ...policy(), fold: 'compatible' }, { ...policy(), timeZone: 'UTC' },
    { ...policy(), kind: 'weekly-local-v2' }, { ...policy(), mode: 'unrestricted' },
    { ...policy(), weekly: [{ day: 1, windows: [] , overnight: true }] },
  ]) invalid(input);
});

test('wall minutes reject overnight, zero length, fractional, non-number and excess source windows before merging', () => {
  for (const window of [ { startMinute: 0, endMinute: 0 }, { startMinute: 1440, endMinute: 1440 },
    { startMinute: 1000, endMinute: 100 }, { startMinute: -1, endMinute: 1 }, { startMinute: 0, endMinute: 1441 },
    { startMinute: 1.5, endMinute: 10 }, { startMinute: '0', endMinute: 10 }, { startMinute: NaN, endMinute: 10 },
    { startMinute: 0, endMinute: 10, timeZone: 'UTC' } ]) invalid({ ...policy(), weekly: [{ day: 1, windows: [window] }] });
  invalid({ ...policy(), weekly: [{ day: 1, windows: Array.from({ length: 9 }, () => ({ startMinute: 0, endMinute: 1 })) }] });
  invalid({ ...policy(), overrides: Array.from({ length: 129 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), windows: [] })) });
});

test('normalized UTF-8 source budget is enforced independently of structural cardinality', () => {
  const hours = Array.from({ length: 8 }, (_, index) => ({ startMinute: index * 120, endMinute: index * 120 + 60 }));
  invalid({ ...policy(), weekly: [], overrides: Array.from({ length: 128 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), windows: hours,
  })) });
});

test('normalization is Temporal-independent and rejects accessors, holes, exotic values and hostile shapes without getters', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: undefined });
    expect(normalizeCalendarAvailabilityPolicy(policy()).kind).toBe('weekly-local-v1');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); }
  let calls = 0;
  const source = policy(); Object.defineProperty(source, 'fold', { enumerable: true, get() { calls++; return 'earlier'; } });
  invalid(source); expect(calls).toBe(0);
  const weekly = [] as unknown[]; weekly.length = 1;
  for (const input of [null, [], new Date(), { ...policy(), weekly }, { ...policy(), overrides: new Set() },
    { ...policy(), weekly: [new Date()] }, new Proxy(policy(), { ownKeys() { throw new Error('private proxy error'); } })]) invalid(input);
  const inner = [{ startMinute: 0, endMinute: 1 }];
  Object.defineProperty(inner, '0', { enumerable: true, get() { calls++; return {}; } });
  invalid({ ...policy(), weekly: [{ day: 1, windows: inner }] }); expect(calls).toBe(0);
});
