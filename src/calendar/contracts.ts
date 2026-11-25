/** Private, scope-admitted calendar contracts shared by native server and browser facades. */
import type { CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView } from './working-hours-contracts';
import type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView } from './location-policy-contracts';
import type { CalendarAppointmentOverride, CalendarOverrideReview, CalendarOverrideAuthority, CalendarOverrideGrantInput, CalendarOverrideGrantView } from './override-contracts';
export type { CalendarAppointmentOverride, CalendarOverrideReview, CalendarOverrideAuthority, CalendarOverrideCategory,
  CalendarOverrideGrantInput, CalendarOverrideGrantView } from './override-contracts';
export type { CalendarResourceLocationPolicyInput, CalendarResourceLocationPolicyView,
  CalendarResourceLocationPolicyWindow, CalendarResourceLocationPolicyAssignment } from './location-policy-contracts';
export type { CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView, CalendarExplicitAvailabilityPolicyInput,
  CalendarWeeklyAvailabilityPolicyInput, CalendarWorkingHoursSnapshot } from './working-hours-contracts';
export interface CalendarActor {
  readonly scopeId: string;
  readonly userId: string;
  readonly principal: string;
  /** Trusted service-admitted capability, never selected by HTTP input. */
  readonly manageAll: boolean;
  readonly createOwn: boolean;
  /** Trusted current capability projection; absent means disabled. Never accepted from browser input. */
  readonly overrides?: CalendarOverrideAuthority;
}
export type CalendarResourceKind = 'person' | 'room' | 'equipment';
/** Current scoped UI discovery only; individual resource/command admission remains authoritative. */
export interface CalendarCapabilities {
  readonly timeZone: string;
  readonly createOwn: boolean;
  readonly manage: boolean;
  /** Caller may discover/manage native account participants in this configured service. */
  readonly participants: boolean;
  /** Absent on older servers. This covers untyped appointments, not holds or blocks. */
  readonly allDayAppointments?: boolean;
  /** Absent on older servers. Authoritative effective assignment policy/discovery is available. */
  readonly locationPolicies?: boolean;
  /** Discovery only: independent per-resource grants and final admission remain mandatory. */
  readonly appointmentOverrides?: boolean;
  readonly overrideGrants?: boolean;
  readonly limits: { readonly maxRangeDays: number; readonly maxPageSize: number; readonly maxResources: number; readonly maxParticipants: number };
}
/** Native account identity only. Calendar files never duplicate Guardian profiles or credentials. */
export interface CalendarParticipantReference { readonly kind: 'guardian-user'; readonly userId: string }
export type CalendarParticipantView =
  | { readonly ref: CalendarParticipantReference; readonly availability: 'available'; readonly name: string }
  | { readonly ref: CalendarParticipantReference; readonly availability: 'unavailable' };
export interface CalendarParticipantDirectoryQuery { readonly search?: string; readonly after?: string; readonly limit?: number }
export interface CalendarParticipantDirectoryPage {
  readonly items: readonly CalendarParticipantView[];
  readonly truncated: boolean;
  readonly nextAfter: string | null;
}
/** Private manager-only projection, separate from appointment details and free/busy. */
export interface CalendarParticipantsView {
  readonly id: string;
  readonly revision: number;
  readonly participants: readonly CalendarParticipantView[];
}
export type CalendarVisitMode = 'in-person' | 'video' | 'phone';
export interface CalendarLocationReference { readonly id: string; readonly revision: number }
export interface CalendarLocationSnapshot extends CalendarLocationReference { readonly label: string; readonly region: string | null }
/** No provider URLs or manual addresses. Omission means an unspecified visit, not inferred telehealth. */
export type CalendarVisitInput = { readonly mode: 'in-person'; readonly location: CalendarLocationReference }
  | { readonly mode: 'video' | 'phone' };
export type CalendarVisitSnapshot = { readonly mode: 'in-person'; readonly location: CalendarLocationSnapshot }
  | { readonly mode: 'video' | 'phone' };
