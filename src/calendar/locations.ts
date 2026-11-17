/** Versioned private location directory and resource metadata. No booking policy is implied. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarLocationView, CalendarResourceLocationsView } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarOwner, calendarActor, calendarBudget, calendarIntent, calendarResource, calendarRevision, CALENDAR_LIMITS,
  grantId, hasCalendarRight, nextCalendarRevision, requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { CALENDAR_LOCATION_JOIN, calendarLocation, calendarLocationCurrentId, calendarLocationSelection, calendarLocationView, calendarLocationVisibility, calendarLocationWitnesses, calendarRegion,
  currentCalendarResourceLocations, parseCalendarLocationIds, readCalendarLocationTarget, requireCalendarLocationManager, type CalendarLocationRow, type CalendarLocationWitness } from './locations-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarText } from './validation';

function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (owner?.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function activeValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return value;
}
export function createCalendarLocation(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'label', 'region', 'active']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarLocationManager(actor);
    const id = calendarKey(r.id), label = calendarText(r.label), region = calendarRegion(r.region === undefined ? null : r.region), active = activeValue(r.active === undefined ? true : r.active);
    return calendarIntent(context, actor, r.requestId, ['location.create', id, label, region, active], 'location', 'manage', requestId => {
      if (context.db.get('calendar_locations', id)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      calendarBudget(context, 'locations'); calendarBudget(context, 'locationHistory');
      context.db.createStrict('_calendar_location_history', { id: calendarHash([actor.scopeId, id, 1]), scope_id: actor.scopeId, location_id: id,
        location_revision: 1, label, region, active: active ? 1 : 0 });
      const change = context.db.createStrict('calendar_locations', { id, scope_id: actor.scopeId, revision: 1 });
      appendCalendarSemanticAudit(context, 'location.created', change, { revision: 1, active });
      return { requestId, operation: 'location.created', id, revision: 1, changed: true };
    });
  });
}
export function replaceCalendarLocation(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'label', 'region', 'active']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarLocationManager(actor);
    const row = calendarLocation(context, actor, r.id), expectedRevision = calendarInteger(r.expectedRevision, 1), label = calendarText(r.label), region = calendarRegion(r.region), active = activeValue(r.active);
    return calendarIntent(context, actor, r.requestId, ['location.replace', row.id, expectedRevision, label, region, active], 'location', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.label === label && row.region === region && (row.active === 1) === active) return { requestId, operation: 'location.updated', id: row.id, revision: row.revision, changed: false };
      const revision = nextCalendarRevision(row.revision); calendarBudget(context, 'locationHistory');
      context.db.createStrict('_calendar_location_history', { id: calendarHash([actor.scopeId, row.id, revision]), scope_id: actor.scopeId,
        location_id: row.id, location_revision: revision, label, region, active: active ? 1 : 0 });
      const change = context.db.update('calendar_locations', row.id, { revision });
      appendCalendarSemanticAudit(context, 'location.updated', change, { revision, active });
      return { requestId, operation: 'location.updated', id: row.id, revision, changed: true };
    });
  });
}
export function replaceCalendarResourceLocations(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'locationIds', 'locationWitnesses']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const resource = calendarResource(context, actor, r.id); requireCalendarRight(context, actor, resource, 'manage');
    const expectedRevision = calendarInteger(r.expectedRevision, 1), locationIds = calendarLocationSelection(r.locationIds), witnesses = calendarLocationWitnesses(r.locationWitnesses ?? []);
    if (witnesses.some(witness => !locationIds.includes(witness.locationId))) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['resource.locations', resource.id, expectedRevision, locationIds], 'resource', 'manage', requestId => {
      calendarRevision(resource, expectedRevision);
      const prior = currentCalendarResourceLocations(context, actor.scopeId, resource.id);
      if (calendarJson(prior) === calendarJson(locationIds)) return { requestId, operation: 'resource.locations-changed', id: resource.id, revision: resource.revision, changed: false };
      for (const id of locationIds) {
        // A successful mutation must not make a guessed hidden directory ID
        // visible. Witnesses are selected by a private authorized read, then
        // independently revalidated here against current rights/membership.
        if (!actor.manageAll && !prior.includes(id)) {
          const witness = witnesses.find(value => value.locationId === id);
          if (!witness) throw new CalendarError('CALENDAR_NOT_FOUND');
          const source = calendarResource(context, actor, witness.resourceId), grant = context.db.get('_calendar_grants', grantId(actor.scopeId, source.id, actor.userId));
          if (!hasCalendarRight(actor, source, grant, 'busy') && !hasCalendarRight(actor, source, grant, 'book')) throw new CalendarError('CALENDAR_NOT_FOUND');
          const pointer = context.db.get('_calendar_resource_locations', source.id), member = context.db.get('_calendar_resource_location_current', calendarLocationCurrentId(actor.scopeId, source.id, id));
          if (!pointer || !member || pointer.scope_id !== actor.scopeId || pointer.resource_id !== source.id || member.scope_id !== actor.scopeId || member.resource_id !== source.id || member.location_id !== id || member.resource_revision !== pointer.resource_revision) throw new CalendarError('CALENDAR_NOT_FOUND');
        }
        const row = calendarLocation(context, actor, id);
        if (row.active !== 1 && !prior.includes(id)) throw new CalendarError('CALENDAR_NOT_FOUND');
      }
      const revision = nextCalendarRevision(resource.revision); calendarBudget(context, 'resourceLocationHistory');
      const change = context.db.update('calendar_resources', resource.id, { revision });
      context.db.createStrict('_calendar_resource_location_history', { id: calendarHash([actor.scopeId, resource.id, revision]), scope_id: actor.scopeId,
        resource_id: resource.id, resource_revision: revision, location_ids_json: calendarJson(locationIds) });
      for (const locationId of locationIds) context.db.createStrict('_calendar_resource_location_members', { id: calendarHash([actor.scopeId, resource.id, revision, locationId]),
        scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision, location_id: locationId });
      if (context.db.get('_calendar_resource_locations', resource.id)) context.db.update('_calendar_resource_locations', resource.id, { resource_revision: revision });
      else context.db.createStrict('_calendar_resource_locations', { id: resource.id, scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision });
      for (const locationId of prior) context.db.delete('_calendar_resource_location_current', calendarLocationCurrentId(actor.scopeId, resource.id, locationId));
      for (const locationId of locationIds) context.db.createStrict('_calendar_resource_location_current', { id: calendarLocationCurrentId(actor.scopeId, resource.id, locationId),
        scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision, location_id: locationId });
      appendCalendarSemanticAudit(context, 'resource.locations-changed', change, { revision, locationCount: locationIds.length });
      return { requestId, operation: 'resource.locations-changed', id: resource.id, revision, changed: true };
    });
  });
}
/** Internal broker projection, never an authored public command field. A
 * witness conveys no authority: the writer revalidates its exact current row. */
