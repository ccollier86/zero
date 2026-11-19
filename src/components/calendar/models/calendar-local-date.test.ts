import { expect, test } from 'bun:test';
import { calendarAddDates, calendarCivilDays, calendarDateFromOrdinal, calendarDateOrdinal, calendarFormatCivilDate,
  calendarLocalDate, calendarParseCivilInput, calendarShiftCivilDate } from './calendar-local-date';
test('Gregorian labels round-trip early years, leap centuries and four-digit bounds without host Date authority', () => {
  for (const day of ['0000-01-01', '0000-02-29', '0001-01-01', '0099-12-31', '0100-03-01', '0400-02-29', '2000-02-29', '2011-12-30', '9999-12-31']) {
    expect(calendarDateFromOrdinal(calendarDateOrdinal(day))).toBe(day);
  }
  for (const day of ['10000-01-01', '1900-02-29', '2025-02-29', '2024-02-30', '2024-13-01', '2024-2-01']) expect(calendarLocalDate(day)).toBeNull();
  expect(calendarAddDates('2024-02-28', 1)).toBe('2024-02-29');
  expect(calendarAddDates('2011-12-29', 1)).toBe('2011-12-30'); // Apia's absent local day is still a Gregorian label.
  expect(calendarAddDates('0000-02-28', 2)).toBe('0000-03-01');
  expect(() => calendarAddDates('9999-12-31', 1)).toThrow(); expect(() => calendarAddDates('0000-01-01', -1)).toThrow();
});
test('civil week/month navigation is Monday-first and does not silently clip display ranges', () => {
  expect(calendarCivilDays('0001-01-01', 'week')).toEqual(['0001-01-01', '0001-01-02', '0001-01-03', '0001-01-04', '0001-01-05', '0001-01-06', '0001-01-07']);
  const month = calendarCivilDays('2026-11-19', 'month'); expect(month).toHaveLength(42); expect(month[0]).toBe('2026-10-26'); expect(month.at(-1)).toBe('2026-12-06');
  expect(calendarShiftCivilDate('2024-01-31', 'month', 1)).toBe('2024-02-29'); expect(() => calendarCivilDays('9999-12-31', 'month')).toThrow();
});
test('civil fields preserve authored dates, including early years, and format independently of viewer zones', () => {
  expect(calendarParseCivilInput('12/30/2011')).toBe('2011-12-30'); expect(calendarParseCivilInput('1/1/0001')).toBe('0001-01-01');
  expect(calendarParseCivilInput('2/29/0000')).toBe('0000-02-29'); expect(calendarFormatCivilDate('0000-02-29', { year: 'numeric', month: '2-digit', day: '2-digit' })).toBe('02/29/0000');
  expect(calendarParseCivilInput('2/29/1900')).toBeNull(); expect(calendarParseCivilInput('2011-12-30T00:00Z')).toBeNull();
  expect(calendarFormatCivilDate('2011-12-30', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Pacific/Apia' })).toBe('12/30/2011');
});
