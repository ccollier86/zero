/** Fixed clocks, no databases/providers, and every Croner instance is stopped in finally by the time helper. */
import { expect, test } from 'bun:test';
import { initialScheduleDue, normalizeScheduleTiming, selectDueOccurrences } from './schedule-time';
const t = (value: string) => Date.parse(value);

test('one-off times are explicit UTC instants, preserve deadlines and expire honestly', () => {
  const timing = normalizeScheduleTiming({ kind: 'once', at: '2026-12-01T15:00:00Z', maxLatenessMs: 5000 });
  const at = initialScheduleDue(timing, 0)!;
  expect(timing).toMatchObject({ at: '2026-12-01T15:00:00.000Z' });
  expect(selectDueOccurrences(timing, at, at - 1)).toMatchObject({ scheduledAt: [], nextDueAt: at, skipped: false });
  expect(selectDueOccurrences(timing, at, at + 5000)).toMatchObject({ scheduledAt: [at], nextDueAt: null, skipped: false });
  expect(selectDueOccurrences(timing, at, at + 5001)).toMatchObject({ scheduledAt: [], nextDueAt: null, skipped: true });
  for (const value of ['2026-02-30T12:00:00Z', '2026-12-01', '2026-12-01T15:00:00', 'invalid']) {
    expect(() => normalizeScheduleTiming({ kind: 'once', at: value })).toThrow();
  }
});

test('durable cron requires an explicit valid timezone and validates policy/limits before timer registration', () => {
  for (const input of [
    { kind: 'cron', pattern: '* * * * *' }, { kind: 'cron', pattern: 'bad', timezone: 'UTC' },
    { kind: 'cron', pattern: '* * * * *', timezone: 'Not/AZone' },
    { kind: 'cron', pattern: '* * * * *', timezone: 'UTC', catchUpLimit: 0 },
    { kind: 'cron', pattern: '* * * * *', timezone: 'UTC', maxLatenessMs: -1 },
    { kind: 'once', at: '2026-12-01T15:00:00Z', extra: true },
  ]) expect(() => normalizeScheduleTiming(input)).toThrow();
});

test('latest policy collapses a year of per-second downtime without an unbounded catch-up loop', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '* * * * * *', timezone: 'UTC', misfire: 'latest' });
  const first = t('2025-01-01T00:00:01Z'), now = t('2026-01-01T00:00:00Z') + 125;
  expect(selectDueOccurrences(timing, first, now)).toEqual({ scheduledAt: [now - 125], nextDueAt: now - 125 + 1000, skipped: true });
});

test('skip allows bounded normal wake lateness but does not execute an obsolete occurrence', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '* * * * * *', timezone: 'UTC', misfire: 'skip', maxLatenessMs: 100 });
  const first = t('2026-01-01T00:00:01Z');
  expect(selectDueOccurrences(timing, first, first + 5)).toEqual({ scheduledAt: [first], nextDueAt: first + 1000, skipped: false });
  expect(selectDueOccurrences(timing, first, first + 5000)).toEqual({ scheduledAt: [], nextDueAt: first + 6000, skipped: true });
});

test('catch-up has both an age window and a total run cap, with deliberate skipping visible', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '* * * * * *', timezone: 'UTC', misfire: 'catch-up', maxLatenessMs: 5000, catchUpLimit: 2 });
  const first = t('2026-01-01T00:00:01Z'), now = first + 100_000;
  expect(selectDueOccurrences(timing, first, now)).toEqual({ scheduledAt: [now - 5000, now - 4000], nextDueAt: now + 1000, skipped: true });
  expect(selectDueOccurrences(timing, first, first + 1000)).toEqual({ scheduledAt: [first, first + 1000], nextDueAt: first + 2000, skipped: false });
});

test('wall-clock midday survives spring/fall offset changes instead of becoming fixed 24-hour arithmetic', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '0 0 12 * * *', timezone: 'America/New_York' });
  expect(initialScheduleDue(timing, t('2026-03-07T17:00:00Z'))).toBe(t('2026-03-08T16:00:00Z'));
  expect(initialScheduleDue(timing, t('2026-10-31T16:00:00Z'))).toBe(t('2026-11-01T17:00:00Z'));
});

test('fall-back never returns a past next time or admits the repeated first-fold occurrence twice', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '0 30 1 * * *', timezone: 'America/New_York', maxLatenessMs: 4 * 60 * 60 * 1000 });
  const first = t('2026-11-01T05:30:00Z'), secondFold = t('2026-11-01T06:15:00Z'), tomorrow = t('2026-11-02T06:30:00Z');
  expect(initialScheduleDue(timing, secondFold)).toBe(tomorrow);
  expect(selectDueOccurrences(timing, first, secondFold)).toEqual({ scheduledAt: [first], nextDueAt: tomorrow, skipped: false });
  const eachMinute = normalizeScheduleTiming({ kind: 'cron', pattern: '0 * * * * *', timezone: 'America/New_York' });
  expect(initialScheduleDue(eachMinute, secondFold)).toBe(t('2026-11-01T07:00:00Z'));
});

test('spring-gap behavior is explicit forward shift, not calendar recurrence inference', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '0 30 2 * * *', timezone: 'America/New_York' });
  expect(initialScheduleDue(timing, t('2026-03-08T00:00:00Z'))).toBe(t('2026-03-08T07:30:00Z'));
});

test('early wakes do nothing, retired cursors do not fire and returned decisions are immutable', () => {
  const timing = normalizeScheduleTiming({ kind: 'cron', pattern: '0 * * * * *', timezone: 'UTC' });
  const next = initialScheduleDue(timing, t('2026-01-01T00:00:01Z'))!;
  expect(selectDueOccurrences(timing, next, next - 1).scheduledAt).toEqual([]);
  expect(() => selectDueOccurrences(timing, next + 123, next + 1000)).toThrow();
  const result = selectDueOccurrences(timing, next, next);
  expect(Object.isFrozen(result) && Object.isFrozen(result.scheduledAt)).toBe(true);
  expect(selectDueOccurrences(timing, null, next)).toEqual({ scheduledAt: [], nextDueAt: null, skipped: false });
});
