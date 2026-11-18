/** Private durable registration journal. No Jobs call or raw-null absence inference runs in this source writer. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import type { JobSourceRegistration } from '../jobs/source-model';
import { CalendarError, calendarCommand } from './error';
import { calendarNow } from './hold-time';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord } from './validation';
import { assertIntegrationOwner, CALENDAR_INTEGRATION_CODES, CALENDAR_INTEGRATION_LIMITS, integrationInputRecord, integrationOwner,
  integrationPolicy, integrationRegistration, integrationTime, type CalendarIntegrationCode, type CalendarIntegrationOwner,
  type CalendarIntegrationPolicySpec, type IntegrationCurrentRow, type IntegrationPolicyRow } from './integration-model';

export type CalendarIntegrationControlAction = 'activate' | 'retire';
export type CalendarIntegrationControlResult = { readonly state: 'accepted'; readonly registration: JobSourceRegistration } | { readonly state: 'absent' };
export interface CalendarIntegrationControlView {
  readonly id: string; readonly ruleId: string; readonly epoch: number; readonly action: CalendarIntegrationControlAction;
  readonly jobsKey: string; readonly expectedJobsRevision: number; readonly expectedRegistration: JobSourceRegistration | null;
  readonly policy: CalendarIntegrationPolicySpec; readonly result: CalendarIntegrationControlResult | null;
  readonly lastFailure: CalendarIntegrationCode | null; readonly nextAttemptMs: number;
}
export interface CalendarIntegrationControlEvidence { readonly registered: boolean; readonly pending: CalendarIntegrationControlView | null }
interface ControlRow extends Row { id: string; scope_id: string; owner_id: string; policy_id: string; rule_id: string; epoch: number; action: CalendarIntegrationControlAction;
  jobs_key: string; expected_jobs_revision: number; expected_registration_json: string | null; created_ms: number }
interface ResultRow extends Row { id: string; scope_id: string; control_id: string; state: 'accepted' | 'absent'; registration_json: string | null; settled_ms: number }
interface AttemptRow extends Row { id: string; scope_id: string; rule_id: string; result_id: string | null; last_failure: CalendarIntegrationCode | null; next_attempt_ms: number }

function actionValue(input: unknown): CalendarIntegrationControlAction {
  if (input !== 'activate' && input !== 'retire') throw new CalendarError('CALENDAR_INPUT_INVALID'); return input;
}
export function calendarIntegrationControlId(scopeId: string, ownerId: string, ruleId: string, epoch: number, action: CalendarIntegrationControlAction): string {
  return calendarHash(['calendar-integration-control-v1', scopeId, calendarKey(ownerId), calendarKey(ruleId, 64), calendarInteger(epoch, 1), actionValue(action)]);
}
export function calendarIntegrationControlJobsKey(id: string, action: CalendarIntegrationControlAction): string {
  return 'calendar-control:' + actionValue(action) + ':' + calendarKey(id, 64);
}
function expectedRegistration(input: unknown, sourceId: string): JobSourceRegistration | null {
  if (input === null) return null;
  const r = calendarRecord(input, ['id', 'generation', 'revision', 'state', 'policyHash']);
  if (r.id !== sourceId || (r.state !== 'active' && r.state !== 'retired') || typeof r.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.policyHash)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { id: sourceId, generation: calendarInteger(r.generation, 1), revision: calendarInteger(r.revision, 1),
    state: r.state, policyHash: r.policyHash };
}
function controlPolicy(history: IntegrationPolicyRow): CalendarIntegrationPolicySpec {
  const policy = integrationPolicy(JSON.parse(history.policy_json));
  if (calendarHash(policy) !== history.digest || policy.ruleId !== history.rule_id) throw new CalendarError('CALENDAR_STATE_INVALID'); return policy;
}
function resultValue(row: ResultRow | null, policy: CalendarIntegrationPolicySpec, control: ControlRow, sourceId: string): CalendarIntegrationControlResult | null {
  return !row ? null : row.state === 'absent' ? { state: 'absent' } : { state: 'accepted', registration: control.action === 'activate'
    ? integrationRegistration(JSON.parse(row.registration_json!), policy) : expectedRegistration(JSON.parse(row.registration_json!), sourceId)! };
}
function view(row: ControlRow, history: IntegrationPolicyRow, attempt: AttemptRow, result: ResultRow | null): CalendarIntegrationControlView {
  if (history.scope_id !== row.scope_id || history.id !== row.policy_id || history.rule_id !== row.rule_id || history.epoch !== row.epoch
    || attempt.scope_id !== row.scope_id || attempt.id !== row.id || attempt.result_id !== (result?.id ?? null)) throw new CalendarError('CALENDAR_STATE_INVALID');
  const policy = controlPolicy(history);
  return { id: row.id, ruleId: row.rule_id, epoch: row.epoch, action: row.action, jobsKey: row.jobs_key, expectedJobsRevision: row.expected_jobs_revision,
    expectedRegistration: row.expected_registration_json ? expectedRegistration(JSON.parse(row.expected_registration_json), history.source_id) : null,
    policy, result: resultValue(result, policy, row, history.source_id), lastFailure: attempt.last_failure, nextAttemptMs: attempt.next_attempt_ms };
}
function writeControl(context: DatabaseWriteCommandContext, owner: CalendarIntegrationOwner, idInput: unknown) {
  const id = calendarKey(idInput, 64), row = context.db.get('_calendar_integration_controls', id) as ControlRow | null;
  if (!row || row.scope_id !== owner.scopeId || row.owner_id !== owner.expectedOwnerId) throw new CalendarError('CALENDAR_NOT_FOUND');
  const history = context.db.get('_calendar_integration_policy_history', row.policy_id) as IntegrationPolicyRow | null;
  const attempt = context.db.get('_calendar_integration_control_attempts', id) as AttemptRow | null;
  if (!history || !attempt) throw new CalendarError('CALENDAR_STATE_INVALID');
  const current = context.db.get('_calendar_integration_policy_current', row.rule_id) as IntegrationCurrentRow | null;
  return { row, history, attempt, current, view: () => view(row, history, context.db.get('_calendar_integration_control_attempts', id) as AttemptRow,
    context.db.get('_calendar_integration_control_results', id) as ResultRow | null) };
}
function owned(context: DatabaseWriteCommandContext, input: unknown, fields: readonly string[]) {
  const r = integrationInputRecord(input, fields), owner = integrationOwner(r); assertIntegrationOwner(context, owner); return { r, owner };
}

/** The immutable intent must commit before the native controller enters a Jobs registration writer. */
export function prepareCalendarIntegrationControl(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['ruleId', 'epoch', 'action', 'expectedRegistration']);
    const ruleId = calendarKey(r.ruleId, 64), epoch = calendarInteger(r.epoch, 1), action = actionValue(r.action);
    const policyId = calendarHash([owner.scopeId, ruleId, epoch]), history = context.db.get('_calendar_integration_policy_history', policyId) as IntegrationPolicyRow | null;
    if (!history || history.scope_id !== owner.scopeId) throw new CalendarError('CALENDAR_NOT_FOUND');
    controlPolicy(history);
    const expected = expectedRegistration(r.expectedRegistration, history.source_id), expectedJson = expected ? calendarJson(expected) : null;
    if (action === 'retire' && !expected) throw new CalendarError('CALENDAR_POLICY_STALE');
    const id = calendarIntegrationControlId(owner.scopeId, owner.expectedOwnerId, ruleId, epoch, action), prior = context.db.get('_calendar_integration_controls', id) as ControlRow | null;
    if (prior) {
      if (prior.expected_registration_json !== expectedJson || prior.expected_jobs_revision !== (expected?.revision ?? 0)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      return writeControl(context, owner, id).view();
    }
    const current = context.db.get('_calendar_integration_policy_current', ruleId) as IntegrationCurrentRow | null;
    if (!current || current.scope_id !== owner.scopeId || current.policy_id !== policyId || current.epoch !== epoch
      || (action === 'retire' ? current.state !== 'retired' : current.state !== 'activating' && current.state !== 'active')) throw new CalendarError('CALENDAR_POLICY_STALE');
    const now = integrationTime(calendarNow()), row: ControlRow = { id, scope_id: owner.scopeId, owner_id: owner.expectedOwnerId, policy_id: policyId, rule_id: ruleId, epoch, action,
      jobs_key: calendarIntegrationControlJobsKey(id, action), expected_jobs_revision: expected?.revision ?? 0, expected_registration_json: expectedJson, created_ms: now };
    context.db.createStrict('_calendar_integration_controls', row);
    context.db.createStrict('_calendar_integration_control_attempts', { id, scope_id: owner.scopeId, rule_id: ruleId, result_id: null, last_failure: null, next_attempt_ms: now });
    return writeControl(context, owner, id).view();
  });
}

