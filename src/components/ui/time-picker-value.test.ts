/**
 * time-picker-value.test.ts
 *
 * Verifies canonical conversion and rejection for Zero time-picker values.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatTimeValue,
  normalizeMinute,
  parseTimeValue,
} from './time-picker-value';

describe('time picker values', () => {
  it('round-trips midnight, noon, and afternoon values', () => {
    expect(parseTimeValue('00:05')).toEqual({ hour: 12, minute: 5, period: 'AM' });
    expect(parseTimeValue('12:30')).toEqual({ hour: 12, minute: 30, period: 'PM' });
    expect(formatTimeValue({ hour: 3, minute: 7, period: 'PM' })).toBe('15:07');
  });

  it('rejects malformed values and invalid display parts', () => {
    expect(parseTimeValue('24:00')).toBeNull();
    expect(parseTimeValue('9:30')).toBeNull();
    expect(() => formatTimeValue({ hour: 0, minute: 30, period: 'AM' })).toThrow();
  });

  it('normalizes minutes to a safe configured step', () => {
    expect(normalizeMinute(37, 5)).toBe(35);
    expect(normalizeMinute(37, 0)).toBe(37);
  });
});
