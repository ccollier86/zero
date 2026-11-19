/** Scope-owned geographic assignment coverage, never credentials or remote licensure proof. */
export interface CalendarResourceLocationPolicyWindow { readonly startAt: string; readonly endAt: string }
export interface CalendarResourceLocationPolicyAssignment {
  readonly locationId: string;
  readonly windows: readonly CalendarResourceLocationPolicyWindow[];
}
export type CalendarResourceLocationPolicyInput = {
  readonly kind: 'static-v1'; readonly locationIds: readonly string[];
} | {
  readonly kind: 'effective-utc-v1'; readonly assignments: readonly CalendarResourceLocationPolicyAssignment[];
};
export interface CalendarResourceLocationPolicyView {
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly policy: CalendarResourceLocationPolicyInput;
}
