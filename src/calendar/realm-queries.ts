/** Authorized bounded projections; busy results never carry appointment IDs or titles. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { CalendarActor, CalendarGrant } from './contracts';
import { CalendarError } from './error';
import { appointmentView, calendarActor, calendarSelection, CALENDAR_LIMITS, grantId, hasCalendarRight, parseCalendarReceipt, resourceView,
  type CalendarAppointmentRow, type CalendarReceiptRow, type CalendarResourceRow } from './realm-model';
import { calendarOverlapSearchStart, normalizeCalendarInstant } from './time';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';
import { readCalendarBlockTarget } from './blocks-model';
import { readCalendarHoldTarget } from './holds-model';
import { calendarNow } from './hold-time';
import { calendarLocationSelection, calendarRegionSelection, readCalendarLocationTarget, requireCalendarLocationManager } from './locations-model';
import { readCalendarAppointmentTypeSnapshot } from './appointment-type-bindings';
import { requireCalendarTypeManager } from './appointment-types-model';
import { readCalendarAppointmentLifecycle, requireCalendarLifecycleManager } from './lifecycle-model';
import { readCalendarAppointmentVisitSnapshot } from './visit-bindings';

function owner(context: DatabaseReadQueryContext, scopeId: string): void {
  const row = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (!row || row.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function resource(context: DatabaseReadQueryContext, actor: CalendarActor, id: string, right: CalendarGrant): CalendarResourceRow {
  const row = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Record<string, string | number | null>>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, row, grant, right)) throw new CalendarError('CALENDAR_NOT_FOUND');
  return row;
}
function resourceIds(context: DatabaseReadQueryContext, scopeId: string, id: string): string[] {
  const rows = context.database.query<{ resource_id: string }>('SELECT resource_id FROM _calendar_reservations WHERE scope_id=? AND appointment_id=? ORDER BY resource_id LIMIT ?').all(scopeId, id, CALENDAR_LIMITS.selection + 1);
  if (!rows.length || rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  return rows.map(row => row.resource_id);
}
export function readCalendarAppointmentTarget(context: DatabaseReadQueryContext, actor: CalendarActor, id: string, right: CalendarGrant) {
  const row = context.database.query<CalendarAppointmentRow>('SELECT * FROM calendar_appointments WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  const ids = resourceIds(context, actor.scopeId, row.id);
  for (const id of ids) resource(context, actor, id, right);
  return { row, ids };
}
const appointment = readCalendarAppointmentTarget;
function rightSql(actor: CalendarActor, alias: string, right: 'any' | 'details') {
  if (actor.manageAll) return { sql: '1=1', params: [] as string[] };
  const grants = right === 'details' ? 'g.manage=1 OR g.details=1' : 'g.manage=1 OR g.details=1 OR g.busy=1 OR g.book=1';
  return { sql: `(${alias}.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=${alias}.scope_id AND g.resource_id=${alias}.id AND g.user_id=? AND (${grants})))`, params: [actor.userId, actor.userId] };
}
export function listCalendarResources(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'limit', 'after', 'locationIds', 'regions']), actor = calendarActor(r.actor), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page);
  const after = r.after === undefined ? '' : calendarKey(r.after); owner(context, actor.scopeId);
  const locationIds = calendarLocationSelection(r.locationIds ?? []), regions = calendarRegionSelection(r.regions ?? []);
  const right = rightSql(actor, 'r', 'any');
  const membership = (predicate: string) => `EXISTS(SELECT 1 FROM _calendar_resource_locations p JOIN _calendar_resource_location_current m ON m.scope_id=p.scope_id AND m.resource_id=p.resource_id AND m.resource_revision=p.resource_revision
    JOIN calendar_locations l ON l.scope_id=m.scope_id AND l.id=m.location_id JOIN _calendar_location_history h ON h.scope_id=l.scope_id AND h.location_id=l.id AND h.location_revision=l.revision
    WHERE p.scope_id=r.scope_id AND p.resource_id=r.id AND ${predicate})`;
  const predicates = [...(locationIds.length ? [`m.location_id IN (${locationIds.map(() => '?').join(',')})`] : []),
    ...(regions.length ? [`h.region IN (${regions.map(() => '?').join(',')})`] : [])];
  const rows = context.database.query<CalendarResourceRow>(`SELECT r.* FROM calendar_resources r WHERE r.scope_id=? AND r.id>? AND ${right.sql}${predicates.length ? ' AND ' + membership(predicates.join(' AND ')) : ''} ORDER BY r.id LIMIT ?`).all(actor.scopeId, after, ...right.params, ...locationIds, ...regions, limit + 1);
  return { items: rows.slice(0, limit).map(resourceView), truncated: rows.length > limit, nextAfter: rows.length > limit ? rows[limit - 1]!.id : null };
}
function range(context: DatabaseReadQueryContext, input: unknown, right: 'busy' | 'details') {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'startAt', 'endAt', 'limit']), actor = calendarActor(r.actor), ids = calendarSelection(r.resourceIds);
  if (new Set(ids).size !== ids.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const startMs = Date.parse(normalizeCalendarInstant(r.startAt)), endMs = Date.parse(normalizeCalendarInstant(r.endAt));
  calendarInteger(endMs - startMs, 1, CALENDAR_LIMITS.rangeMs);
  const limit = calendarInteger(r.limit ?? 100, 1, CALENDAR_LIMITS.page); owner(context, actor.scopeId);
  for (const id of ids) resource(context, actor, id, right);
  return { actor, ids, startMs, endMs, limit };
}
export function queryCalendarBusy(context: DatabaseReadQueryContext, input: unknown) {
  const r = range(context, input, 'busy');
  if (!r.ids.length) return { items: [], truncated: false };
  type BusyRow = { id: string; resource_id: string; occupied_start_ms: number; occupied_end_ms: number };
  const rows: (BusyRow & { kind: number })[] = [], lower = calendarOverlapSearchStart(r.startMs), now = calendarNow();
  // The global first L+1 must be contained in the first L+1 of every sorted
  // resource/store partition. Avoid sorting the entire selected date range in
  // SQLite: at most 3 * 16 * (L+1) rows cross this actor-local read boundary.
  for (const resourceId of r.ids) for (const [table, kind] of [['_calendar_reservations', 0], ['_calendar_block_reservations', 1], ['_calendar_hold_reservations', 2]] as const) {
    const selected = context.database.query<BusyRow>(`SELECT resource_id,occupied_start_ms,occupied_end_ms,id FROM ${table}
      WHERE scope_id=? AND resource_id=? AND active=1 AND occupied_start_ms>=? AND occupied_start_ms<? AND occupied_end_ms>?${kind === 2 ? ' AND expires_ms>?' : ''}
      ORDER BY occupied_start_ms,id LIMIT ?`).all(r.actor.scopeId, resourceId, lower, r.endMs, r.startMs, ...(kind === 2 ? [now] : []), r.limit + 1);
    for (const row of selected) rows.push({ ...row, kind });
  }
  // Canonical IDs are ASCII. Relational comparison matches SQLite BINARY;
  // localeCompare would change the existing private tie-break order.
  const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  rows.sort((left, right) => left.occupied_start_ms - right.occupied_start_ms || compareId(left.resource_id, right.resource_id)
    || left.kind - right.kind || compareId(left.id, right.id));
  return { items: rows.slice(0, r.limit).map(row => ({ resourceId: row.resource_id, startAt: new Date(row.occupied_start_ms).toISOString(), endAt: new Date(row.occupied_end_ms).toISOString() })), truncated: rows.length > r.limit };
}
export function queryCalendarAppointments(context: DatabaseReadQueryContext, input: unknown) {
  const r = range(context, input, 'details');
  if (!r.ids.length) return { items: [], truncated: false };
  const placeholders = r.ids.map(() => '?').join(','), right = rightSql(r.actor, 'resource', 'details');
  // Complete authorization, including unselected co-resources, is filtered before LIMIT/truncation.
  const rows = context.database.query<CalendarAppointmentRow>(`SELECT a.* FROM calendar_appointments a WHERE a.scope_id=? AND a.status='confirmed' AND a.occupied_start_ms>=? AND a.occupied_start_ms<? AND a.occupied_end_ms>?
    AND EXISTS(SELECT 1 FROM _calendar_reservations selected WHERE selected.scope_id=a.scope_id AND selected.appointment_id=a.id AND selected.resource_id IN (${placeholders}))
    AND NOT EXISTS(SELECT 1 FROM _calendar_reservations rr JOIN calendar_resources resource ON resource.id=rr.resource_id AND resource.scope_id=rr.scope_id WHERE rr.scope_id=a.scope_id AND rr.appointment_id=a.id AND NOT ${right.sql})
    ORDER BY a.occupied_start_ms,a.id LIMIT ?`).all(r.actor.scopeId, calendarOverlapSearchStart(r.startMs), r.endMs, r.startMs, ...r.ids, ...right.params, r.limit + 1);
  return { items: rows.slice(0, r.limit).map(row => appointmentView(row, resourceIds(context, r.actor.scopeId, row.id),
    readCalendarAppointmentTypeSnapshot(context, r.actor.scopeId, row.id), readCalendarAppointmentLifecycle(context, r.actor.scopeId, row.id), readCalendarAppointmentVisitSnapshot(context, r.actor.scopeId, row.id))), truncated: rows.length > r.limit };
}
export function readCalendarAppointment(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); owner(context, actor.scopeId);
  const { row, ids } = appointment(context, actor, calendarKey(r.id), 'details');
  return appointmentView(row, ids, readCalendarAppointmentTypeSnapshot(context, actor.scopeId, row.id), readCalendarAppointmentLifecycle(context, actor.scopeId, row.id), readCalendarAppointmentVisitSnapshot(context, actor.scopeId, row.id));
}
export function readCalendarReceipt(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'requestId']), actor = calendarActor(r.actor), requestId = calendarKey(r.requestId); owner(context, actor.scopeId);
  const id = calendarHash([actor.scopeId, actor.principal, requestId]);
  const rows = context.database.query<CalendarReceiptRow>(`SELECT * FROM _calendar_receipts WHERE id=? AND scope_id=? AND principal=?
    UNION ALL SELECT * FROM _calendar_block_receipts WHERE id=? AND scope_id=? AND principal=?
    UNION ALL SELECT * FROM _calendar_hold_receipts WHERE id=? AND scope_id=? AND principal=?
    UNION ALL SELECT * FROM _calendar_location_receipts WHERE id=? AND scope_id=? AND principal=?
    UNION ALL SELECT * FROM _calendar_type_receipts WHERE id=? AND scope_id=? AND principal=?
    UNION ALL SELECT * FROM _calendar_lifecycle_receipts WHERE id=? AND scope_id=? AND principal=?`).all(id, actor.scopeId, actor.principal, id, actor.scopeId, actor.principal, id, actor.scopeId, actor.principal, id, actor.scopeId, actor.principal, id, actor.scopeId, actor.principal, id, actor.scopeId, actor.principal);
  if (rows.length > 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  const row = rows[0];
  if (!row) return null;
  if (parseCalendarReceipt(row).operation === 'appointment.participants-changed' && !actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
  if (row.target_kind === 'lifecycle') requireCalendarLifecycleManager(actor);
  else if (row.target_kind === 'resource') { if (parseCalendarReceipt(row).operation === 'resource.types-changed') requireCalendarTypeManager(actor); resource(context, actor, row.target_id, row.required_right); }
  else if (row.target_kind === 'block') readCalendarBlockTarget(context, actor, row.target_id, row.required_right);
  else if (row.target_kind === 'hold') readCalendarHoldTarget(context, actor, row.target_id, row.required_right);
  else if (row.target_kind === 'location') { requireCalendarLocationManager(actor); readCalendarLocationTarget(context, actor, row.target_id); }
  else if (row.target_kind === 'type') {
    requireCalendarTypeManager(actor);
    if (!context.database.query<{ id: string }>('SELECT id FROM calendar_types WHERE scope_id=? AND id=?').get(actor.scopeId, row.target_id)) throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  else appointment(context, actor, row.target_id, row.required_right);
  const result = parseCalendarReceipt(row);
  if (row.target_kind === 'appointment' && result.operation === 'appointment.created') {
    const holds = context.database.query<{ id: string; principal: string; created_by: string }>(
      'SELECT id,principal,created_by FROM calendar_holds WHERE scope_id=? AND appointment_id=? LIMIT 2').all(actor.scopeId, row.target_id);
    if (holds.length > 1) throw new CalendarError('CALENDAR_STATE_INVALID');
    if (holds[0]) {
      if (holds[0].principal !== actor.principal || holds[0].created_by !== actor.userId) throw new CalendarError('CALENDAR_NOT_FOUND');
      readCalendarHoldTarget(context, actor, holds[0].id, 'book');
    }
  }
  return result;
}