export interface CalendarVisitLocationQuery extends CalendarLocationPageQuery {
  readonly resourceIds: readonly string[];
  /** Explicit occupied UTC bounds, including buffers; omission is directory discovery only. */
  readonly interval?: { readonly startAt: string; readonly endAt: string };
}
/** Reservation occupancy remains separate from confirmation/outcome; only cancellation releases it. */
export type CalendarAppointmentStatus = 'tentative' | 'confirmed' | 'completed' | 'no-show' | 'cancelled';
export interface CalendarLifecyclePolicyInput {
  readonly extended: boolean;
  readonly cancellationReason: 'optional' | 'required';
  readonly noShowReason: 'optional' | 'required';
}
export interface CalendarLifecyclePolicy extends CalendarLifecyclePolicyInput { readonly revision: number }
export interface CalendarAppointmentLifecycle {
  readonly status: CalendarAppointmentStatus;
  /** Source appointment revision at which this lifecycle fact was accepted. */
  readonly revision: number;
  readonly policyRevision: number;
  /** Private domain value. Never copied into audit metadata, busy views or integration intents. */
  readonly reason: string | null;
}
export interface CalendarAppointmentTransitionInput {
  readonly status: CalendarAppointmentStatus;
  /** Captured from the current server transition projection; a changed policy requires review. */
  readonly policyRevision: number;
  readonly reason?: string;
}
export interface CalendarAppointmentTransitions {
  readonly id: string;
  readonly revision: number;
  readonly policyRevision: number;
  readonly status: CalendarAppointmentStatus;
  readonly allowed: readonly { readonly status: CalendarAppointmentStatus; readonly requiresReason: boolean }[];
}
/** A caller selects a current catalog version; policy and historical snapshots are server-owned. */
export interface CalendarAppointmentTypeReference { readonly id: string; readonly revision: number }
export interface CalendarAppointmentTypeSnapshot extends CalendarAppointmentTypeReference {
  readonly label: string;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly colorKey: string | null;
}
export interface CalendarAppointmentTypeInput {
  readonly label: string;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
  readonly colorKey?: string | null;
  readonly active?: boolean;
}
/** Replacement supplies every retained policy field, including active and nullable color. */
export interface CalendarAppointmentTypeReplacement extends Omit<CalendarAppointmentTypeSnapshot, 'id' | 'revision'> {
  readonly active: boolean;
}
export interface CalendarAppointmentTypeView extends CalendarAppointmentTypeSnapshot { readonly active: boolean }
export interface CalendarAppointmentTypePageQuery {
  /** Omission is manager-only catalog discovery; an explicit empty selection always yields an empty page. */
  readonly resourceIds?: readonly string[];
  readonly limit?: number;
  readonly after?: string;
}
export interface CalendarAppointmentTypePage {
  readonly items: readonly CalendarAppointmentTypeView[];
  readonly truncated: boolean;
  readonly nextAfter: string | null;
}
export interface CalendarResourceTypesInput {
  readonly mode: 'unrestricted' | 'optional' | 'required';
  readonly typeIds: readonly string[];
}
export interface CalendarResourceTypesView extends CalendarResourceTypesInput {
  readonly resourceId: string;
  readonly resourceRevision: number;
}
/** Scope-local catalog metadata. Neither locations nor geography filters grant resource access. */
export interface CalendarLocationInput {
  readonly label: string;
  readonly region?: string | null;
  readonly active?: boolean;
}
/** Replacement is explicit: omitted fields never silently restore a deactivated location. */
export interface CalendarLocationReplacement {
  readonly label: string;
  readonly region: string | null;
  readonly active: boolean;
}
export interface CalendarLocationView extends CalendarLocationReplacement {
  readonly id: string;
  readonly revision: number;
}
export interface CalendarLocationPageQuery { readonly limit?: number; readonly after?: string }
export interface CalendarLocationPage {
  readonly items: readonly CalendarLocationView[];
  readonly truncated: boolean;
  readonly nextAfter: string | null;
}
export interface CalendarResourceLocationsView {
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly locationIds: readonly string[];
}
export interface CalendarResourceView {
  readonly id: string;
  readonly label: string;
  readonly kind: CalendarResourceKind;
  readonly ownerId: string | null;
  readonly timeZone: string;
  readonly revision: number;
  readonly active: boolean;
}
export type CalendarGrant = 'busy' | 'details' | 'book' | 'manage';
/** Explicit UTC windows, not recurring working-hours rules. Empty windows mode is closed. */
export interface CalendarAvailabilityWindow { readonly startAt: string; readonly endAt: string }
export interface CalendarAvailabilityInput {
  readonly mode: 'unrestricted' | 'windows';
  readonly windows: readonly CalendarAvailabilityWindow[];
}
export interface CalendarAvailabilityView extends CalendarAvailabilityInput {
  readonly resourceId: string;
  /** Current resource revision, including intervening permission changes. */
  readonly resourceRevision: number;
  readonly timeZone: string;
}
export interface CalendarBlockInput {
  readonly resourceIds: readonly string[];
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
}
export interface CalendarBlockRescheduleInput {
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
}
export interface CalendarBlockView extends CalendarBlockInput {
  readonly id: string;
  readonly revision: number;
  readonly status: 'active' | 'cancelled';
  readonly createdBy: string;
}
export interface CalendarBlockPage { readonly items: readonly CalendarBlockView[]; readonly truncated: boolean }
/** Authenticated transient reservation; this does not enable public self-booking. */
export interface CalendarHoldInput {
  readonly participants?: readonly CalendarParticipantReference[];
  readonly visit?: CalendarVisitInput;
  readonly appointmentType?: CalendarAppointmentTypeReference;
  readonly resourceIds: readonly string[];
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
  readonly ttlSeconds?: number;
}
export interface CalendarHoldConfirmationInput { readonly title: string }
export interface CalendarHoldView {
  readonly visit?: CalendarVisitSnapshot;
  readonly appointmentType?: CalendarAppointmentTypeSnapshot;
  readonly id: string;
  readonly revision: number;
  readonly resourceIds: readonly string[];
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly status: 'held' | 'expired' | 'released' | 'confirmed';
  readonly expiresAt: string;
  readonly createdBy: string;
  readonly appointmentId: string | null;
}
export interface CalendarHoldPage { readonly items: readonly CalendarHoldView[]; readonly truncated: boolean }
export interface CalendarAppointmentView {
  /** Selected accepted child facts, never a grant to call legacy appointment writers. */
  readonly series?: CalendarSeriesChildMetadata;
  /** Authoritative LocalDate fact; ordinary timed JSON retains its original shape. */
  readonly interval?: CalendarAllDayAppointmentInterval;
  readonly visit?: CalendarVisitSnapshot;
  readonly lifecycle?: CalendarAppointmentLifecycle;
  readonly appointmentType?: CalendarAppointmentTypeSnapshot;
  readonly id: string;
  readonly revision: number;
  readonly resourceIds: readonly string[];
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly status: 'confirmed' | 'cancelled';
  readonly createdBy: string;
}
export interface CalendarSeriesChildMetadata {
  readonly kind: 'series-child-v1';
  readonly seriesId: string;
  readonly logicalSegmentId: string;
  readonly nominalKey: string;
  /** Provenance of this selected version, not a newer pending source generation. */
  readonly sourceGeneration: number;
  readonly exceptionRevision: number;
  readonly editPolicy: 'canonical-series-action';
}
/** Safe operation outcome only. Reconciliation must not replay an old private appointment snapshot. */
export interface CalendarCommandReceipt {
  readonly requestId: string;
  readonly operation: 'resource.created' | 'resource.grant-changed' | 'resource.availability-changed' | 'resource.locations-changed'
    | 'resource.location-policy-changed'
    | 'resource.override-grant-changed'
    | 'resource.availability-policy-changed'
    | 'location.created' | 'location.updated'
    | 'type.created' | 'type.updated' | 'resource.types-changed'
    | 'appointment.created' | 'appointment.rescheduled' | 'appointment.updated' | 'appointment.cancelled' | 'appointment.transitioned' | 'appointment.participants-changed'
    | 'lifecycle.policy-changed'
    | 'block.created' | 'block.rescheduled' | 'block.cancelled' | 'hold.acquired' | 'hold.released';
  readonly id: string;
  readonly revision: number;
  readonly changed: boolean;
}
export interface CalendarRangeQuery {
  readonly resourceIds: readonly string[];
  readonly startAt: string;
  readonly endAt: string;
  readonly limit?: number;
}

