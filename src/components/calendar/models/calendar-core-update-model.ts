/** Connected editor adapter for ONE native atomic update. It never chains writes. */
import type { CalendarAppointmentTypePage, CalendarAppointmentUpdateInput, CalendarAppointmentView } from '../../../calendar/contracts';
import type { CalendarCoreDraft } from './calendar-workspace-model';
import { calendarCoreDraftChanged, calendarCoreDraftInput } from './calendar-core-type-model';

/** Multi-resource assignments are preserved by this single-calendar control;
 * callers needing an arbitrary set use the native update API. */
export function calendarCoreEditResources(draft: CalendarCoreDraft, record?: CalendarAppointmentView): readonly string[] {
  return record && record.resourceIds.length > 1 ? record.resourceIds : draft.resourceId ? [draft.resourceId] : [];
}
export function calendarCoreEditAssignmentChanged(draft: CalendarCoreDraft, record?: CalendarAppointmentView): boolean {
  return !!record && record.resourceIds.length === 1 && draft.resourceId !== record.resourceIds[0];
}
export function calendarCoreEditChanged(draft: CalendarCoreDraft, initial: CalendarCoreDraft, record?: CalendarAppointmentView): boolean {
  return calendarCoreDraftChanged(draft, initial, record) || !!record && (
    draft.title.trim() !== initial.title.trim() || record.resourceIds.length === 1 && draft.resourceId !== initial.resourceId);
}
export function calendarCoreUpdateDraftInput(input: {
  readonly draft: CalendarCoreDraft; readonly timeZone: string; readonly types: CalendarAppointmentTypePage | null;
  readonly record: CalendarAppointmentView;
}): { readonly kind: 'update'; readonly input: CalendarAppointmentUpdateInput } | { readonly error: string } {
  const { draft, record } = input;
  if (!draft.title.trim() || draft.title.length > 512 || /[\u0000-\u001f\u007f]/.test(draft.title)) return { error: 'Enter a valid appointment title.' };
  if (!draft.resourceId) return { error: 'Choose a currently authorized calendar.' };
  if (record.resourceIds.length > 1 && draft.resourceId !== record.resourceIds[0]) return {
    error: 'This appointment has multiple reserved resources. Its resource set must be edited together through the native calendar API.' };
  const transfer = calendarCoreEditAssignmentChanged(draft, record);
  // Historical acceptance is not admission on a newly selected calendar. Keep
  // the preserved type visible as a candidate and validate it on the new page.
  const candidate = transfer && draft.appointmentType === undefined && record.appointmentType
    ? { ...draft, appointmentType: record.appointmentType } : draft;
  const base = calendarCoreDraftInput({ ...input, draft: candidate,
    record: transfer ? { ...record, appointmentType: undefined } : record });
  if ('error' in base) return base;
  if (base.kind !== 'reschedule') return { error: 'Reload current appointment details before editing.' };
  return { kind: 'update', input: { ...base.input,
    ...(draft.title.trim() === record.title ? {} : { title: draft.title.trim() }),
    ...(calendarCoreEditAssignmentChanged(draft, record) ? { resourceIds: [draft.resourceId] } : {}) } };
}
