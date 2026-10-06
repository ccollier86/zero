/**
 * data-studio-temporal-value.ts
 *
 * Owns strict calendar/local-wall-time draft binding for existing Zero pickers.
 * It preserves untouched seconds/fractions, never chooses a host-local day from
 * a UTC date-only string, and does not mutate records or choose default values.
 */

import { parseDatePickerInput, parseDatePickerCalendarValue, formatDatePickerCalendarValue } from '../ui/date-picker-value';
import { parseTimeValue } from '../ui/time-picker-value';

/** Logical temporal fields supported by Data Studio's existing domain schema. */
export type DataStudioTemporalType = 'date' | 'datetime';

/** Current picker values plus raw fragments retained during incomplete editing. */
export interface DataStudioTemporalParts {
  readonly date: Date | undefined;
  readonly dateDraft: string;
  readonly time: string;
  readonly seconds: string;
  readonly valid: boolean;
}

const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** A date-only value is calendar data, not a UTC midnight instant. */
export const dataStudioCalendarDate = parseDatePickerCalendarValue;

/** Format a selected local calendar day without UTC/timezone day shifting. */
export const dataStudioCalendarDraft = formatDatePickerCalendarValue;

function fragments(value: string, type: DataStudioTemporalType): { date: string; time: string } {
  if (type === 'date') return { date: value, time: '' };
  const separator = value.indexOf('T');
  return separator < 0 ? { date: value, time: '' }
    : { date: value.slice(0, separator), time: value.slice(separator + 1) };
}

/** Validate a local draft and return the existing API's canonical date/UTC value. */
export function parseDataStudioTemporalDraft(draft: string, type: DataStudioTemporalType): string {
  const parts = fragments(draft, type);
  const calendar = dataStudioCalendarDate(parts.date);
  if (!calendar) throw new TypeError('Choose a valid calendar date.');
  if (type === 'date') return parts.date;
  const time = LOCAL_TIME_PATTERN.exec(parts.time);
  if (!time || !parseTimeValue(`${time[1]}:${time[2]}`) || Number(time[3] ?? 0) > 59) {
    throw new TypeError('Choose a valid local time, including complete seconds.');
  }
  const hour = Number(time[1]), minute = Number(time[2]), second = Number(time[3] ?? 0);
  const millisecond = Number((time[4] ?? '').padEnd(3, '0'));
  const date = new Date(calendar);
  date.setHours(hour, minute, second, millisecond);
  if (date.getFullYear() !== calendar.getFullYear() || date.getMonth() !== calendar.getMonth()
    || date.getDate() !== calendar.getDate() || date.getHours() !== hour
    || date.getMinutes() !== minute || date.getSeconds() !== second || date.getMilliseconds() !== millisecond) {
    throw new TypeError('This local date and time does not exist in your timezone.');
  }
  return date.toISOString();
}

/** Read visible picker parts without mutating or canonicalizing the raw draft. */
export function dataStudioTemporalParts(value: string, type: DataStudioTemporalType): DataStudioTemporalParts {
  const parts = fragments(value, type);
  let valid = value === '';
  if (value !== '') {
    try { parseDataStudioTemporalDraft(value, type); valid = true; } catch { /* Invalid drafts remain editable. */ }
  }
  const minute = parts.time.slice(0, 5);
  return {
    date: dataStudioCalendarDate(parts.date), dateDraft: parts.date,
    time: parseTimeValue(minute) ? minute : '00:00',
    seconds: parts.time.length > 5 ? parts.time.slice(6) : '00.000', valid,
  };
}

/** Merge one calendar change, retaining the exact seconds/fraction of the existing value. */
export function updateDataStudioTemporalDate(value: string, date: Date | undefined, type: DataStudioTemporalType): string {
  if (!date) return '';
  return updateDataStudioTemporalDateText(value, dataStudioCalendarDraft(date), type);
}

/** Preserve an invalid/unfinished typed date rather than silently submitting the old one. */
export function updateDataStudioTemporalDateText(value: string, text: string, type: DataStudioTemporalType): string {
  if (text === '') return '';
  const parsed = parseDatePickerInput(text) ?? dataStudioCalendarDate(text);
  const date = parsed ? dataStudioCalendarDraft(parsed) : text;
  if (type === 'date') return date;
  return `${date}T${fragments(value, type).time || '00:00:00.000'}`;
}

/** A minute/hour edit retains seconds exactly, even while that precision draft is invalid. */
export function updateDataStudioTemporalTime(value: string, time: string): string {
  if (!parseTimeValue(time)) throw new TypeError('Choose a valid hour and minute.');
  const parts = dataStudioTemporalParts(value, 'datetime');
  return `${parts.dateDraft}T${time}:${parts.seconds}`;
}

/** Retain partially entered seconds so validation can block, rather than erase, them. */
export function updateDataStudioTemporalSeconds(value: string, seconds: string): string {
  const parts = dataStudioTemporalParts(value, 'datetime');
  return `${parts.dateDraft}T${parts.time}:${seconds}`;
}
