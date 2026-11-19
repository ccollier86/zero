/** Actor-local primitives. Current Guardian authority comes from the trusted broker, never authored HTTP fields. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseFindFilter } from '../databases/database-operations';
import type { Row } from '../sync/types';
import type { CalendarActor, CalendarAppointmentLifecycle, CalendarAppointmentTypeSnapshot, CalendarAppointmentView, CalendarCommandReceipt, CalendarGrant, CalendarResourceView, CalendarVisitSnapshot } from './contracts';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';
import { calendarBlock } from './blocks-model';
import { calendarHold } from './holds-model';
import { calendarLocation, requireCalendarLocationManager } from './locations-model';
import { calendarType, requireCalendarTypeManager } from './appointment-types-model';
import { recordCalendarIntegrationMutation } from './integration-model';

export const CALENDAR_LIMITS = Object.freeze({ resources: 10_000, appointments: 100_000, blocks: 100_000, holds: 100_000, locations: 10_000,
  locationHistory: 100_000, resourceLocationHistory: 100_000, types: 10_000, typeHistory: 100_000, resourceTypeHistory: 100_000,
  appointmentTypeHistory: 100_000, appointmentVisitHistory: 100_000, appointmentParticipantHistory: 100_000, holdParticipantBindings: 100_000,
  policyHistory: 100_000, appointmentLifecycleHistory: 100_000, availabilityPolicyHistory: 100_000, availabilityPolicyWindows: 1_000_000,
  receipts: 200_000, selection: 16, page: 100, rangeMs: 31 * 86_400_000 });
export interface CalendarResourceRow extends Row { id: string; scope_id: string; label: string; kind: CalendarResourceView['kind']; owner_id: string | null; time_zone: string; revision: number; active: number }
export interface CalendarAppointmentRow extends Row { id: string; scope_id: string; title: string; start_at: string; end_at: string; start_ms: number; end_ms: number; time_zone: string; buffer_before: number; buffer_after: number; occupied_start_ms: number; occupied_end_ms: number; status: CalendarAppointmentView['status']; revision: number; created_by: string }
export interface CalendarReceiptRow extends Row { id: string; scope_id: string; principal: string; request_id: string; digest: string; result_json: string; target_kind: 'resource' | 'appointment' | 'block' | 'hold' | 'location' | 'type' | 'lifecycle'; target_id: string; required_right: 'book' | 'manage' }
export const eq = (field: string, value: string | number): DatabaseFindFilter => ({ type: 'field', field, operator: 'eq', value });
export function calendarActor(input: unknown): CalendarActor {
  const r = calendarRecord(input, ['scopeId', 'userId', 'principal', 'manageAll', 'createOwn']);
  if (typeof r.manageAll !== 'boolean' || typeof r.createOwn !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { scopeId: calendarScope(r.scopeId), userId: calendarKey(r.userId), principal: calendarText(r.principal, 256), manageAll: r.manageAll, createOwn: r.createOwn };
}
export function calendarSelection(input: unknown): string[] {
  const value = calendarValue(input);
  if (!Array.isArray(value) || value.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const ids = value.map(id => calendarKey(id));
  if (new Set(ids).size !== ids.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return ids.sort();
}
export function assertCalendarOwner(context: DatabaseWriteCommandContext, scopeId: string): void {
  const owner = context.db.get('_calendar_owner', 'application');
  if (!owner || owner.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
export function calendarResource(context: DatabaseWriteCommandContext, actor: CalendarActor, input: unknown): CalendarResourceRow {
  const row = context.db.get('calendar_resources', calendarKey(input)) as CalendarResourceRow | null;
  if (!row || row.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  return row;
}
export function grantId(scopeId: string, resourceId: string, userId: string): string { return calendarHash([scopeId, resourceId, userId]); }
export function reservationId(scopeId: string, appointmentId: string, resourceId: string): string { return calendarHash([scopeId, appointmentId, resourceId]); }
export function hasCalendarRight(actor: CalendarActor, row: CalendarResourceRow, grant: Row | null, right: CalendarGrant): boolean {
  if (row.scope_id !== actor.scopeId) return false;
  if (actor.manageAll || row.owner_id === actor.userId) return true;
  return !!grant && grant.scope_id === actor.scopeId && grant.resource_id === row.id && grant.user_id === actor.userId
    && (grant.manage === 1 || grant[right] === 1 || right === 'busy' && grant.details === 1);
}
export function requireCalendarRight(context: DatabaseWriteCommandContext, actor: CalendarActor, row: CalendarResourceRow, right: CalendarGrant): void {
  const grant = context.db.get('_calendar_grants', grantId(actor.scopeId, row.id, actor.userId));
  if (!hasCalendarRight(actor, row, grant, right)) throw new CalendarError('CALENDAR_NOT_FOUND');
}
export function appointmentResources(context: DatabaseWriteCommandContext, actor: CalendarActor, id: string): string[] {
  const rows = context.db.find('_calendar_reservations', { select: ['resource_id'], filters: [eq('scope_id', actor.scopeId), eq('appointment_id', id)], limit: CALENDAR_LIMITS.selection + 1 });
  if (!rows.length || rows.length > CALENDAR_LIMITS.selection) throw new CalendarError('CALENDAR_STATE_INVALID');
  return rows.map(row => String(row.resource_id)).sort();
}
export function calendarAppointment(context: DatabaseWriteCommandContext, actor: CalendarActor, input: unknown, right: CalendarGrant): { row: CalendarAppointmentRow; resourceIds: string[] } {
  const row = context.db.get('calendar_appointments', calendarKey(input)) as CalendarAppointmentRow | null;
  if (!row || row.scope_id !== actor.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const resourceIds = appointmentResources(context, actor, row.id);
  for (const id of resourceIds) requireCalendarRight(context, actor, calendarResource(context, actor, id), right);
  return { row, resourceIds };
}
export function resourceView(row: CalendarResourceRow): CalendarResourceView {
  return { id: row.id, label: row.label, kind: row.kind, ownerId: row.owner_id, timeZone: row.time_zone, revision: row.revision, active: row.active === 1 };
}
export function appointmentView(row: CalendarAppointmentRow, resourceIds: string[], appointmentType?: CalendarAppointmentTypeSnapshot, lifecycle?: CalendarAppointmentLifecycle, visit?: CalendarVisitSnapshot): CalendarAppointmentView {
  return { id: row.id, revision: row.revision, resourceIds, title: row.title, startAt: row.start_at, endAt: row.end_at, timeZone: row.time_zone,
    bufferBeforeMinutes: row.buffer_before, bufferAfterMinutes: row.buffer_after, status: row.status, createdBy: row.created_by,
    ...(appointmentType === undefined ? {} : { appointmentType }), ...(lifecycle === undefined ? {} : { lifecycle }), ...(visit === undefined ? {} : { visit }) };
}
export function calendarRevision(row: { revision: number }, input: unknown): void {
  if (row.revision !== calendarInteger(input, 1)) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
}
export function nextCalendarRevision(revision: number): number { return calendarInteger(revision, 1, Number.MAX_SAFE_INTEGER - 1) + 1; }
export function calendarBudget(context: DatabaseWriteCommandContext, key: 'resources' | 'appointments' | 'blocks' | 'holds' | 'locations' | 'locationHistory' | 'resourceLocationHistory'
  | 'types' | 'typeHistory' | 'resourceTypeHistory' | 'appointmentTypeHistory' | 'appointmentVisitHistory' | 'appointmentParticipantHistory' | 'holdParticipantBindings' | 'policyHistory' | 'appointmentLifecycleHistory'
  | 'availabilityPolicyHistory' | 'availabilityPolicyWindows' | 'receipts', amount = 1): void {
  calendarInteger(amount, 0);
  if (!amount) return;
  const prior = context.db.get('_calendar_usage', key), count = prior ? calendarInteger(prior.count) : 0;
  if (count > CALENDAR_LIMITS[key] - amount) throw new CalendarError('CALENDAR_CAPACITY');
  if (prior) context.db.update('_calendar_usage', key, { count: count + amount });
  else context.db.createStrict('_calendar_usage', { id: key, count: amount });
}
export function authorizeCalendarReceipt(context: DatabaseWriteCommandContext, actor: CalendarActor, prior: CalendarReceiptRow): void {
  if (prior.target_kind === 'lifecycle') { if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN'); }
  else if (prior.target_kind === 'resource') {
    if (parseCalendarReceipt(prior).operation === 'resource.types-changed') requireCalendarTypeManager(actor);
    requireCalendarRight(context, actor, calendarResource(context, actor, prior.target_id), prior.required_right);
  }
  else if (prior.target_kind === 'block') calendarBlock(context, actor, prior.target_id, prior.required_right);
  else if (prior.target_kind === 'hold') calendarHold(context, actor, prior.target_id, prior.required_right);
  else if (prior.target_kind === 'location') { requireCalendarLocationManager(actor); calendarLocation(context, actor, prior.target_id); }
  else if (prior.target_kind === 'type') { requireCalendarTypeManager(actor); calendarType(context, actor, prior.target_id); }
  else {
    if (parseCalendarReceipt(prior).operation === 'appointment.participants-changed' && !actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    calendarAppointment(context, actor, prior.target_id, prior.required_right);
    if (parseCalendarReceipt(prior).operation === 'appointment.created') {
      const holds = context.db.find('calendar_holds', { filters: [eq('scope_id', actor.scopeId), eq('appointment_id', prior.target_id)], limit: 2 });
      if (holds.length > 1) throw new CalendarError('CALENDAR_STATE_INVALID');
      if (holds[0]) {
        if (holds[0].principal !== actor.principal || holds[0].created_by !== actor.userId) throw new CalendarError('CALENDAR_NOT_FOUND');
        calendarHold(context, actor, holds[0].id, 'book');
      }
    }
  }
}
export function parseCalendarReceipt(row: CalendarReceiptRow): CalendarCommandReceipt {
  try {
    const r = calendarRecord(JSON.parse(row.result_json), ['requestId', 'operation', 'id', 'revision', 'changed']);
    const operations = { resource: ['resource.created', 'resource.grant-changed', 'resource.availability-changed', 'resource.locations-changed', 'resource.types-changed', 'resource.availability-policy-changed'],
      appointment: ['appointment.created', 'appointment.rescheduled', 'appointment.cancelled', 'appointment.transitioned', 'appointment.participants-changed'], block: ['block.created', 'block.rescheduled', 'block.cancelled'],
      hold: ['hold.acquired', 'hold.released'], location: ['location.created', 'location.updated'], type: ['type.created', 'type.updated'], lifecycle: ['lifecycle.policy-changed'] };
    if (r.requestId !== row.request_id || r.id !== row.target_id || typeof r.changed !== 'boolean'
      || !operations[row.target_kind]?.includes(r.operation as string)
      || row.target_kind === 'block' && row.required_right !== 'manage'
      || row.target_kind === 'location' && row.required_right !== 'manage'
      || row.target_kind === 'type' && row.required_right !== 'manage'
      || row.target_kind === 'lifecycle' && (row.required_right !== 'manage' || row.target_id !== 'policy')
      || !['book', 'manage'].includes(row.required_right)) throw new CalendarError('CALENDAR_STATE_INVALID');
    return { requestId: calendarKey(r.requestId), operation: r.operation as CalendarCommandReceipt['operation'], id: calendarKey(r.id), revision: calendarInteger(r.revision, 1), changed: r.changed };
  } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
}
/** Receipt replay is immutable but not a grant: current object rights are checked before returning the safe outcome. */
export function calendarIntent(context: DatabaseWriteCommandContext, actor: CalendarActor, requestInput: unknown, intent: unknown,
  targetKind: CalendarReceiptRow['target_kind'], requiredRight: CalendarReceiptRow['required_right'], run: (requestId: string) => CalendarCommandReceipt): CalendarCommandReceipt {
  const requestId = calendarKey(requestInput), id = calendarHash([actor.scopeId, actor.principal, requestId]), digest = calendarHash(intent);
  // Historical pre-015 realms have no operator family. Current realms retain
  // one human key namespace across ordinary and private operator commands.
  if (context.db.hasTable('_calendar_integration_operator_requests') && context.db.get('_calendar_integration_operator_requests',
    calendarHash(['calendar-operator-v1', actor.scopeId, actor.principal, requestId]))) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  const legacy = context.db.get('_calendar_receipts', id) as CalendarReceiptRow | null;
  const block = context.db.get('_calendar_block_receipts', id) as CalendarReceiptRow | null;
  const hold = context.db.get('_calendar_hold_receipts', id) as CalendarReceiptRow | null;
  const location = context.db.get('_calendar_location_receipts', id) as CalendarReceiptRow | null;
  const type = context.db.get('_calendar_type_receipts', id) as CalendarReceiptRow | null;
  const lifecycle = context.db.get('_calendar_lifecycle_receipts', id) as CalendarReceiptRow | null;
  if ([legacy, block, hold, location, type, lifecycle].filter(Boolean).length > 1) throw new CalendarError('CALENDAR_STATE_INVALID');
  const prior = legacy ?? block ?? hold ?? location ?? type ?? lifecycle;
  if (prior) {
    if (prior.scope_id !== actor.scopeId || prior.principal !== actor.principal || prior.digest !== digest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    authorizeCalendarReceipt(context, actor, prior);
    return parseCalendarReceipt(prior);
  }
  calendarBudget(context, 'receipts');
  const result = run(requestId);
  context.db.createStrict(targetKind === 'lifecycle' ? '_calendar_lifecycle_receipts' : targetKind === 'type' ? '_calendar_type_receipts' : targetKind === 'location' ? '_calendar_location_receipts' : targetKind === 'hold' ? '_calendar_hold_receipts' : targetKind === 'block' ? '_calendar_block_receipts' : '_calendar_receipts', { id, scope_id: actor.scopeId, principal: actor.principal, request_id: requestId, digest,
    result_json: calendarJson(result), target_kind: targetKind, target_id: result.id, required_right: requiredRight });
  if (result.changed) context.db.createStrict(targetKind === 'lifecycle' ? '_calendar_lifecycle_effect_intents' : targetKind === 'type' ? '_calendar_type_effect_intents' : targetKind === 'location' ? '_calendar_location_effect_intents' : targetKind === 'hold' ? '_calendar_hold_effect_intents' : targetKind === 'block' ? '_calendar_block_effect_intents' : '_calendar_effect_intents', { id, scope_id: actor.scopeId, receipt_id: id,
    operation: result.operation, target_kind: targetKind, target_id: result.id, revision: result.revision });
  recordCalendarIntegrationMutation(context, actor, result, id);
  return result;
}
