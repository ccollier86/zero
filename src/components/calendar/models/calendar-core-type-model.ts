/** Presentation/defaults only. Native calendar admission remains the final booking-policy authority. */
import type { CalendarAppointmentInput, CalendarAppointmentTypePage, CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot,
  CalendarAppointmentView, CalendarCommandReceipt, CalendarRescheduleInput } from '../../../calendar/contracts';
import { calendarCoreDraftInterval, calendarWallTimeCandidates, calendarZonedParts, type CalendarCoreDraft } from './calendar-workspace-model';
import { calendarVisitDraftInput } from './calendar-visit-model';
import { calendarParticipantDraft } from './calendar-participant-model';

export function calendarCoreTypeVersion(value: CalendarAppointmentTypeReference): string { return JSON.stringify([value.id, value.revision]); }
/** Detached whitelist, not a retained selector object or a mutable catalog record. */
export function calendarCoreTypeSnapshot(value: CalendarAppointmentTypeSnapshot): CalendarAppointmentTypeSnapshot {
  return { id: value.id, revision: value.revision, label: value.label, durationMinutes: value.durationMinutes,
    bufferBeforeMinutes: value.bufferBeforeMinutes, bufferAfterMinutes: value.bufferAfterMinutes, colorKey: value.colorKey };
}
export interface CalendarCoreTypeSelection { readonly current: boolean; readonly snapshot?: CalendarAppointmentTypeSnapshot; readonly accepted: boolean }
/** Only the source-accepted binding may outlive a current selector page. Unsubmitted picker history grants nothing. */
export function calendarCoreTypeSelection(draft: Pick<CalendarCoreDraft, 'appointmentType'>, page: CalendarAppointmentTypePage | null,
  accepted?: CalendarAppointmentTypeSnapshot): CalendarCoreTypeSelection {
  const selected = draft.appointmentType === undefined ? accepted : draft.appointmentType;
  if (!selected) return { current: true, accepted: false };
  const version = calendarCoreTypeVersion(selected);
  if (accepted && calendarCoreTypeVersion(accepted) === version) return { current: true, snapshot: accepted, accepted: true };
  const current = page?.items.find(item => item.active && calendarCoreTypeVersion(item) === version);
  return current ? { current: true, snapshot: current, accepted: false } : { current: false, accepted: false };
}
/** Selection is deliberate: exact buffers and a same-day, unambiguous end are defaults, never a clamp or wall-duration guess. */
export function calendarCoreTypeDefaults(draft: CalendarCoreDraft, selected: CalendarAppointmentTypeSnapshot | null, timeZone?: string):
  { change: Partial<CalendarCoreDraft>; error?: string } {
  if (selected === null) return { change: { appointmentType: null } };
  const change: Partial<CalendarCoreDraft> = { appointmentType: calendarCoreTypeSnapshot(selected),
    bufferBeforeMinutes: selected.bufferBeforeMinutes, bufferAfterMinutes: selected.bufferAfterMinutes };
  if (!timeZone) return { change, error: 'Choose a calendar before applying the type duration.' };
  const starts = calendarWallTimeCandidates(draft.date, draft.start, timeZone);
  if (starts.length !== 1) return { change, error: 'The selected type needs an unambiguous start time in the scheduling timezone.' };
  const endAt = Date.parse(starts[0]!) + selected.durationMinutes * 60_000;
  if (!Number.isFinite(endAt)) return { change, error: 'This type duration cannot be represented by the one-day editor.' };
  const end = calendarZonedParts(endAt, timeZone);
  if (end.date !== draft.date || end.minute <= draft.start || end.second !== 0) {
    return { change, error: 'This type ends outside the editor’s same-day interval. Choose an earlier start or another type; the end was not clipped.' };
  }
  const ends = calendarWallTimeCandidates(draft.date, end.minute, timeZone);
  if (ends.length !== 1 || Date.parse(ends[0]!) !== endAt) return { change,
    error: 'This type ends at an ambiguous local time. Choose another start; no daylight-saving offset is guessed.' };
  return { change: { ...change, end: end.minute } };
}
function validBuffer(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 1440; }
export type CalendarCoreDraftInput = { readonly kind: 'create'; readonly input: CalendarAppointmentInput }
  | { readonly kind: 'reschedule'; readonly input: CalendarRescheduleInput } | { readonly error: string };
