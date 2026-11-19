/** Fixed effective lifecycle and private immutable reasons, separate from occupancy. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentLifecycle, CalendarAppointmentStatus, CalendarAppointmentTransitions, CalendarLifecyclePolicy, CalendarLifecyclePolicyInput } from './contracts';
import { CalendarError } from './error';
import { calendarBudget, type CalendarAppointmentRow } from './realm-model';
import { calendarHash, calendarInteger, calendarRecord, calendarText } from './validation';

export const CALENDAR_DEFAULT_LIFECYCLE_POLICY: CalendarLifecyclePolicy = Object.freeze({ revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' });
export const CALENDAR_LIFECYCLE_STATUSES: readonly CalendarAppointmentStatus[] = Object.freeze(['tentative', 'confirmed', 'completed', 'no-show', 'cancelled']);
interface PolicyHistoryRow extends Row { scope_id: string; policy_revision: number; extended: number; cancellation_reason: 'optional' | 'required'; no_show_reason: 'optional' | 'required' }
interface LifecycleHistoryRow extends Row { scope_id: string; appointment_id: string; appointment_revision: number; policy_revision: number; status: CalendarAppointmentStatus; reason: string | null }
export function requireCalendarLifecycleManager(actor: CalendarActor): void { if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN'); }
export function calendarLifecyclePolicyFields(input: unknown): CalendarLifecyclePolicyInput {
  const r = calendarRecord(input, ['extended', 'cancellationReason', 'noShowReason']);
  if (typeof r.extended !== 'boolean' || !['optional', 'required'].includes(r.cancellationReason as string) || !['optional', 'required'].includes(r.noShowReason as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { extended: r.extended, cancellationReason: r.cancellationReason as 'optional' | 'required', noShowReason: r.noShowReason as 'optional' | 'required' };
}
function policyView(row: PolicyHistoryRow): CalendarLifecyclePolicy { return { revision: row.policy_revision, extended: row.extended === 1, cancellationReason: row.cancellation_reason, noShowReason: row.no_show_reason }; }
export function currentCalendarLifecyclePolicy(context: CalendarReadContext, scopeId: string): CalendarLifecyclePolicy {
  const pointer = context.db.get('_calendar_lifecycle_policy', 'policy');
  if (!pointer) return CALENDAR_DEFAULT_LIFECYCLE_POLICY;
  const row = context.db.get('_calendar_lifecycle_policy_history', calendarHash([scopeId, pointer.policy_revision])) as PolicyHistoryRow | null;
  if (pointer.scope_id !== scopeId || !row || row.scope_id !== scopeId || row.policy_revision !== pointer.policy_revision) throw new CalendarError('CALENDAR_STATE_INVALID');
  return policyView(row);
}
export function readCalendarLifecyclePolicyValue(context: DatabaseReadQueryContext, scopeId: string): CalendarLifecyclePolicy {
  const row = context.database.query<PolicyHistoryRow>(`SELECT h.* FROM _calendar_lifecycle_policy p JOIN _calendar_lifecycle_policy_history h ON h.scope_id=p.scope_id AND h.policy_revision=p.policy_revision WHERE p.id='policy' AND p.scope_id=?`).get(scopeId);
  if (row) return policyView(row);
  if (context.database.query<{ id: string }>("SELECT id FROM _calendar_lifecycle_policy WHERE id='policy'").get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  return CALENDAR_DEFAULT_LIFECYCLE_POLICY;
}
function lifecycleView(row: LifecycleHistoryRow): CalendarAppointmentLifecycle { return { revision: row.appointment_revision, policyRevision: row.policy_revision, status: row.status, reason: row.reason }; }
export function currentCalendarAppointmentLifecycle(context: CalendarReadContext, scopeId: string, appointmentId: string): CalendarAppointmentLifecycle | undefined {
  const pointer = context.db.get('_calendar_appointment_lifecycle_current', appointmentId);
  if (!pointer) return undefined;
  const row = context.db.get('_calendar_appointment_lifecycle_history', String(pointer.lifecycle_id)) as LifecycleHistoryRow | null;
  if (pointer.scope_id !== scopeId || !row || row.scope_id !== scopeId || row.appointment_id !== appointmentId) throw new CalendarError('CALENDAR_STATE_INVALID');
  return lifecycleView(row);
}
export function readCalendarAppointmentLifecycle(context: DatabaseReadQueryContext, scopeId: string, appointmentId: string): CalendarAppointmentLifecycle | undefined {
  const row = context.database.query<LifecycleHistoryRow>(`SELECT h.* FROM _calendar_appointment_lifecycle_current p JOIN _calendar_appointment_lifecycle_history h ON h.id=p.lifecycle_id AND h.scope_id=p.scope_id AND h.appointment_id=p.appointment_id WHERE p.scope_id=? AND p.appointment_id=?`).get(scopeId, appointmentId);
  if (!row && context.database.query<{ id: string }>('SELECT id FROM _calendar_appointment_lifecycle_current WHERE id=?').get(appointmentId)) throw new CalendarError('CALENDAR_STATE_INVALID');
  return row ? lifecycleView(row) : undefined;
}
export function effectiveCalendarAppointmentStatus(context: CalendarReadContext, row: CalendarAppointmentRow): CalendarAppointmentStatus { return currentCalendarAppointmentLifecycle(context, row.scope_id, row.id)?.status ?? row.status; }
export function isCalendarLifecycleTerminal(status: CalendarAppointmentStatus): boolean { return status === 'completed' || status === 'no-show' || status === 'cancelled'; }
export function calendarLifecycleStatus(input: unknown): CalendarAppointmentStatus {
  if (!CALENDAR_LIFECYCLE_STATUSES.includes(input as CalendarAppointmentStatus)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input as CalendarAppointmentStatus;
}
export function calendarLifecycleReason(input: unknown): string | null {
  if (input === undefined) return null;
  return calendarText(calendarText(input, 1024).trim(), 1024);
}
export function calendarLifecycleRequiresReason(policy: CalendarLifecyclePolicy, status: CalendarAppointmentStatus): boolean { return status === 'cancelled' && policy.cancellationReason === 'required' || status === 'no-show' && policy.noShowReason === 'required'; }
export function calendarAppointmentTransitionProjection(row: Pick<CalendarAppointmentRow, 'id' | 'revision'>, status: CalendarAppointmentStatus, policy: CalendarLifecyclePolicy): CalendarAppointmentTransitions {
  const allowed = isCalendarLifecycleTerminal(status) ? [] : CALENDAR_LIFECYCLE_STATUSES.filter(target => target !== status && (policy.extended || target === 'cancelled' || status === 'tentative' && target === 'confirmed'));
  return { id: row.id, revision: row.revision, policyRevision: policy.revision, status, allowed: allowed.map(status => ({ status, requiresReason: calendarLifecycleRequiresReason(policy, status) })) };
}
export function assertCalendarLifecycleReason(policy: CalendarLifecyclePolicy, status: CalendarAppointmentStatus, reason: string | null): void {
  if (calendarLifecycleRequiresReason(policy, status) && reason === null) throw new CalendarError('CALENDAR_REASON_REQUIRED');
}
export function bindCalendarAppointmentLifecycle(context: DatabaseWriteCommandContext, scopeId: string, appointmentId: string, revision: number, status: CalendarAppointmentStatus, policyRevision: number, reason: string | null): void {
  calendarBudget(context, 'appointmentLifecycleHistory');
  const id = calendarHash([scopeId, appointmentId, revision]);
  context.db.createStrict('_calendar_appointment_lifecycle_history', { id, scope_id: scopeId, appointment_id: appointmentId, appointment_revision: calendarInteger(revision, 2), policy_revision: policyRevision, status, reason });
  if (context.db.get('_calendar_appointment_lifecycle_current', appointmentId)) context.db.update('_calendar_appointment_lifecycle_current', appointmentId, { lifecycle_id: id });
  else context.db.createStrict('_calendar_appointment_lifecycle_current', { id: appointmentId, scope_id: scopeId, appointment_id: appointmentId, lifecycle_id: id });
}
