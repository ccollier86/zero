/** Private visit identity; labels and regions always resolve retained location history. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarVisitInput, CalendarVisitSnapshot } from './contracts';
import { CalendarError } from './error';
import { currentCalendarResourceLocations } from './locations-model';
import { calendarBudget, eq } from './realm-model';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

interface VisitRow extends Row { visit_mode: 'in-person' | 'video' | 'phone' | null; location_id: string | null; location_revision: number | null }
interface AppointmentVisitRow extends VisitRow { id: string; scope_id: string; appointment_id: string; appointment_revision: number }
interface LocationHistoryRow extends Row { location_id: string; location_revision: number; label: string; region: string | null; active: number }

export function calendarVisitInput(input: unknown): CalendarVisitInput | undefined {
  if (input === undefined) return undefined;
  const r = calendarRecord(input, ['mode', 'location']);
  if (r.mode === 'in-person') {
    const location = calendarRecord(r.location, ['id', 'revision']);
    return { mode: 'in-person', location: { id: calendarKey(location.id), revision: calendarInteger(location.revision, 1) } };
  }
  if ((r.mode === 'video' || r.mode === 'phone') && !Object.hasOwn(r, 'location')) return { mode: r.mode };
  throw new CalendarError('CALENDAR_INPUT_INVALID');
}
export function sameCalendarVisit(left: CalendarVisitInput | undefined, right: CalendarVisitInput | undefined): boolean {
  return left?.mode === right?.mode && (left?.mode !== 'in-person' || right?.mode === 'in-person'
    && left.location.id === right.location.id && left.location.revision === right.location.revision);
}
/** Assignment intersection precedes every client-selected catalog lookup, even for global managers. */
export function assertCalendarVisitPolicy(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[], visit: CalendarVisitInput | undefined): void {
  assertCalendarVisitPolicyForScope(context, actor.scopeId, resourceIds, visit);
}
/** Private policy core only. A scope is not authorization; callers admit every resource first. */
export function assertCalendarVisitPolicyForScope(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[], visit: CalendarVisitInput | undefined): void {
  if (visit?.mode !== 'in-person') return;
  for (const resourceId of resourceIds) if (!currentCalendarResourceLocations(context, scopeId, resourceId).includes(visit.location.id)) throw new CalendarError('CALENDAR_VISIT_CONFLICT');
}
function snapshot(row: VisitRow, location?: LocationHistoryRow): CalendarVisitSnapshot | undefined {
  if (row.visit_mode === null) return undefined;
  if (row.visit_mode === 'video' || row.visit_mode === 'phone') return { mode: row.visit_mode };
  if (row.visit_mode !== 'in-person' || !location) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { mode: 'in-person', location: { id: location.location_id, revision: location.location_revision, label: location.label, region: location.region } };
}
function commandSnapshot(context: CalendarReadContext, scopeId: string, row: VisitRow): CalendarVisitSnapshot | undefined {
  if (row.visit_mode !== 'in-person') return snapshot(row);
  const history = context.db.find('_calendar_location_history', { filters: [eq('scope_id', scopeId), eq('location_id', String(row.location_id)), eq('location_revision', calendarInteger(row.location_revision, 1))], limit: 2 }) as LocationHistoryRow[];
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return snapshot(row, history[0]);
}
/** New admission only; receipt replays never consult current catalog state. */
export function assertCalendarBookingVisit(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[], visit: CalendarVisitInput | undefined): CalendarVisitSnapshot | undefined {
  return assertCalendarBookingVisitForScope(context, actor.scopeId, resourceIds, visit);
}
/** Private selected-generation admission. It neither impersonates a user nor authorizes a resource. */
export function assertCalendarBookingVisitForScope(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[], visit: CalendarVisitInput | undefined): CalendarVisitSnapshot | undefined {
  assertCalendarVisitPolicyForScope(context, scopeId, resourceIds, visit);
  if (visit?.mode !== 'in-person') return visit;
  const current = context.db.get('calendar_locations', visit.location.id);
  if (!current || current.scope_id !== scopeId) throw new CalendarError('CALENDAR_VISIT_CONFLICT');
  if (current.revision !== visit.location.revision) throw new CalendarError('CALENDAR_VISIT_STALE');
  const rows = context.db.find('_calendar_location_history', { filters: [eq('scope_id', scopeId), eq('location_id', visit.location.id), eq('location_revision', visit.location.revision)], limit: 2 }) as LocationHistoryRow[];
  if (rows.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (rows[0]!.active !== 1) throw new CalendarError('CALENDAR_VISIT_STALE');
  return snapshot({ visit_mode: visit.mode, location_id: visit.location.id, location_revision: visit.location.revision }, rows[0]);
}
function fields(visit: CalendarVisitInput | undefined) {
  return { visit_mode: visit?.mode ?? null, location_id: visit?.mode === 'in-person' ? visit.location.id : null,
    location_revision: visit?.mode === 'in-person' ? visit.location.revision : null };
}
function pointerId(scopeId: string, id: string) { return calendarHash(['appointment.visit', scopeId, id]); }
function holdId(scopeId: string, id: string) { return calendarHash(['hold.visit', scopeId, id]); }
export function calendarAppointmentVisitAtRevision(context: CalendarReadContext, scopeId: string, id: string, revision: number): CalendarVisitSnapshot | undefined {
  const rows = context.db.find('_calendar_appointment_visit_bindings', { filters: [eq('scope_id', scopeId), eq('appointment_id', id),
    { type: 'field', field: 'appointment_revision', operator: 'lte', value: revision }], order: [{ field: 'appointment_revision', direction: 'desc' }], limit: 1 }) as AppointmentVisitRow[];
  return rows[0] ? commandSnapshot(context, scopeId, rows[0]) : undefined;
}
export function calendarCurrentAppointmentVisit(context: CalendarReadContext, scopeId: string, id: string): CalendarVisitSnapshot | undefined {
  const pointer = context.db.get('_calendar_appointment_visit_current', pointerId(scopeId, id));
  if (!pointer) return undefined;
  if (pointer.scope_id !== scopeId || pointer.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  const binding = context.db.get('_calendar_appointment_visit_bindings', String(pointer.binding_id)) as AppointmentVisitRow | null;
  if (!binding || binding.scope_id !== scopeId || binding.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return commandSnapshot(context, scopeId, binding);
}
export function bindCalendarAppointmentVisit(context: DatabaseWriteCommandContext, scopeId: string, id: string, revision: number, visit: CalendarVisitInput | undefined): void {
  calendarBudget(context, 'appointmentVisitHistory');
  const bindingId = calendarHash(['appointment.visit', scopeId, id, revision]), pointer = pointerId(scopeId, id);
  context.db.createStrict('_calendar_appointment_visit_bindings', { id: bindingId, scope_id: scopeId, appointment_id: id, appointment_revision: revision, ...fields(visit) });
  if (context.db.get('_calendar_appointment_visit_current', pointer)) context.db.update('_calendar_appointment_visit_current', pointer, { binding_id: bindingId });
  else context.db.createStrict('_calendar_appointment_visit_current', { id: pointer, scope_id: scopeId, appointment_id: id, binding_id: bindingId });
}
export function bindCalendarHoldVisit(context: DatabaseWriteCommandContext, scopeId: string, id: string, visit: CalendarVisitInput): void {
  context.db.createStrict('_calendar_hold_visit_bindings', { id: holdId(scopeId, id), scope_id: scopeId, hold_id: id, ...fields(visit) });
}
export function calendarHoldVisit(context: CalendarReadContext, scopeId: string, id: string): CalendarVisitSnapshot | undefined {
  const row = context.db.get('_calendar_hold_visit_bindings', holdId(scopeId, id));
  if (!row) return undefined;
  if (row.scope_id !== scopeId || row.hold_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return commandSnapshot(context, scopeId, row as VisitRow);
}
function readSnapshot(context: DatabaseReadQueryContext, scopeId: string, row: VisitRow): CalendarVisitSnapshot | undefined {
  if (row.visit_mode !== 'in-person') return snapshot(row);
  const history = context.database.query<LocationHistoryRow>('SELECT * FROM _calendar_location_history WHERE scope_id=? AND location_id=? AND location_revision=? LIMIT 2').all(scopeId, row.location_id, row.location_revision);
  if (history.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return snapshot(row, history[0]);
}
export function readCalendarAppointmentVisitSnapshot(context: DatabaseReadQueryContext, scopeId: string, id: string): CalendarVisitSnapshot | undefined {
  const pointer = context.database.query<{ binding_id: string }>('SELECT binding_id FROM _calendar_appointment_visit_current WHERE scope_id=? AND appointment_id=?').get(scopeId, id);
  if (!pointer) return undefined;
  const row = context.database.query<VisitRow>('SELECT * FROM _calendar_appointment_visit_bindings WHERE id=? AND scope_id=? AND appointment_id=?').get(pointer.binding_id, scopeId, id);
  if (!row) throw new CalendarError('CALENDAR_STATE_INVALID');
  return readSnapshot(context, scopeId, row);
}
export function readCalendarHoldVisitSnapshot(context: DatabaseReadQueryContext, scopeId: string, id: string): CalendarVisitSnapshot | undefined {
  const row = context.database.query<VisitRow>('SELECT * FROM _calendar_hold_visit_bindings WHERE scope_id=? AND hold_id=?').get(scopeId, id);
  return row ? readSnapshot(context, scopeId, row) : undefined;
}
