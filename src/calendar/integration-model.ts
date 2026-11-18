/** Private observation-only source protocol. These plain contracts confer no owner, Jobs or effect authority. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { jobSourceId, jobSourceScheduleId, normalizeJobSourceContract, type JobSourceContract, type JobSourceRegistration, type JobSourceScheduleReceipt } from '../jobs/source-model';
import { CalendarError } from './error';
import { calendarNow } from './hold-time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope } from './validation';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import type { CalendarAppointmentRow } from './realm-model';
import { effectiveCalendarAppointmentStatus, isCalendarLifecycleTerminal } from './lifecycle-model';

export const CALENDAR_INTEGRATION_COMMANDS = ['calendar.integration.policy.install', 'calendar.integration.policy.activate', 'calendar.integration.policy.retire',
  'calendar.integration.claim', 'calendar.integration.ack', 'calendar.integration.defer', 'calendar.integration.suppress',
  'calendar.integration.effect.admit', 'calendar.integration.effect.settle'] as const;
export const CALENDAR_INTEGRATION_QUERIES = ['calendar.integration.policy', 'calendar.integration.policies', 'calendar.integration.intent',
  'calendar.integration.pending', 'calendar.integration.effect'] as const;
export const CALENDAR_INTEGRATION_LIMITS = Object.freeze({ rules: 8, policies: 10_000, intents: 100_000, page: 100, leaseMs: 60_000, horizonMs: 31 * 86_400_000 });
/** Jobs' once parser deliberately admits four-digit UTC years, unlike calendar display instants. */
export const CALENDAR_INTEGRATION_MAX_DUE_MS = 253_402_300_799_999;
export const CALENDAR_INTEGRATION_CODES = ['JOBS_CAPACITY', 'JOBS_OUTCOME_UNKNOWN', 'JOBS_NOT_READY', 'JOBS_REVISION_CONFLICT',
  'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_AUTHORITY_RETIRED', 'CALENDAR_NOT_READY', 'INTEGRATION_RETRY'] as const;
export type CalendarIntegrationCode = typeof CALENDAR_INTEGRATION_CODES[number];
export interface CalendarIntegrationPolicySpec {
  readonly ruleId: string; readonly ruleVersion: string; readonly adapter: 'observation-v1'; readonly source: JobSourceContract;
  readonly dueOffsetMs: number; readonly maxLatenessMs: number;
}
export interface CalendarIntegrationPolicyView {
  readonly id: string; readonly ruleId: string; readonly epoch: number; readonly state: 'activating' | 'active' | 'retired';
  readonly policy: CalendarIntegrationPolicySpec; readonly registration: JobSourceRegistration | null;
}
export interface CalendarIntegrationObservationInput {
  readonly kind: 'calendar-observation-v1'; readonly intentId: string; readonly appointmentRevision: number; readonly policyEpoch: number;
}
export interface CalendarIntegrationIntentView {
  readonly id: string; readonly ruleId: string; readonly policyEpoch: number; readonly appointmentId: string; readonly appointmentRevision: number;
  readonly createKey: string; readonly cancelKey: string; readonly input: CalendarIntegrationObservationInput; readonly at: string;
  readonly maxLatenessMs: number; readonly initiatedBy: string; readonly policy: CalendarIntegrationPolicySpec;
  readonly registration: JobSourceRegistration | null; readonly eligibility: 'current' | 'superseded' | 'retired' | 'expired';
  readonly state: 'pending' | 'unknown' | 'blocked' | 'accepted' | 'cancelled' | 'suppressed';
  readonly jobsReceipt: JobSourceScheduleReceipt | null; readonly createAttempted: boolean;
}
export interface CalendarIntegrationClaim { readonly id: string; readonly nonce: string; readonly claimGeneration: number; readonly previouslyAttempted: boolean; readonly intent: CalendarIntegrationIntentView }
export interface CalendarIntegrationEffectView { readonly id: string; readonly intentId: string; readonly executionId: string; readonly nonce: string; readonly admittedAt: number; readonly outcome: 'observed' | null }
export interface CalendarIntegrationOwner { readonly scopeId: string; readonly expectedOwnerId: string }
export interface IntegrationPolicyRow extends Row { id: string; scope_id: string; rule_id: string; epoch: number; request_id: string; digest: string; policy_json: string; source_id: string; source_policy_hash: string; created_ms: number }
export interface IntegrationCurrentRow extends Row { id: string; scope_id: string; rule_id: string; policy_id: string; epoch: number; state: CalendarIntegrationPolicyView['state']; registration_json: string | null }
export interface IntegrationIntentRow extends Row { id: string; scope_id: string; owner_id: string; policy_id: string; rule_id: string; policy_epoch: number; source_effect_id: string;
  appointment_id: string; appointment_revision: number; create_key: string; cancel_key: string; input_json: string; due_ms: number; expires_ms: number; initiated_by: string }
