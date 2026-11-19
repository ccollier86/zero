/** Pure source/expansion compatibility; no fabricated ranges, storage, files or installed output. */
import { expect, test } from 'bun:test';
import { CalendarError, type CalendarErrorCode } from './error';
import { admitCalendarTimedRecurrenceSource, materializeCalendarRecurrence, normalizeCalendarTimedRecurrence,
  normalizeCalendarTimedRecurrenceSource, type CalendarTimedRecurrenceSource } from './recurrence-engine';

function source(patch: Partial<CalendarTimedRecurrenceSource> = {}): CalendarTimedRecurrenceSource {
  return { kind: 'timed-local-v1', localStart: '2026-01-01T09:07:03.125', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 37 * 60_000,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'never' } }, ...patch };
}
function rejects(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_INPUT_INVALID') {
  try { run(); throw new Error('invalid source accepted'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC'); }
}
function restoreTemporal(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
}

test('source normalization is closed, detached and frozen without adding a range, limit or effective time', () => {
  const weekdays = [0, 4], input = source({ rule: { frequency: 'weekly', interval: 1, weekdays, end: { kind: 'after', count: 2 } } });
  const normalized = normalizeCalendarTimedRecurrenceSource(input);
  expect(normalized).toEqual({ ...input, rule: { frequency: 'weekly', interval: 1, end: { kind: 'after', count: 2 }, weekdays: [4, 0] } });
  expect(Object.keys(normalized).sort()).toEqual(['durationMilliseconds', 'fold', 'kind', 'localStart', 'rule', 'timeZone']);
  for (const value of [normalized, normalized.rule, normalized.rule.end, normalized.rule.frequency === 'weekly' && normalized.rule.weekdays]) expect(Object.isFrozen(value)).toBe(true);
  weekdays.push(1); (input.rule.end as { kind: string; count: number }).count = 900;
  expect(normalized.rule).toEqual({ frequency: 'weekly', interval: 1, weekdays: [4, 0], end: { kind: 'after', count: 2 } });
  for (const extra of [{ range: { from: '2026-01-01', until: '2026-01-02' } }, { limit: 1 }, { nominalKey: 'forged' }, { startAt: '2026-01-01T09:07:03.125Z' }]) {
    rejects(() => normalizeCalendarTimedRecurrenceSource({ ...source(), ...extra }));
  }
});

test('legacy combined normalization and expansion retain the same exact source and original occurrence', () => {
  const raw = source({ rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 1 }, end: { kind: 'after', count: 3 } } });
  const range = { from: '2026-01-01', until: '2026-04-01' }, normalized = normalizeCalendarTimedRecurrenceSource(raw);
  expect(normalizeCalendarTimedRecurrence({ ...raw, range })).toEqual({ ...normalized, range, limit: 100 });
  expect(normalizeCalendarTimedRecurrence({ ...raw, range, limit: 1 })).toEqual({ ...normalized, range, limit: 1 });
  const admitted = admitCalendarTimedRecurrenceSource(raw);
  expect(admitted.source).toEqual(normalized); expect(admitted.original).toEqual(materializeCalendarRecurrence({ ...raw, range }).occurrences[0]!);
  expect(admitted.original.nominalKey).toBe('timed-v1:' + raw.localStart);
  for (const value of [admitted, admitted.source, admitted.original]) expect(Object.isFrozen(value)).toBe(true);
});

