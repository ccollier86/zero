/**
 * date-picker-value.ts
 *
 * Owns deterministic parsing and display formatting for Zero's DatePicker.
 * It does not own React state, calendar policy, or form validation messages.
 */

import { format } from 'date-fns';

const NUMERIC_DATE_PATTERN = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/;
const CALENDAR_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse date-only ISO calendar data without treating it as a UTC instant. */
export function parseDatePickerCalendarValue(value: string): Date | undefined {
  const match = CALENDAR_VALUE_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

/** Format a selected local calendar day without UTC/timezone day shifting. */
export function formatDatePickerCalendarValue(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new TypeError('Choose a valid calendar date.');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse an unambiguous U.S. numeric or ISO calendar date at local midnight. */
export function parseDatePickerInput(value: string): Date | null {
  const calendar = parseDatePickerCalendarValue(value.trim());
  if (calendar) return calendar;
  const match = NUMERIC_DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[3]);
  const year = Number(match[4]);
  if (year < 1_000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/** Format a selected date with the same long label used by DatePicker. */
export function formatDatePickerValue(value: Date | undefined): string {
  return value ? format(value, 'PPP') : '';
}
