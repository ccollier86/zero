/** Calendar presentation math must not replace or broaden DayPicker policy. */
import { expect, test } from 'bun:test';
import { calendarDateLib, calendarMonthAllowed, calendarNavigationBounds, calendarYearMonth, calendarYearRange } from './calendar-view-model';

test('month/year choices honor explicit and deprecated navigation bounds', () => {
  const props = { startMonth: new Date(2026, 9, 1), endMonth: new Date(2027, 1, 1) };
  const lib = calendarDateLib(props);
  expect(calendarMonthAllowed(new Date(2026, 8, 1), props, lib)).toBe(false);
  expect(calendarMonthAllowed(new Date(2026, 9, 1), props, lib)).toBe(true);
  expect(calendarYearMonth(2027, new Date(2026, 11, 1), props, lib)).toEqual(new Date(2027, 1, 1));
  expect(calendarYearMonth(2026, new Date(2027, 0, 1), props, lib)).toEqual(new Date(2026, 9, 1));
  expect(calendarNavigationBounds({ fromYear: 2025, toYear: 2028 }, lib)).toEqual({ from: new Date(2025, 0, 1), to: new Date(2028, 11, 1) });
  expect(calendarMonthAllowed(new Date(2026, 9, 1), { disableNavigation: true }, lib)).toBe(false);
});

test('year window honors explicit limits, safely ignores malformed inputs, and includes historical visible dates', () => {
  const props = { today: new Date(2026, 9, 7) }, lib = calendarDateLib(props);
  expect(calendarYearRange(new Date(2026, 9, 1), props, lib)).toEqual([1926, 2056]);
  expect(calendarYearRange(new Date(1800, 9, 1), props, lib)).toEqual([1800, 2056]);
  expect(calendarYearRange(new Date(2026, 9, 1), props, lib, [2020, 2030])).toEqual([2020, 2030]);
  expect(calendarYearRange(new Date(2026, 9, 1), props, lib, [NaN, Infinity])).toEqual([1926, 2056]);
  expect(calendarYearRange(new Date(2026, 9, 1), props, lib, [2030, 2020])).toEqual([2026, 2026]);
});

test('configured time zones and partial locale options use the real DayPicker date library', () => {
  const lib = calendarDateLib({ timeZone: 'America/New_York', locale: { code: 'en-US' } });
  const date = lib.newDate(2026, 9, 1);
  expect(lib.getMonth(date)).toBe(9); expect(lib.getYear(date)).toBe(2026);
  expect(lib.format(date, 'LLLL')).toBe('October');
  expect(new Date(date.getTime()).toISOString()).toBe('2026-10-01T04:00:00.000Z');
});
