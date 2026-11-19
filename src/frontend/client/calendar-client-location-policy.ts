/** Browser-only, descriptor-safe mirror of the native bounded UTC assignment dialect. */
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView, CalendarResourceLocationPolicyWindow } from '../../calendar/contracts';
function invalid(): never { throw new Error('Invalid calendar location policy.'); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid();
    result[key] = descriptor.value;
  }
  if (Object.keys(result).length !== fields.length) return invalid();
  return result;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    return descriptor.value;
  });
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return invalid(); return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || value.length > 27 || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return invalid();
  const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return invalid(); return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  const encoded = JSON.stringify(value); if (encoded === undefined) return invalid(); return encoded;
}
export function calendarLocationPolicyInput(value: unknown): CalendarResourceLocationPolicyInput {
  // Admit the discriminant as data before admitting the selected closed branch.
  if (!value || typeof value !== 'object') return invalid();
  const kind = Object.getOwnPropertyDescriptor(value, 'kind'); if (!kind || !('value' in kind)) return invalid();
  let policy: CalendarResourceLocationPolicyInput;
  if (kind.value === 'static-v1') {
    const row = record(value, ['kind', 'locationIds']), locationIds = array(row.locationIds, 16).map(id).sort();
    if (new Set(locationIds).size !== locationIds.length) return invalid();
    policy = Object.freeze({ kind: 'static-v1', locationIds: Object.freeze(locationIds) });
  } else if (kind.value === 'effective-utc-v1') {
    const row = record(value, ['kind', 'assignments']); let total = 0;
    const assignments = array(row.assignments, 16).map(value => {
      const assignment = record(value, ['locationId', 'windows']), locationId = id(assignment.locationId), raw = array(assignment.windows, 64);
      total += raw.length; if (total > 256) return invalid();
      const windows = raw.map(value => {
        const window = record(value, ['startAt', 'endAt']), startAt = instant(window.startAt), endAt = instant(window.endAt);
        if (Date.parse(endAt) <= Date.parse(startAt)) return invalid(); return { startAt, endAt };
      }).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt));
      const merged: CalendarResourceLocationPolicyWindow[] = [];
      for (const window of windows) {
        const prior = merged.at(-1);
        if (prior && Date.parse(window.startAt) <= Date.parse(prior.endAt)) merged[merged.length - 1] = { startAt: prior.startAt,
          endAt: Date.parse(window.endAt) > Date.parse(prior.endAt) ? window.endAt : prior.endAt };
        else merged.push(window);
      }
      return Object.freeze({ locationId, windows: Object.freeze(merged.map(window => Object.freeze(window))) });
    }).sort((a, b) => a.locationId < b.locationId ? -1 : a.locationId > b.locationId ? 1 : 0);
    if (new Set(assignments.map(assignment => assignment.locationId)).size !== assignments.length) return invalid();
    policy = Object.freeze({ kind: 'effective-utc-v1', assignments: Object.freeze(assignments) });
  } else return invalid();
  if (new TextEncoder().encode(canonical(policy)).length > 24 * 1024) return invalid();
  return policy;
}
export function calendarLocationPolicyView(value: unknown, resourceId: string): CalendarResourceLocationPolicyView {
  const row = record(value, ['resourceId', 'resourceRevision', 'policy']);
  if (id(row.resourceId) !== resourceId || !Number.isSafeInteger(row.resourceRevision) || Number(row.resourceRevision) < 1) return invalid();
  const policy = calendarLocationPolicyInput(row.policy);
  if (canonical(row.policy) !== canonical(policy)) return invalid(); // Responses are proof, not input requiring repair.
  return Object.freeze({ resourceId, resourceRevision: Number(row.resourceRevision), policy });
}
