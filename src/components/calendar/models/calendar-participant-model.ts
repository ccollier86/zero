/** Browser-only draft shaping. Current target eligibility remains the native writer's final guard. */
import type { CalendarCommandReceipt, CalendarParticipantReference, CalendarParticipantsView } from '../../../calendar/contracts';

export function calendarParticipantDraft(value: readonly CalendarParticipantReference[]): readonly CalendarParticipantReference[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: CalendarParticipantReference[] = [], ids = new Set<string>();
  for (const ref of value) {
    if (!ref || ref.kind !== 'guardian-user' || typeof ref.userId !== 'string' || ref.userId.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref.userId) || ids.has(ref.userId)) return null;
    ids.add(ref.userId); result.push({ kind: 'guardian-user', userId: ref.userId });
  }
  return result.sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
}
export function calendarParticipantDraftEqual(left: readonly CalendarParticipantReference[], right: readonly CalendarParticipantReference[]): boolean {
  const a = calendarParticipantDraft(left), b = calendarParticipantDraft(right);
  return a !== null && b !== null && a.length === b.length && a.every((ref, index) => ref.userId === b[index]!.userId);
}
export function calendarParticipantBindingCurrent(id: string, revision: number, view: CalendarParticipantsView | null): boolean {
  return view !== null && view.id === id && view.revision === revision;
}
export function calendarParticipantReceiptAccepted(id: string, revision: number, key: string, receipt: CalendarCommandReceipt): boolean {
  return receipt.requestId === key && receipt.id === id && receipt.operation === 'appointment.participants-changed'
    && receipt.revision === revision + (receipt.changed ? 1 : 0);
}
