/** Portable versioned availability sources and their retained UTC materialization. */
import type { CalendarAvailabilityWindow } from './contracts';

export interface CalendarExplicitAvailabilityPolicyInput {
  readonly kind: 'explicit-utc-v1';
  readonly mode: 'unrestricted' | 'windows';
  readonly windows: readonly CalendarAvailabilityWindow[];
}

/** Same-date wall minutes. Split overnight hours explicitly at the civil-date boundary. */
export interface CalendarWorkingHoursWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface CalendarWeeklyAvailabilityPolicyInput {
  readonly kind: 'weekly-local-v1';
  /** Strict Gregorian dates; until is exclusive. Outside this range is not qualified. */
  readonly coverage: { readonly from: string; readonly until: string };
  /** Explicit resolution of repeated wall-time boundaries. Gaps are never shifted. */
  readonly fold: 'earlier' | 'later';
  /** ISO weekdays: Monday = 1, Sunday = 7. Missing days are closed. */
  readonly weekly: readonly { readonly day: number; readonly windows: readonly CalendarWorkingHoursWindow[] }[];
  /** The entire date's replacement hours; an empty set closes that date. */
  readonly overrides: readonly { readonly date: string; readonly windows: readonly CalendarWorkingHoursWindow[] }[];
}

export type CalendarAvailabilityPolicyInput = CalendarExplicitAvailabilityPolicyInput | CalendarWeeklyAvailabilityPolicyInput;

/** Immutable policy-write snapshot, not a claim that ICU identifies a pinned timezone database. */
export interface CalendarWorkingHoursSnapshot {
  readonly coverage: { readonly startAt: string; readonly endAt: string };
  readonly windows: readonly CalendarAvailabilityWindow[];
  readonly engine: { readonly name: 'temporal-working-hours-v1'; readonly runtime: string; readonly icu: string };
  /** Nominal dates whose generated weekly windows encountered nonexistent boundaries. */
  readonly skippedDates: readonly string[];
}

export interface CalendarAvailabilityPolicyView {
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly timeZone: string;
  readonly policy: CalendarAvailabilityPolicyInput;
  readonly materialization: null | {
    readonly coverage: CalendarWorkingHoursSnapshot['coverage'];
    readonly engine: CalendarWorkingHoursSnapshot['engine'];
    readonly skippedDates: readonly string[];
    readonly windowCount: number;
  };
}
