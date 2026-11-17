/** Admission limits match the immutable realm ceilings; configuration may narrow, never advertise more. */
import type { ResolvedCalendarConfig } from './config';
import type { CalendarCommandReceipt, CalendarRangeQuery, CalendarResourcePageQuery } from './contracts';
import { CalendarError } from './error';
import { normalizeCalendarInstant } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarValue } from './validation';

export function calendarPageQuery(input: unknown, config: ResolvedCalendarConfig): CalendarResourcePageQuery {
  const r = calendarRecord(input, ['after', 'limit']);
  return { limit: calendarInteger(r.limit === undefined ? Math.min(25, config.maxPageSize) : r.limit, 1, config.maxPageSize),
    ...(r.after === undefined ? {} : { after: calendarKey(r.after) }) };
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
export function calendarReceipt(input: unknown, requestId: string, operation: string, id: string): CalendarCommandReceipt {
  const r = calendarRecord(input, ['requestId', 'operation', 'id', 'revision', 'changed']);
  const expected = { 'resource.create': 'resource.created', 'resource.grant': 'resource.grant-changed',
    'appointment.create': 'appointment.created', 'appointment.reschedule': 'appointment.rescheduled', 'appointment.cancel': 'appointment.cancelled' }[operation];
  if (!expected || r.requestId !== requestId || r.operation !== expected || r.id !== id || typeof r.changed !== 'boolean') throw new CalendarError('CALENDAR_STATE_INVALID');
  calendarInteger(r.revision, 1);
  return Object.freeze({ requestId, operation: expected as CalendarCommandReceipt['operation'], id, revision: r.revision as number, changed: r.changed });
}
