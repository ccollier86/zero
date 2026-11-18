/** Assignment-compatible active directory intersection. Not a grant or a licensure decision. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { CalendarError } from './error';
import { CALENDAR_LOCATION_JOIN, calendarLocationView, type CalendarLocationRow } from './locations-model';
import { calendarActor, calendarSelection, CALENDAR_LIMITS, grantId, hasCalendarRight, type CalendarResourceRow } from './realm-model';
import { calendarInteger, calendarKey, calendarRecord } from './validation';

export function queryCalendarVisitLocations(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'limit', 'after']), actor = calendarActor(r.actor), resourceIds = calendarSelection(r.resourceIds);
  const limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page), after = r.after === undefined ? '' : calendarKey(r.after);
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (owner?.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  // Admission finishes for every co-resource before touching any directory row.
  for (const id of resourceIds) {
    const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
    if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
    const grant = context.database.query<Row>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
    if (!hasCalendarRight(actor, resource, grant, 'book')) throw new CalendarError('CALENDAR_NOT_FOUND');
    if (resource.active !== 1) throw new CalendarError('CALENDAR_FORBIDDEN');
  }
  if (!resourceIds.length) return { items: [], truncated: false, nextAfter: null };
  // Current assignment cardinality is <=16. Seed from that bounded indexed set,
  // never the scope-wide directory or retained assignment history. The extra
  // row detects invalid state without an unbounded read or silent truncation.
  // Pin the resource-first index: SQLite may otherwise prefer the covering
  // location-first lookup index and traverse the entire scope's current set.
  const candidates = context.database.query<{ location_id: string }>(`SELECT m.location_id FROM _calendar_resource_location_current m INDEXED BY calendar_resource_location_current_identity
    JOIN _calendar_resource_locations p ON p.scope_id=m.scope_id AND p.resource_id=m.resource_id AND p.resource_revision=m.resource_revision
    WHERE m.scope_id=? AND m.resource_id=? ORDER BY m.location_id LIMIT ?`).all(actor.scopeId, resourceIds[0]!, CALENDAR_LIMITS.selection + 1);
  if (candidates.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (!candidates.length) return { items: [], truncated: false, nextAfter: null };
  const intersections = resourceIds.slice(1).map(() => `EXISTS(SELECT 1 FROM _calendar_resource_location_current m
    JOIN _calendar_resource_locations p ON p.scope_id=m.scope_id AND p.resource_id=m.resource_id AND p.resource_revision=m.resource_revision
    WHERE m.scope_id=l.scope_id AND m.location_id=l.id AND m.resource_id=?)`).join(' AND ');
  const rows = context.database.query<CalendarLocationRow>(`SELECT l.*,h.label,h.region,h.active FROM ${CALENDAR_LOCATION_JOIN}
    WHERE l.scope_id=? AND l.id>? AND h.active=1 AND l.id IN (${candidates.map(() => '?').join(',')})${intersections ? ' AND ' + intersections : ''}
    ORDER BY l.id LIMIT ?`).all(actor.scopeId, after, ...candidates.map(row => row.location_id), ...resourceIds.slice(1), limit + 1);
  return { items: rows.slice(0, limit).map(calendarLocationView), truncated: rows.length > limit, nextAfter: rows.length > limit ? rows[limit - 1]!.id : null };
}
