/** One atomic rich edit. Shared readonly preparation never confers mutation authority. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarAppointmentTypeReference, CalendarVisitInput } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { calendarInteger, calendarRecord } from './validation';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarBudget, calendarIntent, calendarResource, requireCalendarRight, nextCalendarRevision, reservationId } from './realm-model';
import { appendCalendarAppointmentUpdateHistory, replaceCalendarAppointmentResourceCurrent } from './appointment-resource-bindings';
import { bindCalendarAppointmentType } from './appointment-type-bindings';
import { bindCalendarAppointmentVisit } from './visit-bindings';
import { bindCalendarAppointmentParticipants, requireCalendarParticipantManager } from './participant-bindings';
import { admitCalendarBookingCandidate } from './booking-admission';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { bindCalendarAppointmentTime, calendarAppointmentTimeFields, calendarAppointmentTimeHistoryFields, type CalendarAppointmentTimeFact } from './appointment-time-bindings';
import { CALENDAR_APPOINTMENT_UPDATE_FIELDS, normalizeCalendarAppointmentUpdate, prepareCalendarAppointmentUpdate } from './appointment-preparation';
import { normalizeCalendarAppointmentOverride } from './override-model';
import { admitCalendarAppointmentOverride, finishCalendarAppointmentOverride, assertCalendarOverrideReviewAuthority } from './overrides';
export { CALENDAR_APPOINTMENT_UPDATE_FIELDS, normalizeCalendarAppointmentUpdate } from './appointment-preparation';
function intervalFields(interval: CalendarAppointmentTimeFact['interval']) {
  return { start_at: interval.startAt, end_at: interval.endAt, start_ms: interval.startMs, end_ms: interval.endMs, time_zone: interval.timeZone,
    buffer_before: interval.bufferBeforeMinutes, buffer_after: interval.bufferAfterMinutes, occupied_start_ms: interval.occupiedStartMs, occupied_end_ms: interval.occupiedEndMs };
}
function snapshot(title: string, resourceIds: readonly string[], fact: CalendarAppointmentTimeFact,
  type: CalendarAppointmentTypeReference | undefined, visit: CalendarVisitInput | undefined, participants: unknown) {
  return { title, resourceIds, startAt: fact.interval.startAt, endAt: fact.interval.endAt, timeZone: fact.interval.timeZone,
    bufferBeforeMinutes: fact.interval.bufferBeforeMinutes, bufferAfterMinutes: fact.interval.bufferAfterMinutes,
    appointmentType: type ? { id: type.id, revision: type.revision } : null,
    visit: visit?.mode === 'in-person' ? { mode: visit.mode, location: { id: visit.location.id, revision: visit.location.revision } } : visit ?? null,
    participants, ...calendarAppointmentTimeHistoryFields(fact) };
}
export function updateCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'override', ...CALENDAR_APPOINTMENT_UPDATE_FIELDS]), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds: oldResources } = calendarAppointment(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    const patch = normalizeCalendarAppointmentUpdate(Object.fromEntries(CALENDAR_APPOINTMENT_UPDATE_FIELDS.filter(field => Object.hasOwn(r, field)).map(field => [field, r[field]])));
    if (Object.hasOwn(patch, 'participants')) requireCalendarParticipantManager(actor);
    const override = Object.hasOwn(r, 'override') ? normalizeCalendarAppointmentOverride(r.override) : undefined;
    const ordinary = [Object.hasOwn(patch, 'interval') ? 'appointment.update.interval.v1' : 'appointment.update.v1', row.id, expectedRevision, patch];
    return calendarIntent(context, actor, r.requestId, override ? ['appointment.update.override.v1', ordinary, override] : ordinary, 'appointment', 'manage', requestId => {
      if (override) {
        const resulting = patch.resourceIds ?? oldResources;
        for (const id of resulting) requireCalendarRight(context, actor, calendarResource(context, actor, id), 'book');
        assertCalendarOverrideReviewAuthority(context, actor, resulting);
      }
      const p = prepareCalendarAppointmentUpdate(context, actor, row.id, expectedRevision, patch);
      if (override && (!p.changed || !p.checks.occupancy)) throw new CalendarError('CALENDAR_OVERRIDE_STALE');
      if (!p.changed) return { requestId, operation: 'appointment.updated' as const, id: row.id, revision: row.revision, changed: false };
      const allowance = override ? admitCalendarAppointmentOverride(context, actor, requestId, p, override) : undefined;
      admitCalendarBookingCandidate(context, actor.scopeId, p, p.checks, allowance);
      const before = snapshot(row.title, p.oldResources, p.priorFact, p.currentType, p.currentVisit, p.currentParticipants);
      const revision = nextCalendarRevision(row.revision); calendarBudget(context, 'appointmentUpdateHistory');
      const change = context.db.update('calendar_appointments', row.id, { title: p.title,
        ...(row.time_kind === undefined ? intervalFields(p.interval) : calendarAppointmentTimeFields(p.fact)), revision });
      for (const id of p.oldResources.filter(id => !p.resourceIds.includes(id))) {
        if (!context.db.get('_calendar_reservations', reservationId(actor.scopeId, row.id, id))) throw new CalendarError('CALENDAR_STATE_INVALID');
        context.db.update('_calendar_reservations', reservationId(actor.scopeId, row.id, id), { active: 0 });
      }
      for (const id of p.resourceIds) {
        const identity = reservationId(actor.scopeId, row.id, id), reservation = context.db.get('_calendar_reservations', identity);
        const values = { occupied_start_ms: p.interval.occupiedStartMs, occupied_end_ms: p.interval.occupiedEndMs, active: 1 };
        if (reservation) {
          if (reservation.scope_id !== actor.scopeId || reservation.appointment_id !== row.id || reservation.resource_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
          context.db.update('_calendar_reservations', identity, values);
        } else context.db.createStrict('_calendar_reservations', { id: identity, scope_id: actor.scopeId, appointment_id: row.id, resource_id: id, ...values });
      }
      replaceCalendarAppointmentResourceCurrent(context, actor.scopeId, row.id, revision, p.resourceIds);
      if (p.typeChanged) bindCalendarAppointmentType(context, actor.scopeId, row.id, revision, p.appointmentType);
      if (p.visitChanged) bindCalendarAppointmentVisit(context, actor.scopeId, row.id, revision, p.visit);
      if (p.participantsChanged) bindCalendarAppointmentParticipants(context, actor.scopeId, row.id, revision, p.participants ?? []);
      if (row.time_kind !== undefined) bindCalendarAppointmentTime(context, actor.scopeId, row.id, revision, p.fact);
      appendCalendarAppointmentUpdateHistory(context, actor.scopeId, row.id, revision, before, snapshot(p.title, p.resourceIds, p.fact, p.appointmentType, p.visit, p.participants));
      if (override) finishCalendarAppointmentOverride(context, actor, requestId, row.id, revision);
      appendCalendarSemanticAudit(context, 'appointment.updated', change, { revision, resourceCount: p.resourceIds.length,
        titleChanged: p.titleChanged, resourcesChanged: p.resourcesChanged, occupancyChanged: p.occupancyChanged, timeZoneChanged: p.timeZoneChanged,
        typeChanged: p.typeChanged, visitChanged: p.visitChanged, participantsChanged: p.participantsChanged,
        ...(Object.hasOwn(patch, 'participants') ? { participantCount: p.participants!.length } : {}),
        ...(override ? { overrideCategory: 'appointment-overlap' as const, overridePolicy: 'appointment-overlap-v1' as const, reasonPresent: true } : {}) });
      return { requestId, operation: 'appointment.updated' as const, id: row.id, revision, changed: true };
    });
  });
}