test('structural source normalization remains Temporal-independent and does not silently become DTSTART admission', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  const gap = source({ localStart: '2026-03-08T02:30:00.000', timeZone: 'America/New_York' });
  const mismatch = source({ rule: { frequency: 'weekly', interval: 1, weekdays: [1], end: { kind: 'never' } } });
  let calls = 0;
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { calls++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
    for (const raw of [gap, mismatch]) {
      expect(normalizeCalendarTimedRecurrenceSource(raw).localStart).toBe(raw.localStart);
      expect(normalizeCalendarTimedRecurrence({ ...raw, range: { from: '2026-01-01', until: '2026-01-02' } }).localStart).toBe(raw.localStart);
    }
    expect(calls).toBe(0);
    rejects(() => admitCalendarTimedRecurrenceSource(mismatch), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    rejects(() => materializeCalendarRecurrence({ ...mismatch, range: { from: '2026-01-01', until: '2026-01-02' } }), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    // Structural query admission still precedes Temporal acquisition in the legacy API.
    const before = calls;
    rejects(() => materializeCalendarRecurrence({ ...source(), range: { from: '2026-01-01', until: '2026-01-01' } }));
    expect(calls).toBe(before);
  } finally { restoreTemporal(descriptor); }
  rejects(() => admitCalendarTimedRecurrenceSource(gap)); rejects(() => admitCalendarTimedRecurrenceSource(mismatch));
});

test('source DTSTART must match each closed recurrence pattern and cannot shift a directly authored gap', () => {
  for (const raw of [
    source({ rule: { frequency: 'weekly', interval: 1, weekdays: [1], end: { kind: 'never' } } }),
    source({ rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 2 }, end: { kind: 'never' } } }),
    source({ rule: { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: -1, weekday: 4 }, end: { kind: 'never' } } }),
    source({ localStart: '2026-03-08T02:30:00.000', timeZone: 'America/New_York' }),
    source({ localStart: '2026-10-04T02:15:00.000', timeZone: 'Australia/Lord_Howe', fold: 'later' }),
    source({ localStart: '2011-12-30T09:00:00.000', timeZone: 'Pacific/Apia' }),
  ]) rejects(() => admitCalendarTimedRecurrenceSource(raw));
});

test('original nominal identity is unchanged by fold or zone while effective UTC remains separately qualified', () => {
  const raw = source({ localStart: '2026-11-01T01:30:00.000', timeZone: 'America/New_York' });
  const earlier = admitCalendarTimedRecurrenceSource(raw).original, later = admitCalendarTimedRecurrenceSource({ ...raw, fold: 'later' }).original;
  expect(earlier.nominalKey).toBe(later.nominalKey); expect(Date.parse(later.startAt) - Date.parse(earlier.startAt)).toBe(3_600_000);
  const utc = admitCalendarTimedRecurrenceSource({ ...raw, timeZone: 'UTC' }).original;
  expect(utc.nominalKey).toBe(earlier.nominalKey); expect(utc.startAt).not.toBe(earlier.startAt);
});

test('source admission needs no fake exclusive range at year9999 and preserves existing signed UTC boundary vocabulary', () => {
  const upper = source({ localStart: '9999-12-31T23:30:00.000', durationMilliseconds: 2 * 86_400_000 });
  const result = admitCalendarTimedRecurrenceSource(upper);
  expect(result.original.localStart).toBe(upper.localStart); expect(result.original.nominalKey).toBe('timed-v1:' + upper.localStart);
  expect(result.original.endAt).toBe('+010000-01-02T23:30:00.000Z'); expect(result.source).not.toHaveProperty('range');
  const lower = admitCalendarTimedRecurrenceSource(source({ localStart: '0000-01-01T00:30:00.000', timeZone: 'Etc/GMT-14' }));
  expect(lower.original.startAt).toBe('-000001-12-31T10:30:00.000Z');
});

test('source and admit reject accessors/proxies/unknown source facts before observing them', () => {
  let touched = 0;
  const getter = { ...source() }; Object.defineProperty(getter, 'localStart', { enumerable: true, get() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  const proxy = new Proxy(source(), { getPrototypeOf() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); }, ownKeys() { touched++; throw new Error('PRIVATE_DIAGNOSTIC'); } });
  for (const raw of [getter, proxy, { ...source(), rule: { ...source().rule, BYMONTH: [1] } }, { ...source(), kind: 'all-day-v1' }]) {
    rejects(() => normalizeCalendarTimedRecurrenceSource(raw)); rejects(() => admitCalendarTimedRecurrenceSource(raw));
  }
  expect(touched).toBe(0);
});

test('native private diagnostics retain the existing static unavailable error mapping for source admission', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, value: { PlainDate: { from() { throw new Error('PRIVATE_DIAGNOSTIC'); } }, ZonedDateTime: { from() {} } } });
    rejects(() => admitCalendarTimedRecurrenceSource(source()), 'CALENDAR_TIME_RULES_UNAVAILABLE');
  } finally { restoreTemporal(descriptor); }
});
