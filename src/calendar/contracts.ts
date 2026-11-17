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
  readonly operation: 'resource.created' | 'resource.grant-changed' | 'resource.availability-changed'
    | 'appointment.created' | 'appointment.rescheduled' | 'appointment.cancelled'
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
export interface CalendarReadOptions { readonly signal?: AbortSignal }
export interface CalendarResourcePageQuery {
  readonly limit?: number;
  readonly after?: string;
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
    cancel(id: string, options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
    watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void,
      options?: CalendarWatchOptions): () => void;
  };
  readonly busy: { query(query: CalendarRangeQuery, options?: CalendarReadOptions): Promise<CalendarBusyPage> };
  readonly receipts: { get(key: string, options?: CalendarReadOptions): Promise<CalendarCommandReceipt | null> };
}
