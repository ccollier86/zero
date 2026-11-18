/** Short tracked source commands only. No Jobs/Torrent/provider call may run in a calendar transaction. */
import type { DatabaseFindFilter } from '../databases/database-operations';
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { jobSourceId } from '../jobs/source-model';
import { CalendarError, calendarCommand } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey } from './validation';
import { calendarNow } from './hold-time';
import { effectiveCalendarAppointmentStatus, isCalendarLifecycleTerminal } from './lifecycle-model';
import type { CalendarAppointmentRow } from './realm-model';
import { assertIntegrationClaim, assertIntegrationOwner, CALENDAR_INTEGRATION_CODES, CALENDAR_INTEGRATION_LIMITS, integrationBudget,
  integrationContext, integrationInputRecord, integrationOwner, integrationPolicy, integrationPolicyView, integrationRegistration, integrationScheduleReceipt, integrationTime,
  type CalendarIntegrationClaim, type CalendarIntegrationEffectView, type IntegrationAdmissionRow, type IntegrationCurrentRow, type IntegrationDispatchRow,
  type IntegrationPolicyRow } from './integration-model';

const eq = (field: string, value: string | number | null): DatabaseFindFilter => ({ type: 'field', field, operator: 'eq', value });
const next = (n: number) => calendarInteger(n, 0, Number.MAX_SAFE_INTEGER - 1) + 1;
const clearClaim = { claim_nonce: null, claim_until_ms: null };
function owned(context: DatabaseWriteCommandContext, input: unknown, fields: readonly string[]) {
  const r = integrationInputRecord(input, fields), owner = integrationOwner(r); assertIntegrationOwner(context, owner); return { r, owner };
}
function currentPolicy(context: DatabaseWriteCommandContext, scopeId: string, ruleInput: unknown, epochInput: unknown) {
  const ruleId = calendarKey(ruleInput, 64), epoch = calendarInteger(epochInput, 1);
  const current = context.db.get('_calendar_integration_policy_current', ruleId) as IntegrationCurrentRow | null;
  if (!current || current.scope_id !== scopeId || current.epoch !== epoch) throw new CalendarError('CALENDAR_POLICY_STALE');
  const history = context.db.get('_calendar_integration_policy_history', current.policy_id) as IntegrationPolicyRow | null;
  if (!history || history.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { current, history, view: () => integrationPolicyView(history, context.db.get('_calendar_integration_policy_current', ruleId) as IntegrationCurrentRow,
    context.db.get('_calendar_integration_policy_registrations', history.id)?.registration_json as string | null ?? null) };
}
export function installCalendarIntegrationPolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['policy', 'expectedEpoch', 'now']);
    const policy = integrationPolicy(r.policy), expectedEpoch = calendarInteger(r.expectedEpoch), requestId = calendarKey(r.requestId), now = integrationTime(r.now);
    const identity = policy.source.identity;
    if (identity.ownerId !== owner.expectedOwnerId || identity.scopeId !== owner.scopeId || identity.databaseId !== 'calendar:' + calendarHash(owner.scopeId)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const previous = context.db.find('_calendar_integration_policy_history', { filters: [eq('scope_id', owner.scopeId), eq('request_id', requestId)], limit: 1 })[0] as IntegrationPolicyRow | undefined;
    const digest = calendarHash(policy), sourceId = jobSourceId(identity);
    const binding = context.db.get('_calendar_integration_rule_sources', policy.ruleId);
    const occupied = context.db.find('_calendar_integration_rule_sources', { filters: [eq('scope_id', owner.scopeId), eq('source_id', sourceId)], limit: 1 })[0];
    if (binding && (binding.scope_id !== owner.scopeId || binding.source_id !== sourceId) || occupied && occupied.rule_id !== policy.ruleId) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    if (previous) {
      if (previous.digest !== digest || previous.epoch !== expectedEpoch + 1) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      if (!binding) throw new CalendarError('CALENDAR_STATE_INVALID');
      return integrationPolicyView(previous, context.db.get('_calendar_integration_policy_current', policy.ruleId) as IntegrationCurrentRow | null,
        context.db.get('_calendar_integration_policy_registrations', previous.id)?.registration_json as string | null ?? null);
    }
    const prior = context.db.get('_calendar_integration_policy_current', policy.ruleId) as IntegrationCurrentRow | null;
    if ((prior?.epoch ?? 0) !== expectedEpoch) throw new CalendarError('CALENDAR_POLICY_STALE');
    if (!prior && context.db.find('_calendar_integration_policy_current', { filters: [eq('scope_id', owner.scopeId)], limit: CALENDAR_INTEGRATION_LIMITS.rules }).length >= CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_CAPACITY');
    integrationBudget(context, 'integrationPolicies', CALENDAR_INTEGRATION_LIMITS.policies);
    if (!binding) context.db.createStrict('_calendar_integration_rule_sources', { id: policy.ruleId, scope_id: owner.scopeId, rule_id: policy.ruleId, source_id: sourceId });
    const epoch = next(expectedEpoch), id = calendarHash([owner.scopeId, policy.ruleId, epoch]);
    const history: IntegrationPolicyRow = { id, scope_id: owner.scopeId, rule_id: policy.ruleId, epoch, request_id: requestId, digest, policy_json: calendarJson(policy),
      source_id: sourceId, source_policy_hash: calendarHash(policy.source), created_ms: now };
    context.db.createStrict('_calendar_integration_policy_history', history);
    const pointer = { id: policy.ruleId, scope_id: owner.scopeId, rule_id: policy.ruleId, policy_id: id, epoch, state: 'activating', registration_json: null };
    if (prior) context.db.update('_calendar_integration_policy_current', policy.ruleId, pointer); else context.db.createStrict('_calendar_integration_policy_current', pointer);
    return integrationPolicyView(history, pointer as IntegrationCurrentRow);
  });
}
export function activateCalendarIntegrationPolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['ruleId', 'epoch', 'registration']);
    const selected = currentPolicy(context, owner.scopeId, r.ruleId, r.epoch), policy = integrationPolicy(JSON.parse(selected.history.policy_json));
    const registration = integrationRegistration(r.registration, policy), json = calendarJson(registration);
    if (registration.state !== 'active' || selected.current.state === 'retired') throw new CalendarError('CALENDAR_POLICY_STALE');
    const prior = context.db.get('_calendar_integration_policy_registrations', selected.history.id);
    if (prior && prior.registration_json !== json) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    if (!prior) context.db.createStrict('_calendar_integration_policy_registrations', { id: selected.history.id, scope_id: owner.scopeId, policy_id: selected.history.id, registration_json: json });
    if (selected.current.state !== 'active') context.db.update('_calendar_integration_policy_current', selected.current.id, { state: 'active', registration_json: json });
    return selected.view();
  });
}
export function retireCalendarIntegrationPolicy(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['ruleId', 'epoch', 'now']);
    const selected = currentPolicy(context, owner.scopeId, r.ruleId, r.epoch);
    if (selected.current.state !== 'retired') context.db.update('_calendar_integration_policy_current', selected.current.id, { state: 'retired' });
    return selected.view();
  });
}

