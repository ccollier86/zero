/** Browser-only policy DTO admission. Native expansion and private window rows never enter this module. */
import type { CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView } from '../../calendar/contracts';
import { normalizeCalendarAvailabilityPolicy, calendarWorkingHoursDateOrdinal } from '../../calendar/working-hours-model';

function invalid(): never { throw new Error('Invalid calendar availability policy.'); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  if (Object.keys(result).length !== fields.length) return invalid();
  return result;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function instant(value: unknown): string {
  const time = text(value, 27), date = new Date(time);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== time) return invalid();
  return time;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return invalid();
  return encoded;
}
export function calendarAvailabilityPolicyInput(value: unknown): CalendarAvailabilityPolicyInput {
  return normalizeCalendarAvailabilityPolicy(value);
}
export function calendarAvailabilityPolicyView(value: unknown): CalendarAvailabilityPolicyView {
  const row = record(value, ['resourceId', 'resourceRevision', 'timeZone', 'policy', 'materialization']);
  const resourceId = text(row.resourceId, 128), timeZone = text(row.timeZone, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(resourceId) || !Number.isSafeInteger(row.resourceRevision) || Number(row.resourceRevision) < 1 || /^[+-]/.test(timeZone)) return invalid();
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { return invalid(); }
  const policy = normalizeCalendarAvailabilityPolicy(row.policy);
  // A source response must already be canonical; do not quietly repair a
  // noncanonical or differently typed wire generation and call it accepted.
  if (canonical(row.policy) !== canonical(policy)) return invalid();
  let materialization: CalendarAvailabilityPolicyView['materialization'] = null;
  if (policy.kind === 'explicit-utc-v1') { if (row.materialization !== null) return invalid(); }
  else {
    const snapshot = record(row.materialization, ['coverage', 'engine', 'skippedDates', 'windowCount']);
    const coverage = record(snapshot.coverage, ['startAt', 'endAt']), engine = record(snapshot.engine, ['name', 'runtime', 'icu']);
    const startAt = instant(coverage.startAt), endAt = instant(coverage.endAt), duration = Date.parse(endAt) - Date.parse(startAt);
    const runtime = text(engine.runtime, 96), icu = text(engine.icu, 64);
    if (duration <= 0 || duration > 368 * 86_400_000 || engine.name !== 'temporal-working-hours-v1'
      || !/^[A-Za-z0-9._:+-]+$/.test(runtime) || !/^[A-Za-z0-9._:+-]+$/.test(icu)
      || !Number.isSafeInteger(snapshot.windowCount) || Number(snapshot.windowCount) < 0 || Number(snapshot.windowCount) > 1024) return invalid();
    if (!Array.isArray(snapshot.skippedDates) || Object.getPrototypeOf(snapshot.skippedDates) !== Array.prototype || snapshot.skippedDates.length > 366
      || Reflect.ownKeys(snapshot.skippedDates).length !== snapshot.skippedDates.length + 1) return invalid();
    const skippedDates: string[] = [];
    for (let index = 0; index < snapshot.skippedDates.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(snapshot.skippedDates, String(index));
      if (!descriptor || !('value' in descriptor)) return invalid();
      const date = text(descriptor.value, 10); calendarWorkingHoursDateOrdinal(date);
      if (date < policy.coverage.from || date >= policy.coverage.until || index > 0 && date <= skippedDates[index - 1]!) return invalid();
      skippedDates.push(date);
    }
    materialization = Object.freeze({ coverage: Object.freeze({ startAt, endAt }),
      engine: Object.freeze({ name: 'temporal-working-hours-v1', runtime, icu }), skippedDates: Object.freeze(skippedDates), windowCount: Number(snapshot.windowCount) });
  }
  return Object.freeze({ resourceId, resourceRevision: Number(row.resourceRevision), timeZone, policy, materialization });
}
