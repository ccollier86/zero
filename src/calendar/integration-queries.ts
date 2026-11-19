/** Owner-bound private evidence queries. No actor, request facade, seal or provider handle is returned. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { CalendarError } from './error';
import { calendarNow } from './hold-time';
import { selectCalendarIntegrationQueue } from './integration-queue';
import { calendarHash, calendarInteger, calendarKey } from './validation';
import { CALENDAR_INTEGRATION_LIMITS, integrationInputRecord, integrationIntentView, integrationOwner, integrationPolicyView, integrationTime,
  type CalendarIntegrationEffectView, type CalendarIntegrationNextWake, type IntegrationAdmissionRow, type IntegrationCurrentRow, type IntegrationDispatchRow, type IntegrationIntentRow, type IntegrationPolicyRow, type IntegrationReceiptRow } from './integration-model';

function owned(context: DatabaseReadQueryContext, input: unknown, fields: readonly string[]) {
  const r = integrationInputRecord(input, fields), owner = integrationOwner(r);
  const row = context.database.query<{ owner_id: string; scope_id: string }>("SELECT owner_id,scope_id FROM _calendar_owner WHERE id='application'").get();
  if (!row || row.scope_id !== owner.scopeId || row.owner_id !== owner.expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID');
  return { r, owner };
}
function policy(context: DatabaseReadQueryContext, current: IntegrationCurrentRow) {
  const history = context.database.query<IntegrationPolicyRow>('SELECT * FROM _calendar_integration_policy_history WHERE id=? AND scope_id=?').get(current.policy_id, current.scope_id);
  if (!history) throw new CalendarError('CALENDAR_STATE_INVALID');
  const registration = context.database.query<{ registration_json: string }>('SELECT registration_json FROM _calendar_integration_policy_registrations WHERE id=? AND scope_id=?').get(history.id, history.scope_id);
  return integrationPolicyView(history, current, registration?.registration_json ?? null);
}
export function readCalendarIntegrationPolicy(context: DatabaseReadQueryContext, input: unknown) {
  const { r, owner } = owned(context, input, ['ruleId']);
  const current = context.database.query<IntegrationCurrentRow>('SELECT * FROM _calendar_integration_policy_current WHERE scope_id=? AND rule_id=?').get(owner.scopeId, calendarKey(r.ruleId, 64));
  return current ? policy(context, current) : null;
}
export function listCalendarIntegrationPolicies(context: DatabaseReadQueryContext, input: unknown) {
  const { owner } = owned(context, input, []);
  const rows = context.database.query<IntegrationCurrentRow>('SELECT * FROM _calendar_integration_policy_current WHERE scope_id=? ORDER BY id LIMIT ?').all(owner.scopeId, CALENDAR_INTEGRATION_LIMITS.rules + 1);
  if (rows.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID'); return rows.map(row => policy(context, row));
}
function intent(context: DatabaseReadQueryContext, scopeId: string, id: string, now?: number) {
  const row = context.database.query<IntegrationIntentRow>('SELECT * FROM _calendar_integration_intents WHERE id=? AND scope_id=?').get(id, scopeId);
  if (!row) return null;
  const dispatch = context.database.query<IntegrationDispatchRow>('SELECT * FROM _calendar_integration_dispatch WHERE id=? AND scope_id=?').get(id, scopeId);
  const history = context.database.query<IntegrationPolicyRow>('SELECT * FROM _calendar_integration_policy_history WHERE id=? AND scope_id=?').get(row.policy_id, scopeId);
  if (!dispatch || !history) throw new CalendarError('CALENDAR_STATE_INVALID');
  const current = context.database.query<IntegrationCurrentRow>('SELECT * FROM _calendar_integration_policy_current WHERE id=? AND scope_id=?').get(row.rule_id, scopeId);
  const receipt = context.database.query<IntegrationReceiptRow>('SELECT * FROM _calendar_integration_receipts WHERE id=? AND scope_id=?').get(calendarHash([id, 'create']), scopeId);
  const registration = context.database.query<{ registration_json: string }>('SELECT registration_json FROM _calendar_integration_policy_registrations WHERE id=? AND scope_id=?').get(history.id, scopeId);
  return integrationIntentView(row, dispatch, history, current, receipt, now, registration?.registration_json ?? null);
}
export function readCalendarIntegrationIntent(context: DatabaseReadQueryContext, input: unknown) {
  const { r, owner } = owned(context, input, ['id']); return intent(context, owner.scopeId, calendarKey(r.id));
}
export function listPendingCalendarIntegrations(context: DatabaseReadQueryContext, input: unknown) {
  const { r, owner } = owned(context, input, ['now', 'limit']), now = integrationTime(r.now), limit = calendarInteger(r.limit ?? 25, 1, CALENDAR_INTEGRATION_LIMITS.page);
  const ready = ['pending', 'unknown', 'blocked', 'accepted'].flatMap(state => context.database.query<{ id: string; next_attempt_ms: number }>(
    `SELECT id,next_attempt_ms FROM _calendar_integration_dispatch WHERE scope_id=? AND claim_nonce IS NULL AND state=? AND next_attempt_ms<=?
    ORDER BY next_attempt_ms,id LIMIT ?`).all(owner.scopeId, state, now, limit)).sort((a, b) => a.next_attempt_ms - b.next_attempt_ms || a.id.localeCompare(b.id));
  const expired = context.database.query<{ id: string }>(`SELECT id FROM _calendar_integration_dispatch WHERE scope_id=? AND claim_nonce IS NOT NULL AND claim_until_ms<=?
    ORDER BY claim_until_ms,id LIMIT ?`).all(owner.scopeId, now, limit);
  const policies = context.database.query<IntegrationCurrentRow>('SELECT * FROM _calendar_integration_policy_current WHERE scope_id=? ORDER BY id LIMIT ?').all(owner.scopeId, CALENDAR_INTEGRATION_LIMITS.rules + 1);
  if (policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
  const retired = policies.flatMap(policy => context.database.query<{ id: string; policy_epoch: number; next_attempt_ms: number }>(`SELECT id,policy_epoch,next_attempt_ms FROM _calendar_integration_dispatch
    WHERE scope_id=? AND rule_id=? AND state='accepted' AND claim_nonce IS NULL AND blocked_code IS NULL AND policy_epoch${policy.state === 'retired' ? '<=' : '<'}?
    ORDER BY policy_epoch,next_attempt_ms,id LIMIT ?`).all(owner.scopeId, policy.rule_id, policy.epoch, limit))
    .sort((a, b) => a.policy_epoch - b.policy_epoch || a.next_attempt_ms - b.next_attempt_ms || a.id.localeCompare(b.id));
  const cursor = context.database.query<{ scope_id: string; next_class: number }>("SELECT scope_id,next_class FROM _calendar_integration_queue_cursor WHERE id='dispatch'").get();
  if (cursor && cursor.scope_id !== owner.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
  return selectCalendarIntegrationQueue<{ id: string }>([expired, retired, ready], cursor ? calendarInteger(cursor.next_class, 0, 2) : 0, limit)
    .selected.map(row => intent(context, owner.scopeId, row.id, now));
}
/** Exact source-local scheduler hint. Polling this query never claims work or advances fairness. */
export function readCalendarIntegrationNextWake(context: DatabaseReadQueryContext, input: unknown): CalendarIntegrationNextWake {
  const { owner } = owned(context, input, []), now = integrationTime(calendarNow());
  let earliest: number | null = null;
  const include = (at: number | undefined) => { if (at !== undefined) earliest = Math.min(earliest ?? Infinity, Math.max(now, integrationTime(at))); };
  for (const state of ['pending', 'unknown', 'blocked', 'accepted']) {
    include(context.database.query<{ next_attempt_ms: number }>(`SELECT next_attempt_ms FROM _calendar_integration_dispatch
      WHERE scope_id=? AND claim_nonce IS NULL AND state=? ORDER BY next_attempt_ms,id LIMIT 1`).get(owner.scopeId, state)?.next_attempt_ms);
  }
  include(context.database.query<{ claim_until_ms: number }>(`SELECT claim_until_ms FROM _calendar_integration_dispatch
    WHERE scope_id=? AND claim_nonce IS NOT NULL ORDER BY claim_until_ms,id LIMIT 1`).get(owner.scopeId)?.claim_until_ms);
  include(context.database.query<{ next_attempt_ms: number }>(`SELECT next_attempt_ms FROM _calendar_integration_control_attempts
    WHERE scope_id=? AND result_id IS NULL ORDER BY next_attempt_ms,id LIMIT 1`).get(owner.scopeId)?.next_attempt_ms);
  const policies = context.database.query<IntegrationCurrentRow>('SELECT * FROM _calendar_integration_policy_current WHERE scope_id=? ORDER BY id LIMIT ?')
    .all(owner.scopeId, CALENDAR_INTEGRATION_LIMITS.rules + 1);
  if (policies.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const policy of policies) {
    // Only healthy acceptance bypasses its expiry marker when policy changes.
    // A cancellation retry has a blocked code and must retain its exact backoff.
    if (context.database.query<{ id: string }>(`SELECT id FROM _calendar_integration_dispatch WHERE scope_id=? AND rule_id=?
      AND state='accepted' AND claim_nonce IS NULL AND blocked_code IS NULL AND policy_epoch${policy.state === 'retired' ? '<=' : '<'}?
      ORDER BY policy_epoch,next_attempt_ms,id LIMIT 1`).get(owner.scopeId, policy.rule_id, policy.epoch)) include(now);
  }
  return { nextWakeAt: earliest };
}
export function readCalendarIntegrationEffect(context: DatabaseReadQueryContext, input: unknown): CalendarIntegrationEffectView | null {
  const { r, owner } = owned(context, input, ['id']), id = calendarKey(r.id);
  const row = context.database.query<IntegrationAdmissionRow>('SELECT * FROM _calendar_integration_effect_admissions WHERE id=? AND scope_id=?').get(id, owner.scopeId);
  if (!row) return null;
  return { id: row.id, intentId: row.intent_id, executionId: row.execution_id, nonce: row.nonce, admittedAt: row.admitted_ms,
    outcome: context.database.query<{ id: string }>('SELECT id FROM _calendar_integration_effect_outcomes WHERE id=? AND scope_id=?').get(id, owner.scopeId) ? 'observed' : null };
}
