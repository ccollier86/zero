import { expect, test } from 'bun:test';
import type { CalendarAppointmentTransitions, CalendarAppointmentView } from '../../../calendar/contracts';
import { calendarTransitionAuthorityDenied, calendarTransitionCurrent, calendarTransitionInput, calendarTransitionProposal, calendarTransitionReceiptAccepted } from './calendar-transition-model';
const record: CalendarAppointmentView = { id: 'appointment', revision: 7, resourceIds: ['provider'], title: 'Synthetic appointment',
  startAt: '2030-01-01T09:00:00.000Z', endAt: '2030-01-01T10:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'user' };
const transitions: CalendarAppointmentTransitions = { id: record.id, revision: 7, policyRevision: 2, status: 'confirmed',
  allowed: [{ status: 'cancelled', requiresReason: true }] };
test('the server projection alone supplies allowed actions; mismatched identity, revision and effective status do not authorize UI commands', () => {
  expect(calendarTransitionProposal(record, transitions, 'completed')).toBeNull();
  for (const patch of [{ id: 'other' }, { revision: 8 }, { status: 'tentative' as const }]) {
    expect(calendarTransitionProposal(record, { ...transitions, ...patch }, 'cancelled')).toBeNull();
  }
  expect(calendarTransitionProposal(record, transitions, 'cancelled')).toEqual({ id: 'appointment', revision: 7, policyRevision: 2, status: 'cancelled', requiresReason: true });
});
test('policy and appointment changes require review instead of silently rebasing a reason dialog', () => {
  const proposal = calendarTransitionProposal(record, transitions, 'cancelled')!;
  expect(calendarTransitionCurrent(proposal, transitions)).toBe(true);
  for (const patch of [{ id: 'other' }, { revision: 8 }, { policyRevision: 3 }, { allowed: [] },
    { allowed: [{ status: 'cancelled' as const, requiresReason: false }] }]) expect(calendarTransitionCurrent(proposal, { ...transitions, ...patch })).toBe(false);
});
test('required reasons are bounded private input; optional blank reasons are omitted, not manufactured', () => {
  const proposal = calendarTransitionProposal(record, transitions, 'cancelled')!;
  expect(calendarTransitionInput(proposal, '  ')).toBeNull();
  expect(calendarTransitionInput(proposal, 'x'.repeat(1025))).toBeNull();
  for (const value of ['Synthetic\treason', 'Synthetic\nreason', '\u0000reason', 'reason\u007f']) expect(calendarTransitionInput(proposal, value)).toBeNull();
  expect(calendarTransitionInput(proposal, ' Synthetic reason ')).toEqual({ status: 'cancelled', policyRevision: 2, reason: 'Synthetic reason' });
  expect(calendarTransitionInput({ ...proposal, requiresReason: false }, '  ')).toEqual({ status: 'cancelled', policyRevision: 2 });
});
test('effective lifecycle status is used without mistaking the reservation status for visit progress', () => {
  const tentative = { ...record, lifecycle: { status: 'tentative' as const, revision: 6, policyRevision: 2, reason: null } };
  expect(calendarTransitionProposal(tentative, { ...transitions, status: 'tentative' }, 'cancelled')).not.toBeNull();
  expect(calendarTransitionProposal(tentative, transitions, 'cancelled')).toBeNull();
});
test('a mutation-observed access denial retires presentation before an independent live query can catch up', () => {
  for (const error of [{ status: 401, code: 'AUTH_UNAUTHORIZED' }, { status: 403, code: null },
    { status: 428, code: 'LOGGING_ADMISSION_REQUIRED' }, { status: 404, code: 'CALENDAR_NOT_FOUND' },
    { status: null, code: 'CALENDAR_FORBIDDEN' }]) expect(calendarTransitionAuthorityDenied(error)).toBe(true);
  for (const error of [{ status: 409, code: 'CALENDAR_POLICY_STALE' }, { status: 400, code: 'CALENDAR_INPUT_INVALID' },
    { status: 503, code: 'CALENDAR_OUTCOME_UNKNOWN' }]) expect(calendarTransitionAuthorityDenied(error)).toBe(false);
});
test('receipt reconciliation cannot accept a different identity, operation, target, source revision or false no-op', () => {
  const proposal = calendarTransitionProposal(record, transitions, 'cancelled')!;
  const receipt = { requestId: 'request', operation: 'appointment.transitioned' as const, id: proposal.id, revision: proposal.revision + 1, changed: true };
  expect(calendarTransitionReceiptAccepted(proposal, 'request', receipt)).toBe(true);
  for (const patch of [{ requestId: 'other' }, { id: 'other' }, { revision: 9 }, { changed: false }, { operation: 'appointment.cancelled' as const }]) {
    expect(calendarTransitionReceiptAccepted(proposal, 'request', { ...receipt, ...patch })).toBe(false);
  }
});
