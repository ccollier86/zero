/** Calendar-owned references only. Trusted SYSTEM target admission belongs to the parent's final commit guard. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarParticipantReference } from './contracts';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarBudget, calendarIntent, calendarRevision,
  nextCalendarRevision } from './realm-model';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';
import { effectiveCalendarAppointmentStatus, isCalendarLifecycleTerminal } from './lifecycle-model';
import { appendCalendarSemanticAudit } from './semantic-audit';
import { readCalendarHoldTarget } from './holds-model';
import { readCalendarAppointmentTarget } from './realm-queries';
import { calendarParticipantReferences } from './participants-validation';
export { calendarParticipantReferences, CALENDAR_PARTICIPANT_LIMIT } from './participants-validation';

interface AppointmentBindingRow extends Row { id: string; scope_id: string; appointment_id: string; appointment_revision: number; references_json: string }
interface HoldBindingRow extends Row { id: string; scope_id: string; hold_id: string; references_json: string }

export function requireCalendarParticipantManager(actor: CalendarActor): void {
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
}
function decodeReferences(row: { references_json: string }): CalendarParticipantReference[] {
  try {
    const references = calendarParticipantReferences(JSON.parse(row.references_json));
    if (calendarJson(references) !== row.references_json) throw new CalendarError('CALENDAR_STATE_INVALID');
    return references;
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
function pointerId(scopeId: string, id: string) { return calendarHash(['appointment.participants', scopeId, id]); }
function holdId(scopeId: string, id: string) { return calendarHash(['hold.participants', scopeId, id]); }

export function calendarCurrentAppointmentParticipants(context: CalendarReadContext, scopeId: string, id: string): CalendarParticipantReference[] {
  const pointer = context.db.get('_calendar_appointment_participant_current', pointerId(scopeId, id));
  if (!pointer) return [];
  if (pointer.scope_id !== scopeId || pointer.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  const binding = context.db.get('_calendar_appointment_participant_bindings', String(pointer.binding_id)) as AppointmentBindingRow | null;
  if (!binding || binding.scope_id !== scopeId || binding.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return decodeReferences(binding);
}
export function bindCalendarAppointmentParticipants(context: DatabaseWriteCommandContext, scopeId: string, id: string, revision: number,
  references: readonly CalendarParticipantReference[]): void {
  calendarBudget(context, 'appointmentParticipantHistory');
  const bindingId = calendarHash(['appointment.participants', scopeId, id, revision]), pointer = pointerId(scopeId, id);
  context.db.createStrict('_calendar_appointment_participant_bindings', { id: bindingId, scope_id: scopeId, appointment_id: id,
    appointment_revision: revision, references_json: calendarJson(references) });
  if (context.db.get('_calendar_appointment_participant_current', pointer)) context.db.update('_calendar_appointment_participant_current', pointer, { binding_id: bindingId });
  else context.db.createStrict('_calendar_appointment_participant_current', { id: pointer, scope_id: scopeId, appointment_id: id, binding_id: bindingId });
}
export function bindCalendarHoldParticipants(context: DatabaseWriteCommandContext, scopeId: string, id: string, references: readonly CalendarParticipantReference[]): void {
  calendarBudget(context, 'holdParticipantBindings');
  context.db.createStrict('_calendar_hold_participant_bindings', { id: holdId(scopeId, id), scope_id: scopeId, hold_id: id, references_json: calendarJson(references) });
}
/** The usage marker also keeps omitted-participant legacy writes independent of the additive 008 schema. */
export function calendarHoldParticipants(context: CalendarReadContext, scopeId: string, id: string): CalendarParticipantReference[] | undefined {
  if (!context.db.get('_calendar_usage', 'holdParticipantBindings')) return undefined;
  const binding = context.db.get('_calendar_hold_participant_bindings', holdId(scopeId, id)) as HoldBindingRow | null;
  if (!binding) return undefined;
  if (binding.scope_id !== scopeId || binding.hold_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return decodeReferences(binding);
}

export function replaceCalendarAppointmentParticipants(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', 'references']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId); requireCalendarParticipantManager(actor);
    const { row } = calendarAppointment(context, actor, r.id, 'manage'), expectedRevision = calendarInteger(r.expectedRevision, 1);
    const references = calendarParticipantReferences(r.references);
    return calendarIntent(context, actor, r.requestId, ['appointment.participants.v1', row.id, expectedRevision, references], 'appointment', 'manage', requestId => {
      // Fresh target admission is the trusted parent's concern. CAS makes its
      // selected prior-reference diff match the source generation being changed.
      calendarRevision(row, expectedRevision);
      if (isCalendarLifecycleTerminal(effectiveCalendarAppointmentStatus(context, row))) throw new CalendarError('CALENDAR_TRANSITION_INVALID');
      const prior = calendarCurrentAppointmentParticipants(context, actor.scopeId, row.id);
      if (calendarJson(prior) === calendarJson(references)) return { requestId, operation: 'appointment.participants-changed' as const, id: row.id, revision: row.revision, changed: false };
      const revision = nextCalendarRevision(row.revision), change = context.db.update('calendar_appointments', row.id, { revision });
      bindCalendarAppointmentParticipants(context, actor.scopeId, row.id, revision, references);
      appendCalendarSemanticAudit(context, 'appointment.participants-changed', change, { revision, participantCount: references.length, participantsChanged: true });
      return { requestId, operation: 'appointment.participants-changed' as const, id: row.id, revision, changed: true };
    });
  });
}
function readOwner(context: DatabaseReadQueryContext, scopeId: string): void {
  if (context.database.query<{ scope_id: string }>("SELECT scope_id FROM _calendar_owner WHERE id='application'").get()?.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
export function readCalendarAppointmentParticipants(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId); requireCalendarParticipantManager(actor);
  const { row } = readCalendarAppointmentTarget(context, actor, calendarKey(r.id), 'details');
  const binding = context.database.query<AppointmentBindingRow>(`SELECT b.* FROM _calendar_appointment_participant_current p
    JOIN _calendar_appointment_participant_bindings b ON b.id=p.binding_id AND b.scope_id=p.scope_id AND b.appointment_id=p.appointment_id
    WHERE p.scope_id=? AND p.appointment_id=?`).get(actor.scopeId, row.id);
  return { id: row.id, revision: row.revision, references: binding ? decodeReferences(binding) : [] };
}
export function readCalendarHoldParticipants(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId); requireCalendarParticipantManager(actor);
  const { row } = readCalendarHoldTarget(context, actor, calendarKey(r.id));
  const binding = context.database.query<HoldBindingRow>('SELECT * FROM _calendar_hold_participant_bindings WHERE scope_id=? AND hold_id=?').get(actor.scopeId, row.id);
  return { id: row.id, revision: row.revision, references: binding ? decodeReferences(binding) : [] };
}
/** Trusted confirmation admission, not a participant disclosure API. Uncaptured legacy holds keep their existing rights. */
export function readCalendarHoldParticipantAdmission(context: DatabaseReadQueryContext, input: unknown) {
  const r = calendarRecord(input, ['actor', 'id']), actor = calendarActor(r.actor); readOwner(context, actor.scopeId);
  const { row } = readCalendarHoldTarget(context, actor, calendarKey(r.id));
  const marker = context.database.query<{ count: number }>('SELECT count FROM _calendar_usage WHERE id=?').get('holdParticipantBindings');
  const binding = marker ? context.database.query<HoldBindingRow>('SELECT * FROM _calendar_hold_participant_bindings WHERE scope_id=? AND hold_id=?').get(actor.scopeId, row.id) : null;
  if (binding) requireCalendarParticipantManager(actor);
  return { id: row.id, revision: row.revision, references: binding ? decodeReferences(binding) : null };
}