export function queryCalendarLocationAssignmentWitnesses(context: DatabaseReadQueryContext, input: unknown): CalendarLocationWitness[] {
  const r = calendarRecord(input, ['actor', 'locationIds']), actor = calendarActor(r.actor), locationIds = calendarLocationSelection(r.locationIds);
  readOwner(context, actor.scopeId);
  if (actor.manageAll) return [];
  const witnesses: CalendarLocationWitness[] = [];
  for (const locationId of locationIds) {
    const source = context.database.query<{ resource_id: string }>(`SELECT m.resource_id FROM _calendar_resource_location_current m
      JOIN _calendar_resource_locations p ON p.scope_id=m.scope_id AND p.resource_id=m.resource_id AND p.resource_revision=m.resource_revision
      JOIN calendar_resources resource ON resource.scope_id=m.scope_id AND resource.id=m.resource_id
      WHERE m.scope_id=? AND m.location_id=? AND (resource.owner_id IS ? OR EXISTS(SELECT 1 FROM _calendar_grants g WHERE g.scope_id=resource.scope_id AND g.resource_id=resource.id AND g.user_id=? AND (g.manage=1 OR g.details=1 OR g.busy=1 OR g.book=1)))
      ORDER BY m.resource_id LIMIT 1`).get(actor.scopeId, locationId, actor.userId, actor.userId);
    if (source) witnesses.push({ locationId, resourceId: source.resource_id });
  }
  return witnesses;
}
export function listCalendarLocations(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'limit', 'after']), actor = calendarActor(r.actor), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page);
  const after = r.after === undefined ? '' : calendarKey(r.after); readOwner(context, actor.scopeId);
  const visibility = calendarLocationVisibility(actor, 'l');
  const rows = context.database.query<CalendarLocationRow>(`SELECT l.*,h.label,h.region,h.active FROM ${CALENDAR_LOCATION_JOIN} WHERE l.scope_id=? AND l.id>? AND ${visibility.sql} ORDER BY l.id LIMIT ?`).all(actor.scopeId, after, ...visibility.params, limit + 1);
  return { items: rows.slice(0, limit).map(calendarLocationView), truncated: rows.length > limit, nextAfter: rows.length > limit ? rows[limit - 1]!.id : null };
}
export function readCalendarLocation(context: DatabaseReadQueryContext, input: unknown): CalendarLocationView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId);
  return calendarLocationView(readCalendarLocationTarget(context, actor, r.id));
}
export function readCalendarResourceLocations(context: DatabaseReadQueryContext, input: unknown): CalendarResourceLocationsView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id); readOwner(context, actor.scopeId);
  const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Record<string, string | number | null>>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, resource, grant, 'busy') && !hasCalendarRight(actor, resource, grant, 'book')) throw new CalendarError('CALENDAR_NOT_FOUND');
  const pointer = context.database.query<{ resource_revision: number }>('SELECT resource_revision FROM _calendar_resource_locations WHERE id=? AND scope_id=? AND resource_id=?').get(id, actor.scopeId, id);
  const history = pointer ? context.database.query<{ location_ids_json: string }>('SELECT location_ids_json FROM _calendar_resource_location_history WHERE scope_id=? AND resource_id=? AND resource_revision=?').get(actor.scopeId, id, pointer.resource_revision) : null;
  if (pointer && !history) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { resourceId: id, resourceRevision: resource.revision, locationIds: history ? parseCalendarLocationIds(history.location_ids_json) : [] };
}
