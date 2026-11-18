/** Source-only receipt recovery; no runtime database, process, browser or generated output. */
import { expect, test } from 'bun:test';
import type { CalendarCommandReceipt } from '../../../calendar/contracts';
import { CalendarPendingRequestLedger, calendarPendingReceiptMatches, type CalendarPendingRequest } from './calendar-workspace-model';

const created: CalendarPendingRequest = { key: 'original-create', operation: 'appointment.created' };
const createReceipt: CalendarCommandReceipt = { requestId: created.key, operation: created.operation, id: 'appointment-a', revision: 1, changed: true };

test('creation recovery accepts only its original key, operation and genuine first accepted revision', () => {
  expect(calendarPendingReceiptMatches(created, createReceipt)).toBe(true);
  for (const replacement of [
    { requestId: 'different-key' }, { operation: 'appointment.rescheduled' as const }, { revision: 2 }, { changed: false },
    { revision: 0 }, { revision: -1 }, { revision: 1.5 }, { revision: NaN }, { revision: Infinity },
  ]) expect(calendarPendingReceiptMatches(created, { ...createReceipt, ...replacement })).toBe(false);
  expect(calendarPendingReceiptMatches({ ...created, id: 'known-created-target' }, createReceipt)).toBe(false);
});

for (const operation of ['appointment.rescheduled', 'appointment.participants-changed'] as const) {
  test(`${operation} recovery distinguishes changed and quiet no-op revisions without consulting later object state`, () => {
    const request: CalendarPendingRequest = { key: 'original-mutation', operation, id: 'appointment-a', expectedRevision: 4 };
    const receipt: CalendarCommandReceipt = { requestId: request.key, operation, id: 'appointment-a', revision: 5, changed: true };
    expect(calendarPendingReceiptMatches(request, receipt)).toBe(true);
    expect(calendarPendingReceiptMatches(request, { ...receipt, revision: 4, changed: false })).toBe(true);
    expect(calendarPendingReceiptMatches(request, { ...receipt, revision: 4 })).toBe(false);
    expect(calendarPendingReceiptMatches(request, { ...receipt, changed: false })).toBe(false);
    for (const revision of [1, 3, 6, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 4.5]) {
      expect(calendarPendingReceiptMatches(request, { ...receipt, revision })).toBe(false);
    }
    expect(calendarPendingReceiptMatches(request, { ...receipt, id: 'another-appointment' })).toBe(false);
    expect(calendarPendingReceiptMatches(request, { ...receipt, requestId: 'another-key' })).toBe(false);
    expect(calendarPendingReceiptMatches(request, { ...receipt, operation: 'appointment.cancelled' })).toBe(false);
    for (const expectedRevision of [undefined, 0, -1, 4.5, NaN, Infinity]) {
      expect(calendarPendingReceiptMatches({ ...request, expectedRevision }, receipt)).toBe(false);
    }
  });
}

test('status changes require the exact next accepted generation; no-op acknowledgment cannot settle them', () => {
  const request: CalendarPendingRequest = { key: 'status-key', operation: 'appointment.transitioned', id: 'appointment-a', expectedRevision: 7 };
  const receipt: CalendarCommandReceipt = { requestId: request.key, operation: request.operation, id: request.id!, revision: 8, changed: true };
  expect(calendarPendingReceiptMatches(request, receipt)).toBe(true);
  expect(calendarPendingReceiptMatches(request, { ...receipt, revision: 7, changed: false })).toBe(false);
  expect(calendarPendingReceiptMatches(request, { ...receipt, changed: false })).toBe(false);
  expect(calendarPendingReceiptMatches(request, { ...receipt, revision: 9 })).toBe(false);
});

test('malformed missing-target mutation identity cannot settle an arbitrary matching receipt', () => {
  const request: CalendarPendingRequest = { key: 'mutation-key', operation: 'appointment.participants-changed', expectedRevision: 4 };
  expect(calendarPendingReceiptMatches(request, { requestId: request.key, operation: request.operation, id: 'arbitrary-target', revision: 5, changed: true })).toBe(false);
});

test('a nonmatching receipt leaves its owner unsettled and concurrent replacement cannot be erased by an old successful read', () => {
  const ledger = new CalendarPendingRequestLedger(), older: CalendarPendingRequest = {
    key: 'older-participant-key', operation: 'appointment.participants-changed', id: 'appointment-a', expectedRevision: 4,
  };
  ledger.track(older);
  const read = ledger.beginReconciliation()!;
  expect(read).toBe(older);
  const impossible: CalendarCommandReceipt = { requestId: older.key, operation: older.operation, id: older.id!, revision: 9, changed: true };
  expect(calendarPendingReceiptMatches(read, impossible)).toBe(false);
  ledger.finishReconciliation(read);
  expect(ledger.beginReconciliation()).toBe(older);
  ledger.finishReconciliation(read);
  const newer: CalendarPendingRequest = { key: 'newer-key', operation: 'appointment.rescheduled', id: 'appointment-b', expectedRevision: 11 };
  ledger.track(newer);
  const olderAccepted = { ...impossible, revision: 5 };
  expect(calendarPendingReceiptMatches(read, olderAccepted)).toBe(true);
  expect(ledger.settle(read)).toBe(false);
  expect(ledger.settle({ ...newer })).toBe(false);
  expect(ledger.beginReconciliation()).toBe(newer);
  ledger.finishReconciliation(newer);
  expect(ledger.settle(newer)).toBe(true);
  expect(ledger.beginReconciliation()).toBeNull();
});
