/** An intent, not a committed outcome. A consuming UI can defer it for a reason/confirmation. */
import type { AppointmentStatus, EventDraft } from '../types';
import { updateAppointmentDraft } from './appointment-draft';
export interface AppointmentStatusChangeRequest {
  readonly previous: AppointmentStatus;
  readonly next: AppointmentStatus;
  readonly event: Readonly<EventDraft>;
  readonly change: Partial<EventDraft>;
}
export function appointmentStatusRequest(event: EventDraft, next: AppointmentStatus): AppointmentStatusChangeRequest | null {
  if (event.status === next) return null;
  const updated = updateAppointmentDraft(event, { status: next });
  return { previous: event.status, next, event, change: { status: next, visit: updated.visit, ...(next !== 'cancelled' ? { cancellationReason: undefined } : {}) } };
}
