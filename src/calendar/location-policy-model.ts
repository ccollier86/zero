/** Pure detached source normalization. UTC windows do not borrow viewer/profile timezone authority. */
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyWindow } from './location-policy-contracts';
import { CalendarError } from './error';
import { normalizeCalendarInstant } from './time';
import { calendarJson, calendarKey, calendarRecord, calendarValue } from './validation';

export const CALENDAR_LOCATION_POLICY_LIMITS = Object.freeze({ locations: 16, windowsPerLocation: 64, windows: 256, sourceBytes: 24 * 1024,
  history: 100_000, retainedWindows: 1_000_000 });
export const CALENDAR_LOCATION_POLICY_STATE = '_calendar_resource_location_policy_state';
export const CALENDAR_LOCATION_POLICY_HISTORY = '_calendar_resource_location_policy_history';
export const CALENDAR_LOCATION_POLICY_WINDOWS = '_calendar_resource_location_policy_windows';
export const CALENDAR_LOCATION_POLICY_CURRENT = '_calendar_resource_location_policy_current';
const invalid = (): never => { throw new CalendarError('CALENDAR_INPUT_INVALID'); };
export function calendarLocationPolicyIds(policy: CalendarResourceLocationPolicyInput): readonly string[] {
  return policy.kind === 'static-v1' ? [...policy.locationIds] : policy.assignments.map(assignment => assignment.locationId);
}
export function normalizeCalendarResourceLocationPolicy(input: unknown): CalendarResourceLocationPolicyInput {
  const r = calendarRecord(calendarValue(input));
  let normalized: CalendarResourceLocationPolicyInput;
  if (r.kind === 'static-v1') {
    calendarRecord(r, ['kind', 'locationIds']);
    if (!Array.isArray(r.locationIds) || r.locationIds.length > CALENDAR_LOCATION_POLICY_LIMITS.locations) return invalid();
    const locationIds = r.locationIds.map(value => calendarKey(value)).sort();
    if (new Set(locationIds).size !== locationIds.length) return invalid();
    normalized = Object.freeze({ kind: 'static-v1', locationIds: Object.freeze(locationIds) });
  } else if (r.kind === 'effective-utc-v1') {
    calendarRecord(r, ['kind', 'assignments']);
    if (!Array.isArray(r.assignments) || r.assignments.length > CALENDAR_LOCATION_POLICY_LIMITS.locations) return invalid();
    let total = 0;
    const assignments = r.assignments.map(value => {
      const assignment = calendarRecord(value, ['locationId', 'windows']), locationId = calendarKey(assignment.locationId);
      if (!Array.isArray(assignment.windows) || assignment.windows.length > CALENDAR_LOCATION_POLICY_LIMITS.windowsPerLocation) return invalid();
      total += assignment.windows.length;
      if (total > CALENDAR_LOCATION_POLICY_LIMITS.windows) return invalid();
      const windows = assignment.windows.map(value => {
        const window = calendarRecord(value, ['startAt', 'endAt']);
        if (typeof window.startAt !== 'string' || typeof window.endAt !== 'string') return invalid();
        const startAt = normalizeCalendarInstant(window.startAt), endAt = normalizeCalendarInstant(window.endAt);
        if (Date.parse(endAt) <= Date.parse(startAt)) return invalid();
        return { startAt, endAt };
      }).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt));
      const merged: CalendarResourceLocationPolicyWindow[] = [];
      for (const window of windows) {
        const prior = merged.at(-1);
        if (prior && Date.parse(window.startAt) <= Date.parse(prior.endAt)) merged[merged.length - 1] = {
          startAt: prior.startAt, endAt: Date.parse(window.endAt) > Date.parse(prior.endAt) ? window.endAt : prior.endAt };
        else merged.push(window);
      }
      return Object.freeze({ locationId, windows: Object.freeze(merged.map(window => Object.freeze(window))) });
    }).sort((a, b) => a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0);
    if (new Set(assignments.map(assignment => assignment.locationId)).size !== assignments.length) return invalid();
    normalized = Object.freeze({ kind: 'effective-utc-v1', assignments: Object.freeze(assignments) });
  } else return invalid();
  if (new TextEncoder().encode(calendarJson(normalized)).length > CALENDAR_LOCATION_POLICY_LIMITS.sourceBytes) return invalid();
  return normalized;
}