/** Two bounded index probes: ready work and expired physical claims. Never page retained intent history. */
export function claimCalendarIntegrations(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['now', 'nonce', 'leaseMs', 'limit']);
    const now = integrationTime(r.now), nonce = calendarKey(r.nonce), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_INTEGRATION_LIMITS.page);
    const until = integrationTime(now + calendarInteger(r.leaseMs, 1, CALENDAR_INTEGRATION_LIMITS.leaseMs));
    // Equality-partition before LIMIT: terminal history never consumes scan work,
    // and each state probe follows exactly one ready index partition.
    const ready = ['pending', 'unknown', 'blocked', 'accepted'].flatMap(state => context.db.find('_calendar_integration_dispatch', { filters: [
      eq('scope_id', owner.scopeId), eq('claim_nonce', null), eq('state', state), { type: 'field', field: 'next_attempt_ms', operator: 'lte', value: now }],
      order: [{ field: 'next_attempt_ms', direction: 'asc' }, { field: 'id', direction: 'asc' }], limit }) as IntegrationDispatchRow[])
      .sort((a, b) => a.next_attempt_ms - b.next_attempt_ms || a.id.localeCompare(b.id));
    const expired = context.db.find('_calendar_integration_dispatch', { filters: [eq('scope_id', owner.scopeId), { type: 'field', field: 'claim_nonce', operator: 'ne', value: null },
      { type: 'field', field: 'claim_until_ms', operator: 'lte', value: now }], order: [{ field: 'claim_until_ms', direction: 'asc' }, { field: 'id', direction: 'asc' }], limit }) as IntegrationDispatchRow[];
    const retired: IntegrationDispatchRow[] = [];
    const policies = context.db.find('_calendar_integration_policy_current', { filters: [eq('scope_id', owner.scopeId)], limit: CALENDAR_INTEGRATION_LIMITS.rules + 1 }) as IntegrationCurrentRow[];
    if (policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
    for (const policy of policies) retired.push(...context.db.find('_calendar_integration_dispatch', { filters: [eq('scope_id', owner.scopeId), eq('rule_id', policy.rule_id),
      eq('state', 'accepted'), eq('claim_nonce', null), eq('blocked_code', null), { type: 'field', field: 'policy_epoch', operator: policy.state === 'retired' ? 'lte' : 'lt', value: policy.epoch }],
      order: [{ field: 'policy_epoch', direction: 'asc' }, { field: 'next_attempt_ms', direction: 'asc' }, { field: 'id', direction: 'asc' }], limit }) as IntegrationDispatchRow[]);
    const selected = [...new Map([...expired, ...retired, ...ready].map(row => [row.id, row])).values()].slice(0, limit), claimed: CalendarIntegrationClaim[] = [];
    for (const dispatch of selected) {
      const stored = integrationContext(context, owner.scopeId, dispatch.id), view = stored.view(now), generation = next(dispatch.claim_generation);
      context.db.update('_calendar_integration_dispatch', dispatch.id, { eligibility: view.eligibility, claim_nonce: nonce, claim_generation: generation, claim_until_ms: until,
        claim_previous_attempted: dispatch.create_attempted, create_attempted: 1 });
      claimed.push({ id: dispatch.id, nonce, claimGeneration: generation, previouslyAttempted: dispatch.create_attempted === 1, intent: stored.view(now) });
    }
    return claimed;
  });
}
export function acknowledgeCalendarIntegration(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'nonce', 'claimGeneration', 'phase', 'receipt']);
    const stored = integrationContext(context, owner.scopeId, r.id); assertIntegrationClaim(stored.dispatch, r.nonce, r.claimGeneration);
    const view = stored.view(), receipt = integrationScheduleReceipt(r.receipt, stored.intent, view.policy);
    if (!view.registration || receipt.policyGeneration !== view.registration.generation || (r.phase !== 'create' && r.phase !== 'cancel')
      || r.phase === 'create' && (receipt.control !== 'active' || receipt.revision !== 1 || receipt.generation !== 1)
      || r.phase === 'cancel' && receipt.control !== 'cancelled') throw new CalendarError('CALENDAR_STATE_INVALID');
    if (r.phase === 'cancel' && !stored.receipt) throw new CalendarError('CALENDAR_STATE_INVALID');
    const id = calendarHash([stored.intent.id, r.phase]), json = calendarJson(receipt), previous = context.db.get('_calendar_integration_receipts', id);
    if (previous && previous.receipt_json !== json) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    if (!previous) context.db.createStrict('_calendar_integration_receipts', { id, scope_id: owner.scopeId, intent_id: stored.intent.id, phase: r.phase,
      command_key: r.phase === 'create' ? stored.intent.create_key : stored.intent.cancel_key, receipt_json: json });
    context.db.update('_calendar_integration_dispatch', stored.intent.id, { ...clearClaim, state: r.phase === 'cancel' ? 'cancelled' : 'accepted', blocked_code: null,
      // This is an exclusive integer wake marker, not a newly authored due instant.
      next_attempt_ms: r.phase === 'cancel' || view.eligibility !== 'current' ? 0 : calendarInteger(stored.intent.expires_ms + 1) });
    return stored.view();
  });
}
export function deferCalendarIntegration(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'nonce', 'claimGeneration', 'now', 'code', 'retryAt', 'unknown', 'notCommitted']);
    const stored = integrationContext(context, owner.scopeId, r.id); assertIntegrationClaim(stored.dispatch, r.nonce, r.claimGeneration);
    const now = integrationTime(r.now), retryAt = integrationTime(r.retryAt);
    if (retryAt <= now || retryAt > now + CALENDAR_INTEGRATION_LIMITS.horizonMs || !CALENDAR_INTEGRATION_CODES.includes(r.code as never)
      || r.unknown !== undefined && typeof r.unknown !== 'boolean' || r.notCommitted !== undefined && typeof r.notCommitted !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
    if (r.notCommitted === true && (r.unknown === true || r.code === 'JOBS_OUTCOME_UNKNOWN' || stored.receipt || stored.dispatch.claim_previous_attempted !== 0)) throw new CalendarError('CALENDAR_STATE_INVALID');
    context.db.update('_calendar_integration_dispatch', stored.intent.id, { ...clearClaim, state: stored.receipt ? 'accepted' : r.unknown ? 'unknown' : r.code === 'JOBS_CAPACITY' ? 'blocked' : 'pending',
      ...(r.notCommitted === true ? { create_attempted: 0 } : {}), next_attempt_ms: retryAt, blocked_code: String(r.code) });
    return stored.view();
  });
}
export function suppressCalendarIntegration(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'nonce', 'claimGeneration']);
    const stored = integrationContext(context, owner.scopeId, r.id); assertIntegrationClaim(stored.dispatch, r.nonce, r.claimGeneration);
    if (stored.receipt || stored.dispatch.claim_previous_attempted !== 0 || stored.view().eligibility === 'current') throw new CalendarError('CALENDAR_STATE_INVALID');
    context.db.update('_calendar_integration_dispatch', stored.intent.id, { ...clearClaim, state: 'suppressed', blocked_code: null }); return stored.view();
  });
}
function effectView(context: DatabaseWriteCommandContext, row: IntegrationAdmissionRow): CalendarIntegrationEffectView {
  return { id: row.id, intentId: row.intent_id, executionId: row.execution_id, nonce: row.nonce, admittedAt: row.admitted_ms,
    outcome: context.db.get('_calendar_integration_effect_outcomes', row.id) ? 'observed' : null };
}
/** Unique source-local admission is the cutoff. A historical replay never grants execution permission. */
export function admitCalendarIntegrationEffect(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'executionId', 'nonce', 'registration', 'workflow']);
    const stored = integrationContext(context, owner.scopeId, r.id), executionId = calendarKey(r.executionId), nonce = calendarKey(r.nonce);
    const prior = context.db.get('_calendar_integration_effect_admissions', stored.intent.id) as IntegrationAdmissionRow | null;
    if (prior) return { admitted: false, effect: effectView(context, prior) };
    const now = calendarNow(), view = stored.view(now);
    const appointment = context.db.get('calendar_appointments', stored.intent.appointment_id) as CalendarAppointmentRow | null;
    if (view.eligibility !== 'current' || stored.current?.state !== 'active' || stored.current.epoch !== stored.intent.policy_epoch || !view.registration
      || now < stored.intent.due_ms || now > stored.intent.expires_ms
      || !appointment || appointment.scope_id !== owner.scopeId || appointment.revision !== stored.intent.appointment_revision
      || isCalendarLifecycleTerminal(effectiveCalendarAppointmentStatus(context, appointment))
      || calendarJson(integrationRegistration(r.registration, view.policy)) !== calendarJson(view.registration)
      || calendarJson(r.workflow) !== calendarJson(view.policy.source.workflow)) throw new CalendarError('CALENDAR_POLICY_STALE');
    // Sample again at the actual source-local cutoff, not from a host snapshot
    // captured before a pool/actor/authority wait. No await follows in this writer.
    const admittedAt = calendarNow();
    if (admittedAt < stored.intent.due_ms || admittedAt > stored.intent.expires_ms) throw new CalendarError('CALENDAR_POLICY_STALE');
    const row: IntegrationAdmissionRow = { id: stored.intent.id, scope_id: owner.scopeId, intent_id: stored.intent.id, execution_id: executionId, nonce,
      admitted_ms: admittedAt, registration_json: calendarJson(view.registration) };
    context.db.createStrict('_calendar_integration_effect_admissions', row); return { admitted: true, effect: effectView(context, row) };
  });
}
/** Factual observation settlement remains writable after retirement; it is not new publication authority. */
export function settleCalendarIntegrationEffect(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'executionId', 'nonce', 'outcome', 'now']);
    const id = calendarKey(r.id), row = context.db.get('_calendar_integration_effect_admissions', id) as IntegrationAdmissionRow | null;
    if (!row || row.scope_id !== owner.scopeId || row.execution_id !== calendarKey(r.executionId) || row.nonce !== calendarKey(r.nonce) || r.outcome !== 'observed') throw new CalendarError('CALENDAR_STATE_INVALID');
    if (!context.db.get('_calendar_integration_effect_outcomes', id)) context.db.createStrict('_calendar_integration_effect_outcomes', { id, scope_id: owner.scopeId, admission_id: id, outcome: 'observed', settled_ms: integrationTime(r.now) });
    return effectView(context, row);
  });
}
