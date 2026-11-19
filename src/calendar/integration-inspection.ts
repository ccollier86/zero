/** Owner-bound bounded source inspection. No retained-history counts or evidence payloads. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { CalendarError } from './error';
import { calendarNow } from './hold-time';
import { CALENDAR_INTEGRATION_CODES, CALENDAR_INTEGRATION_LIMITS, integrationInputRecord, integrationOwner, integrationTime, type CalendarIntegrationCode } from './integration-model';
import { calendarInteger, calendarKey } from './validation';
import type { CalendarIntegrationInspection, CalendarIntegrationInspectionRule, CalendarIntegrationRetainedBudget } from './integration-inspection-model';
export type { CalendarIntegrationInspection, CalendarIntegrationInspectionRule, CalendarIntegrationRetainedBudget } from './integration-inspection-model';

export function readCalendarIntegrationInspection(context: DatabaseReadQueryContext, input: unknown): CalendarIntegrationInspection {
  const owner = integrationOwner(integrationInputRecord(input, []));
  const actual = context.database.query<{ scope_id: string; owner_id: string }>("SELECT scope_id,owner_id FROM _calendar_owner WHERE id='application'").get();
  if (!actual || actual.scope_id !== owner.scopeId || actual.owner_id !== owner.expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const inspectedAtMs = integrationTime(calendarNow());
  const budget = (id: string, limit: number): CalendarIntegrationRetainedBudget => {
    const row = context.database.query<{ count: number }>('SELECT count FROM _calendar_usage WHERE id=?').get(id);
    const used = row ? calendarInteger(row.count) : 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  };
  const current = context.database.query<{ id: string; rule_id: string; policy_id: string; epoch: number; state: CalendarIntegrationInspectionRule['state'] }>(
    'SELECT id,rule_id,policy_id,epoch,state FROM _calendar_integration_policy_current WHERE scope_id=? ORDER BY rule_id LIMIT ?')
    .all(owner.scopeId, CALENDAR_INTEGRATION_LIMITS.rules + 1);
  if (current.length > CALENDAR_INTEGRATION_LIMITS.rules) throw new CalendarError('CALENDAR_STATE_INVALID');
  const rules = current.map(row => {
    const history = context.database.query<{ rule_id: string; epoch: number; digest: string }>(
      'SELECT rule_id,epoch,digest FROM _calendar_integration_policy_history WHERE id=? AND scope_id=?').get(row.policy_id, owner.scopeId);
    if (!history || row.id !== row.rule_id || history.rule_id !== row.rule_id || history.epoch !== row.epoch
      || !['activating', 'active', 'retired'].includes(row.state) || !/^[a-f0-9]{64}$/.test(history.digest)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const attempt = context.database.query<{ id: string; last_failure: CalendarIntegrationCode | null; next_attempt_ms: number }>(
      `SELECT id,last_failure,next_attempt_ms FROM _calendar_integration_control_attempts WHERE scope_id=? AND rule_id=? AND result_id IS NULL
      ORDER BY next_attempt_ms,id LIMIT 1`).get(owner.scopeId, row.rule_id);
    let pendingControl: CalendarIntegrationInspectionRule['pendingControl'] = null;
    if (attempt) {
      const control = context.database.query<{ action: 'activate' | 'retire'; epoch: number; rule_id: string }>(
        'SELECT action,epoch,rule_id FROM _calendar_integration_controls WHERE id=? AND scope_id=? AND owner_id=?').get(attempt.id, owner.scopeId, owner.expectedOwnerId);
      if (!control || control.rule_id !== row.rule_id || !['activate', 'retire'].includes(control.action)
        || attempt.last_failure !== null && !CALENDAR_INTEGRATION_CODES.includes(attempt.last_failure)) throw new CalendarError('CALENDAR_STATE_INVALID');
      pendingControl = { action: control.action, epoch: calendarInteger(control.epoch, 1), lastFailure: attempt.last_failure, nextAttemptMs: integrationTime(attempt.next_attempt_ms) };
    }
    return { id: calendarKey(row.policy_id, 64), ruleId: calendarKey(row.id, 64), epoch: calendarInteger(row.epoch, 1), state: row.state, policyDigest: history.digest, pendingControl };
  });
  const exists = (sql: string, ...parameters: string[]) => !!context.database.query<{ id: string }>(sql).get(...parameters);
  const state = (value: string) => exists('SELECT id FROM _calendar_integration_dispatch WHERE scope_id=? AND state=? LIMIT 1', owner.scopeId, value);
  return {
    inspectedAtMs, retained: { policies: budget('integrationPolicies', CALENDAR_INTEGRATION_LIMITS.policies), intents: budget('integrationIntents', CALENDAR_INTEGRATION_LIMITS.intents) }, rules,
    dispatch: { pending: state('pending'), unknown: state('unknown'), blocked: state('blocked'), accepted: state('accepted'),
      claimed: exists('SELECT id FROM _calendar_integration_dispatch WHERE scope_id=? AND claim_nonce IS NOT NULL ORDER BY claim_until_ms,id LIMIT 1', owner.scopeId) },
    effects: { admittedButUnsettled: exists('SELECT id FROM _calendar_integration_pending_effects WHERE scope_id=? LIMIT 1', owner.scopeId) },
  };
}
