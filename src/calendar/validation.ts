/** Bounded canonical data; no getters, proxies, executable objects or raw authority are client inputs. */
import { createHash } from 'node:crypto';
import { workerRecord, workerValue, type WorkerValue } from '../workers/worker-value';
import { stableStringify } from '../migrations/schema-snapshot';
import { CalendarError } from './error';

export function calendarRecord(input: unknown, fields?: readonly string[]): Record<string, unknown> {
  try { return workerRecord(input, fields); } catch { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
}
export function calendarInteger(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input;
}
export function calendarText(input: unknown, limit = 256): string {
  if (typeof input !== 'string' || !input || input.length > limit || /[\u0000-\u001f\u007f]/.test(input)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input;
}
export function calendarKey(input: unknown, limit = 128): string {
  const key = calendarText(input, limit);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return key;
}
export function calendarScope(input: unknown): string {
  const id = calendarText(input, 263);
  if (id !== 'application' && (!id.startsWith('tenant:') || id.length <= 7 || id.slice(7).trim() !== id.slice(7))) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return id;
}
export function calendarValue(input: unknown): WorkerValue {
  try {
    const value = workerValue(input);
    if (Buffer.byteLength(stableStringify(value)) > 32 * 1024) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return value;
  } catch { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
}
export function calendarJson(input: unknown): string { return stableStringify(calendarValue(input)); }
export function calendarHash(input: unknown): string { return createHash('sha256').update(calendarJson(input)).digest('hex'); }
