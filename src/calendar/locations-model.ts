/** Location metadata is directory information, not geographic or booking authority. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarLocationView } from './contracts';
import { CalendarError } from './error';
import { calendarSelection, eq } from './realm-model';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarValue } from './validation';

export interface CalendarLocationPointer extends Row { id: string; scope_id: string; revision: number }
export interface CalendarLocationRow extends CalendarLocationPointer { label: string; region: string | null; active: number }
export interface CalendarLocationWitness { locationId: string; resourceId: string }
export function calendarLocationCurrentId(scopeId: string, resourceId: string, locationId: string): string { return calendarHash([scopeId, resourceId, locationId]); }
export function calendarLocationWitnesses(input: unknown): CalendarLocationWitness[] {
  const values = calendarValue(input);
  if (!Array.isArray(values) || values.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const witnesses = values.map(value => { const r = calendarRecord(value, ['locationId', 'resourceId']); return { locationId: calendarKey(r.locationId), resourceId: calendarKey(r.resourceId) }; });
  if (new Set(witnesses.map(value => value.locationId)).size !== witnesses.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return witnesses;
}

export function calendarRegion(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(input)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input;
}
export const calendarLocationSelection = calendarSelection;
export function calendarRegionSelection(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const regions = input.map(value => calendarRegion(value));
  if (regions.some(value => value === null) || new Set(regions).size !== regions.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return (regions as string[]).sort();
}
export function requireCalendarLocationManager(actor: CalendarActor): void {
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
}
export function calendarLocation(context: CalendarReadContext, actor: CalendarActor, input: unknown): CalendarLocationRow {
  const id = calendarKey(input), pointer = context.db.get('calendar_locations', id) as CalendarLocationPointer | null;
  if (!pointer || pointer.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const history = context.db.find('_calendar_location_history', { filters: [eq('scope_id', actor.scopeId), eq('location_id', id), eq('location_revision', pointer.revision)], limit: 2 });
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { ...pointer, label: String(history[0]!.label), region: history[0]!.region as string | null, active: Number(history[0]!.active) };
}
export function calendarLocationView(row: CalendarLocationRow): CalendarLocationView {
  return { id: row.id, label: row.label, region: row.region, active: row.active === 1, revision: row.revision };
}
/** Every membership used here belongs to the current assignment, and every
 * resource right is current. This predicate must be applied before LIMIT. */
export function calendarLocationVisibility(actor: CalendarActor, alias: string): { sql: string; params: string[] } {
  if (actor.manageAll) return { sql: '1=1', params: [] };
  return { sql: `EXISTS(SELECT 1 FROM _calendar_resource_location_current m
    JOIN _calendar_resource_locations p ON p.scope_id=m.scope_id AND p.resource_id=m.resource_id AND p.resource_revision=m.resource_revision
    JOIN calendar_resources r ON r.id=m.resource_id AND r.scope_id=m.scope_id
    WHERE m.scope_id=${alias}.scope_id AND m.location_id=${alias}.id AND (r.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=r.scope_id AND g.resource_id=r.id AND g.user_id=? AND (g.manage=1 OR g.details=1 OR g.busy=1 OR g.book=1))))`, params: [actor.userId, actor.userId] };
}
export const CALENDAR_LOCATION_JOIN = 'calendar_locations l JOIN _calendar_location_history h ON h.scope_id=l.scope_id AND h.location_id=l.id AND h.location_revision=l.revision';
export function readCalendarLocationTarget(context: DatabaseReadQueryContext, actor: CalendarActor, input: unknown): CalendarLocationRow {
  const id = calendarKey(input), visibility = calendarLocationVisibility(actor, 'l');
  const row = context.database.query<CalendarLocationRow>(`SELECT l.*,h.label,h.region,h.active FROM ${CALENDAR_LOCATION_JOIN} WHERE l.scope_id=? AND l.id=? AND ${visibility.sql}`).get(actor.scopeId, id, ...visibility.params);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  return row;
}
export function parseCalendarLocationIds(input: unknown): string[] {
  try {
    if (typeof input !== 'string') throw new Error();
    const ids = calendarLocationSelection(JSON.parse(input));
    if (calendarJson(ids) !== input) throw new Error();
    return ids;
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
export function currentCalendarResourceLocations(context: CalendarReadContext, scopeId: string, resourceId: string): string[] {
  const pointer = context.db.get('_calendar_resource_locations', resourceId);
  if (!pointer) return [];
  if (pointer.scope_id !== scopeId || pointer.resource_id !== resourceId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const history = context.db.find('_calendar_resource_location_history', { filters: [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('resource_revision', calendarInteger(pointer.resource_revision, 1))], limit: 2 });
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return parseCalendarLocationIds(history[0]!.location_ids_json);
}
