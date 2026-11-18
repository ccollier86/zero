/** Private hold subjects and membership. A hold is never an authority snapshot or a public booking proof. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentTypeSnapshot, CalendarHoldView, CalendarVisitSnapshot } from './contracts';
import { CalendarError } from './error';
import { calendarNow } from './hold-time';
import { CALENDAR_LIMITS, calendarResource, eq, grantId, hasCalendarRight, type CalendarResourceRow } from './realm-model';
import { calendarHash, calendarKey } from './validation';

export const CALENDAR_HOLD_LIMITS = Object.freeze({ principal: 16, scope: 1_000, ttl: 300, maxTtl: 900 });
export interface CalendarHoldRow extends Row {
  id: string; scope_id: string; principal: string; created_by: string; created_ms: number; revision: number;
  start_at: string; end_at: string; start_ms: number; end_ms: number; time_zone: string;
  buffer_before: number; buffer_after: number; occupied_start_ms: number; occupied_end_ms: number;
  status: 'held' | 'released' | 'confirmed'; expires_ms: number; appointment_id: string | null;
}
export interface CalendarHoldReservationRow extends Row {
  id: string; scope_id: string; hold_id: string; resource_id: string; resource_revision: number;
  occupied_start_ms: number; occupied_end_ms: number; expires_ms: number; active: number;
}
export interface CalendarHoldTarget {
  row: CalendarHoldRow; resourceIds: string[]; reservations: CalendarHoldReservationRow[];
}
type HoldRight = 'book' | 'manage';

export function holdReservationId(scopeId: string, holdId: string, resourceId: string): string {
  return calendarHash(['hold', scopeId, holdId, resourceId]);
}
function boundedReservations(rows: CalendarHoldReservationRow[]): CalendarHoldReservationRow[] {
  if (!rows.length || rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  return rows.sort((a, b) => a.resource_id < b.resource_id ? -1 : a.resource_id > b.resource_id ? 1 : 0);
}
export function isCalendarHoldSubject(actor: CalendarActor, row: CalendarHoldRow): boolean {
  return row.scope_id === actor.scopeId && row.principal === actor.principal && row.created_by === actor.userId;
}

/** The creator needs current book on every co-resource; a manager needs current manage on every co-resource. */
export function calendarHold(context: DatabaseWriteCommandContext, actor: CalendarActor, input: unknown, right: HoldRight = 'book'): CalendarHoldTarget {
  const row = context.db.get('calendar_holds', calendarKey(input)) as CalendarHoldRow | null;
  if (!row || row.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const reservations = boundedReservations(context.db.find('_calendar_hold_reservations', {
    filters: [eq('scope_id', actor.scopeId), eq('hold_id', row.id)], limit: CALENDAR_LIMITS.selection + 1,
  }) as CalendarHoldReservationRow[]);
  let book = true, manage = true;
  for (const reservation of reservations) {
    const resource = calendarResource(context, actor, reservation.resource_id);
    const grant = context.db.get('_calendar_grants', grantId(actor.scopeId, resource.id, actor.userId));
    book = book && hasCalendarRight(actor, resource, grant, 'book');
    manage = manage && hasCalendarRight(actor, resource, grant, 'manage');
  }
  if (!manage && !(right === 'book' && isCalendarHoldSubject(actor, row) && book)) throw new CalendarError('CALENDAR_NOT_FOUND');
  return { row, resourceIds: reservations.map(reservation => reservation.resource_id), reservations };
}

export function readCalendarHoldResourceIds(context: DatabaseReadQueryContext, scopeId: string, id: string): string[] {
  return readReservations(context, scopeId, id).map(row => row.resource_id);
}
function readReservations(context: DatabaseReadQueryContext, scopeId: string, id: string): CalendarHoldReservationRow[] {
  return boundedReservations(context.database.query<CalendarHoldReservationRow>(
    'SELECT * FROM _calendar_hold_reservations WHERE scope_id=? AND hold_id=? ORDER BY resource_id LIMIT ?')
    .all(scopeId, id, CALENDAR_LIMITS.selection + 1));
}

/** Current authority applies even to expired/released history and immutable safe receipts. */
export function readCalendarHoldTarget(context: DatabaseReadQueryContext, actor: CalendarActor, id: string, right: HoldRight = 'book'): CalendarHoldTarget {
  const row = context.database.query<CalendarHoldRow>('SELECT * FROM calendar_holds WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  const reservations = readReservations(context, actor.scopeId, row.id);
  let book = true, manage = true;
  for (const reservation of reservations) {
    const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(reservation.resource_id, actor.scopeId);
    if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
    const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?')
      .get(grantId(actor.scopeId, reservation.resource_id, actor.userId), actor.scopeId);
    book = book && hasCalendarRight(actor, resource, grant, 'book');
    manage = manage && hasCalendarRight(actor, resource, grant, 'manage');
  }
  if (!manage && !(right === 'book' && isCalendarHoldSubject(actor, row) && book)) throw new CalendarError('CALENDAR_NOT_FOUND');
  return { row, resourceIds: reservations.map(reservation => reservation.resource_id), reservations };
}

export function holdView(row: CalendarHoldRow, resourceIds: string[], now = calendarNow(), appointmentType?: CalendarAppointmentTypeSnapshot, visit?: CalendarVisitSnapshot): CalendarHoldView {
  return { id: row.id, revision: row.revision, resourceIds, startAt: row.start_at, endAt: row.end_at, timeZone: row.time_zone,
    bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after,
    status: row.status === 'held' && row.expires_ms <= now ? 'expired' : row.status,
    expiresAt: new Date(row.expires_ms).toISOString(), createdBy: row.created_by, appointmentId: row.appointment_id,
    ...(appointmentType ? { appointmentType } : {}), ...(visit ? { visit } : {}) };
}