/** One final whitelist. Labels, colors, snapshots, demo fields and participant writes never leak into rescheduling. */
export function calendarCoreDraftInput({ draft, timeZone, types, record, participantsEnabled = false }: {
  readonly draft: CalendarCoreDraft; readonly timeZone: string; readonly types: CalendarAppointmentTypePage | null;
  readonly record?: CalendarAppointmentView; readonly participantsEnabled?: boolean;
}): CalendarCoreDraftInput {
  const interval = calendarCoreDraftInterval(record ? { ...draft, title: record.title } : draft, timeZone);
  if ('error' in interval) return interval;
  const selected = calendarCoreTypeSelection(draft, types, record?.appointmentType);
  if (!selected.current) return { error: 'The draft type is not on this authorized page. Choose a current type or explicitly clear it before saving.' };
  const type = selected.snapshot;
  const before = draft.bufferBeforeMinutes ?? record?.bufferBeforeMinutes ?? type?.bufferBeforeMinutes ?? 0;
  const after = draft.bufferAfterMinutes ?? record?.bufferAfterMinutes ?? type?.bufferAfterMinutes ?? 0;
  if (!validBuffer(before) || !validBuffer(after)) return { error: 'Enter whole-minute buffers between 0 and 1440 minutes.' };
  if (type && (Date.parse(interval.endAt) - Date.parse(interval.startAt) !== type.durationMinutes * 60_000
    || before !== type.bufferBeforeMinutes || after !== type.bufferAfterMinutes)) {
    return { error: 'The exact duration and both buffers must match the selected type. Your manual times were preserved; review them or explicitly clear the type.' };
  }
  const visit = calendarVisitDraftInput(draft, record?.visit); if ('error' in visit) return visit;
  if (record) {
    return { kind: 'reschedule', input: { ...interval, timeZone, bufferBeforeMinutes: before, bufferAfterMinutes: after, ...visit,
      ...(draft.appointmentType === null ? { appointmentType: null } : type && !selected.accepted ? { appointmentType: { id: type.id, revision: type.revision } } : {}) } };
  }
  if (!draft.resourceId) return { error: 'Choose a currently authorized calendar.' };
  const participants = participantsEnabled && draft.participants !== undefined ? calendarParticipantDraft(draft.participants) : undefined;
  if (participants === null) return { error: 'Review the selected native account participants.' };
  return { kind: 'create', input: { resourceIds: [draft.resourceId], title: draft.title.trim(), ...interval, timeZone,
    ...(draft.bufferBeforeMinutes !== undefined ? { bufferBeforeMinutes: before } : {}),
    ...(draft.bufferAfterMinutes !== undefined ? { bufferAfterMinutes: after } : {}),
    ...(type ? { appointmentType: { id: type.id, revision: type.revision } } : {}),
    ...(visit.visit ? { visit: visit.visit } : {}), ...(participants === undefined ? {} : { participants }) } };
}
/** Meaningful dirty state; detached labels and hidden, irrelevant visit-location metadata do not make an edit. */
export function calendarCoreDraftChanged(draft: CalendarCoreDraft, initial: CalendarCoreDraft, record?: CalendarAppointmentView): boolean {
  const selected = (value: CalendarCoreDraft) => { const type = value.appointmentType === undefined ? record?.appointmentType : value.appointmentType; return type ? calendarCoreTypeVersion(type) : null; };
  const key = (value: CalendarCoreDraft) => JSON.stringify([record?.resourceIds ?? value.resourceId, record?.title ?? value.title, value.date, value.start, value.end,
    selected(value), value.bufferBeforeMinutes ?? record?.bufferBeforeMinutes ?? 0, value.bufferAfterMinutes ?? record?.bufferAfterMinutes ?? 0, value.visitMode ?? 'unspecified',
    value.visitMode === 'in-person' && value.visitLocation ? JSON.stringify([value.visitLocation.id, value.visitLocation.revision]) : null,
    record || value.participants === undefined ? null : value.participants.map(ref => [ref.kind, ref.userId]).sort((a, b) => a[1]!.localeCompare(b[1]!))]);
  return key(draft) !== key(initial);
}
/** Receipt identity alone is insufficient; an unrelated generation cannot settle this submitted revision. */
export function calendarCoreReceiptRevisionCurrent(receipt: CalendarCommandReceipt, record?: CalendarAppointmentView): boolean {
  return record ? receipt.revision === record.revision + (receipt.changed ? 1 : 0) : receipt.changed && receipt.revision === 1;
}
