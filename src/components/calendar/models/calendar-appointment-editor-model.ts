/** Browser-safe rich one-off drafting. Only canonical supported fields reach ONE command. */
import type { CalendarAppointmentCreateInput, CalendarAppointmentTypePage, CalendarAppointmentUpdateInput, CalendarAppointmentView,
  CalendarParticipantReference } from '../../../calendar/contracts';
import { calendarCoreDraftChanged, calendarCoreDraftInput } from './calendar-core-type-model';
import { calendarParticipantDraft, calendarParticipantDraftEqual } from './calendar-participant-model';
import { calendarVisitDraftInput } from './calendar-visit-model';
import { calendarDateOrdinal, calendarLocalDate } from './calendar-local-date';
import type { CalendarCoreDraft } from './calendar-workspace-model';

export interface CalendarAppointmentDraft extends Omit<CalendarCoreDraft, 'resourceId'> {
  readonly resourceIds: readonly string[];
  /** Omission retains the legacy timed draft and wire shape. All-day end is exclusive. */
  readonly intervalKind?: 'timed-v1' | 'all-day-local-v1';
  readonly endDate?: string;
}
export interface CalendarAppointmentEditorSession {
  readonly key: number | string;
  readonly initial: CalendarAppointmentDraft;
  /** Scheduling zone is explicit and stable for this opening; changing resource sets never guesses another zone. */
  readonly timeZone: string;
  readonly trigger?: HTMLElement;
  readonly record?: CalendarAppointmentView;
}
function resources(value: readonly string[], maximum = 16): readonly string[] | null {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16 || !Array.isArray(value) || !value.length || value.length > maximum
    || value.some(id => typeof id !== 'string' || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))
    || new Set(value).size !== value.length) return null;
  return [...value].sort();
}
function equalResources(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].sort(), right = [...b].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
export function calendarAppointmentDraftResourcesChanged(draft: CalendarAppointmentDraft, record?: CalendarAppointmentView): boolean {
  return !!record && !equalResources(draft.resourceIds, record.resourceIds);
}
export function calendarAppointmentDraftChanged(draft: CalendarAppointmentDraft, initial: CalendarAppointmentDraft, record?: CalendarAppointmentView): boolean {
  if ((draft.intervalKind ?? 'timed-v1') !== (initial.intervalKind ?? 'timed-v1')) return true;
  if (draft.intervalKind === 'all-day-local-v1') {
    const key = (value: CalendarAppointmentDraft) => JSON.stringify([value.resourceIds.slice().sort(), value.title.trim(), value.date, value.endDate,
      (value.appointmentType === undefined ? record?.appointmentType : value.appointmentType)?.id ?? null,
      (value.appointmentType === undefined ? record?.appointmentType : value.appointmentType)?.revision ?? null,
      value.visitMode ?? 'unspecified', value.visitMode === 'in-person' && value.visitLocation ? [value.visitLocation.id, value.visitLocation.revision] : null]);
    return key(draft) !== key(initial) || !calendarParticipantDraftEqual(draft.participants ?? [], initial.participants ?? []);
  }
  return !equalResources(draft.resourceIds, initial.resourceIds) || draft.title.trim() !== initial.title.trim()
    || calendarCoreDraftChanged({ ...draft, resourceId: draft.resourceIds[0] ?? '' }, { ...initial, resourceId: initial.resourceIds[0] ?? '' }, record)
    || !calendarParticipantDraftEqual(draft.participants ?? [], initial.participants ?? []);
}
export function calendarAppointmentDraftInput({ draft, timeZone, types, record, participantsEnabled = false, initialParticipants,
  maxResources = 16, maxParticipants = 100 }: {
  readonly draft: CalendarAppointmentDraft; readonly timeZone: string; readonly types: CalendarAppointmentTypePage | null;
  readonly record?: CalendarAppointmentView; readonly participantsEnabled?: boolean;
  readonly initialParticipants?: readonly CalendarParticipantReference[] | null;
  readonly maxResources?: number; readonly maxParticipants?: number;
}): { readonly kind: 'create'; readonly input: CalendarAppointmentCreateInput } | { readonly kind: 'update'; readonly input: CalendarAppointmentUpdateInput }
  | { readonly error: string } {
  const ids = resources(draft.resourceIds, maxResources);
  if (!ids) return { error: `Choose between 1 and ${maxResources} distinct currently authorized calendars.` };
  if (!draft.title.trim() || draft.title.length > 512 || /[\u0000-\u001f\u007f]/.test(draft.title)) return { error: 'Enter a valid appointment title.' };
  if (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 100) return { error: 'Participant limits are unavailable.' };
  const transferred = calendarAppointmentDraftResourcesChanged(draft, record);
  const core: CalendarCoreDraft = { ...draft, resourceId: ids[0]!,
    ...(transferred && draft.appointmentType === undefined && record?.appointmentType ? { appointmentType: record.appointmentType } : {}) };
  let participants: readonly CalendarParticipantReference[] | undefined;
  if (draft.participants !== undefined) {
    if (!participantsEnabled) return { error: 'Participant editing is unavailable for this opening.' };
    const refs = calendarParticipantDraft(draft.participants);
    if (!refs || refs.length > maxParticipants) return { error: `Choose at most ${maxParticipants} valid native account participants.` };
    if (record && initialParticipants == null) return { error: 'Load the exact accepted participant revision before replacing it.' };
    if (!record || !calendarParticipantDraftEqual(refs, initialParticipants!)) participants = refs;
  }
  if (draft.intervalKind === 'all-day-local-v1') {
    const selected = draft.appointmentType === undefined ? record?.appointmentType : draft.appointmentType;
    if (selected) return { error: 'Explicitly clear the appointment type before choosing all-day. All-day appointments are untyped.' };
    if (!calendarLocalDate(draft.date) || !calendarLocalDate(draft.endDate)) return { error: 'Choose valid four-digit Gregorian start and exclusive end dates.' };
    const length = calendarDateOrdinal(draft.endDate!) - calendarDateOrdinal(draft.date);
    if (length < 1 || length > 31) return { error: 'Choose an exclusive end date 1 to 31 calendar days after the start date.' };
    const visit = calendarVisitDraftInput(draft, record?.visit); if ('error' in visit) return visit;
    const interval = { kind: 'all-day-local-v1' as const, startDate: draft.date, endDate: draft.endDate!, timeZone };
    if (!record) return { kind: 'create', input: { resourceIds: ids, title: draft.title.trim(), interval,
      ...(visit.visit ? { visit: visit.visit } : {}), ...(participants === undefined ? {} : { participants }) } };
    const unchanged = record.interval?.startDate === interval.startDate && record.interval.endDate === interval.endDate && record.interval.timeZone === interval.timeZone;
    const fields = { ...(!record.interval ? { appointmentType: null } : {}), ...visit,
      ...(draft.title.trim() === record.title ? {} : { title: draft.title.trim() }),
      ...(transferred ? { resourceIds: ids } : {}), ...(participants === undefined ? {} : { participants }) };
    return unchanged ? { kind: 'update', input: fields } : { kind: 'update', input: { ...fields, interval } };
  }
  let shaped: ReturnType<typeof calendarCoreDraftInput>;
  try { shaped = calendarCoreDraftInput({ draft: core, timeZone, types,
    record: record && transferred ? { ...record, appointmentType: undefined } : record, participantsEnabled }); }
  catch { return { error: 'Choose a supported scheduling timezone and unambiguous interval.' }; }
  if ('error' in shaped) return shaped;
  if (shaped.kind === 'create') return { kind: 'create', input: { ...shaped.input, resourceIds: ids,
    ...(participants === undefined ? {} : { participants }) } };
  if (!record) return { error: 'Reload current appointment details before editing.' };
  if (record.interval) {
    const { startAt, endAt, timeZone: zone, bufferBeforeMinutes, bufferAfterMinutes, ...fields } = shaped.input;
    return { kind: 'update', input: { ...fields,
      interval: { kind: 'timed-v1', startAt, endAt, timeZone: zone, bufferBeforeMinutes: bufferBeforeMinutes ?? 0, bufferAfterMinutes: bufferAfterMinutes ?? 0 },
      ...(draft.title.trim() === record.title ? {} : { title: draft.title.trim() }),
      ...(transferred ? { resourceIds: ids } : {}), ...(participants === undefined ? {} : { participants }) } };
  }
  return { kind: 'update', input: { ...shaped.input,
    ...(draft.title.trim() === record.title ? {} : { title: draft.title.trim() }),
    ...(transferred ? { resourceIds: ids } : {}), ...(participants === undefined ? {} : { participants }) } };
}
