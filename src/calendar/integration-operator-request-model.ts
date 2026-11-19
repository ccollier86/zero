/** Private initiating-request facts. These receipts prove a local cutoff, never Jobs or effect settlement. */
import type { Row } from '../sync/types';
import type { CalendarIntegrationPolicySelection } from './integration-controller';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

export type CalendarIntegrationOperatorAction = 'retire' | 'reactivate';
export interface CalendarIntegrationOperatorRequestReceipt {
  readonly requestId: string;
  readonly action: CalendarIntegrationOperatorAction;
  readonly ruleId: string;
  readonly expected: CalendarIntegrationPolicySelection;
  readonly policy: CalendarIntegrationPolicySelection;
  readonly localState: 'retired' | 'activating';
  readonly changed: boolean;
  readonly acceptedAtMs: number;
}
export interface IntegrationOperatorRequestRow extends Row {
  id: string; scope_id: string; owner_id: string; principal: string; user_id: string; request_id: string; digest: string;
  action: CalendarIntegrationOperatorAction; rule_id: string; selected_policy_id: string; selected_epoch: number; selected_digest: string;
  policy_id: string; policy_epoch: number; policy_digest: string; local_state: 'retired' | 'activating'; changed: number; accepted_ms: number;
}
export function calendarOperatorRequestId(scopeId: string, principal: string, requestId: string): string {
  return calendarHash(['calendar-operator-v1', scopeId, principal, requestId]);
}
export function calendarIntegrationOperatorRequestSelection(input: unknown): CalendarIntegrationPolicySelection {
  const row = calendarRecord(input, ['id', 'epoch', 'policyDigest']), id = calendarKey(row.id, 64), policyDigest = calendarKey(row.policyDigest, 64);
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(policyDigest)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ id, epoch: calendarInteger(row.epoch, 1), policyDigest });
}
/** Only authored semantics select request identity; the framework's current desired catalog is not part of it. */
export function calendarIntegrationOperatorRequestIntent(input: unknown): {
  readonly action: CalendarIntegrationOperatorAction; readonly ruleId: string; readonly expected: CalendarIntegrationPolicySelection; readonly digest: string;
} {
  const row = calendarRecord(input, ['action', 'ruleId', 'expected']);
  if (row.action !== 'retire' && row.action !== 'reactivate') throw new CalendarError('CALENDAR_INPUT_INVALID');
  const action = row.action, ruleId = calendarKey(row.ruleId, 64), expected = calendarIntegrationOperatorRequestSelection(row.expected);
  return Object.freeze({ action, ruleId, expected, digest: calendarHash([action, ruleId, expected]) });
}
export function calendarIntegrationOperatorRequestView(row: IntegrationOperatorRequestRow): CalendarIntegrationOperatorRequestReceipt {
  const expected = calendarIntegrationOperatorRequestSelection({ id: row.selected_policy_id, epoch: row.selected_epoch, policyDigest: row.selected_digest });
  const policy = calendarIntegrationOperatorRequestSelection({ id: row.policy_id, epoch: row.policy_epoch, policyDigest: row.policy_digest });
  const intent = calendarIntegrationOperatorRequestIntent({ action: row.action, ruleId: row.rule_id, expected });
  if (row.id !== calendarOperatorRequestId(row.scope_id, row.principal, row.request_id) || row.digest !== intent.digest || ![0, 1].includes(row.changed) || row.local_state !== (row.action === 'retire' ? 'retired' : 'activating')
    || (row.action === 'retire' ? policy.id !== expected.id || policy.epoch !== expected.epoch || policy.policyDigest !== expected.policyDigest : row.changed !== 1 || policy.epoch !== expected.epoch + 1)) throw new CalendarError('CALENDAR_STATE_INVALID');
  return Object.freeze({ requestId: calendarKey(row.request_id), action: intent.action, ruleId: intent.ruleId, expected, policy,
    localState: row.local_state, changed: row.changed === 1, acceptedAtMs: calendarInteger(row.accepted_ms, 0, 8_640_000_000_000_000) });
}
