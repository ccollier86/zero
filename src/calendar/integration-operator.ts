/** Private native operator contracts. No request mutation, provider or disable certificate. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { JobSourceCapacity, JobRetainedCapacity } from '../jobs/source-model';
import { CalendarError } from './error';
import type { CalendarIntegrationPolicySelection } from './integration-controller';
import type { CalendarIntegrationInspection, CalendarIntegrationInspectionRule } from './integration-inspection-model';
import type { CalendarIntegrationPolicyView } from './integration-model';
import { calendarHash, calendarInteger, calendarKey, calendarRecord } from './validation';

export interface CalendarIntegrationOperatorReadOptions {
  readonly signal?: AbortSignal;
  /** Trusted native request fence only; never admitted by the request-facing options. */
  readonly assertCurrent?: () => void;
  /** Revalidate trusted request authority before continuing after a private read wait. */
  readonly confirmCurrent?: () => Promise<void>;
}
export interface CalendarIntegrationOperatorControl {
  readonly signal?: AbortSignal;
  readonly ruleId: string;
  readonly expected: CalendarIntegrationPolicySelection;
}
export interface CalendarIntegrationOperatorRule extends CalendarIntegrationInspectionRule {
  readonly configured: boolean;
  readonly selection: CalendarIntegrationPolicySelection;
  readonly downstream: null | {
    readonly generation: number; readonly revision: number;
    readonly state: 'active' | 'retired'; readonly matchesPolicy: boolean;
  };
  readonly capacity: null | { readonly sourceSchedules: JobRetainedCapacity; readonly file: JobSourceCapacity['file'] };
}
export interface CalendarIntegrationOperatorInspection extends Omit<CalendarIntegrationInspection, 'rules'> {
  readonly rules: readonly CalendarIntegrationOperatorRule[];
  /** Retired controls and empty queues are NOT proof that running effects have drained. */
  readonly evidenceOwnerRequired: true;
  readonly snapshot: 'separate-source-and-jobs-observations';
}
export interface CalendarIntegrationOperatorResult {
  readonly ruleId: string;
  readonly selection: CalendarIntegrationPolicySelection;
  readonly localState: CalendarIntegrationPolicyView['state'];
  readonly downstream: 'active' | 'retired' | 'never-registered' | 'pending';
  readonly evidenceOwnerRequired: true;
}
export interface CalendarIntegrationNativeOperations {
  inspect(scope: ServiceDataScope, options?: CalendarIntegrationOperatorReadOptions): Promise<CalendarIntegrationOperatorInspection | null>;
  retire(scope: ServiceDataScope, input: CalendarIntegrationOperatorControl): Promise<CalendarIntegrationOperatorResult>;
  reactivate(scope: ServiceDataScope, input: CalendarIntegrationOperatorControl): Promise<CalendarIntegrationOperatorResult>;
}

export function calendarIntegrationOperatorOptions(input?: CalendarIntegrationOperatorReadOptions): CalendarIntegrationOperatorReadOptions {
  const options = calendarRecord(input === undefined ? {} : input, ['signal', 'assertCurrent', 'confirmCurrent']);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)
    || options.assertCurrent !== undefined && typeof options.assertCurrent !== 'function'
    || options.confirmCurrent !== undefined && typeof options.confirmCurrent !== 'function') throw new CalendarError('CALENDAR_INPUT_INVALID');
  const signal = options.signal as AbortSignal | undefined;
  const assertCurrent = options.assertCurrent as (() => void) | undefined, confirmCurrent = options.confirmCurrent as (() => Promise<void>) | undefined;
  signal?.throwIfAborted(); return { ...(signal ? { signal } : {}), ...(assertCurrent ? { assertCurrent } : {}), ...(confirmCurrent ? { confirmCurrent } : {}) };
}
export function calendarIntegrationOperatorControl(input: CalendarIntegrationOperatorControl): CalendarIntegrationOperatorControl {
  const options = calendarRecord(input, ['ruleId', 'expected', 'signal']);
  const { signal } = calendarIntegrationOperatorOptions(options.signal === undefined ? {} : { signal: options.signal as AbortSignal });
  const selection = calendarRecord(options.expected, ['id', 'epoch', 'policyDigest']);
  const id = calendarKey(selection.id, 64), policyDigest = calendarKey(selection.policyDigest, 64);
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(policyDigest)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ ruleId: calendarKey(options.ruleId, 64),
    expected: Object.freeze({ id, epoch: calendarInteger(selection.epoch, 1), policyDigest }), ...(signal ? { signal } : {}) });
}
export function calendarIntegrationPolicySelection(policy: CalendarIntegrationPolicyView): CalendarIntegrationPolicySelection {
  return Object.freeze({ id: policy.id, epoch: policy.epoch, policyDigest: calendarHash(policy.policy) });
}
/** Cross-await policy fence, not a promise of a cross-database transaction. */
export function calendarIntegrationInspectionKey(view: CalendarIntegrationInspection): string {
  return calendarHash(view.rules.map(rule => [rule.id, rule.epoch, rule.state, rule.policyDigest]));
}
