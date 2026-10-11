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
    || (parts.period !== 'AM' && parts.period !== 'PM')
  ) {
    throw new Error('Invalid time picker value.');
  }
  const hour24 = parts.hour % 12 + (parts.period === 'PM' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** Return the minute at or before the input that follows the configured step. */
export function normalizeMinute(minute: number, step: number): number {
  const boundedStep = Number.isInteger(step) && step >= 1 && step <= 30 ? step : 1;
  return Math.min(59, Math.floor(minute / boundedStep) * boundedStep);
}

/** Render a validated canonical time without changing its stored 24-hour value. */
export function formatTimePickerDisplay(value: string, format: '12h' | '24h' = '12h'): string {
  const parts = parseTimeValue(value);
  if (!parts) return value;
  return format === '24h' ? value : `${parts.hour}:${String(parts.minute).padStart(2, '0')} ${parts.period}`;
}

/** Build bounded selectable times, retaining an existing off-step minute exactly. */
export function timePickerOptions(step = 1, selected?: string): readonly string[] {
  const bounded = Number.isInteger(step) && step >= 1 && step <= 30 ? step : 1;
  const values: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += bounded) {
      values.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
  }
  if (selected && parseTimeValue(selected) && !values.includes(selected)) values.push(selected);
  return values.sort();
}
