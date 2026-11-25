/** Shared appointment/block/live-hold capacity-one checks inside one short writer decision. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseFindFilter } from '../databases/database-operations';
import { CalendarError } from './error';
import { eq } from './realm-model';
import { calendarOverlapSearchStart, type CalendarTimedInterval } from './time';
import { calendarNow } from './hold-time';
import type { CalendarReadContext } from './calendar-read-store';
import { calendarHash, calendarInteger, calendarKey } from './validation';
import { CALENDAR_APPOINTMENT_RESOURCE_CURRENT, calendarCurrentResourceMembership } from './appointment-resource-bindings';
import { CALENDAR_OVERRIDE_ADMISSIONS } from './override-model';
import { assertCalendarSeriesResourcesAvailable } from './series-occupancy';

export interface CalendarAppointmentOverlapWitness {
  readonly resourceId: string; readonly reservationId: string; readonly appointmentId: string; readonly parentRevision: number;
  readonly bindingRevision: number;
  readonly occupiedStartMs: number; readonly occupiedEndMs: number; readonly descriptorHash: string;
}
export interface CalendarAppointmentOverlapAllowance { readonly kind: 'calendar-appointment-overlap-allowance' }
const allowances = new WeakMap<CalendarAppointmentOverlapAllowance, { context: CalendarReadContext; hash: string }>();
function occupancyHash(scopeId: string, resourceIds: readonly string[], interval: CalendarTimedInterval, except?: { kind: string; id: string }) {
  return calendarHash(['calendar.occupancy.v1', scopeId, resourceIds, interval.occupiedStartMs, interval.occupiedEndMs, except ?? null]);
}
/** Private native mint. Callers must first authenticate the exact fresh decision and insert its admission. Never exposed over IPC. */
export function mintCalendarAppointmentOverlapAllowance(context: DatabaseWriteCommandContext, scopeId: string, resourceIds: readonly string[],
  interval: CalendarTimedInterval, admissionId: string, except?: { kind: string; id: string }): CalendarAppointmentOverlapAllowance {
  const admission = context.db.get(CALENDAR_OVERRIDE_ADMISSIONS, admissionId);
  if (!admission || admission.scope_id !== scopeId || admission.resource_ids_json !== JSON.stringify(resourceIds)
    || typeof admission.witness_count !== 'number' || !Number.isInteger(admission.witness_count) || admission.witness_count < 1 || admission.witness_count > 64
    || context.db.get('_calendar_receipts', admissionId) || (except ? except.kind !== 'appointment' || admission.appointment_id !== except.id || admission.action !== 'update' : admission.action !== 'create')) {
    throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  const value = Object.freeze({ kind: 'calendar-appointment-overlap-allowance' as const });
  allowances.set(value, { context, hash: occupancyHash(scopeId, resourceIds, interval, except) }); return value;
}
export function collectCalendarAppointmentOverlapWitnesses(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[],
  interval: CalendarTimedInterval, exceptId?: string): { readonly witnesses: readonly CalendarAppointmentOverlapWitness[]; readonly overflow: boolean } {
  try { return collectWitnessFacts(context, scopeId, resourceIds, interval, exceptId); }
  catch (error) { if (error instanceof CalendarError && error.code === 'CALENDAR_INPUT_INVALID') throw new CalendarError('CALENDAR_STATE_INVALID'); throw error; }
}
function collectWitnessFacts(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[],
  interval: CalendarTimedInterval, exceptId?: string): { readonly witnesses: readonly CalendarAppointmentOverlapWitness[]; readonly overflow: boolean } {
  if (!calendarCurrentResourceMembership(context)) throw new CalendarError('CALENDAR_STATE_INVALID');
  const witnesses: CalendarAppointmentOverlapWitness[] = [];
  for (const resourceId of resourceIds) {
    const rows = context.db.find('_calendar_reservations', { filters: [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('active', 1),
      { type: 'field', field: 'occupied_start_ms', operator: 'gte', value: calendarOverlapSearchStart(interval.occupiedStartMs) },
      { type: 'field', field: 'occupied_start_ms', operator: 'lt', value: interval.occupiedEndMs },
      { type: 'field', field: 'occupied_end_ms', operator: 'gt', value: interval.occupiedStartMs },
      ...(exceptId === undefined ? [] : [{ type: 'field' as const, field: 'appointment_id', operator: 'ne' as const, value: exceptId }])],
      order: [{ field: 'occupied_start_ms', direction: 'asc' }, { field: 'id', direction: 'asc' }], limit: 65 - witnesses.length });
    if (witnesses.length + rows.length > 64) return { witnesses: [], overflow: true };
    for (const row of rows) {
      const appointmentId = calendarKey(row.appointment_id), parent = context.db.get('calendar_appointments', appointmentId);
      const membership = context.db.get(CALENDAR_APPOINTMENT_RESOURCE_CURRENT, calendarHash([scopeId, appointmentId, resourceId]));
      if (!parent || parent.scope_id !== scopeId || parent.status !== 'confirmed' || !membership || membership.scope_id !== scopeId
        || membership.appointment_id !== appointmentId || membership.resource_id !== resourceId || row.occupied_start_ms !== parent.occupied_start_ms
        || row.occupied_end_ms !== parent.occupied_end_ms) throw new CalendarError('CALENDAR_STATE_INVALID');
      const value = { resourceId, reservationId: calendarKey(row.id), appointmentId, parentRevision: calendarInteger(parent.revision, 1),
        bindingRevision: calendarInteger(membership.binding_revision, 1, calendarInteger(parent.revision, 1)),
        occupiedStartMs: calendarInteger(row.occupied_start_ms, -8_640_000_000_000_000), occupiedEndMs: calendarInteger(row.occupied_end_ms, -8_640_000_000_000_000) };
      witnesses.push(Object.freeze({ ...value, descriptorHash: calendarHash(['calendar.overlap.witness.v1', scopeId, value, parent.status]) }));
    }
  }
  return { witnesses: Object.freeze(witnesses), overflow: false };
}

/** Review/final exception still executes blocks and currently live holds. */
export function assertCalendarHardResourcesAvailable(context: CalendarReadContext, scopeId: string, resourceIds: readonly string[], interval: CalendarTimedInterval, now = calendarNow()): void {
  assertCalendarSeriesResourcesAvailable(context, scopeId, resourceIds, interval, now);
  for (const resourceId of resourceIds) for (const [table, hold] of [['_calendar_block_reservations', false], ['_calendar_hold_reservations', true]] as const) {
    if (context.db.find(table, { select: ['id'], filters: [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('active', 1),
      { type: 'field', field: 'occupied_start_ms', operator: 'gte', value: calendarOverlapSearchStart(interval.occupiedStartMs) },
      { type: 'field', field: 'occupied_start_ms', operator: 'lt', value: interval.occupiedEndMs },
      { type: 'field', field: 'occupied_end_ms', operator: 'gt', value: interval.occupiedStartMs },
      ...(hold ? [{ type: 'field' as const, field: 'expires_ms', operator: 'gt' as const, value: now }] : [])],
      ...(hold ? { order: [{ field: 'expires_ms', direction: 'asc' as const }] } : {}), limit: 1 }).length) throw new CalendarError('CALENDAR_BOOKING_CONFLICT');
  }
}

export function assertCalendarResourcesAvailable(context: CalendarReadContext, scopeId: string,
  resourceIds: readonly string[], interval: CalendarTimedInterval, except?: { kind: 'appointment' | 'block' | 'hold'; id: string }, now = calendarNow(), allowance?: CalendarAppointmentOverlapAllowance): void {
  if (allowance) {
    const admitted = allowances.get(allowance);
    if (!admitted || admitted.context !== context || admitted.hash !== occupancyHash(scopeId, resourceIds, interval, except)) throw new CalendarError('CALENDAR_STATE_INVALID');
    allowances.delete(allowance);
    assertCalendarHardResourcesAvailable(context, scopeId, resourceIds, interval, now); return;
  }
  assertCalendarSeriesResourcesAvailable(context, scopeId, resourceIds, interval, now);
  for (const resourceId of resourceIds) for (const [table, kind, parent] of [
    ['_calendar_reservations', 'appointment', 'appointment_id'],
    ['_calendar_block_reservations', 'block', 'block_id'],
    ['_calendar_hold_reservations', 'hold', 'hold_id'],
  ] as const) {
    const filters: DatabaseFindFilter[] = [eq('scope_id', scopeId), eq('resource_id', resourceId), eq('active', 1),
      { type: 'field', field: 'occupied_start_ms', operator: 'gte', value: calendarOverlapSearchStart(interval.occupiedStartMs) },
      { type: 'field', field: 'occupied_start_ms', operator: 'lt', value: interval.occupiedEndMs },
      { type: 'field', field: 'occupied_end_ms', operator: 'gt', value: interval.occupiedStartMs }];
    if (except?.kind === kind) filters.push({ type: 'field', field: parent, operator: 'ne', value: except.id });
    if (kind === 'hold') filters.push({ type: 'field', field: 'expires_ms', operator: 'gt', value: now });
    // Expired holds remain immutable history. Use their expiry-first live index,
    // not an occupied-start scan across repeated reservations of the same future slot.
    if (context.db.find(table, { select: ['id'], filters,
      ...(kind === 'hold' ? { order: [{ field: 'expires_ms', direction: 'asc' as const }] } : {}), limit: 1 }).length) throw new CalendarError('CALENDAR_BOOKING_CONFLICT');
  }
}
