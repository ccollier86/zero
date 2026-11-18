/** Browser-safe, engine-free normalization. No host timezone, Buffer, Temporal or server imports. */
import { CalendarError } from './error';
import type { CalendarAvailabilityPolicyInput, CalendarWorkingHoursWindow } from './working-hours-contracts';

export const CALENDAR_WORKING_HOURS_MAX_COVERAGE_DAYS = 366;
export const CALENDAR_WORKING_HOURS_MAX_WINDOWS_PER_DAY = 8;
export const CALENDAR_WORKING_HOURS_MAX_OVERRIDES = 128;
export const CALENDAR_WORKING_HOURS_MAX_SOURCE_BYTES = 24 * 1024;
export const CALENDAR_WORKING_HOURS_MAX_GENERATED_WINDOWS = 1024;
const DAY_MS = 86_400_000;
const UTC_INSTANT = /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }

/** Detach descriptor values without invoking getters or accepting inherited/executable fields. */
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid();
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return invalid();
    const keys = Reflect.ownKeys(input);
    if (keys.length > fields.length) return invalid();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !fields.includes(key)) return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch { return invalid(); }
}

function array(input: unknown, limit: number): unknown[] {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
    const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > limit || Reflect.ownKeys(input).length !== length + 1) return invalid();
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
      result.push(descriptor.value);
    }
    return result;
  } catch { return invalid(); }
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return Object.is(value, -0) ? 0 : value;
}

/** UTC arithmetic only; setUTCFullYear avoids Date's special handling of years 00–99. */
export function calendarWorkingHoursDateOrdinal(input: unknown): number {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return invalid();
  const year = Number(input.slice(0, 4)), month = Number(input.slice(5, 7)), day = Number(input.slice(8, 10));
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalid();
  return date.getTime() / DAY_MS;
}

function instant(input: unknown): string {
  if (typeof input === 'number') return new Date(integer(input, -8_640_000_000_000_000, 8_640_000_000_000_000)).toISOString();
  if (typeof input !== 'string' || !UTC_INSTANT.test(input)) return invalid();
  const date = new Date(input);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== input) return invalid();
  return input;
}

function windows(input: unknown): readonly CalendarWorkingHoursWindow[] {
  const normalized = array(input, CALENDAR_WORKING_HOURS_MAX_WINDOWS_PER_DAY).map(value => {
    const row = record(value, ['startMinute', 'endMinute']);
    const startMinute = integer(row.startMinute, 0, 1439), endMinute = integer(row.endMinute, 1, 1440);
    if (endMinute <= startMinute) return invalid();
    return { startMinute, endMinute };
  }).sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  const merged: CalendarWorkingHoursWindow[] = [];
  for (const window of normalized) {
    const prior = merged[merged.length - 1];
    if (prior && prior.endMinute >= window.startMinute) merged[merged.length - 1] = { startMinute: prior.startMinute, endMinute: Math.max(prior.endMinute, window.endMinute) };
    else merged.push(window);
  }
  return Object.freeze(merged.map(window => Object.freeze(window)));
}

export function normalizeCalendarAvailabilityPolicy(input: unknown): CalendarAvailabilityPolicyInput {
  const row = record(input, ['kind', 'mode', 'windows', 'coverage', 'fold', 'weekly', 'overrides']);
  let normalized: CalendarAvailabilityPolicyInput;
  if (row.kind === 'explicit-utc-v1') {
    if (Object.keys(row).some(key => !['kind', 'mode', 'windows'].includes(key)) || !['unrestricted', 'windows'].includes(row.mode as string)) return invalid();
    const values = array(row.windows, 100);
    if (row.mode === 'unrestricted' && values.length) return invalid();
    const ordered = values.map(value => {
      const window = record(value, ['startAt', 'endAt']), startAt = instant(window.startAt), endAt = instant(window.endAt);
      if (Date.parse(endAt) <= Date.parse(startAt)) return invalid();
      return { startAt, endAt };
    }).sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || Date.parse(left.endAt) - Date.parse(right.endAt));
    const merged: { startAt: string; endAt: string }[] = [];
    for (const window of ordered) {
      const prior = merged[merged.length - 1];
      if (prior && Date.parse(prior.endAt) >= Date.parse(window.startAt)) merged[merged.length - 1] = { startAt: prior.startAt, endAt: Date.parse(prior.endAt) >= Date.parse(window.endAt) ? prior.endAt : window.endAt };
      else merged.push(window);
    }
    normalized = { kind: row.kind, mode: row.mode as 'unrestricted' | 'windows', windows: Object.freeze(merged.map(window => Object.freeze(window))) };
  } else if (row.kind === 'weekly-local-v1') {
    if (Object.keys(row).some(key => !['kind', 'coverage', 'fold', 'weekly', 'overrides'].includes(key)) || !['earlier', 'later'].includes(row.fold as string)) return invalid();
    const coverage = record(row.coverage, ['from', 'until']);
    const from = calendarWorkingHoursDateOrdinal(coverage.from), until = calendarWorkingHoursDateOrdinal(coverage.until);
    if (until <= from || until - from > CALENDAR_WORKING_HOURS_MAX_COVERAGE_DAYS) return invalid();
    const weekly = array(row.weekly, 7).map(value => {
      const day = record(value, ['day', 'windows']);
      return Object.freeze({ day: integer(day.day, 1, 7), windows: windows(day.windows) });
    }).sort((left, right) => left.day - right.day);
    if (new Set(weekly.map(day => day.day)).size !== weekly.length) return invalid();
    const overrides = array(row.overrides, CALENDAR_WORKING_HOURS_MAX_OVERRIDES).map(value => {
      const override = record(value, ['date', 'windows']), ordinal = calendarWorkingHoursDateOrdinal(override.date);
      if (ordinal < from || ordinal >= until) return invalid();
      return Object.freeze({ date: override.date as string, windows: windows(override.windows) });
    }).sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0);
    if (new Set(overrides.map(override => override.date)).size !== overrides.length) return invalid();
    normalized = { kind: row.kind, coverage: Object.freeze({ from: coverage.from as string, until: coverage.until as string }),
      fold: row.fold as 'earlier' | 'later', weekly: Object.freeze(weekly), overrides: Object.freeze(overrides) };
  } else return invalid();
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > CALENDAR_WORKING_HOURS_MAX_SOURCE_BYTES) return invalid();
  return Object.freeze(normalized);
}