/** Authored Gregorian dates, independent of the viewer's timezone; end is exclusive. */
export interface CalendarAllDayAppointmentInterval {
  readonly kind: 'all-day-local-v1';
  readonly startDate: string;
  readonly endDate: string;
  readonly timeZone: string;
}
export interface CalendarExplicitTimedAppointmentInterval {
  readonly kind: 'timed-v1';
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}
export type CalendarAppointmentIntervalInput = CalendarAllDayAppointmentInterval | CalendarExplicitTimedAppointmentInterval;
export interface CalendarDateRangeQuery {
  readonly resourceIds: readonly string[];
  readonly startDate: string;
  /** Exclusive bound; not an ISO instant or a browser-local Date. */
  readonly endDate: string;
  readonly limit?: number;
}

export interface CalendarResourceInput {
  readonly label: string;
  readonly kind: CalendarResourceKind;
  readonly ownerId?: string | null;
  readonly timeZone: string;
}
export interface CalendarAppointmentInput {
  readonly participants?: readonly CalendarParticipantReference[];
  readonly visit?: CalendarVisitInput;
  readonly appointmentType?: CalendarAppointmentTypeReference;
  readonly resourceIds: readonly string[];
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
}
/** Additive explicit-interval creation; the existing timed input interface is unchanged. */
export interface CalendarExplicitAppointmentInput extends Omit<CalendarAppointmentInput,
  'startAt' | 'endAt' | 'timeZone' | 'bufferBeforeMinutes' | 'bufferAfterMinutes'> {
  readonly interval: CalendarAppointmentIntervalInput;
  readonly startAt?: never;
  readonly endAt?: never;
  readonly timeZone?: never;
  readonly bufferBeforeMinutes?: never;
  readonly bufferAfterMinutes?: never;
}
export type CalendarAppointmentCreateInput = CalendarAppointmentInput | CalendarExplicitAppointmentInput;
/** Rescheduling explicitly supplies both buffers, never guesses them from a stale browser snapshot. */
export interface CalendarRescheduleInput {
  /** Omission preserves the accepted visit at the expected revision; null explicitly clears it. */
  readonly visit?: CalendarVisitInput | null;
  /** Omit to preserve the accepted historical snapshot; null explicitly detaches it. */
  readonly appointmentType?: CalendarAppointmentTypeReference | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}
