/** Explicit, bounded policy normalization. Recurring working-hours expansion is deliberately separate. */
import type { CalendarReadContext } from './calendar-read-store';
import type { CalendarAvailabilityInput, CalendarAvailabilityWindow } from './contracts';
import { CalendarError } from './error';
import { normalizeCalendarInstant, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarRecord, calendarValue } from './validation';
import { assertCalendarAvailabilityPolicy, currentCalendarAvailabilityPolicy } from './working-hours';

export const CALENDAR_AVAILABILITY_WINDOW_LIMIT = 100;
/** Policy window length does not change the bounded occupied-interval lookup invariant. */
export function normalizeCalendarAvailability(input: unknown): CalendarAvailabilityInput {
  const r = calendarRecord(input, ['mode', 'windows']), values = calendarValue(r.windows);
  if (!['unrestricted', 'windows'].includes(r.mode as string) || !Array.isArray(values)
    || values.length > CALENDAR_AVAILABILITY_WINDOW_LIMIT || r.mode === 'unrestricted' && values.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const windows = values.map(value => {
    const w = calendarRecord(value, ['startAt', 'endAt']), startAt = normalizeCalendarInstant(w.startAt), endAt = normalizeCalendarInstant(w.endAt);
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return { startAt, endAt };
  }).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt));
  const merged: CalendarAvailabilityWindow[] = [];
  for (const w of windows) {
    const prior = merged[merged.length - 1];
    if (prior && Date.parse(w.startAt) <= Date.parse(prior.endAt)) {
      merged[merged.length - 1] = { startAt: prior.startAt, endAt: Date.parse(w.endAt) > Date.parse(prior.endAt) ? w.endAt : prior.endAt };
    } else merged.push(w);
  }
  return { mode: r.mode as CalendarAvailabilityInput['mode'], windows: merged };
}

/** Stored normalized policy must already be sorted and merged; corrupt policy is not an empty/unrestricted fallback. */
export function readCalendarAvailabilityPolicy(row: { mode: unknown; windows_json: unknown }): CalendarAvailabilityInput {
  try {
    if (typeof row.windows_json !== 'string') throw new Error();
    const values = calendarValue(JSON.parse(row.windows_json));
    if (!['unrestricted', 'windows'].includes(row.mode as string) || !Array.isArray(values)
      || values.length > CALENDAR_AVAILABILITY_WINDOW_LIMIT || row.mode === 'unrestricted' && values.length) throw new Error();
    let end = -Infinity;
    const windows = values.map(value => {
      const w = calendarRecord(value, ['startAt', 'endAt']), startAt = normalizeCalendarInstant(w.startAt), endAt = normalizeCalendarInstant(w.endAt);
      const startMs = Date.parse(startAt), endMs = Date.parse(endAt);
      if (endMs <= startMs || startMs <= end) throw new Error();
      end = endMs; return { startAt, endAt };
    });
    return { mode: row.mode as CalendarAvailabilityInput['mode'], windows };
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}

export function currentCalendarAvailability(context: CalendarReadContext, scopeId: string, resourceId: string): CalendarAvailabilityInput {
  const policy = currentCalendarAvailabilityPolicy(context, scopeId, resourceId);
  if (policy?.kind === 'weekly-local-v1') throw new CalendarError('CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED');
  return policy ? { mode: policy.mode, windows: policy.windows } : currentLegacyCalendarAvailability(context, scopeId, resourceId);
}
/** Retained pre-009 policy only. Callers must explicitly select it rather than override a current local policy. */
export function currentLegacyCalendarAvailability(context: CalendarReadContext, scopeId: string, resourceId: string): CalendarAvailabilityInput {
  const pointer = context.db.get('_calendar_availability', resourceId);
  if (!pointer) return { mode: 'unrestricted', windows: [] };
  if (pointer.scope_id !== scopeId || pointer.resource_id !== resourceId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const history = context.db.find('_calendar_availability_history', { filters: [
    { type: 'field', field: 'scope_id', operator: 'eq', value: scopeId },
    { type: 'field', field: 'resource_id', operator: 'eq', value: resourceId },
    { type: 'field', field: 'policy_revision', operator: 'eq', value: calendarInteger(pointer.policy_revision, 1) },
  ], limit: 2 });
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return readCalendarAvailabilityPolicy({ mode: history[0]!.mode, windows_json: history[0]!.windows_json });
}

export function assertCalendarAvailability(context: CalendarReadContext, scopeId: string,
  resourceIds: readonly string[], interval: CalendarTimedInterval): void {
  for (const resourceId of resourceIds) {
    if (assertCalendarAvailabilityPolicy(context, scopeId, resourceId, interval)) continue;
    const policy = currentCalendarAvailability(context, scopeId, resourceId);
    if (policy.mode === 'windows' && !policy.windows.some(w => Date.parse(w.startAt) <= interval.occupiedStartMs
      && Date.parse(w.endAt) >= interval.occupiedEndMs)) throw new CalendarError('CALENDAR_AVAILABILITY_CONFLICT');
  }
}
