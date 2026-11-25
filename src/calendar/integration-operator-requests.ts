/** Private actor-bound request acceptance. Only local source facts commit here; native controls run separately. */
import type { DatabaseReadQueryContext, DatabaseWriteCommandContext } from '../databases/database-realm';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import { CalendarError, calendarCommand } from './error';
import { calendarNow } from './hold-time';
import { installCalendarIntegrationPolicy, retireCalendarIntegrationPolicy } from './integration-commands';
import { CALENDAR_INTEGRATION_LIMITS, integrationBudget, integrationPolicy, integrationTime, type CalendarIntegrationPolicyView, type IntegrationCurrentRow, type IntegrationPolicyRow } from './integration-model';
import { calendarActor, calendarBudget } from './realm-model';
import { readCalendarHumanKeyClaim } from './human-request-key';
import { calendarHash, calendarKey, calendarRecord } from './validation';
import { calendarIntegrationOperatorRequestIntent, calendarIntegrationOperatorRequestView, calendarOperatorRequestId, type IntegrationOperatorRequestRow } from './integration-operator-request-model';

export function requestCalendarIntegrationOperator(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const row = calendarRecord(input, ['actor', 'expectedOwnerId', 'requestId', 'action', 'ruleId', 'expected', 'desired']), actor = calendarActor(row.actor);
    if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    const expectedOwnerId = calendarKey(row.expectedOwnerId), requestId = calendarKey(row.requestId), owner = context.db.get('_calendar_owner', 'application');
    if (!owner || owner.scope_id !== actor.scopeId || owner.owner_id !== expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID');
    const intent = calendarIntegrationOperatorRequestIntent({ action: row.action, ruleId: row.ruleId, expected: row.expected });
    const id = calendarOperatorRequestId(actor.scopeId, actor.principal, requestId);
    const claim = readCalendarHumanKeyClaim(context.db, actor.scopeId, actor.principal, requestId);
    if (claim && claim.family !== 'operator') throw new CalendarError('CALENDAR_INTENT_CONFLICT');
    const prior = claim?.row as IntegrationOperatorRequestRow | undefined;
    if (prior) {
      if (prior.scope_id !== actor.scopeId || prior.owner_id !== expectedOwnerId || prior.principal !== actor.principal || prior.user_id !== actor.userId || prior.digest !== intent.digest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      // Deliberately before current selection/desired-policy parsing: this is an accepted human request, not fresh native CAS.
      return calendarIntegrationOperatorRequestView(prior);
    }
    const selected = context.db.get('_calendar_integration_policy_current', intent.ruleId) as IntegrationCurrentRow | null;
    const history = selected && context.db.get('_calendar_integration_policy_history', selected.policy_id) as IntegrationPolicyRow | null;
    if (!selected || !history || selected.scope_id !== actor.scopeId || history.scope_id !== actor.scopeId || selected.policy_id !== intent.expected.id
      || selected.epoch !== intent.expected.epoch || history.digest !== intent.expected.policyDigest || history.rule_id !== intent.ruleId) throw new CalendarError('CALENDAR_POLICY_STALE');
    const changed = intent.action === 'reactivate' || selected.state !== 'retired', now = integrationTime(calendarNow());
    if (intent.action === 'retire' && changed) integrationBudget(context, 'integrationOperatorRetirements', CALENDAR_INTEGRATION_LIMITS.policies);
    else calendarBudget(context, 'receipts');
    let policy: CalendarIntegrationPolicyView;
    const native = { scopeId: actor.scopeId, expectedOwnerId, requestId: 'operator:' + id };
    if (intent.action === 'retire') {
      if (row.desired !== undefined) throw new CalendarError('CALENDAR_INPUT_INVALID');
      policy = retireCalendarIntegrationPolicy(context, { ...native, ruleId: intent.ruleId, epoch: intent.expected.epoch, expectedSelection: intent.expected }).value;
    } else {
      const desired = integrationPolicy(row.desired);
      if (desired.ruleId !== intent.ruleId) throw new CalendarError('CALENDAR_INPUT_INVALID');
      policy = installCalendarIntegrationPolicy(context, { ...native, policy: desired, expectedEpoch: intent.expected.epoch, expectedSelection: intent.expected, requireRetired: true, now }).value;
    }
    const accepted: IntegrationOperatorRequestRow = { id, scope_id: actor.scopeId, owner_id: expectedOwnerId, principal: actor.principal, user_id: actor.userId, request_id: requestId, digest: intent.digest,
      action: intent.action, rule_id: intent.ruleId, selected_policy_id: intent.expected.id, selected_epoch: intent.expected.epoch, selected_digest: intent.expected.policyDigest,
      policy_id: policy.id, policy_epoch: policy.epoch, policy_digest: calendarHash(policy.policy), local_state: intent.action === 'retire' ? 'retired' : 'activating', changed: changed ? 1 : 0, accepted_ms: now };
    const change = context.db.createStrict('_calendar_integration_operator_requests', accepted);
    if (changed) {
      if (!change) throw new CalendarError('CALENDAR_STATE_INVALID');
      appendDatabaseCommandSourceAudit(context, { id: 'calendar-operator:' + id, family: 'workflow',
        action: intent.action === 'retire' ? 'calendar.integration.retirement-requested' : 'calendar.integration.reactivation-requested', outcome: 'succeeded', occurredAt: now,
        target: { type: 'calendar.integration-rule', id: intent.ruleId },
        metadata: { sequence: change.seq, selectedEpoch: intent.expected.epoch, policyEpoch: policy.epoch, selectedPolicyId: intent.expected.id, policyId: policy.id, requestRef: id } });
    }
    return calendarIntegrationOperatorRequestView(accepted);
  });
}

export function readCalendarIntegrationOperatorReceipt(context: DatabaseReadQueryContext, input: unknown) {
  const row = calendarRecord(input, ['actor', 'expectedOwnerId', 'requestId']), actor = calendarActor(row.actor);
  if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
  const requestId = calendarKey(row.requestId), expectedOwnerId = calendarKey(row.expectedOwnerId);
  const owner = context.database.query<{ scope_id: string; owner_id: string }>("SELECT scope_id,owner_id FROM _calendar_owner WHERE id='application'").get();
  if (!owner || owner.scope_id !== actor.scopeId || owner.owner_id !== expectedOwnerId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const receipt = context.database.query<IntegrationOperatorRequestRow>('SELECT * FROM _calendar_integration_operator_requests WHERE id=? AND scope_id=? AND principal=? AND user_id=?')
    .get(calendarOperatorRequestId(actor.scopeId, actor.principal, requestId), actor.scopeId, actor.principal, actor.userId);
  return receipt ? calendarIntegrationOperatorRequestView(receipt) : null;
}
