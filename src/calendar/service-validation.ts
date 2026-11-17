/** Admission limits match the immutable realm ceilings; configuration may narrow, never advertise more. */
import type { ResolvedCalendarConfig } from './config';
import type { CalendarAppointmentTypePageQuery, CalendarCommandReceipt, CalendarLocationPageQuery, CalendarRangeQuery, CalendarResourcePageQuery } from './contracts';
import { CalendarError } from './error';
import { normalizeCalendarInstant } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarText, calendarValue } from './validation';

export function calendarPageQuery(input: unknown, config: Pick<ResolvedCalendarConfig, 'maxPageSize'>): CalendarLocationPageQuery {
  const r = calendarRecord(input, ['after', 'limit']);
  return { limit: calendarInteger(r.limit === undefined ? Math.min(25, config.maxPageSize) : r.limit, 1, config.maxPageSize),
    ...(r.after === undefined ? {} : { after: calendarKey(r.after) }) };
}
function region(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(input)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input;
}
/** Frozen selections are detached before admission awaits. Empty facets never confer authority. */
export function calendarLocationIds(input: unknown): readonly string[] {
  const values = calendarValue(input);
  if (!Array.isArray(values) || values.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const result = values.map(value => calendarKey(value)).sort();
  if (new Set(result).size !== result.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze(result);
}
export function calendarResourcePageQuery(input: unknown, config: Pick<ResolvedCalendarConfig, 'maxPageSize'>): CalendarResourcePageQuery {
  const r = calendarRecord(input, ['after', 'limit', 'locationIds', 'regions']);
  const base = calendarPageQuery({ ...(r.after === undefined ? {} : { after: r.after }), ...(r.limit === undefined ? {} : { limit: r.limit }) }, config);
  const regions = r.regions === undefined ? undefined : calendarValue(r.regions);
  if (regions !== undefined && (!Array.isArray(regions) || regions.length > 16)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const acceptedRegions = regions === undefined ? undefined : (regions as unknown[]).map(region).sort();
  if (acceptedRegions && new Set(acceptedRegions).size !== acceptedRegions.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ ...base, ...(r.locationIds === undefined ? {} : { locationIds: calendarLocationIds(r.locationIds) }),
    ...(acceptedRegions === undefined ? {} : { regions: Object.freeze(acceptedRegions) }) });
}
export function calendarAppointmentTypePageQuery(input: unknown, config: Pick<ResolvedCalendarConfig, 'maxPageSize' | 'maxResources'>): CalendarAppointmentTypePageQuery {
  const r = calendarRecord(input, ['after', 'limit', 'resourceIds']);
  const base = calendarPageQuery({ ...(r.after === undefined ? {} : { after: r.after }), ...(r.limit === undefined ? {} : { limit: r.limit }) }, config);
  if (r.resourceIds === undefined) return Object.freeze(base);
  const values = calendarValue(r.resourceIds);
  if (!Array.isArray(values) || values.length > config.maxResources) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const resourceIds = values.map(value => calendarKey(value)).sort();
  if (new Set(resourceIds).size !== resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ ...base, resourceIds: Object.freeze(resourceIds) });
}
export function calendarAppointmentTypeInput(input: unknown, replacement = false): Record<string, unknown> {
  const fields = ['label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active'];
  const r = calendarRecord(input, fields);
  calendarText(r.label, 256); calendarInteger(r.durationMinutes, 1, 44_640);
  if (replacement && fields.some(field => !Object.hasOwn(r, field) || r[field] === undefined)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (r[key] !== undefined) calendarInteger(r[key], 0, 1440);
  if (r.colorKey !== undefined && r.colorKey !== null) region(r.colorKey);
  if (r.active !== undefined && typeof r.active !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return calendarValue(r) as Record<string, unknown>;
}
export function calendarTypeReference(input: unknown): Record<string, unknown> {
  const r = calendarRecord(input, ['id', 'revision']);
  calendarKey(r.id); calendarInteger(r.revision, 1);
  return calendarValue(r) as Record<string, unknown>;
}
export function calendarResourceTypesInput(input: unknown): Record<string, unknown> {
  const r = calendarRecord(input, ['mode', 'typeIds']);
  if (!['unrestricted', 'optional', 'required'].includes(r.mode as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const values = calendarValue(r.typeIds);
  if (!Array.isArray(values) || values.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const typeIds = values.map(value => calendarKey(value)).sort();
  if (new Set(typeIds).size !== typeIds.length || r.mode === 'unrestricted' && typeIds.length !== 0) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { mode: r.mode, typeIds: Object.freeze(typeIds) };
}
export function calendarLifecyclePolicyInput(input: unknown): Record<string, unknown> {
  const r = calendarRecord(input, ['extended', 'cancellationReason', 'noShowReason']);
  if (typeof r.extended !== 'boolean' || !['optional', 'required'].includes(r.cancellationReason as string)
    || !['optional', 'required'].includes(r.noShowReason as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return calendarValue(r) as Record<string, unknown>;
}
export function calendarLifecycleReason(input: unknown): string {
  const text = calendarText(input, 1024).trim();
  if (!text) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return text;
}
export function calendarAppointmentTransitionInput(input: unknown): Record<string, unknown> {
  const r = calendarRecord(input, ['status', 'policyRevision', 'reason']);
  if (!['tentative', 'confirmed', 'completed', 'no-show', 'cancelled'].includes(r.status as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  calendarInteger(r.policyRevision, 1);
  if (Object.hasOwn(r, 'reason') && r.status !== 'cancelled' && r.status !== 'no-show') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { ...calendarValue(r) as Record<string, unknown>, ...(Object.hasOwn(r, 'reason') ? { reason: calendarLifecycleReason(r.reason) } : {}) };
}
/** Create defaults belong to the realm; replacement must explicitly supply every retained catalog field. */
export function calendarLocationInput(input: unknown, replacement = false): Record<string, unknown> {
  const r = calendarRecord(input, ['label', 'region', 'active']);
  calendarText(r.label, 256);
  if (replacement && (!Object.hasOwn(r, 'region') || !Object.hasOwn(r, 'active'))) throw new CalendarError('CALENDAR_INPUT_INVALID');
  if (r.region !== undefined && r.region !== null) region(r.region);
  if (replacement && r.region === undefined || r.active !== undefined && typeof r.active !== 'boolean'
    || replacement && r.active === undefined) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return calendarValue(r) as Record<string, unknown>;
}
export function calendarRange(input: unknown, config: ResolvedCalendarConfig): CalendarRangeQuery {
  const r = calendarRecord(input, ['resourceIds', 'startAt', 'endAt', 'limit']);
  const ids = calendarValue(r.resourceIds);
  if (!Array.isArray(ids) || ids.length > config.maxResources) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const resourceIds = ids.map(value => calendarKey(value)).sort();
  if (new Set(resourceIds).size !== resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const startAt = normalizeCalendarInstant(r.startAt), endAt = normalizeCalendarInstant(r.endAt);
  calendarInteger(Date.parse(endAt) - Date.parse(startAt), 1, config.maxRangeDays * 86_400_000);
  return Object.freeze({ resourceIds: Object.freeze(resourceIds), startAt, endAt,
    limit: calendarInteger(r.limit === undefined ? config.maxPageSize : r.limit, 1, config.maxPageSize) });
}
export function calendarReceipt(input: unknown, requestId: string, operation: string, id: string, expectedRevision?: number): CalendarCommandReceipt {
  const r = calendarRecord(input, ['requestId', 'operation', 'id', 'revision', 'changed']);
  const expected = { 'resource.create': 'resource.created', 'resource.grant': 'resource.grant-changed',
    'resource.availability': 'resource.availability-changed',
    'resource.locations': 'resource.locations-changed', 'location.create': 'location.created', 'location.replace': 'location.updated',
    'type.create': 'type.created', 'type.replace': 'type.updated', 'resource.types': 'resource.types-changed',
    'block.create': 'block.created', 'block.reschedule': 'block.rescheduled', 'block.cancel': 'block.cancelled',
    'hold.acquire': 'hold.acquired', 'hold.release': 'hold.released', 'hold.confirm': 'appointment.created',
    'appointment.create': 'appointment.created', 'appointment.reschedule': 'appointment.rescheduled', 'appointment.cancel': 'appointment.cancelled',
    'appointment.transition': 'appointment.transitioned', 'lifecycle.replace': 'lifecycle.policy-changed' }[operation];
  if (!expected || r.requestId !== requestId || r.operation !== expected || r.id !== id || typeof r.changed !== 'boolean') throw new CalendarError('CALENDAR_STATE_INVALID');
  calendarInteger(r.revision, 1);
  if (expectedRevision !== undefined && (operation === 'lifecycle.replace' || operation === 'appointment.transition')
    && (r.revision !== expectedRevision + (r.changed ? 1 : 0) || operation === 'appointment.transition' && !r.changed)) throw new CalendarError('CALENDAR_STATE_INVALID');
  return Object.freeze({ requestId, operation: expected as CalendarCommandReceipt['operation'], id, revision: r.revision as number, changed: r.changed });
}
