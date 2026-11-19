/** Private source facts only: no provider/drain certificate or publication authority. */
import type { CalendarIntegrationCode, CalendarIntegrationPolicyView } from './integration-model';
import type { CalendarIntegrationControlAction } from './integration-controls';

export interface CalendarIntegrationRetainedBudget {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}
export interface CalendarIntegrationInspectionRule {
  /** Actual persisted current policy identity; not a contract or capability. */
  readonly id: string;
  readonly ruleId: string;
  readonly epoch: number;
  readonly state: CalendarIntegrationPolicyView['state'];
  readonly policyDigest: string;
  /** One indexed unresolved control, including an older epoch or future backoff. */
  readonly pendingControl: {
    readonly action: CalendarIntegrationControlAction;
    readonly epoch: number;
    readonly lastFailure: CalendarIntegrationCode | null;
    readonly nextAttemptMs: number;
  } | null;
}
export interface CalendarIntegrationInspection {
  readonly inspectedAtMs: number;
  readonly retained: {
    readonly policies: CalendarIntegrationRetainedBudget;
    readonly intents: CalendarIntegrationRetainedBudget;
  };
  readonly rules: readonly CalendarIntegrationInspectionRule[];
  /** Existence, not exact totals, eligibility or an assertion that handoff is ready. */
  readonly dispatch: { readonly pending: boolean; readonly unknown: boolean; readonly blocked: boolean; readonly accepted: boolean; readonly claimed: boolean };
  /** A cutoff exists without a source-local observation outcome; never provider success. */
  readonly effects: { readonly admittedButUnsettled: boolean };
}
