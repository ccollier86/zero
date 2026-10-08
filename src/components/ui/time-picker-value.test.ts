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
  formatTimePickerDisplay,
  timePickerOptions,
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

  it('changes display format without changing canonical time', () => {
    expect(formatTimePickerDisplay('00:05')).toBe('12:05 AM');
    expect(formatTimePickerDisplay('12:30')).toBe('12:30 PM');
    expect(formatTimePickerDisplay('15:07')).toBe('3:07 PM');
    expect(formatTimePickerDisplay('15:07', '24h')).toBe('15:07');
    expect(formatTimePickerDisplay('unfinished')).toBe('unfinished');
  });

  it('retains an existing precise minute when its step changes', () => {
    const options = timePickerOptions(15, '17:46');
    expect(options).toHaveLength(97);
    expect(options).toContain('17:45');
    expect(options).toContain('17:46');
    expect(options).toContain('18:00');
    expect(options.indexOf('17:46')).toBe(options.indexOf('17:45') + 1);
    expect(timePickerOptions(15, 'invalid')).toHaveLength(96);
  });

  it('bounds invalid step configuration and never emits malformed times', () => {
    expect(timePickerOptions(0)).toHaveLength(1440);
    expect(timePickerOptions(31)).toHaveLength(1440);
    expect(timePickerOptions(7)).toHaveLength(216);
    expect(timePickerOptions(7).every(value => parseTimeValue(value) !== null)).toBe(true);
    expect(() => formatTimeValue({ hour: 3, minute: 7, period: 'invalid' as 'AM' })).toThrow();
  });
});