/** One atomic rich edit. Omitted fields preserve accepted facts; only type/visit accept explicit null. */
export type CalendarAppointmentUpdateInput = {
  readonly title?: string;
  readonly resourceIds?: readonly string[];
  readonly appointmentType?: CalendarAppointmentTypeReference | null;
  readonly visit?: CalendarVisitInput | null;
  readonly participants?: readonly CalendarParticipantReference[];
} & ({
  readonly interval?: never;
  readonly startAt: string; readonly endAt: string; readonly timeZone: string;
  readonly bufferBeforeMinutes: number; readonly bufferAfterMinutes: number;
} | {
  readonly interval?: never;
  readonly startAt?: never; readonly endAt?: never; readonly timeZone?: never;
  readonly bufferBeforeMinutes?: never; readonly bufferAfterMinutes?: never;
} | {
  readonly interval: CalendarAppointmentIntervalInput;
  readonly startAt?: never; readonly endAt?: never; readonly timeZone?: never;
  readonly bufferBeforeMinutes?: never; readonly bufferAfterMinutes?: never;
});
export interface CalendarRequestOptions {
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}
export interface CalendarControlOptions extends CalendarRequestOptions {
  readonly expectedRevision: number;
}
export interface CalendarAppointmentRequestOptions extends CalendarRequestOptions { readonly override?: CalendarAppointmentOverride }
export interface CalendarAppointmentControlOptions extends CalendarControlOptions { readonly override?: CalendarAppointmentOverride }
export interface CalendarCancellationOptions extends CalendarControlOptions { readonly reason?: string }
export interface CalendarReadOptions { readonly signal?: AbortSignal }
export interface CalendarResourcePageQuery extends CalendarLocationPageQuery {
  /** Empty or omitted facets are unrestricted within the currently authorized resource set. */
  readonly locationIds?: readonly string[];
  readonly regions?: readonly string[];
}
export interface CalendarResourcePage {
  readonly items: readonly CalendarResourceView[];
  readonly truncated: boolean;
  readonly nextAfter: string | null;
}
export interface CalendarAppointmentPage {
  readonly items: readonly CalendarAppointmentView[];
  readonly truncated: boolean;
}
/** Busy intervals include buffers but never private IDs, titles or participant information. */
export interface CalendarBusyPage {
  readonly items: readonly { readonly resourceId: string; readonly startAt: string; readonly endAt: string }[];
  readonly truncated: boolean;
}
export interface CalendarWatchUpdate {
  readonly invalidated: boolean;
  /** A new authorized snapshot after a transport gap, not evidence of a database commit. */
  readonly reconnected?: boolean;
}
export interface CalendarWatchOptions extends CalendarReadOptions {
  /** Terminal error: retire previously accepted private presentation; do not silently retain it. */
  readonly onError?: (error: unknown) => void;
}
export interface ScopedCalendar {
  readonly overrides: {
    readonly grants: {
      get(resourceId: string, userId: string, options?: CalendarReadOptions): Promise<CalendarOverrideGrantView>;
      replace(resourceId: string, userId: string, grants: CalendarOverrideGrantInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
      watch(resourceId: string, userId: string, listener: (grant: CalendarOverrideGrantView, update?: CalendarWatchUpdate) => void,
        options?: CalendarWatchOptions): () => void;
    };
  };
  readonly capabilities: {
    get(options?: CalendarReadOptions): Promise<CalendarCapabilities>;
    watch(listener: (capabilities: CalendarCapabilities, update?: CalendarWatchUpdate) => void, options?: CalendarWatchOptions): () => void;
  };
  readonly participants: {
    directory(query?: CalendarParticipantDirectoryQuery, options?: CalendarReadOptions): Promise<CalendarParticipantDirectoryPage>;
    forAppointment(id: string, options?: CalendarReadOptions): Promise<CalendarParticipantsView>;
    forHold(id: string, options?: CalendarReadOptions): Promise<CalendarParticipantsView>;
    replace(id: string, references: readonly CalendarParticipantReference[], options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watchDirectory(query: CalendarParticipantDirectoryQuery, listener: (page: CalendarParticipantDirectoryPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchForAppointment(id: string, listener: (page: CalendarParticipantsView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchForHold(id: string, listener: (page: CalendarParticipantsView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly lifecycle: {
    get(options?: CalendarReadOptions): Promise<CalendarLifecyclePolicy>;
    replace(input: CalendarLifecyclePolicyInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watch(listener: (policy: CalendarLifecyclePolicy, update?: CalendarWatchUpdate) => void, options?: CalendarWatchOptions): () => void;
  };
  readonly types: {
    list(query?: CalendarAppointmentTypePageQuery, options?: CalendarReadOptions): Promise<CalendarAppointmentTypePage>;
    get(id: string, options?: CalendarReadOptions): Promise<CalendarAppointmentTypeView>;
    create(input: CalendarAppointmentTypeInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    replace(id: string, input: CalendarAppointmentTypeReplacement, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    forResource(resourceId: string, options?: CalendarReadOptions): Promise<CalendarResourceTypesView>;
    watch(query: CalendarAppointmentTypePageQuery, listener: (page: CalendarAppointmentTypePage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchType(id: string, listener: (type: CalendarAppointmentTypeView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchForResource(resourceId: string, listener: (types: CalendarResourceTypesView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly locations: {
    readonly policy: {
      get(resourceId: string, options?: CalendarReadOptions): Promise<CalendarResourceLocationPolicyView>;
      replace(resourceId: string, policy: CalendarResourceLocationPolicyInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
      watch(resourceId: string, listener: (policy: CalendarResourceLocationPolicyView, update?: CalendarWatchUpdate) => void,
        options?: CalendarWatchOptions): () => void;
    };
    forVisit(query: CalendarVisitLocationQuery, options?: CalendarReadOptions): Promise<CalendarLocationPage>;
    watchForVisit(query: CalendarVisitLocationQuery, listener: (page: CalendarLocationPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    list(query?: CalendarLocationPageQuery, options?: CalendarReadOptions): Promise<CalendarLocationPage>;
    get(id: string, options?: CalendarReadOptions): Promise<CalendarLocationView>;
    create(input: CalendarLocationInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    replace(id: string, input: CalendarLocationReplacement, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    forResource(resourceId: string, options?: CalendarReadOptions): Promise<CalendarResourceLocationsView>;
    watch(query: CalendarLocationPageQuery, listener: (page: CalendarLocationPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchLocation(id: string, listener: (location: CalendarLocationView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchForResource(resourceId: string, listener: (locations: CalendarResourceLocationsView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly holds: {
    acquire(input: CalendarHoldInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    get(id: string, options?: CalendarReadOptions): Promise<CalendarHoldView>;
    query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarHoldPage>;
    watch(query: CalendarRangeQuery, listener: (page: CalendarHoldPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    release(id: string, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    /** Consumes the caller's hold and creates an ordinary appointment in the same transaction. */
    confirm(id: string, input: CalendarHoldConfirmationInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
  };
  readonly resources: {
    list(query?: CalendarResourcePageQuery, options?: CalendarReadOptions): Promise<CalendarResourcePage>;
    create(input: CalendarResourceInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    setGrants(id: string, userId: string, grants: readonly CalendarGrant[], options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    setLocations(id: string, locationIds: readonly string[], options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    setAppointmentTypes(id: string, types: CalendarResourceTypesInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watch(query: CalendarResourcePageQuery, listener: (page: CalendarResourcePage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly availability: {
    /** Versioned source policy. Weekly UTC coverage is frozen by the canonical writer, not supplied by the browser. */
    readonly policy: {
      get(resourceId: string, options?: CalendarReadOptions): Promise<CalendarAvailabilityPolicyView>;
      replace(resourceId: string, policy: CalendarAvailabilityPolicyInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
      watch(resourceId: string, listener: (policy: CalendarAvailabilityPolicyView, update?: CalendarWatchUpdate) => void,
        options?: CalendarWatchOptions): () => void;
    };
    get(resourceId: string, options?: CalendarReadOptions): Promise<CalendarAvailabilityView>;
    replace(resourceId: string, availability: CalendarAvailabilityInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watch(resourceId: string, listener: (availability: CalendarAvailabilityView, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly blocks: {
    query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarBlockPage>;
    get(id: string, options?: CalendarReadOptions): Promise<CalendarBlockView>;
    create(block: CalendarBlockInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    reschedule(id: string, block: CalendarBlockRescheduleInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    cancel(id: string, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watch(query: CalendarRangeQuery, listener: (page: CalendarBlockPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly appointments: {
    query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarAppointmentPage>;
    /** Only all-day appointments, matched on their authoritative date labels. */
    queryDates(query: CalendarDateRangeQuery, options?: CalendarReadOptions): Promise<CalendarAppointmentPage>;
    get(id: string, options?: CalendarReadOptions): Promise<CalendarAppointmentView>;
    create(input: CalendarAppointmentCreateInput, options: CalendarAppointmentRequestOptions): Promise<CalendarCommandReceipt>;
    reviewCreate(input: CalendarAppointmentCreateInput, options: CalendarRequestOptions): Promise<CalendarOverrideReview>;
    reviewUpdate(id: string, patch: CalendarAppointmentUpdateInput, options: CalendarControlOptions): Promise<CalendarOverrideReview>;
    reschedule(id: string, input: CalendarRescheduleInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    update(id: string, input: CalendarAppointmentUpdateInput, options: CalendarAppointmentControlOptions): Promise<CalendarCommandReceipt>;
    cancel(id: string, options: CalendarCancellationOptions): Promise<CalendarCommandReceipt>;
    transitions(id: string, options?: CalendarReadOptions): Promise<CalendarAppointmentTransitions>;
    transition(id: string, input: CalendarAppointmentTransitionInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watchTransitions(id: string, listener: (transitions: CalendarAppointmentTransitions, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watchDates(query: CalendarDateRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly busy: { query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarBusyPage> };
  readonly receipts: { get(key: string, options?: CalendarReadOptions): Promise<CalendarCommandReceipt | null> };
}
