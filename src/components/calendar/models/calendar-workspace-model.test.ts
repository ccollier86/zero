/** Pure in-memory adapter and receipt-fence tests; no browser, runtime store or generated fixture. */
import { expect, test } from 'bun:test';
import { calendarCoreDraftInterval, CalendarDraftReceiptFence, CalendarPendingRequestLedger, calendarDisplayDays, calendarWallTimeCandidates, calendarWorkspaceQueries, projectCalendarAppointments } from './calendar-workspace-model';
import type { CalendarAppointmentView, CalendarCommandReceipt } from '../../../calendar/contracts';
const record: CalendarAppointmentView = { id: 'appointment-a', revision: 1, resourceIds: ['resource-a', 'room-a'], title: 'Synthetic appointment',
  startAt: '2026-11-16T15:00:00.000Z', endAt: '2026-11-16T16:00:00.000Z', timeZone: 'America/New_York', bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic-user' };
const receipt: CalendarCommandReceipt = { requestId: 'same-key', operation: 'appointment.created', id: record.id, revision: 1, changed: true };
test('month view uses two bounded contiguous authoritative ranges and preserves an empty selection', () => {
  const days = calendarDisplayDays(new Date(2026, 10, 16, 12), 'month'), queries = calendarWorkspaceQueries(days, ['resource-a']);
  expect(days).toHaveLength(42); expect(queries).toHaveLength(2); expect(queries[0]!.endAt).toBe(queries[1]!.startAt);
  for (const query of queries) expect(Date.parse(query.endAt) - Date.parse(query.startAt)).toBeLessThanOrEqual(31 * 86400_000);
  expect(calendarWorkspaceQueries(days, [])).toEqual([]);
});
test('wall-time admission rejects nonexistent and ambiguous local times rather than host-zone guessing', () => {
  expect(calendarWallTimeCandidates('2026-03-08', 150, 'America/New_York')).toEqual([]);
  expect(calendarWallTimeCandidates('2026-11-01', 90, 'America/New_York')).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
  expect(calendarWallTimeCandidates('2026-11-16', 600, 'America/New_York')).toEqual(['2026-11-16T15:00:00.000Z']);
  expect(calendarCoreDraftInterval({ resourceId: 'resource-a', title: 'Title', date: '2026-11-01', start: 90, end: 150 }, 'America/New_York')).toHaveProperty('error');
});
test('a control-character title is rejected before a UI request identity could be dispatched', () => {
  expect(calendarCoreDraftInterval({ resourceId: 'resource', title: 'Synthetic\ttitle', date: '2026-11-16', start: 540, end: 600 }, 'UTC')).toHaveProperty('error');
});
test('real reservations project for each selected co-resource without fabricated people or visit metadata', () => {
  const projected = projectCalendarAppointments([record], ['resource-a', 'room-a'], ['2026-11-16'], 'America/New_York', 'day');
  expect(projected.events).toHaveLength(2); expect(projected.sourceByEventId.size).toBe(2);
  for (const event of projected.events) {
    expect(event).toMatchObject({ start: 600, end: 660, title: record.title, location: 'Unspecified', attendees: [], visitType: null, recurrence: null, sendReminder: false });
    expect(projected.sourceByEventId.get(event.id)).toBe(record);
  }
  expect(projectCalendarAppointments([record], [], ['2026-11-16'], 'America/New_York', 'day').events).toEqual([]);
});
test('managed cards display the accepted lifecycle without treating terminal outcomes as released reservations', () => {
  for (const status of ['tentative', 'completed', 'no-show'] as const) {
    const source = { ...record, lifecycle: { status, revision: 1, policyRevision: 2, reason: null } };
    const projected = projectCalendarAppointments([source], ['resource-a'], ['2026-11-16'], 'America/New_York', 'day');
    expect(projected.events[0]!.status).toBe(status);
    expect(projected.sourceByEventId.get(projected.events[0]!.id)!.status).toBe('confirmed');
  }
});
test('managed cards map explicit visit modes without inventing participants, arrival or call links', () => {
  for (const [visit, location] of [[{ mode: 'phone' as const }, 'Phone'], [{ mode: 'video' as const }, 'Telehealth'],
    [{ mode: 'in-person' as const, location: { id: 'place', revision: 1, label: 'PRIVATE_LOCATION', region: null } }, 'In-person']] as const) {
    const projected = projectCalendarAppointments([{ ...record, visit }], ['resource-a'], ['2026-11-16'], 'America/New_York', 'day');
    expect(projected.events[0]!).toMatchObject({ location, patientId: null, attendees: [] });
    expect(projected.events[0]!.visit).toBeUndefined();
  }
});
test('outside-hours, overnight, sub-minute and DST-transition records remain in the exact-instant companion list, never silently clipped', () => {
  const cases = [
    { ...record, startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z' },
    { ...record, startAt: '2026-11-16T23:00:00.000Z', endAt: '2026-11-17T08:00:00.000Z' },
    { ...record, startAt: '2026-11-16T15:00:00.001Z' },
    { ...record, startAt: '2026-11-01T05:30:00.000Z', endAt: '2026-11-01T06:45:00.000Z' },
  ];
  for (const item of cases) {
    const projected = projectCalendarAppointments([item], ['resource-a'], [item.startAt.includes('11-01') ? '2026-11-01' : '2026-11-16'], 'America/New_York', 'day');
    expect(projected.events).toEqual([]); expect(projected.supplemental).toEqual([item]);
  }
});
test('only matching original receipts may close an unchanged submitted draft', () => {
  const fence = new CalendarDraftReceiptFence(); fence.submit('same-key', 'appointment.created');
  expect(fence.accepted({ ...receipt, requestId: 'other-key' })).toEqual({ matches: false, canClose: false });
  expect(fence.accepted({ ...receipt, operation: 'appointment.cancelled' })).toEqual({ matches: false, canClose: false });
  expect(fence.accepted(receipt)).toEqual({ matches: true, canClose: true });
  fence.edit(); expect(fence.accepted(receipt)).toEqual({ matches: true, canClose: false });
  expect(() => fence.submit('new-key', 'appointment.created')).toThrow('Reconcile');
});
test('replacement openings and rejected requests never reuse the old submit owner', () => {
  const old = new CalendarDraftReceiptFence(), next = new CalendarDraftReceiptFence(); old.submit('same-key', 'appointment.rescheduled', record.id);
  expect(next.accepted(receipt)).toEqual({ matches: false, canClose: false });
  expect(old.accepted({ ...receipt, operation: 'appointment.rescheduled', id: 'other-appointment' })).toEqual({ matches: false, canClose: false });
  old.rejected(); old.submit('replacement-key', 'appointment.rescheduled', record.id);
  expect(old.accepted({ ...receipt, operation: 'appointment.rescheduled' })).toEqual({ matches: false, canClose: false });
});
test('scope-owned recovery serializes receipt reads and retains an unsettled identity after a missing receipt', () => {
  const ledger = new CalendarPendingRequestLedger(), original = { key: 'original-key', operation: 'appointment.created' as const };
  ledger.track(original); expect(ledger.beginReconciliation()).toBe(original);
  expect(ledger.beginReconciliation()).toBeNull();
  ledger.finishReconciliation({ ...original }); expect(ledger.beginReconciliation()).toBeNull();
  ledger.finishReconciliation(original); expect(ledger.beginReconciliation()).toBe(original);
  expect(ledger.settle(original)).toBe(true); ledger.finishReconciliation(original);
  expect(ledger.beginReconciliation()).toBeNull();
});
test('late receipt reads and editor callbacks cannot clear a newer unsettled mutation', () => {
  const ledger = new CalendarPendingRequestLedger(), original = { key: 'original-key', operation: 'appointment.created' as const }, next = { key: 'next-key', operation: 'appointment.cancelled' as const, id: record.id };
  ledger.track(original); expect(ledger.beginReconciliation()).toBe(original);
  expect(ledger.settle(original)).toBe(true); ledger.track(next);
  expect(ledger.settle(original)).toBe(false); expect(ledger.settle({ ...next })).toBe(false);
  ledger.finishReconciliation(original); expect(ledger.beginReconciliation()).toBe(next);
  ledger.finishReconciliation(original); expect(ledger.beginReconciliation()).toBeNull();
  ledger.finishReconciliation(next); expect(ledger.settle(next)).toBe(true);
});
