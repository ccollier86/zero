/** Versioned resource availability. Restrictive changes never silently cancel existing reservations. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarAvailabilityView } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { calendarActor, calendarIntent, calendarResource, calendarRevision, grantId, hasCalendarRight,
  nextCalendarRevision, requireCalendarRight, type CalendarResourceRow } from './realm-model';
import { currentCalendarAvailability, normalizeCalendarAvailability, readCalendarAvailabilityPolicy } from './availability-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';

export function readCalendarAvailability(context: DatabaseReadQueryContext, input: unknown): CalendarAvailabilityView {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id);
  const owner = context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get();
  if (owner?.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const resource = context.database.query<CalendarResourceRow>('SELECT * FROM calendar_resources WHERE id=? AND scope_id=?').get(id, actor.scopeId);
  if (!resource) throw new CalendarError('CALENDAR_NOT_FOUND');
  const grant = context.database.query<Record<string, string | number | null>>('SELECT * FROM _calendar_grants WHERE id=? AND scope_id=?')
    .get(grantId(actor.scopeId, id, actor.userId), actor.scopeId);
  if (!hasCalendarRight(actor, resource, grant, 'book') && !hasCalendarRight(actor, resource, grant, 'details')) throw new CalendarError('CALENDAR_NOT_FOUND');
  const pointer = context.database.query<{ policy_revision: number }>('SELECT policy_revision FROM _calendar_availability WHERE id=? AND scope_id=? AND resource_id=?').get(id, actor.scopeId, id);
  const history = pointer ? context.database.query<{ mode: string; windows_json: string }>(
    'SELECT mode,windows_json FROM _calendar_availability_history WHERE scope_id=? AND resource_id=? AND policy_revision=?').get(actor.scopeId, id, pointer.policy_revision) : null;
  if (pointer && !history) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { resourceId: id, resourceRevision: resource.revision, timeZone: resource.time_zone,
    ...(history ? readCalendarAvailabilityPolicy(history) : { mode: 'unrestricted', windows: [] }) };
}

export function replaceCalendarAvailability(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'requestId', 'expectedRevision', 'mode', 'windows']), actor = calendarActor(r.actor);
    if (context.db.get('_calendar_owner', 'application')?.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
    const resource = calendarResource(context, actor, r.id); requireCalendarRight(context, actor, resource, 'manage');
    const expectedRevision = calendarInteger(r.expectedRevision, 1), policy = normalizeCalendarAvailability({ mode: r.mode, windows: r.windows });
    return calendarIntent(context, actor, r.requestId, ['resource.availability', resource.id, expectedRevision, policy], 'resource', 'manage', requestId => {
      calendarRevision(resource, expectedRevision);
      const prior = currentCalendarAvailability(context, actor.scopeId, resource.id);
      if (calendarJson(prior) === calendarJson(policy)) return { requestId, operation: 'resource.availability-changed', id: resource.id, revision: resource.revision, changed: false };
      const revision = nextCalendarRevision(resource.revision), change = context.db.update('calendar_resources', resource.id, { revision });
      context.db.createStrict('_calendar_availability_history', { id: calendarHash([actor.scopeId, resource.id, revision]), scope_id: actor.scopeId,
        resource_id: resource.id, policy_revision: revision, mode: policy.mode, windows_json: calendarJson(policy.windows) });
      if (context.db.get('_calendar_availability', resource.id)) context.db.update('_calendar_availability', resource.id, { policy_revision: revision });
      else context.db.createStrict('_calendar_availability', { id: resource.id, scope_id: actor.scopeId, resource_id: resource.id, policy_revision: revision });
      appendCalendarSemanticAudit(context, 'resource.availability-changed', change, { revision });
      return { requestId, operation: 'resource.availability-changed', id: resource.id, revision, changed: true };
    });
  });
}
