/** Assignment-compatible active directory intersection. Not a grant or a licensure decision. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { CalendarError } from './error';
import { CALENDAR_LOCATION_JOIN, calendarLocationView, type CalendarLocationRow } from './locations-model';
import { calendarActor, calendarSelection, CALENDAR_LIMITS, grantId, hasCalendarRight, type CalendarResourceRow } from './realm-model';
import { calendarInteger, calendarKey, calendarRecord } from './validation';
import { normalizeCalendarInstant } from './time';
import { readCalendarResourceLocationCoverage } from './location-policies';

function occupiedInterval(input: unknown): { readonly startMs: number; readonly endMs: number } {
  const value = calendarRecord(input, ['startAt', 'endAt']);
  if (typeof value.startAt !== 'string' || typeof value.endAt !== 'string') throw new CalendarError('CALENDAR_INPUT_INVALID');
  const startMs = Date.parse(normalizeCalendarInstant(value.startAt)), endMs = Date.parse(normalizeCalendarInstant(value.endAt));
  calendarInteger(endMs - startMs, 1, 33 * 86_400_000);
  return { startMs, endMs };
}

export function queryCalendarVisitLocations(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'limit', 'after', 'interval']), actor = calendarActor(r.actor), resourceIds = calendarSelection(r.resourceIds);
  const limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page), after = r.after === undefined ? '' : calendarKey(r.after);
  const interval = Object.hasOwn(r, 'interval') ? occupiedInterval(r.interval) : undefined;
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
  // Validate every selected current generation only after complete resource
  // authority. Even a missing directory candidate cannot conceal a damaged
  // policy/union selector as an apparently empty eligible set.
  const coverage = resourceIds.map(id => readCalendarResourceLocationCoverage(context, actor.scopeId, id));
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
    ORDER BY l.id LIMIT ?`).all(actor.scopeId, after, ...candidates.map(row => row.location_id), ...resourceIds.slice(1), interval ? CALENDAR_LIMITS.selection + 1 : limit + 1);
  if (rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  // There are at most16 current candidate IDs. Qualify the complete common set
  // before public pagination; an early ineligible row cannot hide a later one
  // or change truncation. No interval remains a directory intersection only.
  const eligible = interval ? rows.filter(row => coverage.every(policy => policy.allows(row.id, interval.startMs, interval.endMs))) : rows;
  return { items: eligible.slice(0, limit).map(calendarLocationView), truncated: eligible.length > limit,
    nextAfter: eligible.length > limit ? eligible[limit - 1]!.id : null };
}