export interface IntegrationDispatchRow extends Row { id: string; scope_id: string; rule_id: string; policy_epoch: number; appointment_id: string; appointment_revision: number; eligibility: CalendarIntegrationIntentView['eligibility']; state: CalendarIntegrationIntentView['state'];
  claim_nonce: string | null; claim_generation: number; claim_until_ms: number | null; claim_previous_attempted: number; create_attempted: number; next_attempt_ms: number; blocked_code: CalendarIntegrationCode | null }
export interface IntegrationReceiptRow extends Row { id: string; scope_id: string; intent_id: string; phase: 'create' | 'cancel'; command_key: string; receipt_json: string }
export interface IntegrationAdmissionRow extends Row { id: string; scope_id: string; intent_id: string; execution_id: string; nonce: string; admitted_ms: number; registration_json: string }
export function integrationTime(input: unknown = calendarNow()): number { return calendarInteger(input, 0, 8_640_000_000_000_000); }
export function integrationOwner(input: Record<string, unknown>): CalendarIntegrationOwner { return { scopeId: calendarScope(input.scopeId), expectedOwnerId: calendarKey(input.expectedOwnerId) }; }
export function assertIntegrationOwner(context: DatabaseWriteCommandContext, owner: CalendarIntegrationOwner): void {
  const row = context.db.get('_calendar_owner', 'application');
  if (!row || row.scope_id !== owner.scopeId || row.owner_id !== owner.expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID');
}
export function integrationPolicy(input: unknown): CalendarIntegrationPolicySpec {
  const r = calendarRecord(input, ['ruleId', 'ruleVersion', 'adapter', 'source', 'dueOffsetMs', 'maxLatenessMs']);
  if (r.adapter !== 'observation-v1') throw new CalendarError('CALENDAR_INPUT_INVALID');
  let source: JobSourceContract;
  try { source = normalizeJobSourceContract(r.source); } catch { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
  return { ruleId: calendarKey(r.ruleId, 64), ruleVersion: calendarKey(r.ruleVersion, 64), adapter: 'observation-v1', source,
    dueOffsetMs: calendarInteger(r.dueOffsetMs, -CALENDAR_INTEGRATION_LIMITS.horizonMs, CALENDAR_INTEGRATION_LIMITS.horizonMs),
    maxLatenessMs: calendarInteger(r.maxLatenessMs, 0, CALENDAR_INTEGRATION_LIMITS.horizonMs) };
}
export function integrationRegistration(input: unknown, policy: CalendarIntegrationPolicySpec): JobSourceRegistration {
  const r = calendarRecord(input, ['id', 'generation', 'revision', 'state', 'policyHash']);
  if (r.id !== jobSourceId(policy.source.identity) || r.policyHash !== calendarHash(policy.source) || !['active', 'retired'].includes(r.state as string)) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { id: String(r.id), generation: calendarInteger(r.generation, 1), revision: calendarInteger(r.revision, 1), state: r.state as JobSourceRegistration['state'], policyHash: String(r.policyHash) };
}
export function integrationScheduleReceipt(input: unknown, intent: IntegrationIntentRow, policy: CalendarIntegrationPolicySpec): JobSourceScheduleReceipt {
  const r = calendarRecord(input, ['id', 'sourceId', 'policyGeneration', 'control', 'revision', 'generation', 'createdAt', 'updatedAt']);
  if (r.id !== jobSourceScheduleId(policy.source.identity, intent.create_key) || r.sourceId !== jobSourceId(policy.source.identity)
    || !['active', 'paused', 'cancelled'].includes(r.control as string)) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { id: String(r.id), sourceId: String(r.sourceId), policyGeneration: calendarInteger(r.policyGeneration, 1), control: r.control as JobSourceScheduleReceipt['control'],
    revision: calendarInteger(r.revision, 1), generation: calendarInteger(r.generation, 1), createdAt: integrationTime(r.createdAt), updatedAt: integrationTime(r.updatedAt) };
}
export function integrationBudget(context: DatabaseWriteCommandContext, key: 'integrationPolicies' | 'integrationIntents', limit: number): void {
  const row = context.db.get('_calendar_usage', key), count = row ? calendarInteger(row.count) : 0;
  if (count >= limit) throw new CalendarError('CALENDAR_CAPACITY');
  if (row) context.db.update('_calendar_usage', key, { count: count + 1 }); else context.db.createStrict('_calendar_usage', { id: key, count: 1 });
}
export function integrationPolicyView(history: IntegrationPolicyRow, current: IntegrationCurrentRow | null, historicalRegistration: string | null = null): CalendarIntegrationPolicyView {
  const policy = integrationPolicy(JSON.parse(history.policy_json));
  if (history.digest !== calendarHash(policy) || policy.ruleId !== history.rule_id) throw new CalendarError('CALENDAR_STATE_INVALID');
  const selected = current?.policy_id === history.id ? current : null;
  return { id: history.id, ruleId: history.rule_id, epoch: history.epoch, state: selected?.state ?? 'retired', policy,
    registration: historicalRegistration ? integrationRegistration(JSON.parse(historicalRegistration), policy)
      : selected?.registration_json ? integrationRegistration(JSON.parse(selected.registration_json), policy) : null };
}
export function integrationIntentView(intent: IntegrationIntentRow, dispatch: IntegrationDispatchRow, history: IntegrationPolicyRow,
  current: IntegrationCurrentRow | null, receipt: IntegrationReceiptRow | null, now = calendarNow(), historicalRegistration: string | null = null): CalendarIntegrationIntentView {
  const selected = integrationPolicyView(history, current, historicalRegistration);
  return { id: intent.id, ruleId: intent.rule_id, policyEpoch: intent.policy_epoch, appointmentId: intent.appointment_id, appointmentRevision: intent.appointment_revision,
    createKey: intent.create_key, cancelKey: intent.cancel_key, input: JSON.parse(intent.input_json), at: new Date(intent.due_ms).toISOString(),
    maxLatenessMs: intent.expires_ms - intent.due_ms, initiatedBy: intent.initiated_by, policy: selected.policy, registration: selected.registration,
    eligibility: dispatch.eligibility !== 'current' ? dispatch.eligibility : selected.state === 'retired' ? 'retired' : now > intent.expires_ms ? 'expired' : 'current',
    state: dispatch.state, jobsReceipt: receipt ? integrationScheduleReceipt(JSON.parse(receipt.receipt_json), intent, selected.policy) : null, createAttempted: dispatch.create_attempted === 1 };
}
export function integrationContext(context: DatabaseWriteCommandContext, scopeId: string, idInput: unknown) {
  const id = calendarKey(idInput), intent = context.db.get('_calendar_integration_intents', id) as IntegrationIntentRow | null;
  const dispatch = context.db.get('_calendar_integration_dispatch', id) as IntegrationDispatchRow | null;
  if (!intent || intent.scope_id !== scopeId || !dispatch || dispatch.scope_id !== scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const history = context.db.get('_calendar_integration_policy_history', intent.policy_id) as IntegrationPolicyRow | null;
  if (!history || history.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const current = context.db.get('_calendar_integration_policy_current', intent.rule_id) as IntegrationCurrentRow | null;
  const receipt = context.db.get('_calendar_integration_receipts', calendarHash([id, 'create'])) as IntegrationReceiptRow | null;
  return { intent, dispatch, history, current, receipt, view: (now = calendarNow()) => integrationIntentView(intent, context.db.get('_calendar_integration_dispatch', id) as IntegrationDispatchRow, history,
    context.db.get('_calendar_integration_policy_current', intent.rule_id) as IntegrationCurrentRow | null, context.db.get('_calendar_integration_receipts', calendarHash([id, 'create'])) as IntegrationReceiptRow | null,
    now, context.db.get('_calendar_integration_policy_registrations', history.id)?.registration_json as string | null ?? null) };
}
export function assertIntegrationClaim(dispatch: IntegrationDispatchRow, nonce: unknown, generation: unknown): void {
  if (dispatch.claim_nonce !== calendarKey(nonce) || dispatch.claim_generation !== calendarInteger(generation, 1)) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
}
export function integrationInputRecord(input: unknown, fields: readonly string[]): Record<string, unknown> {
  return calendarRecord(input, ['scopeId', 'expectedOwnerId', 'requestId', ...fields]);
}

/** Called only after the ordinary receipt/effect seal, within the same canonical writer transaction. */
export function recordCalendarIntegrationMutation(context: DatabaseWriteCommandContext, actor: CalendarActor, result: CalendarCommandReceipt, sourceEffectId: string): void {
  if (!result.changed || !result.operation.startsWith('appointment.')) return;
  const policies = context.db.find('_calendar_integration_policy_current', { filters: [{ type: 'field', field: 'scope_id', operator: 'eq', value: actor.scopeId }], limit: CALENDAR_INTEGRATION_LIMITS.rules + 1 }) as IntegrationCurrentRow[];
  // No installed policy means no integration. A missing 010 table is not silently treated as disabled.
  if (!policies.length) return;
  if (policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
  const prior = context.db.find('_calendar_integration_dispatch', { filters: [
    { type: 'field', field: 'scope_id', operator: 'eq', value: actor.scopeId }, { type: 'field', field: 'appointment_id', operator: 'eq', value: result.id },
    { type: 'field', field: 'eligibility', operator: 'eq', value: 'current' }], limit: CALENDAR_INTEGRATION_LIMITS.rules + 1 });
  if (prior.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const row of prior) context.db.update('_calendar_integration_dispatch', String(row.id), { eligibility: 'superseded', next_attempt_ms: 0 });
  const appointment = context.db.get('calendar_appointments', result.id) as CalendarAppointmentRow | null;
  if (!appointment || appointment.scope_id !== actor.scopeId || appointment.revision !== result.revision) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (isCalendarLifecycleTerminal(effectiveCalendarAppointmentStatus(context, appointment))) return;
  const ownerId = context.db.get('_calendar_owner', 'application')?.owner_id;
  if (typeof ownerId !== 'string') throw new CalendarError('CALENDAR_STATE_INVALID');
  const nextAttempt = integrationTime(calendarNow());
  for (const current of policies) {
    if (current.state === 'retired') continue;
    const history = context.db.get('_calendar_integration_policy_history', current.policy_id) as IntegrationPolicyRow | null;
    if (!history) throw new CalendarError('CALENDAR_STATE_INVALID');
    const { policy } = integrationPolicyView(history, current);
    const id = calendarHash(['calendar-integration-v1', actor.scopeId, ownerId, current.rule_id, current.epoch, sourceEffectId, result.revision]);
    const due = calendarInteger(appointment.start_ms + policy.dueOffsetMs, 0, CALENDAR_INTEGRATION_MAX_DUE_MS), expires = integrationTime(due + policy.maxLatenessMs);
    const input: CalendarIntegrationObservationInput = { kind: 'calendar-observation-v1', intentId: id, appointmentRevision: result.revision, policyEpoch: current.epoch };
    integrationBudget(context, 'integrationIntents', CALENDAR_INTEGRATION_LIMITS.intents);
    context.db.createStrict('_calendar_integration_intents', { id, scope_id: actor.scopeId, owner_id: ownerId, policy_id: history.id, rule_id: current.rule_id,
      policy_epoch: current.epoch, source_effect_id: sourceEffectId, appointment_id: result.id, appointment_revision: result.revision,
      create_key: 'cal-create:' + id, cancel_key: 'cal-cancel:' + id, input_json: calendarJson(input), due_ms: due, expires_ms: expires, initiated_by: actor.userId });
    context.db.createStrict('_calendar_integration_dispatch', { id, scope_id: actor.scopeId, rule_id: current.rule_id, policy_epoch: current.epoch, appointment_id: result.id, appointment_revision: result.revision,
      eligibility: 'current', state: 'pending', claim_nonce: null, claim_generation: 0, claim_until_ms: null, claim_previous_attempted: 0,
      create_attempted: 0, next_attempt_ms: nextAttempt, blocked_code: null });
  }
}
