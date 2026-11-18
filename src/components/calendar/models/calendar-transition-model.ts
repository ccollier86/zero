/** UI admission only. The canonical writer rechecks the same revision, policy and current rights. */
import type { CalendarAppointmentStatus, CalendarAppointmentTransitionInput, CalendarAppointmentTransitions, CalendarAppointmentView, CalendarCommandReceipt } from '../../../calendar/contracts';

export interface CalendarTransitionProposal {
  readonly id: string;
  readonly revision: number;
  readonly policyRevision: number;
  readonly status: CalendarAppointmentStatus;
  readonly requiresReason: boolean;
}
export function calendarTransitionProposal(record: CalendarAppointmentView, transitions: CalendarAppointmentTransitions,
  status: CalendarAppointmentStatus): CalendarTransitionProposal | null {
  if (transitions.id !== record.id || transitions.revision !== record.revision
    || transitions.status !== (record.lifecycle?.status ?? record.status)) return null;
  const allowed = transitions.allowed.find(item => item.status === status);
  return allowed ? { id: record.id, revision: record.revision, policyRevision: transitions.policyRevision,
    status, requiresReason: allowed.requiresReason } : null;
}
export function calendarTransitionCurrent(proposal: CalendarTransitionProposal, current: CalendarAppointmentTransitions): boolean {
  return proposal.id === current.id && proposal.revision === current.revision && proposal.policyRevision === current.policyRevision
    && current.allowed.some(item => item.status === proposal.status && item.requiresReason === proposal.requiresReason);
}
export function calendarTransitionInput(proposal: CalendarTransitionProposal, reason: string): CalendarAppointmentTransitionInput | null {
  const value = reason.trim();
  if (reason.length > 1024 || /[\u0000-\u001f\u007f]/.test(reason) || proposal.requiresReason && !value) return null;
  return { status: proposal.status, policyRevision: proposal.policyRevision, ...(value ? { reason: value } : {}) };
}
/** A mutation can observe revocation before its independent live query does. Withdraw immediately. */
export function calendarTransitionAuthorityDenied(error: { readonly code: string | null; readonly status: number | null }): boolean {
  return error.status === 401 || error.status === 403 || error.status === 428
    || error.code === 'CALENDAR_NOT_FOUND' || error.code === 'CALENDAR_FORBIDDEN'
    || error.code === 'AUTH_UNAUTHORIZED' || error.code === 'UNAUTHORIZED'
    || error.code === 'AUTH_FORBIDDEN' || error.code === 'FORBIDDEN' || error.code === 'LOGGING_ADMISSION_REQUIRED';
}
export function calendarTransitionReceiptAccepted(proposal: CalendarTransitionProposal, key: string, receipt: CalendarCommandReceipt): boolean {
  return receipt.requestId === key && receipt.id === proposal.id && receipt.operation === 'appointment.transitioned'
    && receipt.changed && receipt.revision === proposal.revision + 1;
}
