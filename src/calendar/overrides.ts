/** Independent one-off exception authority. All decisions stay inside the verified native owner. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { CalendarReadContext } from './calendar-read-store';
import { createCalendarReadContext } from './calendar-read-store';
import type { CalendarActor } from './contracts';
import type { CalendarAppointmentOverride, CalendarOverrideReview, CalendarOverrideGrantView } from './override-contracts';
import { CALENDAR_OVERRIDE_POLICY, CALENDAR_OVERRIDE_STATE as state, CALENDAR_OVERRIDE_GRANT_CURRENT as current, CALENDAR_OVERRIDE_GRANT_HISTORY as grants,
  CALENDAR_OVERRIDE_ADMISSIONS as admissions, CALENDAR_OVERRIDE_HISTORY as history, CALENDAR_OVERRIDE_WITNESSES as witnesses,
  CALENDAR_OVERRIDE_LIMITS as limits, normalizeCalendarOverrideGrant } from './override-model';
import { CalendarError, calendarCommand } from './error';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarIntent, calendarResource, calendarRevision, eq, grantId,
  nextCalendarRevision, requireCalendarRight } from './realm-model';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarText } from './validation';
import { calendarNow } from './hold-time';
import { admitCalendarBookingHardCandidate } from './booking-admission';
import { assertCalendarHardResourcesAvailable, collectCalendarAppointmentOverlapWitnesses, mintCalendarAppointmentOverlapAllowance,
  type CalendarAppointmentOverlapAllowance, type CalendarAppointmentOverlapWitness } from './occupancy';
import { calendarPreparedAppointmentHash, type CalendarPreparedAppointment } from './appointment-preparation';
import { appointmentResources } from './realm-model';
import { calendarCurrentAppointmentTime, calendarAppointmentTimeHistoryFields } from './appointment-time-bindings';
import { calendarCurrentAppointmentType } from './appointment-type-bindings';
import { calendarCurrentAppointmentVisit } from './visit-bindings';
import { calendarCurrentAppointmentParticipants } from './participant-bindings';
import { appendCalendarSemanticAudit } from './semantic-audit';

const tables = [state, current, grants, admissions, history, witnesses];
const grantIdentity = (scope: string, resource: string, user: string) => calendarHash(['calendar.override.grant.v1', scope, resource, user]);
function invalid(): never { throw new CalendarError('CALENDAR_STATE_INVALID'); }
function secret(context: CalendarReadContext): string {
  const present = tables.map(table => context.db.hasTable(table)), marker = context.db.get('_calendar_usage', 'overrideVersion');
  // This helper is exclusively019 admission, not a legacy ordinary fallback.
  // Even complete table removal cannot turn adopted authority into a new key.
  if (present.every(value => !value) && !marker) invalid();
  const selected = present.every(Boolean) ? context.db.get(state, 'application') : null;
  if (!selected || selected.version !== 19 || marker?.count !== 19 || typeof selected.review_key !== 'string' || !/^[a-f0-9]{64}$/.test(selected.review_key)) invalid();
  return selected.review_key;
}
function currentGrant(context: CalendarReadContext, scope: string, resourceId: string, user: string) {
  try { return currentGrantFacts(context, scope, resourceId, user); }
  catch (error) { if (error instanceof CalendarError && error.code === 'CALENDAR_INPUT_INVALID') invalid(); throw error; }
}
function currentGrantFacts(context: CalendarReadContext, scope: string, resourceId: string, user: string) {
  const id = grantIdentity(scope, resourceId, user), pointer = context.db.get(current, id);
  const latest = context.db.find(grants, { filters: [eq('scope_id', scope), eq('resource_id', resourceId), eq('user_id', user)],
    order: [{ field: 'resource_revision', direction: 'desc' }], limit: 1 })[0];
  if (!pointer && !latest) return { enabled: false, generation: 'absent' };
  if (!pointer || !latest || pointer.scope_id !== scope || pointer.resource_id !== resourceId || pointer.user_id !== user || pointer.history_id !== latest.id
    || pointer.resource_revision !== latest.resource_revision || latest.scope_id !== scope || latest.resource_id !== resourceId || latest.user_id !== user
    || latest.enabled !== 0 && latest.enabled !== 1 || calendarInteger(latest.resource_revision, 2) > calendarInteger(context.db.get('calendar_resources', resourceId)?.revision, 1)) invalid();
  return { enabled: latest.enabled === 1, generation: calendarHash(['calendar.override.grant.generation.v1', latest.id, latest.resource_revision, latest.enabled]) };
}
/** Used by review BEFORE selected catalog/time/private conflict probes. No owner/manage fallback. */
export function assertCalendarOverrideReviewAuthority(context: CalendarReadContext, actor: CalendarActor, resourceIds: readonly string[]): readonly string[] {
  if (!actor.overrides || actor.overrides.policyVersion !== CALENDAR_OVERRIDE_POLICY || !actor.overrides.use) throw new CalendarError('CALENDAR_OVERRIDE_NOT_ALLOWED');
  assertCalendarOwner(context, actor.scopeId); secret(context);
  const generations: string[] = [];
  for (const id of resourceIds) {
    const resource = calendarResource(context, actor, id); requireCalendarRight(context, actor, resource, 'book');
    const grant = currentGrant(context, actor.scopeId, id, actor.userId);
    if (!grant.enabled) throw new CalendarError('CALENDAR_OVERRIDE_NOT_ALLOWED');
    generations.push(calendarHash([id, resource.revision, grant.generation]));
  }
  return Object.freeze(generations);
}
export const assertCalendarOverrideUse = assertCalendarOverrideReviewAuthority;

