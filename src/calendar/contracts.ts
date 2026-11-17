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
  readonly operation: 'resource.created' | 'resource.grant-changed' | 'appointment.created' | 'appointment.rescheduled' | 'appointment.cancelled';
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
  readonly resources: {
    list(query?: CalendarResourcePageQuery, options?: CalendarReadOptions): Promise<CalendarResourcePage>;
    create(input: CalendarResourceInput, options: CalendarRequestOptions): Promise<CalendarCommandReceipt>;
    setGrants(id: string, userId: string, grants: readonly CalendarGrant[], options: CalendarControlOptions): Promise<CalendarCommandReceipt>;
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