/** Acknowledgment records historical truth; only a still-current activating pointer may become active. */
export function acknowledgeCalendarIntegrationControl(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'result']), selected = writeControl(context, owner, r.id);
    const supplied = calendarRecord(r.result, ['state', 'registration']), policy = controlPolicy(selected.history);
    let registration: JobSourceRegistration | null = null;
    if (supplied.state === 'accepted') {
      registration = selected.row.action === 'activate' ? integrationRegistration(supplied.registration, policy)
        : expectedRegistration(supplied.registration, selected.history.source_id);
      const expected = selected.row.expected_registration_json ? expectedRegistration(JSON.parse(selected.row.expected_registration_json), selected.history.source_id) : null;
      const same = selected.row.action === 'activate' ? expected?.state === 'active' && expected.policyHash === selected.history.source_policy_hash : expected?.state === 'retired';
      const revision = expected ? calendarInteger(expected.revision + (same ? 0 : 1), 1) : 1;
      const generation = selected.row.action === 'retire' ? expected?.generation : expected ? calendarInteger(expected.generation + (same ? 0 : 1), 1) : 1;
      if (!registration || registration.state !== (selected.row.action === 'activate' ? 'active' : 'retired') || registration.revision !== revision || registration.generation !== generation
        || selected.row.action === 'retire' && (!expected || registration.policyHash !== expected.policyHash)) throw new CalendarError('CALENDAR_STATE_INVALID');
    } else if (supplied.state === 'absent') {
      if (Object.hasOwn(supplied, 'registration') || selected.row.action !== 'activate' || !selected.current
        || selected.current.policy_id === selected.row.policy_id && selected.current.state !== 'retired') throw new CalendarError('CALENDAR_POLICY_STALE');
      // Only the fixed native controller may invoke this after Jobs' same-gate
      // original-key reconciliation barrier. A raw null receipt is not proof.
    } else throw new CalendarError('CALENDAR_INPUT_INVALID');
    const json = registration ? calendarJson(registration) : null, prior = context.db.get('_calendar_integration_control_results', selected.row.id) as ResultRow | null;
    if (prior) {
      if (prior.state !== supplied.state || prior.registration_json !== json) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      return selected.view();
    }
    if (registration && selected.row.action === 'activate') {
      const previous = context.db.get('_calendar_integration_policy_registrations', selected.row.policy_id);
      if (previous && previous.registration_json !== json) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    }
    context.db.createStrict('_calendar_integration_control_results', { id: selected.row.id, scope_id: owner.scopeId, control_id: selected.row.id,
      state: supplied.state, registration_json: json, settled_ms: integrationTime(calendarNow()) });
    if (registration && selected.row.action === 'activate') {
      if (!context.db.get('_calendar_integration_policy_registrations', selected.row.policy_id)) context.db.createStrict('_calendar_integration_policy_registrations', {
        id: selected.row.policy_id, scope_id: owner.scopeId, policy_id: selected.row.policy_id, registration_json: json });
      if (selected.current?.policy_id === selected.row.policy_id && selected.current.state === 'activating') {
        context.db.update('_calendar_integration_policy_current', selected.row.rule_id, { state: 'active', registration_json: json });
      }
    }
    return selected.view();
  });
}
export function failCalendarIntegrationControl(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const { r, owner } = owned(context, input, ['id', 'code', 'retryAt', 'now']), selected = writeControl(context, owner, r.id);
    if (context.db.get('_calendar_integration_control_results', selected.row.id)) return selected.view();
    const now = integrationTime(r.now), retryAt = integrationTime(r.retryAt);
    if (!CALENDAR_INTEGRATION_CODES.includes(r.code as never) || retryAt <= now || retryAt > now + CALENDAR_INTEGRATION_LIMITS.horizonMs) throw new CalendarError('CALENDAR_INPUT_INVALID');
    context.db.update('_calendar_integration_control_attempts', selected.row.id, { last_failure: String(r.code), next_attempt_ms: Math.max(selected.attempt.next_attempt_ms, retryAt) });
    return selected.view();
  });
}

