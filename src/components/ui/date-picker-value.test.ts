/**
 * date-picker-value.test.ts
 *
 * Verifies DatePicker's typed U.S. calendar-date boundary and canonical label.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatDatePickerValue,
  parseDatePickerInput,
} from './date-picker-value';

describe('DatePicker value contract', () => {
  test.each([
    '1-4-2026',
    '01-04-2026',
    '1/4/2026',
    '01/04/2026',
  ])('accepts %s as January 4, 2026', (input) => {
    const parsed = parseDatePickerInput(input);

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(0);
    expect(parsed?.getDate()).toBe(4);
    expect(formatDatePickerValue(parsed ?? undefined)).toBe('January 4th, 2026');
  });

  test('accepts valid leap days', () => {
    expect(parseDatePickerInput('2/29/2024')).not.toBeNull();
  });

  test.each([
    '',
    '1/4/26',
    '1/4-2026',
    '13/4/2026',
    '2/29/2025',
    '4/31/2026',
    'January 4, 2026',
  ])('rejects incomplete or invalid input %s', (input) => {
    expect(parseDatePickerInput(input)).toBeNull();
  });

  test('formats an empty selection as an empty input', () => {
    expect(formatDatePickerValue(undefined)).toBe('');
  });
});
