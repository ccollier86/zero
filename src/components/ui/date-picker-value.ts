/**
 * date-picker-value.ts
 *
 * Owns deterministic parsing and display formatting for Zero's DatePicker.
 * It does not own React state, calendar policy, or form validation messages.
 */

import { format } from 'date-fns';

const NUMERIC_DATE_PATTERN = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/;

/** Parse an unambiguous U.S. numeric calendar date at local midnight. */
export function parseDatePickerInput(value: string): Date | null {
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
