import { expect, test } from 'bun:test';
import { CalendarError, calendarCommand } from './error';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarValue } from './validation';

test('calendar input admission is detached, bounded and canonical without executing authored getters', () => {
  let called = 0;
  expect(() => calendarRecord({ get value() { called++; return 'private'; } })).toThrow();
  expect(called).toBe(0);
  expect(() => calendarRecord({ unexpected: true }, ['expected'])).toThrow();
  expect(() => calendarValue({ body: 'x'.repeat(32 * 1024) })).toThrow();
  expect(() => calendarValue({ value: NaN })).toThrow();
  const original = { array: [1, 2] };
  expect(calendarValue(original)).not.toBe(original);
  expect(calendarHash({ a: 1, b: 2 })).toBe(calendarHash({ b: 2, a: 1 }));
});

test('scope and identity admission reject substitutions instead of coercing them', () => {
  expect(calendarScope('application')).toBe('application');
  expect(calendarScope('tenant:opaque')).toBe('tenant:opaque');
  for (const invalid of ['', 'tenant:', 'tenant: ', {}, null]) expect(() => calendarScope(invalid)).toThrow();
  for (const invalid of [1.1, Infinity, '1']) expect(() => calendarInteger(invalid)).toThrow();
  expect(() => calendarKey('../path')).toThrow();
});

test('domain rejection carries only safe failure facts and is not an accepted envelope', () => {
  for (const outcome of ['not-started', 'not-committed', 'unknown'] as const) {
    expect(new CalendarError('CALENDAR_OUTCOME_UNKNOWN', outcome).outcome).toBe('unknown');
  }
  const rejected = () => calendarCommand(() => { throw new CalendarError('CALENDAR_FORBIDDEN'); });
  expect(rejected).toThrow();
  expect(calendarCommand(() => 1)).toEqual({ ok: true, value: 1 });
});
