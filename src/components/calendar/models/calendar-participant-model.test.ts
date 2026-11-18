import { expect, test } from 'bun:test';
import type { CalendarCommandReceipt, CalendarParticipantReference } from '../../../calendar/contracts';
import { calendarParticipantBindingCurrent, calendarParticipantDraft, calendarParticipantDraftEqual, calendarParticipantReceiptAccepted } from './calendar-participant-model';
const ref = (userId: string): CalendarParticipantReference => ({ kind: 'guardian-user', userId });
test('participant draft shaping is bounded, detached and reference-only without carrying private picker labels', () => {
  const value = [{ ...ref('b'), name: 'DO_NOT_RETAIN' }, ref('a')], shaped = calendarParticipantDraft(value)!;
  expect(shaped).toEqual([ref('a'), ref('b')]); expect(shaped[1]).not.toBe(value[0]);
  expect(value[0]!.userId).toBe('b');
  for (const invalid of [[ref('a'), ref('a')], [ref('../private')], [ref('')], Array.from({ length: 101 }, (_, i) => ref('id-' + i)),
    [{ kind: 'patient', userId: 'a' }] as unknown as CalendarParticipantReference[]]) expect(calendarParticipantDraft(invalid)).toBeNull();
});
test('participant no-op compares canonical reference sets, never profile presentation or array order', () => {
  expect(calendarParticipantDraftEqual([ref('a'), ref('b')], [ref('b'), ref('a')])).toBe(true);
  expect(calendarParticipantDraftEqual([], [])).toBe(true);
  expect(calendarParticipantDraftEqual([ref('a')], [])).toBe(false);
  expect(calendarParticipantDraftEqual([ref('a'), ref('a')], [ref('a'), ref('a')])).toBe(false);
});
test('binding and receipt correlation use the exact appointment revision and participant operation', () => {
  expect(calendarParticipantBindingCurrent('appointment', 3, { id: 'appointment', revision: 3, participants: [] })).toBe(true);
  expect(calendarParticipantBindingCurrent('appointment', 3, { id: 'appointment', revision: 4, participants: [] })).toBe(false);
  expect(calendarParticipantBindingCurrent('appointment', 3, null)).toBe(false);
  const receipt: CalendarCommandReceipt = { requestId: 'key', operation: 'appointment.participants-changed', id: 'appointment', revision: 4, changed: true };
  expect(calendarParticipantReceiptAccepted('appointment', 3, 'key', receipt)).toBe(true);
  expect(calendarParticipantReceiptAccepted('appointment', 3, 'key', { ...receipt, changed: false, revision: 3 })).toBe(true);
  for (const invalid of [{ ...receipt, requestId: 'other' }, { ...receipt, id: 'other' }, { ...receipt, revision: 5 },
    { ...receipt, changed: false }, { ...receipt, operation: 'appointment.rescheduled' as const }]) expect(calendarParticipantReceiptAccepted('appointment', 3, 'key', invalid)).toBe(false);
});
