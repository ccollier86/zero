/** Private, scope-admitted calendar contracts shared by native server and browser facades. */
export interface CalendarActor {
  readonly scopeId: string;
  readonly userId: string;
  readonly principal: string;
  /** Trusted service-admitted capability, never selected by HTTP input. */
  readonly manageAll: boolean;
  readonly createOwn: boolean;
}
export type CalendarResourceKind = 'person' | 'room' | 'equipment';
export type CalendarVisitMode = 'in-person' | 'video' | 'phone';
export interface CalendarLocationReference { readonly id: string; readonly revision: number }
export interface CalendarLocationSnapshot extends CalendarLocationReference { readonly label: string; readonly region: string | null }
/** No provider URLs or manual addresses. Omission means an unspecified visit, not inferred telehealth. */
export type CalendarVisitInput = { readonly mode: 'in-person'; readonly location: CalendarLocationReference }
  | { readonly mode: 'video' | 'phone' };
export type CalendarVisitSnapshot = { readonly mode: 'in-person'; readonly location: CalendarLocationSnapshot }
  | { readonly mode: 'video' | 'phone' };
export interface CalendarVisitLocationQuery extends CalendarLocationPageQuery { readonly resourceIds: readonly string[] }
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
/** Safe operation outcome only. Reconciliation must not replay an old private appointment snapshot. */
export interface CalendarCommandReceipt {
  readonly requestId: string;
  readonly operation: 'resource.created' | 'resource.grant-changed' | 'resource.availability-changed' | 'resource.locations-changed'
    | 'location.created' | 'location.updated'
    | 'type.created' | 'type.updated' | 'resource.types-changed'
    | 'appointment.created' | 'appointment.rescheduled' | 'appointment.cancelled' | 'appointment.transitioned'
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

export interface CalendarResourceInput {
  readonly label: string;
  readonly kind: CalendarResourceKind;
  readonly ownerId?: string | null;
  readonly timeZone: string;
}
export interface CalendarAppointmentInput {
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
export interface CalendarRequestOptions {
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
}
export interface CalendarControlOptions extends CalendarRequestOptions {
  readonly expectedRevision: number;
}
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
    get(id: string, options?: CalendarReadOptions): Promise<CalendarAppointmentView>;
    create(input: CalendarAppointmentInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    reschedule(id: string, input: CalendarRescheduleInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    cancel(id: string, options: CalendarCancellationOptions): Promise<CalendarCommandReceipt>;
    transitions(id: string, options?: CalendarReadOptions): Promise<CalendarAppointmentTransitions>;
    transition(id: string, input: CalendarAppointmentTransitionInput, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watchTransitions(id: string, listener: (transitions: CalendarAppointmentTransitions, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
    watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly busy: { query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarBusyPage> };
  readonly receipts: { get(key: string, options?: CalendarReadOptions): Promise<CalendarCommandReceipt | null> };
}
