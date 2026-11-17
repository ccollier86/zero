/** Short synchronous tracked commands. SQLite owns all-resource conflict decisions and rollback. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarActor, CalendarCommandReceipt, CalendarGrant } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { appointmentResources, calendarActor, calendarAppointment, calendarBudget, calendarIntent, calendarResource, calendarRevision,
  grantId, nextCalendarRevision, requireCalendarRight, reservationId } from './realm-model';
import { normalizeCalendarTimedInterval, normalizeCalendarTimeZone, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';
import { calendarSelection } from './realm-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { assertCalendarResourcesAvailable } from './occupancy';
import { assertCalendarAvailability } from './availability-model';

function owner(context: DatabaseWriteCommandContext, scopeId: string): void {
  if (context.db.get('_calendar_owner', 'application')?.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
function receipt(requestId: string, operation: CalendarCommandReceipt['operation'], id: string, revision: number, changed = true): CalendarCommandReceipt {
  return { requestId, operation, id, revision, changed };
}
function intervalFields(interval: CalendarTimedInterval) {
  return { start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
    buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes, occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs };
}
export function bindCalendarOwner(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['ownerId', 'scopeId']), ownerId = calendarKey(r.ownerId), scopeId = calendarScope(r.scopeId);
    const prior = context.db.get('_calendar_owner', 'application');
    if (prior && (prior.owner_id !== ownerId || prior.scope_id !== scopeId)) throw new CalendarError('CALENDAR_STATE_INVALID');
    if (!prior) context.db.createStrict('_calendar_owner', { id: 'application', owner_id: ownerId, scope_id: scopeId });
    return { bound: true };
  });
}
export function createCalendarResource(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'label', 'kind', 'ownerId', 'timeZone']), actor = calendarActor(r.actor);
    owner(context, actor.scopeId);
    const id = calendarKey(r.id), label = calendarText(r.label, 256), timeZone = normalizeCalendarTimeZone(r.timeZone);
    const ownerId = r.ownerId === null ? null : calendarKey(r.ownerId);
    if (!['person', 'room', 'equipment'].includes(r.kind as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    if (!actor.manageAll && !(actor.createOwn && r.kind === 'person' && ownerId === actor.userId)) throw new CalendarError('CALENDAR_FORBIDDEN');
    return calendarIntent(context, actor, r.requestId, ['resource.create', id, label, r.kind, ownerId, timeZone], 'resource', 'manage', requestId => {
      if (context.db.get('calendar_resources', id)) {
        requireCalendarRight(context, actor, calendarResource(context, actor, id), 'manage');
        throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      }
      calendarBudget(context, 'resources');
      const change = context.db.createStrict('calendar_resources', { id, scope_id: actor.scopeId, label, kind: String(r.kind), owner_id: ownerId, time_zone: timeZone, revision: 1, active: 1 });
      appendCalendarSemanticAudit(context, 'resource.created', change, { revision: 1 });
      return receipt(requestId, 'resource.created', id, 1);
    });
  });
}
export function changeCalendarGrant(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'userId', 'grants']), actor = calendarActor(r.actor);
    owner(context, actor.scopeId);
    const row = calendarResource(context, actor, r.id); requireCalendarRight(context, actor, row, 'manage');
    const userId = calendarKey(r.userId), expectedRevision = calendarInteger(r.expectedRevision, 1), values = calendarValue(r.grants);
    if (!Array.isArray(values) || values.length > 4 || values.some(value => !['busy', 'details', 'book', 'manage'].includes(value as string)) || new Set(values).size !== values.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const grants = (values as CalendarGrant[]).slice().sort();
    return calendarIntent(context, actor, r.requestId, ['resource.grant', row.id, expectedRevision, userId, grants], 'resource', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      const id = grantId(actor.scopeId, row.id, userId), prior = context.db.get('_calendar_grants', id);
      const next = { busy: grants.includes('busy') ? 1 : 0, details: grants.includes('details') ? 1 : 0, book: grants.includes('book') ? 1 : 0, manage: grants.includes('manage') ? 1 : 0 };
      if (Object.entries(next).every(([key, value]) => (prior?.[key] ?? 0) === value)) return receipt(requestId, 'resource.grant-changed', row.id, row.revision, false);
      if (prior) context.db.update('_calendar_grants', id, next);
      else context.db.createStrict('_calendar_grants', { id, scope_id: actor.scopeId, resource_id: row.id, user_id: userId, ...next });
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_resources', row.id, { revision });
      appendCalendarSemanticAudit(context, 'resource.grant-changed', change, { revision });
      return receipt(requestId, 'resource.grant-changed', row.id, revision);
    });
  });
}
export function createCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']), actor = calendarActor(r.actor);
    owner(context, actor.scopeId);
    const id = calendarKey(r.id), title = calendarText(r.title, 512), resourceIds = calendarSelection(r.resourceIds).sort();
    if (!resourceIds.length || new Set(resourceIds).size !== resourceIds.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const interval = normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone,
      bufferBeforeMinutes: r.bufferBeforeMinutes, bufferAfterMinutes: r.bufferAfterMinutes });
    for (const resourceId of resourceIds) {
      const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'book');
      if (!resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
    }
    return calendarIntent(context, actor, r.requestId, ['appointment.create', id, resourceIds, title, interval], 'appointment', 'book', requestId => {
      commitCalendarAppointment(context, actor, id, title, resourceIds, interval);
      return receipt(requestId, 'appointment.created', id, 1);
    });
  });
}
/** Internal canonical writer shared with hold confirmation, always inside the caller's realm transaction. */
export function commitCalendarAppointment(context: DatabaseWriteCommandContext, actor: CalendarActor, id: string, title: string,
  resourceIds: readonly string[], interval: CalendarTimedInterval, options?: { readonly now?: number; readonly exceptHoldId?: string }): void {
  if (context.db.get('calendar_appointments', id)) {
    calendarAppointment(context, actor, id, 'book');
    throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  }
  for (const resourceId of resourceIds) {
    const resource = calendarResource(context, actor, resourceId); requireCalendarRight(context, actor, resource, 'book');
    if (!resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
  }
  assertCalendarAvailability(context, actor.scopeId, resourceIds, interval);
  assertCalendarResourcesAvailable(context, actor.scopeId, resourceIds, interval,
    options?.exceptHoldId === undefined ? undefined : { kind: 'hold', id: options.exceptHoldId }, options?.now);
  calendarBudget(context, 'appointments');
  const change = context.db.createStrict('calendar_appointments', { id, scope_id: actor.scopeId, title, ...intervalFields(interval), status: 'confirmed', revision: 1, created_by: actor.userId });
  for (const resourceId of resourceIds) context.db.createStrict('_calendar_reservations', { id: reservationId(actor.scopeId, id, resourceId), scope_id: actor.scopeId,
    appointment_id: id, resource_id: resourceId, occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 });
  appendCalendarSemanticAudit(context, 'appointment.created', change, { revision: 1, resourceCount: resourceIds.length, status: 'confirmed' });
}
export function rescheduleCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes']), actor = calendarActor(r.actor);
    owner(context, actor.scopeId);
    const { row, resourceIds } = calendarAppointment(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    const interval = normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone,
      bufferBeforeMinutes: calendarInteger(r.bufferBeforeMinutes, 0, 1_440), bufferAfterMinutes: calendarInteger(r.bufferAfterMinutes, 0, 1_440) });
    return calendarIntent(context, actor, r.requestId, ['appointment.reschedule', row.id, expectedRevision, interval], 'appointment', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status !== 'confirmed') throw new CalendarError('CALENDAR_REVISION_CONFLICT');
      if (Object.entries(intervalFields(interval)).every(([key, value]) => row[key] === value)) return receipt(requestId, 'appointment.rescheduled', row.id, row.revision, false);
      for (const id of resourceIds) if (!calendarResource(context, actor, id).active) throw new CalendarError('CALENDAR_FORBIDDEN');
      // A zone-only display correction does not invalidate grandfathered UTC occupancy.
      if (row.start_ms !== interval.startMs || row.end_ms !== interval.endMs || row.buffer_before !== interval.bufferBeforeMinutes
        || row.buffer_after !== interval.bufferAfterMinutes) assertCalendarAvailability(context, actor.scopeId, resourceIds, interval);
      assertCalendarResourcesAvailable(context, actor.scopeId, resourceIds, interval, { kind: 'appointment', id: row.id });
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_appointments', row.id, { ...intervalFields(interval), revision });
      for (const id of resourceIds) context.db.update('_calendar_reservations', reservationId(actor.scopeId, row.id, id), { occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs });
      appendCalendarSemanticAudit(context, 'appointment.rescheduled', change, { revision, resourceCount: resourceIds.length, status: 'confirmed' });
      return receipt(requestId, 'appointment.rescheduled', row.id, revision);
    });
  });
}
export function cancelCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'confirmed']), actor = calendarActor(r.actor);
    owner(context, actor.scopeId);
    const { row } = calendarAppointment(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    // Declining the dialog is not a command and cannot consume its logical identity or create false evidence.
    if (r.confirmed !== true) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['appointment.cancel', row.id, expectedRevision], 'appointment', 'manage', requestId => {
      calendarRevision(row, expectedRevision);
      if (row.status === 'cancelled') return receipt(requestId, 'appointment.cancelled', row.id, row.revision, false);
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_appointments', row.id, { status: 'cancelled', revision });
      for (const id of appointmentResources(context, actor, row.id)) context.db.update('_calendar_reservations', reservationId(actor.scopeId, row.id, id), { active: 0 });
      appendCalendarSemanticAudit(context, 'appointment.cancelled', change, { revision, status: 'cancelled' });
      return receipt(requestId, 'appointment.cancelled', row.id, revision);
    });
  });
}
