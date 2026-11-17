/** Private one-off block primitives shared by canonical handlers and live receipt authorization. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarBlockView, CalendarGrant } from './contracts';
import { CalendarError } from './error';
import { CALENDAR_LIMITS, calendarResource, eq, grantId, hasCalendarRight, requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { calendarHash, calendarKey } from './validation';

export interface CalendarBlockRow extends Row {
  id: string; scope_id: string; title: string; start_at: string; end_at: string; start_ms: number; end_ms: number;
  time_zone: string; status: CalendarBlockView['status']; revision: number; created_by: string;
}

export function blockReservationId(scopeId: string, blockId: string, resourceId: string): string {
  return calendarHash(['block', scopeId, blockId, resourceId]);
}

export function blockResources(context: DatabaseWriteCommandContext, actor: CalendarActor, id: string): string[] {
  const rows = context.db.find('_calendar_block_reservations', { select: ['resource_id'],
    filters: [eq('scope_id', actor.scopeId), eq('block_id', id)], limit: CALENDAR_LIMITS.selection + 1 });
  if (!rows.length || rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  return rows.map(row => String(row.resource_id)).sort();
}

export function calendarBlock(context: DatabaseWriteCommandContext, actor: CalendarActor, input: unknown, right: CalendarGrant): { row: CalendarBlockRow; resourceIds: string[] } {
  const row = context.db.get('calendar_blocks', calendarKey(input)) as CalendarBlockRow | null;
  if (!row || row.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const resourceIds = blockResources(context, actor, row.id);
  for (const id of resourceIds) requireCalendarRight(context, actor, calendarResource(context, actor, id), right);
  return { row, resourceIds };
}

export function readCalendarBlockResource(context: DatabaseReadQueryContext, actor: CalendarActor, id: string, right: CalendarGrant): CalendarResourceRow {
  const row = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?')
    .get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, row, grant, right)) throw new CalendarError('CALENDAR_NOT_FOUND');
  return row;
}

export function readCalendarBlockResourceIds(context: DatabaseReadQueryContext, scopeId: string, id: string): string[] {
  const rows = context.database.query<{ resource_id: string }>(
    'SELECT resource_id FROM _calendar_block_reservations WHERE scope_id=? AND block_id=? ORDER BY resource_id LIMIT ?')
    .all(scopeId, id, CALENDAR_LIMITS.selection + 1);
  if (!rows.length || rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  return rows.map(row => row.resource_id);
}

/** Current all-co-resource rights, including cancelled history; receipts never preserve historical authority. */
export function readCalendarBlockTarget(context: DatabaseReadQueryContext, actor: CalendarActor, id: string, right: CalendarGrant): { row: CalendarBlockRow; resourceIds: string[] } {
  const row = context.database.query<CalendarBlockRow>('SELECT * FROM calendar_blocks WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  const resourceIds = readCalendarBlockResourceIds(context, actor.scopeId, row.id);
  for (const id of resourceIds) readCalendarBlockResource(context, actor, id, right);
  return { row, resourceIds };
}

export function blockView(row: CalendarBlockRow, resourceIds: string[]): CalendarBlockView {
  return { id: row.id, revision: row.revision, resourceIds, title: row.title, startAt: row.start_at, endAt: row.end_at,
    timeZone: row.time_zone, status: row.status, createdBy: row.created_by };
}
