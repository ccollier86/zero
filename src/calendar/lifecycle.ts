/** Scope policy and all-co-resource-managed appointment transitions. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarLifecyclePolicy, CalendarAppointmentTransitions } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarBudget, calendarIntent, calendarRevision,
  nextCalendarRevision, reservationId } from './realm-model';
import { readCalendarAppointmentTarget } from './realm-queries';
import { calendarAppointmentTransitionProjection, calendarLifecyclePolicyFields, currentCalendarLifecyclePolicy, requireCalendarLifecycleManager,
  readCalendarLifecyclePolicyValue, readCalendarAppointmentLifecycle, effectiveCalendarAppointmentStatus, calendarLifecycleStatus, calendarLifecycleReason,
  assertCalendarLifecycleReason, bindCalendarAppointmentLifecycle } from './lifecycle-model';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';
import { appendCalendarSemanticAudit } from './semantic-audit';

function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  if (context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get()?.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
export function readCalendarLifecyclePolicy(context: DatabaseReadQueryContext, input: unknown): CalendarLifecyclePolicy {
  const r = calendarRecord(input, ['actor']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId); requireCalendarLifecycleManager(actor);
  return readCalendarLifecyclePolicyValue(context, actor.scopeId);
}
export function replaceCalendarLifecyclePolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'expectedRevision', 'extended', 'cancellationReason', 'noShowReason']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarLifecycleManager(actor);
    const expectedRevision = calendarInteger(r.expectedRevision, 1), fields = calendarLifecyclePolicyFields({ extended: r.extended, cancellationReason: r.cancellationReason, noShowReason: r.noShowReason });
    return calendarIntent(context, actor, r.requestId, ['lifecycle.replace.v1', expectedRevision, fields], 'lifecycle', 'manage', requestId => {
      const prior = currentCalendarLifecyclePolicy(context, actor.scopeId); calendarRevision(prior, expectedRevision);
      const { revision: _revision, ...priorFields } = prior;
      if (calendarJson(fields) === calendarJson(priorFields)) return { requestId, operation: 'lifecycle.policy-changed', id: 'policy', revision: prior.revision, changed: false };
      const revision = nextCalendarRevision(prior.revision); calendarBudget(context, 'policyHistory');
      context.db.createStrict('_calendar_lifecycle_policy_history', { id: calendarHash([actor.scopeId, revision]), scope_id: actor.scopeId, policy_revision: revision,
        extended: fields.extended ? 1 : 0, cancellation_reason: fields.cancellationReason, no_show_reason: fields.noShowReason });
      const change = prior.revision === 1 ? context.db.createStrict('_calendar_lifecycle_policy', { id: 'policy', scope_id: actor.scopeId, policy_revision: revision })
        : context.db.update('_calendar_lifecycle_policy', 'policy', { policy_revision: revision });
      appendCalendarSemanticAudit(context, 'lifecycle.policy-changed', change, { revision, policyRevision: revision });
      return { requestId, operation: 'lifecycle.policy-changed', id: 'policy', revision, changed: true };
    });
  });
}
export function readCalendarAppointmentTransitions(context: DatabaseReadQueryContext, input: unknown): CalendarAppointmentTransitions {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor), id = calendarKey(r.id); readOwner(context, actor.scopeId);
  // The same current-membership target resolver owns every co-resource fence.
  // Retained historical reservations are not current management requirements.
  const { row } = readCalendarAppointmentTarget(context, actor, id, 'manage');
  return calendarAppointmentTransitionProjection(row, readCalendarAppointmentLifecycle(context, actor.scopeId, id)?.status ?? row.status, readCalendarLifecyclePolicyValue(context, actor.scopeId));
}
export function transitionCalendarAppointment(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'status', 'policyRevision', 'reason']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const { row, resourceIds } = calendarAppointment(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    const status = calendarLifecycleStatus(r.status), policyRevision = calendarInteger(r.policyRevision, 1), reason = calendarLifecycleReason(r.reason);
    if (reason !== null && status !== 'cancelled' && status !== 'no-show') throw new CalendarError('CALENDAR_INPUT_INVALID');
    return calendarIntent(context, actor, r.requestId, ['appointment.transition.v1', row.id, expectedRevision, status, policyRevision, reason], 'appointment', 'manage', requestId => {
      const policy = currentCalendarLifecyclePolicy(context, actor.scopeId);
      if (policy.revision !== policyRevision) throw new CalendarError('CALENDAR_POLICY_STALE');
      calendarRevision(row, expectedRevision);
      if (!calendarAppointmentTransitionProjection(row, effectiveCalendarAppointmentStatus(context, row), policy).allowed.some(target => target.status === status)) throw new CalendarError('CALENDAR_TRANSITION_INVALID');
      assertCalendarLifecycleReason(policy, status, reason);
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_appointments', row.id, { revision, status: status === 'cancelled' ? 'cancelled' : 'confirmed' });
      bindCalendarAppointmentLifecycle(context, actor.scopeId, row.id, revision, status, policyRevision, reason);
      if (status === 'cancelled') for (const id of resourceIds) context.db.update('_calendar_reservations', reservationId(actor.scopeId, row.id, id), { active: 0 });
      appendCalendarSemanticAudit(context, 'appointment.transitioned', change, { revision, status, policyRevision, reasonPresent: reason !== null });
      return { requestId, operation: 'appointment.transitioned', id: row.id, revision, changed: true };
    });
  });
}
