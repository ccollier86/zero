/**
 * time-picker-value.ts
 *
 * Owns strict 24-hour time parsing and conversion for Zero's visual picker.
 */

export interface TimeParts {
  hour: number;
  minute: number;
  period: 'AM' | 'PM';
}

/** Parse an HH:mm value into display parts, returning null for invalid input. */
export function parseTimeValue(value: string | undefined): TimeParts | null {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour24, minute] = value.split(':').map(Number);
  return {
    hour: hour24! % 12 || 12,
    minute: minute!,
    period: hour24! >= 12 ? 'PM' : 'AM',
  };
}

/** Convert validated display parts into canonical HH:mm application state. */
export function formatTimeValue(parts: TimeParts): string {
  if (
    !Number.isInteger(parts.hour)
    || parts.hour < 1
    || parts.hour > 12
    || !Number.isInteger(parts.minute)
    || parts.minute < 0
    || parts.minute > 59
  ) {
    throw new Error('Invalid time picker value.');
  }
  const hour24 = parts.hour % 12 + (parts.period === 'PM' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** Return the first minute at or after the input that follows the configured step. */
export function normalizeMinute(minute: number, step: number): number {
  const boundedStep = Number.isInteger(step) && step >= 1 && step <= 30 ? step : 1;
  return Math.min(59, Math.floor(minute / boundedStep) * boundedStep);
}
