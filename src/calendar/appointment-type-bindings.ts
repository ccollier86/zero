/** Type identity is captured once; all displayed facts come from retained catalog history. */
import type { CalendarReadContext } from './calendar-read-store';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot } from './contracts';
import { currentCalendarResourceTypes } from './appointment-types-model';
import { CalendarError } from './error';
import { calendarBudget, eq } from './realm-model';
import { normalizeCalendarTimedInterval, type CalendarTimedInterval } from './time';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

interface TypeHistoryRow extends Row {
  type_id: string; type_revision: number; label: string; duration_minutes: number; buffer_before: number; buffer_after: number; color_key: string | null; active: number;
}
interface AppointmentBindingRow extends Row {
  id: string; scope_id: string; appointment_id: string; appointment_revision: number; type_id: string | null; type_revision: number | null;
}
interface HoldBindingRow extends Row { id: string; scope_id: string; hold_id: string; type_id: string; type_revision: number }

export function calendarAppointmentTypeReference(input: unknown): CalendarAppointmentTypeReference | undefined {
  if (input === undefined) return undefined;
  const r = calendarRecord(input, ['id', 'revision']);
  return { id: calendarKey(r.id), revision: calendarInteger(r.revision, 1) };
}
export function sameCalendarAppointmentType(left: CalendarAppointmentTypeReference | undefined, right: CalendarAppointmentTypeReference | undefined): boolean {
  return left?.id === right?.id && left?.revision === right?.revision;
}
function snapshot(row: TypeHistoryRow): CalendarAppointmentTypeSnapshot {
  return { id: row.type_id, revision: row.type_revision, label: row.label, durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after, colorKey: row.color_key };
}
function history(context: CalendarReadContext, scopeId: string, reference: CalendarAppointmentTypeReference): CalendarAppointmentTypeSnapshot {
  const rows = context.db.find('_calendar_type_history', { filters: [eq('scope_id', scopeId), eq('type_id', reference.id), eq('type_revision', reference.revision)], limit: 2 }) as TypeHistoryRow[];
  if (rows.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return snapshot(rows[0]!);
}
/** Typed wire identity must not consult a client-selected hidden catalog generation before receipt lookup. */
export function normalizeCalendarTypedIntentInterval(r: Record<string, unknown>) {
  const interval = normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone,
    bufferBeforeMinutes: r.bufferBeforeMinutes, bufferAfterMinutes: r.bufferAfterMinutes });
  return { startAt: interval.startAt, endAt: interval.endAt, timeZone: interval.timeZone,
    bufferBeforeMinutes: r.bufferBeforeMinutes === undefined ? null : interval.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes === undefined ? null : interval.bufferAfterMinutes };
}
/** Complete policy intersection is checked before any client-selected catalog lookup, never before accepted replay. */
export function assertCalendarTypePolicy(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[],
  reference: CalendarAppointmentTypeReference | undefined): void {
  assertCalendarTypePolicyForScope(context, actor.scopeId, resourceIds, reference);
}
/** Private policy core only. A scope is not authorization; callers admit every resource first. */
export function assertCalendarTypePolicyForScope(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[],
  reference: CalendarAppointmentTypeReference | undefined): void {
  for (const resourceId of resourceIds) {
    const policy = currentCalendarResourceTypes(context, scopeId, resourceId);
    if (!reference ? policy.mode === 'required' : policy.mode !== 'unrestricted' && !policy.typeIds.includes(reference.id)) throw new CalendarError('CALENDAR_TYPE_CONFLICT');
  }
}
function currentBookingType(context: CalendarReadContext, scopeId: string, reference: CalendarAppointmentTypeReference): CalendarAppointmentTypeSnapshot {
  const current = context.db.get('calendar_types', reference.id);
  if (!current || current.scope_id !== scopeId || current.revision !== reference.revision) throw new CalendarError('CALENDAR_TYPE_STALE');
  const rows = context.db.find('_calendar_type_history', { filters: [eq('scope_id', scopeId), eq('type_id', reference.id), eq('type_revision', reference.revision)], limit: 2 }) as TypeHistoryRow[];
  if (rows.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (rows[0]!.active !== 1) throw new CalendarError('CALENDAR_TYPE_STALE');
  return snapshot(rows[0]!);
}
/** Called only inside a new typed command callback, after receipt lookup and all resource rights. */
export function normalizeCalendarTypedBooking(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[], r: Record<string, unknown>, reference: CalendarAppointmentTypeReference) {
  assertCalendarTypePolicy(context, actor, resourceIds, reference);
  const appointmentType = currentBookingType(context, actor.scopeId, reference);
  const interval = normalizeCalendarTimedInterval({ startAt: r.startAt, endAt: r.endAt, timeZone: r.timeZone,
    bufferBeforeMinutes: r.bufferBeforeMinutes === undefined ? appointmentType?.bufferBeforeMinutes : r.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes === undefined ? appointmentType?.bufferAfterMinutes : r.bufferAfterMinutes });
  return { interval, appointmentType };
}
/** Call only after the receipt lookup: an accepted replay is not rejected by a later catalog/policy change. */
export function assertCalendarBookingType(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[], interval: CalendarTimedInterval,
  reference: CalendarAppointmentTypeReference | undefined): CalendarAppointmentTypeSnapshot | undefined {
  return assertCalendarBookingTypeForScope(context, actor.scopeId, resourceIds, interval, reference);
}
/** Private catalog/interval admission, not a resource or source-authority grant. */
export function assertCalendarBookingTypeForScope(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[], interval: CalendarTimedInterval,
  reference: CalendarAppointmentTypeReference | undefined): CalendarAppointmentTypeSnapshot | undefined {
  assertCalendarTypePolicyForScope(context, scopeId, resourceIds, reference);
  const appointmentType = reference ? currentBookingType(context, scopeId, reference) : undefined;
  if (appointmentType) {
    if (interval.endMs - interval.startMs !== appointmentType.durationMinutes * 60_000
      || interval.bufferBeforeMinutes !== appointmentType.bufferBeforeMinutes || interval.bufferAfterMinutes !== appointmentType.bufferAfterMinutes) throw new CalendarError('CALENDAR_TYPE_CONFLICT');
  }
  return appointmentType;
}
function appointmentPointerId(scopeId: string, id: string): string { return calendarHash(['appointment.type', scopeId, id]); }
function holdBindingId(scopeId: string, id: string): string { return calendarHash(['hold.type', scopeId, id]); }

/** Prior generations are used when normalizing an old reschedule replay, not the later current type. */
export function calendarAppointmentTypeAtRevision(context: CalendarReadContext, scopeId: string, id: string, revision: number): CalendarAppointmentTypeSnapshot | undefined {
  const rows = context.db.find('_calendar_appointment_type_bindings', { filters: [eq('scope_id', scopeId), eq('appointment_id', id),
    { type: 'field', field: 'appointment_revision', operator: 'lte', value: revision }], order: [{ field: 'appointment_revision', direction: 'desc' }], limit: 1 }) as AppointmentBindingRow[];
  const binding = rows[0];
  return binding?.type_id ? history(context, scopeId, { id: binding.type_id, revision: calendarInteger(binding.type_revision, 1) }) : undefined;
}
export function calendarCurrentAppointmentType(context: CalendarReadContext, scopeId: string, id: string): CalendarAppointmentTypeSnapshot | undefined {
  const pointer = context.db.get('_calendar_appointment_type_current', appointmentPointerId(scopeId, id));
  if (!pointer) return undefined;
  if (pointer.scope_id !== scopeId || pointer.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  const binding = context.db.get('_calendar_appointment_type_bindings', String(pointer.binding_id)) as AppointmentBindingRow | null;
  if (!binding || binding.scope_id !== scopeId || binding.appointment_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return binding.type_id ? history(context, scopeId, { id: binding.type_id, revision: calendarInteger(binding.type_revision, 1) }) : undefined;
}
export function bindCalendarAppointmentType(context: DatabaseWriteCommandContext, scopeId: string, id: string, revision: number,
  appointmentType: CalendarAppointmentTypeReference | undefined): void {
  calendarBudget(context, 'appointmentTypeHistory');
  const bindingId = calendarHash(['appointment.type', scopeId, id, revision]), pointerId = appointmentPointerId(scopeId, id);
  context.db.createStrict('_calendar_appointment_type_bindings', { id: bindingId, scope_id: scopeId, appointment_id: id, appointment_revision: revision,
    type_id: appointmentType?.id ?? null, type_revision: appointmentType?.revision ?? null });
  if (context.db.get('_calendar_appointment_type_current', pointerId)) context.db.update('_calendar_appointment_type_current', pointerId, { binding_id: bindingId });
  else context.db.createStrict('_calendar_appointment_type_current', { id: pointerId, scope_id: scopeId, appointment_id: id, binding_id: bindingId });
}
export function bindCalendarHoldType(context: DatabaseWriteCommandContext, scopeId: string, id: string, appointmentType: CalendarAppointmentTypeReference): void {
  context.db.createStrict('_calendar_hold_type_bindings', { id: holdBindingId(scopeId, id), scope_id: scopeId, hold_id: id,
    type_id: appointmentType.id, type_revision: appointmentType.revision });
}
export function calendarHoldAppointmentType(context: CalendarReadContext, scopeId: string, id: string): CalendarAppointmentTypeSnapshot | undefined {
  const binding = context.db.get('_calendar_hold_type_bindings', holdBindingId(scopeId, id)) as HoldBindingRow | null;
  if (!binding) return undefined;
  if (binding.scope_id !== scopeId || binding.hold_id !== id) throw new CalendarError('CALENDAR_STATE_INVALID');
  return history(context, scopeId, { id: binding.type_id, revision: binding.type_revision });
}
function readHistory(context: DatabaseReadQueryContext, scopeId: string, reference: CalendarAppointmentTypeReference): CalendarAppointmentTypeSnapshot {
  const rows = context.database.query<TypeHistoryRow>('SELECT * FROM _calendar_type_history WHERE scope_id=? AND type_id=? AND type_revision=? LIMIT 2').all(scopeId, reference.id, reference.revision);
  if (rows.length !== 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  return snapshot(rows[0]!);
}
export function readCalendarAppointmentTypeSnapshot(context: DatabaseReadQueryContext, scopeId: string, id: string): CalendarAppointmentTypeSnapshot | undefined {
  const pointer = context.database.query<{ binding_id: string }>('SELECT binding_id FROM _calendar_appointment_type_current WHERE scope_id=? AND appointment_id=?').get(scopeId, id);
  if (!pointer) return undefined;
  const binding = context.database.query<AppointmentBindingRow>('SELECT * FROM _calendar_appointment_type_bindings WHERE id=? AND scope_id=? AND appointment_id=?').get(pointer.binding_id, scopeId, id);
  if (!binding) throw new CalendarError('CALENDAR_STATE_INVALID');
  return binding.type_id ? readHistory(context, scopeId, { id: binding.type_id, revision: calendarInteger(binding.type_revision, 1) }) : undefined;
}
export function readCalendarHoldTypeSnapshot(context: DatabaseReadQueryContext, scopeId: string, id: string): CalendarAppointmentTypeSnapshot | undefined {
  const binding = context.database.query<HoldBindingRow>('SELECT * FROM _calendar_hold_type_bindings WHERE scope_id=? AND hold_id=?').get(scopeId, id);
  return binding ? readHistory(context, scopeId, { id: binding.type_id, revision: binding.type_revision }) : undefined;
}
