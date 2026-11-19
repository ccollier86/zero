/** Private atomic rich-edit admission. Pure normalization confers no authority and reads no catalog/defaults. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarAppointmentTypeReference, CalendarAppointmentUpdateInput, CalendarVisitInput } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { calendarParticipantReferences } from './participants-validation';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarJson, calendarKey, calendarRecord, calendarText, calendarValue } from './validation';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarBudget, calendarIntent, calendarResource, calendarRevision,
  nextCalendarRevision, requireCalendarRight, reservationId } from './realm-model';
import { appendCalendarAppointmentUpdateHistory, calendarCurrentResourceMembership, replaceCalendarAppointmentResourceCurrent } from './appointment-resource-bindings';
import { calendarCurrentAppointmentType, bindCalendarAppointmentType, sameCalendarAppointmentType } from './appointment-type-bindings';
import { calendarCurrentAppointmentVisit, bindCalendarAppointmentVisit, sameCalendarVisit } from './visit-bindings';
import { bindCalendarAppointmentParticipants, calendarCurrentAppointmentParticipants, requireCalendarParticipantManager } from './participant-bindings';
import { effectiveCalendarAppointmentStatus, isCalendarLifecycleTerminal } from './lifecycle-model';
import { admitCalendarBookingCandidate } from './booking-admission';
import { appendCalendarSemanticAudit } from './semantic-audit';

export const CALENDAR_APPOINTMENT_UPDATE_FIELDS = Object.freeze([
  'title', 'resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'appointmentType', 'visit', 'participants',
] as const);
const INTERVAL_FIELDS = ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes'] as const;
function typeReference(value: unknown): CalendarAppointmentTypeReference {
  const r = calendarRecord(value, ['id', 'revision']);
  return Object.freeze({ id: calendarKey(r.id), revision: calendarInteger(r.revision, 1) });
}
function visitReference(value: unknown): CalendarVisitInput {
  const r = calendarRecord(value, ['mode', 'location']);
  if (r.mode === 'in-person') return Object.freeze({ mode: r.mode, location: typeReference(r.location) });
  if ((r.mode === 'video' || r.mode === 'phone') && !Object.hasOwn(r, 'location')) return Object.freeze({ mode: r.mode });
  throw new CalendarError('CALENDAR_INPUT_INVALID');
}

/** Server-only closed wire normalization. A complete explicit interval or no interval; omission never means clear/default. */
export function normalizeCalendarAppointmentUpdate(input: unknown): Readonly<CalendarAppointmentUpdateInput> {
  const r = calendarRecord(calendarValue(input), CALENDAR_APPOINTMENT_UPDATE_FIELDS);
  if (!Object.keys(r).length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const normalized: Record<string, unknown> = {};
  if (Object.hasOwn(r, 'title')) normalized.title = calendarText(r.title, 512);
  if (Object.hasOwn(r, 'resourceIds')) {
    if (!Array.isArray(r.resourceIds) || !r.resourceIds.length || r.resourceIds.length > 16) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const ids = r.resourceIds.map(value => calendarKey(value));
    if (new Set(ids).size !== ids.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
    normalized.resourceIds = Object.freeze(ids.sort());
  }
  if (INTERVAL_FIELDS.some(field => Object.hasOwn(r, field))) {
    if (!INTERVAL_FIELDS.every(field => Object.hasOwn(r, field))) throw new CalendarError('CALENDAR_INPUT_INVALID');
    calendarInteger(r.bufferBeforeMinutes, 0, 1440); calendarInteger(r.bufferAfterMinutes, 0, 1440);
    const interval = normalizeCalendarTimedInterval(Object.fromEntries(INTERVAL_FIELDS.map(field => [field, r[field]])));
    for (const field of INTERVAL_FIELDS) normalized[field] = interval[field];
  }
  if (Object.hasOwn(r, 'appointmentType')) normalized.appointmentType = r.appointmentType === null ? null : typeReference(r.appointmentType);
  if (Object.hasOwn(r, 'visit')) normalized.visit = r.visit === null ? null : visitReference(r.visit);
  if (Object.hasOwn(r, 'participants')) normalized.participants = Object.freeze(calendarParticipantReferences(r.participants).map(ref => Object.freeze(ref)));
  return Object.freeze(normalized) as Readonly<CalendarAppointmentUpdateInput>;
}

function intervalFields(interval: CalendarTimedInterval) {
  return { start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
    buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes, occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs };
}
function snapshot(title: string, resourceIds: readonly string[], interval: CalendarTimedInterval,
  appointmentType: CalendarAppointmentTypeReference | undefined, visit: CalendarVisitInput | undefined,
  participants: ReturnType<typeof calendarCurrentAppointmentParticipants>) {
  return { title, resourceIds, startAt: interval.startAt, endAt: interval.endAt, timeZone: interval.timeZone,
    bufferBeforeMinutes: interval.bufferBeforeMinutes, bufferAfterMinutes: interval.bufferAfterMinutes,
    appointmentType: appointmentType ? { id: appointmentType.id, revision: appointmentType.revision } : null,
    visit: visit?.mode === 'in-person' ? { mode: visit.mode, location: { id: visit.location.id, revision: visit.location.revision } } : visit ?? null,
    participants };
}

/** One canonical source decision. The trusted parent supplies fresh SYSTEM participant admission at the real commit fence. */
export function updateCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', ...CALENDAR_APPOINTMENT_UPDATE_FIELDS]), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds: oldResources } = calendarAppointment(context, actor, r.id, 'manage');
    const expectedRevision = calendarInteger(r.expectedRevision, 1);
    const patch = normalizeCalendarAppointmentUpdate(Object.fromEntries(CALENDAR_APPOINTMENT_UPDATE_FIELDS.filter(field => Object.hasOwn(r, field)).map(field => [field, r[field]])));
    if (Object.hasOwn(patch, 'participants')) requireCalendarParticipantManager(actor);
    // No base/catalog/default lookup participates in the new operation digest. Exact replay precedes fresh CAS/policy admission.
    return calendarIntent(context, actor, r.requestId, ['appointment.update.v1', row.id, expectedRevision, patch], 'appointment', 'manage', requestId => {
      if (!calendarCurrentResourceMembership(context)) throw new CalendarError('CALENDAR_NOT_READY');
      calendarRevision(row, expectedRevision);
      if (isCalendarLifecycleTerminal(effectiveCalendarAppointmentStatus(context, row))) throw new CalendarError('CALENDAR_TRANSITION_INVALID');
      const currentType = calendarCurrentAppointmentType(context, actor.scopeId, row.id), currentVisit = calendarCurrentAppointmentVisit(context, actor.scopeId, row.id);
      const currentParticipants = calendarCurrentAppointmentParticipants(context, actor.scopeId, row.id);
      const priorInterval = normalizeCalendarTimedInterval({ startAt: row.start_at, endAt: row.end_at, timeZone: row.time_zone,
        bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after });
      const interval = Object.hasOwn(patch, 'startAt') ? normalizeCalendarTimedInterval({ startAt: patch.startAt, endAt: patch.endAt, timeZone: patch.timeZone,
        bufferBeforeMinutes: patch.bufferBeforeMinutes, bufferAfterMinutes: patch.bufferAfterMinutes }) : priorInterval;
      const resourceIds = patch.resourceIds ? [...patch.resourceIds] : oldResources, added = resourceIds.filter(id => !oldResources.includes(id));
      const title = patch.title ?? row.title, type = Object.hasOwn(patch, 'appointmentType') ? patch.appointmentType ?? undefined : currentType;
      const visit = Object.hasOwn(patch, 'visit') ? patch.visit ?? undefined : currentVisit;
      const participants = Object.hasOwn(patch, 'participants') ? [...patch.participants!] : currentParticipants;
      const titleChanged = title !== row.title, resourcesChanged = calendarJson(resourceIds) !== calendarJson(oldResources);
      const occupancyChanged = interval.startMs !== row.start_ms || interval.endMs !== row.end_ms || interval.bufferBeforeMinutes !== row.buffer_before || interval.bufferAfterMinutes !== row.buffer_after;
      const timeZoneChanged = interval.timeZone !== row.time_zone, typeChanged = !sameCalendarAppointmentType(currentType, type), visitChanged = !sameCalendarVisit(currentVisit, visit);
      const participantsChanged = calendarJson(currentParticipants) !== calendarJson(participants);
      if (!titleChanged && !resourcesChanged && !occupancyChanged && !timeZoneChanged && !typeChanged && !visitChanged && !participantsChanged) {
        return { requestId, operation: 'appointment.updated' as const, id: row.id, revision: row.revision, changed: false };
      }
      // Complete old-manage / resulting-book admission precedes every selected catalog lookup.
      for (const id of resourceIds) {
        const resource = calendarResource(context, actor, id); requireCalendarRight(context, actor, resource, 'book');
        if ((occupancyChanged || typeChanged || visitChanged || added.includes(id)) && !resource.active) throw new CalendarError('CALENDAR_FORBIDDEN');
      }
      const admitType = occupancyChanged || typeChanged || added.length > 0, admitVisit = occupancyChanged || visitChanged || added.length > 0;
      admitCalendarBookingCandidate(context, actor.scopeId, { resourceIds, interval, appointmentType: type, visit },
        { type: admitType, visit: admitVisit, availabilityResourceIds: occupancyChanged ? resourceIds : added,
          occupancy: occupancyChanged || added.length ? { except: { kind: 'appointment', id: row.id } } : false });
      const before = snapshot(row.title, oldResources, priorInterval, currentType, currentVisit, currentParticipants);
      const revision = nextCalendarRevision(row.revision);
      calendarBudget(context, 'appointmentUpdateHistory');
      const change = context.db.update('calendar_appointments', row.id, { title, ...intervalFields(interval), revision });
      for (const id of oldResources.filter(id => !resourceIds.includes(id))) {
        if (!context.db.get('_calendar_reservations', reservationId(actor.scopeId, row.id, id))) throw new CalendarError('CALENDAR_STATE_INVALID');
        context.db.update('_calendar_reservations', reservationId(actor.scopeId, row.id, id), { active: 0 });
      }
      for (const id of resourceIds) {
        const identity = reservationId(actor.scopeId, row.id, id), reservation = context.db.get('_calendar_reservations', identity);
        const values = { occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs, active: 1 };
        if (reservation) {
          if (reservation.scope_id !== actor.scopeId || reservation.appointment_id !== row.id || reservation.resource_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
          context.db.update('_calendar_reservations', identity, values);
        } else context.db.createStrict('_calendar_reservations', { id: identity, scope_id: actor.scopeId, appointment_id: row.id, resource_id: id, ...values });
      }
      replaceCalendarAppointmentResourceCurrent(context, actor.scopeId, row.id, revision, resourceIds);
      if (typeChanged) bindCalendarAppointmentType(context, actor.scopeId, row.id, revision, type);
      if (visitChanged) bindCalendarAppointmentVisit(context, actor.scopeId, row.id, revision, visit);
      if (participantsChanged) bindCalendarAppointmentParticipants(context, actor.scopeId, row.id, revision, participants);
      appendCalendarAppointmentUpdateHistory(context, actor.scopeId, row.id, revision, before, snapshot(title, resourceIds, interval, type, visit, participants));
      appendCalendarSemanticAudit(context, 'appointment.updated', change, { revision, resourceCount: resourceIds.length,
        titleChanged, resourcesChanged, occupancyChanged, timeZoneChanged, typeChanged, visitChanged, participantsChanged,
        ...(Object.hasOwn(patch, 'participants') ? { participantCount: participants.length } : {}) });
      return { requestId, operation: 'appointment.updated' as const, id: row.id, revision, changed: true };
    });
  });
}
