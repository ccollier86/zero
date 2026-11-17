/** Scope-managed versioned appointment types and explicit resource admission policy. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarActor, CalendarAppointmentTypeReplacement, CalendarAppointmentTypeView, CalendarResourceTypesView } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarOwner, calendarActor, calendarBudget, calendarIntent, calendarResource, calendarRevision, calendarSelection, CALENDAR_LIMITS,
  grantId, hasCalendarRight, nextCalendarRevision, type CalendarResourceRow } from './realm-model';
import { CALENDAR_TYPE_JOIN, calendarType, calendarTypeFields, calendarTypePolicy, calendarTypeView, currentCalendarResourceTypes,
  parseCalendarTypePolicy, requireCalendarTypeManager, type CalendarTypeRow } from './appointment-types-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';

function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (owner?.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function historyFields(fields: CalendarAppointmentTypeReplacement) {
  return { label: fields.label, duration_minutes: fields.durationMinutes, buffer_before: fields.bufferBeforeMinutes, buffer_after: fields.bufferAfterMinutes,
    color_key: fields.colorKey, active: fields.active ? 1 : 0 };
}
function readResource(context: DatabaseReadQueryContext, actor: CalendarActor, id: string): CalendarResourceRow {
  const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Record<string, string | number | null>>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?').get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, resource, grant, 'book') && !hasCalendarRight(actor, resource, grant, 'details')) throw new CalendarError('CALENDAR_NOT_FOUND');
  return resource;
}
export function createCalendarType(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarTypeManager(actor);
    const { actor: _actor, id: _id, requestId: _request, ...values } = r, id = calendarKey(r.id), fields = calendarTypeFields(values, true);
    return calendarIntent(context, actor, r.requestId, ['type.create', id, fields], 'type', 'manage', requestId => {
      if (context.db.get('calendar_types', id)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      calendarBudget(context, 'types'); calendarBudget(context, 'typeHistory');
      context.db.createStrict('_calendar_type_history', { id: calendarHash([actor.scopeId, id, 1]), scope_id: actor.scopeId, type_id: id, type_revision: 1, ...historyFields(fields) });
      const change = context.db.createStrict('calendar_types', { id, scope_id: actor.scopeId, revision: 1 });
      appendCalendarSemanticAudit(context, 'type.created', change, { revision: 1, active: fields.active });
      return { requestId, operation: 'type.created', id, revision: 1, changed: true };
    });
  });
}
export function replaceCalendarType(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarTypeManager(actor);
    const { actor: _actor, id: _id, requestId: _request, expectedRevision: _expected, ...values } = r;
    const row = calendarType(context, actor, r.id), expectedRevision = calendarInteger(r.expectedRevision, 1), fields = calendarTypeFields(values);
    return calendarIntent(context, actor, r.requestId, ['type.replace', row.id, expectedRevision, fields], 'type', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      const { id: _id, revision: _revision, ...prior } = calendarTypeView(row);
      if (calendarJson(prior) === calendarJson(fields)) return { requestId, operation: 'type.updated', id: row.id, revision: row.revision, changed: false };
      const revision = nextCalendarRevision(row.revision); calendarBudget(context, 'typeHistory');
      context.db.createStrict('_calendar_type_history', { id: calendarHash([actor.scopeId, row.id, revision]), scope_id: actor.scopeId, type_id: row.id, type_revision: revision, ...historyFields(fields) });
      const change = context.db.update('calendar_types', row.id, { revision });
      appendCalendarSemanticAudit(context, 'type.updated', change, { revision, active: fields.active });
      return { requestId, operation: 'type.updated', id: row.id, revision, changed: true };
    });
  });
}
export function replaceCalendarResourceTypes(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'mode', 'typeIds']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarTypeManager(actor);
    const resource = calendarResource(context, actor, r.id), expectedRevision = calendarInteger(r.expectedRevision, 1), policy = calendarTypePolicy({ mode: r.mode, typeIds: r.typeIds });
    return calendarIntent(context, actor, r.requestId, ['resource.types', resource.id, expectedRevision, policy], 'resource', 'manage', requestId => {
      calendarRevision(resource, expectedRevision);
      const prior = currentCalendarResourceTypes(context, actor.scopeId, resource.id);
      if (calendarJson(prior) === calendarJson(policy)) return { requestId, operation: 'resource.types-changed', id: resource.id, revision: resource.revision, changed: false };
      for (const id of policy.typeIds) {
        const type = calendarType(context, actor, id);
        if (type.active !== 1 && !prior.typeIds.includes(id)) throw new CalendarError('CALENDAR_NOT_FOUND');
      }
      const revision = nextCalendarRevision(resource.revision); calendarBudget(context, 'resourceTypeHistory');
      const change = context.db.update('calendar_resources', resource.id, { revision });
      context.db.createStrict('_calendar_resource_type_history', { id: calendarHash([actor.scopeId, resource.id, revision]), scope_id: actor.scopeId,
        resource_id: resource.id, resource_revision: revision, mode: policy.mode, type_ids_json: calendarJson(policy.typeIds) });
      for (const typeId of policy.typeIds) context.db.createStrict('_calendar_resource_type_members', { id: calendarHash([actor.scopeId, resource.id, revision, typeId]),
        scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision, type_id: typeId });
      if (context.db.get('_calendar_resource_types', resource.id)) context.db.update('_calendar_resource_types', resource.id, { resource_revision: revision });
      else context.db.createStrict('_calendar_resource_types', { id: resource.id, scope_id: actor.scopeId, resource_id: resource.id, resource_revision: revision });
      appendCalendarSemanticAudit(context, 'resource.types-changed', change, { revision, mode: policy.mode, typeCount: policy.typeIds.length });
      return { requestId, operation: 'resource.types-changed', id: resource.id, revision, changed: true };
    });
  });
}
export function listCalendarTypes(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'resourceIds', 'limit', 'after']), actor = calendarActor(r.actor), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page);
  const after = r.after === undefined ? '' : calendarKey(r.after), selected = r.resourceIds === undefined ? null : calendarSelection(r.resourceIds);
  readOwner(context, actor.scopeId);
  if (selected?.length === 0 || selected === null && !actor.manageAll) return { items: [], truncated: false, nextAfter: null };
  // Authorize every selected resource before applying catalog pagination. Busy is
  // deliberately insufficient, and no selected identity is returned to callers.
  for (const id of selected ?? []) readResource(context, actor, id);
  const intersection = selected === null ? '' : ` AND h.active=1 AND NOT EXISTS(SELECT 1 FROM _calendar_resource_types p
    JOIN _calendar_resource_type_history policy ON policy.scope_id=p.scope_id AND policy.resource_id=p.resource_id AND policy.resource_revision=p.resource_revision
    WHERE p.scope_id=t.scope_id AND p.resource_id IN (${selected.map(() => '?').join(',')}) AND policy.mode<>'unrestricted'
    AND NOT EXISTS(SELECT 1 FROM _calendar_resource_type_members m WHERE m.scope_id=p.scope_id AND m.resource_id=p.resource_id AND m.resource_revision=p.resource_revision AND m.type_id=t.id))`;
  const rows = context.database.query<CalendarTypeRow>(`SELECT t.*,h.label,h.duration_minutes,h.buffer_before,h.buffer_after,h.color_key,h.active FROM ${CALENDAR_TYPE_JOIN}
    WHERE t.scope_id=? AND t.id>?${intersection} ORDER BY t.id LIMIT ?`).all(actor.scopeId, after, ...(selected ?? []), limit + 1);
  return { items: rows.slice(0, limit).map(calendarTypeView), truncated: rows.length > limit, nextAfter: rows.length > limit ? rows[limit - 1]!.id : null };
}
export function readCalendarType(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentTypeView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId); requireCalendarTypeManager(actor);
  const row = context.database.query<CalendarTypeRow>(`SELECT t.*,h.label,h.duration_minutes,h.buffer_before,h.buffer_after,h.color_key,h.active FROM ${CALENDAR_TYPE_JOIN} WHERE t.scope_id=? AND t.id=?`).get(actor.scopeId, calendarKey(r.id));
  if (!row) throw new CalendarError('CALENDAR_NOT_FOUND');
  return calendarTypeView(row);
}
export function readCalendarResourceTypes(context: DatabaseReadQueryContext, input: unknown): CalendarResourceTypesView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id); readOwner(context, actor.scopeId);
  const resource = readResource(context, actor, id);
  const pointer = context.database.query<{ resource_revision: number }>('SELECT resource_revision FROM _calendar_resource_types WHERE id=? AND scope_id=? AND resource_id=?').get(id, actor.scopeId, id);
  const history = pointer ? context.database.query<{ mode: string; type_ids_json: string }>('SELECT mode,type_ids_json FROM _calendar_resource_type_history WHERE scope_id=? AND resource_id=? AND resource_revision=?').get(actor.scopeId, id, pointer.resource_revision) : null;
  if (pointer && !history) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { resourceId: id, resourceRevision: resource.revision, ...(history ? parseCalendarTypePolicy(history.mode, history.type_ids_json) : { mode: 'unrestricted' as const, typeIds: [] }) };
}