function readOwned(context: DatabaseReadQueryContext, input: unknown, fields: readonly string[]) {
  const r = integrationInputRecord(input, fields), owner = integrationOwner(r);
  const actual = context.database.query<{ scope_id: string; owner_id: string }>("SELECT scope_id,owner_id FROM _calendar_owner WHERE id='application'").get();
  if (!actual || actual.scope_id !== owner.scopeId || actual.owner_id !== owner.expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID'); return { r, owner };
}
function readControl(context: DatabaseReadQueryContext, owner: CalendarIntegrationOwner, id: string): CalendarIntegrationControlView | null {
  const row = context.database.query<ControlRow>('SELECT * FROM _calendar_integration_controls WHERE id=? AND scope_id=? AND owner_id=?').get(id, owner.scopeId, owner.expectedOwnerId);
  if (!row) return null;
  const history = context.database.query<IntegrationPolicyRow>('SELECT * FROM _calendar_integration_policy_history WHERE id=?').get(row.policy_id);
  const attempt = context.database.query<AttemptRow>('SELECT * FROM _calendar_integration_control_attempts WHERE id=?').get(id);
  const result = context.database.query<ResultRow>('SELECT * FROM _calendar_integration_control_results WHERE id=?').get(id);
  if (!history || !attempt) throw new CalendarError('CALENDAR_STATE_INVALID'); return view(row, history, attempt, result);
}
export function readCalendarIntegrationControl(context: DatabaseReadQueryContext, input: unknown) {
  const { r, owner } = readOwned(context, input, ['id', 'ruleId', 'epoch', 'action']);
  let id: string;
  if (r.id !== undefined) {
    if (['ruleId', 'epoch', 'action'].some(key => Object.hasOwn(r, key))) throw new CalendarError('CALENDAR_INPUT_INVALID'); id = calendarKey(r.id, 64);
  } else id = calendarIntegrationControlId(owner.scopeId, owner.expectedOwnerId, calendarKey(r.ruleId, 64), calendarInteger(r.epoch, 1), actionValue(r.action));
  return readControl(context, owner, id);
}
export function listPendingCalendarIntegrationControls(context: DatabaseReadQueryContext, input: unknown) {
  const { r, owner } = readOwned(context, input, ['now', 'limit', 'after']), now = integrationTime(r.now), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_INTEGRATION_LIMITS.page);
  const after = r.after === undefined ? null : calendarRecord(r.after, ['nextAttemptMs', 'id']);
  const cursor = after ? { at: integrationTime(after.nextAttemptMs), id: calendarKey(after.id, 64) } : null;
  const rows = context.database.query<{ id: string }>(`SELECT id FROM _calendar_integration_control_attempts WHERE scope_id=? AND result_id IS NULL AND next_attempt_ms<=?
    ${cursor ? 'AND (next_attempt_ms,id)>(?,?)' : ''} ORDER BY next_attempt_ms,id LIMIT ?`).all(owner.scopeId, now, ...(cursor ? [cursor.at, cursor.id] : []), limit);
  return rows.map(row => {
    const result = readControl(context, owner, row.id); if (!result || result.result) throw new CalendarError('CALENDAR_STATE_INVALID'); return result;
  });
}
/** Constant-size source-presence proof and one indexed unresolved control, including future backoff/old epochs. */
export function readCalendarIntegrationControlEvidence(context: DatabaseReadQueryContext, input: unknown): CalendarIntegrationControlEvidence {
  const { r, owner } = readOwned(context, input, ['ruleId']), ruleId = calendarKey(r.ruleId, 64);
  const binding = context.database.query<{ source_id: string }>('SELECT source_id FROM _calendar_integration_rule_sources WHERE id=? AND scope_id=?').get(ruleId, owner.scopeId);
  if (!binding) return { registered: false, pending: null };
  const registered = !!context.database.query<{ id: string }>('SELECT id FROM _calendar_integration_registered_sources WHERE id=? AND scope_id=? AND rule_id=?').get(binding.source_id, owner.scopeId, ruleId);
  const row = context.database.query<{ id: string }>(`SELECT id FROM _calendar_integration_control_attempts WHERE scope_id=? AND rule_id=? AND result_id IS NULL
    ORDER BY next_attempt_ms,id LIMIT 1`).get(owner.scopeId, ruleId);
  return { registered, pending: row ? readControl(context, owner, row.id) : null };
}
