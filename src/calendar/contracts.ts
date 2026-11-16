/** Internal domain contracts under implementation; not a mounted calendar service or browser API. */
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
