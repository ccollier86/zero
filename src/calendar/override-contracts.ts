/** Closed one-off exception dialect. A review is neither a reservation nor booking authority. */
export type CalendarOverrideCategory = 'appointment-overlap';
export interface CalendarAppointmentOverride {
  readonly policyVersion: 'appointment-overlap-v1';
  readonly decisionToken: string;
  readonly reason: string;
}
export type CalendarOverrideReview =
  | { readonly status: 'clear' | 'non-reviewable' }
  | { readonly status: 'reviewable'; readonly categories: readonly ['appointment-overlap'];
      readonly policyVersion: 'appointment-overlap-v1'; readonly decisionToken: string; readonly expiresAt: string };
export interface CalendarOverrideGrantInput { readonly categories: readonly CalendarOverrideCategory[] }
export interface CalendarOverrideGrantView extends CalendarOverrideGrantInput {
  readonly resourceId: string; readonly userId: string; readonly resourceRevision: number;
}
export interface CalendarOverrideAuthority {
  readonly policyVersion: 'appointment-overlap-v1'; readonly policyHash: string;
  readonly use: boolean; readonly manageGrants: boolean;
}