export function readCalendarOverrideGrant(context: DatabaseReadQueryContext, input: unknown): CalendarOverrideGrantView {
  const r = calendarRecord(input, ['actor', 'id', 'userId']), actor = calendarActor(r.actor), resourceId = calendarKey(r.id), userId = calendarKey(r.userId);
  const read = createCalendarReadContext(context); assertCalendarOwner(read, actor.scopeId);
  const resource = calendarResource(read, actor, resourceId); requireCalendarRight(read, actor, resource, 'manage');
  if (!actor.overrides?.manageGrants) throw new CalendarError('CALENDAR_OVERRIDE_NOT_ALLOWED');
  secret(read); const grant = currentGrant(read, actor.scopeId, resourceId, userId);
  return { resourceId, userId, resourceRevision: resource.revision, categories: grant.enabled ? ['appointment-overlap'] : [] };
}
function budget(context: DatabaseWriteCommandContext, key: 'overrideGrantHistory' | 'overrideHistory' | 'overrideWitnesses', amount: number) {
  const maximum = key === 'overrideGrantHistory' ? limits.grantHistory : key === 'overrideHistory' ? limits.history : limits.retainedWitnesses;
  const prior = context.db.get('_calendar_usage', key), count = prior ? calendarInteger(prior.count) : 0;
  if (count > maximum - amount) throw new CalendarError('CALENDAR_CAPACITY');
  if (prior) context.db.update('_calendar_usage', key, { count: count + amount }); else context.db.createStrict('_calendar_usage', { id: key, count: amount });
}
interface CapturedGrant { readonly resourceId: string; readonly userId: string; readonly revision: number; readonly historyId: string; readonly enabled: number }
const capturedGrants = new WeakMap<DatabaseWriteCommandContext, Map<string, CapturedGrant>>();
export function replaceCalendarOverrideGrant(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const r = calendarRecord(input, ['actor', 'id', 'userId', 'requestId', 'expectedRevision', 'categories']), actor = calendarActor(r.actor);
    assertCalendarOwner(context, actor.scopeId);
    const resource = calendarResource(context, actor, r.id); requireCalendarRight(context, actor, resource, 'manage');
    const userId = calendarKey(r.userId), expectedRevision = calendarInteger(r.expectedRevision, 1), value = normalizeCalendarOverrideGrant({ categories: r.categories });
    return calendarIntent(context, actor, r.requestId, ['resource.override-grant.v1', resource.id, expectedRevision, userId, value.categories], 'resource', 'manage', requestId => {
      if (!actor.overrides?.manageGrants) throw new CalendarError('CALENDAR_OVERRIDE_NOT_ALLOWED');
      secret(context); calendarRevision(resource, expectedRevision);
      const prior = currentGrant(context, actor.scopeId, resource.id, userId), enabled = value.categories.length ? 1 : 0;
      if (prior.enabled === !!enabled) return { requestId, operation: 'resource.override-grant-changed' as const, id: resource.id, revision: resource.revision, changed: false };
      budget(context, 'overrideGrantHistory', 1);
      const revision = nextCalendarRevision(resource.revision), change = context.db.update('calendar_resources', resource.id, { revision });
      const id = grantIdentity(actor.scopeId, resource.id, userId), historyId = calendarHash(['calendar.override.grant.history.v1', id, revision]);
      context.db.createStrict(grants, { id: historyId, scope_id: actor.scopeId, resource_id: resource.id, user_id: userId, resource_revision: revision, enabled });
      const values = { resource_revision: revision, history_id: historyId };
      if (context.db.get(current, id)) context.db.update(current, id, values);
      else context.db.createStrict(current, { id, scope_id: actor.scopeId, resource_id: resource.id, user_id: userId, ...values });
      let captures = capturedGrants.get(context); if (!captures) capturedGrants.set(context, captures = new Map());
      captures.set(calendarHash([actor.scopeId, actor.principal, requestId]), { resourceId: resource.id, userId, revision, historyId, enabled });
      appendCalendarSemanticAudit(context, 'resource.override-grant-changed', change, { revision });
      return { requestId, operation: 'resource.override-grant-changed' as const, id: resource.id, revision, changed: true };
    });
  });
}
export function assertCalendarOverrideResourceReceiptEvidence(context: DatabaseWriteCommandContext, actor: CalendarActor, receiptId: string, resourceId: string, revision: number): void {
  const capture = capturedGrants.get(context)?.get(receiptId);
  if (!capture) invalid();
  secret(context);
  const pointer = context.db.get(current, grantIdentity(actor.scopeId, resourceId, capture.userId)), selected = context.db.get(grants, capture.historyId);
  if (capture.resourceId !== resourceId || capture.revision !== revision || !pointer || !selected || pointer.scope_id !== actor.scopeId || pointer.resource_id !== resourceId
    || pointer.user_id !== capture.userId || pointer.resource_revision !== revision || pointer.history_id !== capture.historyId
    || selected.scope_id !== actor.scopeId || selected.resource_id !== resourceId || selected.user_id !== capture.userId || selected.resource_revision !== revision || selected.enabled !== capture.enabled) invalid();
  currentGrant(context, actor.scopeId, resourceId, capture.userId);
}
function normalResourceGeneration(context: CalendarReadContext, actor: CalendarActor, prepared: CalendarPreparedAppointment) {
  const ids = new Set(prepared.resourceIds);
  if (prepared.action === 'update') for (const id of calendarAppointment(context, actor, prepared.id, 'manage').resourceIds) ids.add(id);
  return [...ids].sort().map(id => {
    const row = calendarResource(context, actor, id), grant = context.db.get('_calendar_grants', grantId(actor.scopeId, id, actor.userId));
    return calendarHash([id, row.revision, row.owner_id, row.active, grant ? [grant.scope_id, grant.resource_id, grant.user_id, grant.busy, grant.details, grant.book, grant.manage] : null]);
  });
}
function descriptor(context: CalendarReadContext, actor: CalendarActor, key: string, prepared: CalendarPreparedAppointment,
  generations: readonly string[], selected: readonly CalendarAppointmentOverlapWitness[]): string {
  const owner = context.db.get('_calendar_owner', 'application');
  if (!owner || owner.scope_id !== actor.scopeId || !actor.overrides) invalid();
  return calendarHash(['calendar.override.decision.v1', actor.scopeId, calendarKey(owner.owner_id), actor.userId, actor.principal, actor.manageAll,
    key, prepared.action, prepared.id, prepared.expectedRevision, prepared.inputHash, calendarPreparedAppointmentHash(prepared), actor.overrides.policyHash,
    normalResourceGeneration(context, actor, prepared), generations, selected.map(value => value.descriptorHash)]);
}
function mac(key: string, decision: string, issued: number, expires: number, nonce: string): string {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(calendarJson(['calendar.override.token.v1', decision, issued, expires, nonce])).digest('hex');
}
const nonReviewable = () => Object.freeze({ status: 'non-reviewable' as const });
export function isCalendarOverrideHardRefusal(error: unknown): boolean {
  return error instanceof CalendarError && ['CALENDAR_BOOKING_CONFLICT', 'CALENDAR_AVAILABILITY_CONFLICT', 'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED',
    'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED', 'CALENDAR_TIME_RULES_UNAVAILABLE', 'CALENDAR_TYPE_CONFLICT', 'CALENDAR_TYPE_STALE',
    'CALENDAR_VISIT_CONFLICT', 'CALENDAR_VISIT_STALE', 'CALENDAR_TRANSITION_INVALID'].includes(error.code);
}
/** Real readonly query caller already admits ordinary old-manage/result-book before fresh preparation. */
export function reviewPreparedCalendarAppointmentOverride(context: CalendarReadContext, actor: CalendarActor, keyInput: unknown, prepared: CalendarPreparedAppointment): CalendarOverrideReview {
  const key = calendarKey(keyInput), generations = assertCalendarOverrideReviewAuthority(context, actor, prepared.resourceIds);
  if (!prepared.checks.occupancy) return nonReviewable();
  const now = calendarNow();
  try {
    admitCalendarBookingHardCandidate(context, actor.scopeId, prepared, prepared.checks);
    assertCalendarHardResourcesAvailable(context, actor.scopeId, prepared.resourceIds, prepared.interval, now);
  } catch (error) {
    if (isCalendarOverrideHardRefusal(error)) return nonReviewable();
    throw error;
  }
  const selected = collectCalendarAppointmentOverlapWitnesses(context, actor.scopeId, prepared.resourceIds, prepared.interval,
    prepared.checks.occupancy.except?.kind === 'appointment' ? prepared.checks.occupancy.except.id : undefined);
  if (selected.overflow) return nonReviewable();
  if (!selected.witnesses.length) return Object.freeze({ status: 'clear' });
  const decision = descriptor(context, actor, key, prepared, generations, selected.witnesses), expires = calendarInteger(now + limits.ttlMs), nonce = randomBytes(16).toString('hex');
  return Object.freeze({ status: 'reviewable', categories: Object.freeze(['appointment-overlap'] as const), policyVersion: CALENDAR_OVERRIDE_POLICY,
    decisionToken: `co1.${now}.${expires}.${nonce}.${mac(secret(context), decision, now, expires, nonce)}`, expiresAt: new Date(expires).toISOString() });
}
interface CapturedAdmission { readonly prepared: CalendarPreparedAppointment; readonly row: Row; readonly selected: readonly CalendarAppointmentOverlapWitness[] }
const capturedAdmissions = new WeakMap<DatabaseWriteCommandContext, Map<string, CapturedAdmission>>();
export function admitCalendarAppointmentOverride(context: DatabaseWriteCommandContext, actor: CalendarActor, keyInput: unknown,
  prepared: CalendarPreparedAppointment, override: CalendarAppointmentOverride): CalendarAppointmentOverlapAllowance {
  const key = calendarKey(keyInput), generations = assertCalendarOverrideReviewAuthority(context, actor, prepared.resourceIds);
  if (!prepared.checks.occupancy) throw new CalendarError('CALENDAR_OVERRIDE_STALE');
  admitCalendarBookingHardCandidate(context, actor.scopeId, prepared, prepared.checks);
  const now = calendarNow(); assertCalendarHardResourcesAvailable(context, actor.scopeId, prepared.resourceIds, prepared.interval, now);
  const selected = collectCalendarAppointmentOverlapWitnesses(context, actor.scopeId, prepared.resourceIds, prepared.interval,
    prepared.checks.occupancy.except?.kind === 'appointment' ? prepared.checks.occupancy.except.id : undefined);
  if (selected.overflow || !selected.witnesses.length) throw new CalendarError('CALENDAR_OVERRIDE_STALE');
  const parts = override.decisionToken.split('.'), issued = Number(parts[1]), expires = Number(parts[2]), nonce = parts[3], supplied = parts[4];
  if (parts.length !== 5 || parts[0] !== 'co1' || !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
    || String(issued) !== parts[1] || String(expires) !== parts[2] || issued < 0 || issued > now || expires <= now || expires - issued !== limits.ttlMs
    || !nonce || !/^[a-f0-9]{32}$/.test(nonce) || !supplied || !/^[a-f0-9]{64}$/.test(supplied) || override.policyVersion !== CALENDAR_OVERRIDE_POLICY) throw new CalendarError('CALENDAR_OVERRIDE_STALE');
  const decision = descriptor(context, actor, key, prepared, generations, selected.witnesses);
  if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(mac(secret(context), decision, issued, expires, nonce), 'hex'))) throw new CalendarError('CALENDAR_OVERRIDE_STALE');
  budget(context, 'overrideHistory', 1); budget(context, 'overrideWitnesses', selected.witnesses.length);
  const id = calendarHash([actor.scopeId, actor.principal, key]), owner = context.db.get('_calendar_owner', 'application');
  if (!owner) invalid();
  const row: Row = { id, scope_id: actor.scopeId, principal: actor.principal, request_id: key, owner_id: calendarKey(owner.owner_id), appointment_id: prepared.id,
    action: prepared.action, base_revision: prepared.expectedRevision, appointment_revision: prepared.expectedRevision + 1,
    policy_version: CALENDAR_OVERRIDE_POLICY, policy_hash: actor.overrides!.policyHash, input_hash: prepared.inputHash, candidate_hash: calendarPreparedAppointmentHash(prepared),
    decision_hash: decision, reason: override.reason, witness_count: selected.witnesses.length, resource_ids_json: calendarJson(prepared.resourceIds), issued_ms: issued, expires_ms: expires, nonce };
  context.db.createStrict(admissions, row);
  selected.witnesses.forEach((value, ordinal) => context.db.createStrict(witnesses, { id: calendarHash(['calendar.override.witness.v1', id, ordinal]), scope_id: actor.scopeId,
    admission_id: id, ordinal, resource_id: value.resourceId, reservation_id: value.reservationId, appointment_id: value.appointmentId,
    parent_revision: value.parentRevision, binding_revision: value.bindingRevision, occupied_start_ms: value.occupiedStartMs, occupied_end_ms: value.occupiedEndMs, descriptor_hash: value.descriptorHash }));
  let captures = capturedAdmissions.get(context); if (!captures) capturedAdmissions.set(context, captures = new Map());
  captures.set(id, { prepared, row, selected: selected.witnesses });
  return mintCalendarAppointmentOverlapAllowance(context, actor.scopeId, prepared.resourceIds, prepared.interval, id, prepared.checks.occupancy.except);
}
export function finishCalendarAppointmentOverride(context: DatabaseWriteCommandContext, actor: CalendarActor, requestId: string, appointmentId: string, revision: number): void {
  const id = calendarHash([actor.scopeId, actor.principal, requestId]), capture = capturedAdmissions.get(context)?.get(id);
  if (!capture || capture.prepared.id !== appointmentId || capture.prepared.expectedRevision + 1 !== revision) invalid();
  context.db.createStrict(history, { id, scope_id: actor.scopeId, appointment_id: appointmentId, appointment_revision: revision, admission_id: id });
}
/** Called once before ordinary receipt/effect publication. A JSON row cannot mint a native allowance or final proof. */
export function assertCalendarOverrideReceiptEvidence(context: DatabaseWriteCommandContext, actor: CalendarActor, receiptId: string, targetId: string, revision: number): void {
  if (!context.db.hasTable(admissions)) return;
  const row = context.db.get(admissions, receiptId), capture = capturedAdmissions.get(context)?.get(receiptId);
  if (!row && !capture) return;
  if (!row || !capture || row.appointment_id !== targetId || row.appointment_revision !== revision
    || Object.entries(capture.row).some(([field, value]) => row[field] !== value)) invalid();
  const p = capture.prepared, parent = context.db.get('calendar_appointments', targetId), h = context.db.get(history, receiptId);
  if (!parent || parent.scope_id !== actor.scopeId || parent.revision !== revision || parent.title !== p.title || parent.status !== 'confirmed'
    || !h || h.admission_id !== receiptId || h.appointment_id !== targetId || h.appointment_revision !== revision
    || calendarJson(appointmentResources(context, actor, targetId)) !== calendarJson(p.resourceIds)) invalid();
  const fact = calendarCurrentAppointmentTime(context, parent);
  const reference = (value: { id: string; revision: number } | undefined) => value ? { id: value.id, revision: value.revision } : null;
  const visitReference = (value: CalendarPreparedAppointment['visit']) => value?.mode === 'in-person'
    ? { mode: value.mode, location: reference(value.location) } : value ?? null;
  if (calendarJson(calendarAppointmentTimeHistoryFields(fact)) !== calendarJson(calendarAppointmentTimeHistoryFields(p.fact))
    || calendarJson(fact.interval) !== calendarJson(p.fact.interval)
    || calendarJson(reference(calendarCurrentAppointmentType(context, actor.scopeId, targetId))) !== calendarJson(reference(p.appointmentType))
    || calendarJson(visitReference(calendarCurrentAppointmentVisit(context, actor.scopeId, targetId))) !== calendarJson(visitReference(p.visit))
    || calendarJson(calendarCurrentAppointmentParticipants(context, actor.scopeId, targetId)) !== calendarJson(p.participants ?? [])) invalid();
  const retained = context.db.find(witnesses, { filters: [eq('admission_id', receiptId)], order: [{ field: 'ordinal', direction: 'asc' }], limit: 65 });
  if (retained.length !== capture.selected.length || retained.some((w, ordinal) => {
    const value = capture.selected[ordinal]!;
    return w.scope_id !== actor.scopeId || w.ordinal !== ordinal || w.resource_id !== value.resourceId || w.reservation_id !== value.reservationId || w.appointment_id !== value.appointmentId
      || w.parent_revision !== value.parentRevision || w.occupied_start_ms !== value.occupiedStartMs || w.occupied_end_ms !== value.occupiedEndMs || w.descriptor_hash !== value.descriptorHash;
  })) invalid();
  if (retained.some((w, ordinal) => w.binding_revision !== capture.selected[ordinal]!.bindingRevision)) invalid();
}
