/** Browser-safe rich one-off drafting. Only canonical supported fields reach ONE command. */
import type { CalendarAppointmentInput, CalendarAppointmentTypePage, CalendarAppointmentUpdateInput, CalendarAppointmentView,
  CalendarParticipantReference } from '../../../calendar/contracts';
import { calendarCoreDraftChanged, calendarCoreDraftInput } from './calendar-core-type-model';
import { calendarParticipantDraft, calendarParticipantDraftEqual } from './calendar-participant-model';
import type { CalendarCoreDraft } from './calendar-workspace-model';

export interface CalendarAppointmentDraft extends Omit<CalendarCoreDraft, 'resourceId'> {
  readonly resourceIds: readonly string[];
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
}): { readonly kind: 'create'; readonly input: CalendarAppointmentInput } | { readonly kind: 'update'; readonly input: CalendarAppointmentUpdateInput }
  | { readonly error: string } {
  const ids = resources(draft.resourceIds, maxResources);
  if (!ids) return { error: `Choose between 1 and ${maxResources} distinct currently authorized calendars.` };
  if (!draft.title.trim() || draft.title.length > 512 || /[\u0000-\u001f\u007f]/.test(draft.title)) return { error: 'Enter a valid appointment title.' };
  if (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 100) return { error: 'Participant limits are unavailable.' };
  const transferred = calendarAppointmentDraftResourcesChanged(draft, record);
  const core: CalendarCoreDraft = { ...draft, resourceId: ids[0]!,
    ...(transferred && draft.appointmentType === undefined && record?.appointmentType ? { appointmentType: record.appointmentType } : {}) };
  let shaped: ReturnType<typeof calendarCoreDraftInput>;
  try { shaped = calendarCoreDraftInput({ draft: core, timeZone, types,
    record: record && transferred ? { ...record, appointmentType: undefined } : record, participantsEnabled }); }
  catch { return { error: 'Choose a supported scheduling timezone and unambiguous interval.' }; }
  if ('error' in shaped) return shaped;
  let participants: readonly CalendarParticipantReference[] | undefined;
  if (draft.participants !== undefined) {
    if (!participantsEnabled) return { error: 'Participant editing is unavailable for this opening.' };
    const refs = calendarParticipantDraft(draft.participants);
    if (!refs || refs.length > maxParticipants) return { error: `Choose at most ${maxParticipants} valid native account participants.` };
    if (record && initialParticipants == null) return { error: 'Load the exact accepted participant revision before replacing it.' };
    if (!record || !calendarParticipantDraftEqual(refs, initialParticipants!)) participants = refs;
  }
  if (shaped.kind === 'create') return { kind: 'create', input: { ...shaped.input, resourceIds: ids,
    ...(participants === undefined ? {} : { participants }) } };
  if (!record) return { error: 'Reload current appointment details before editing.' };
  return { kind: 'update', input: { ...shaped.input,
    ...(draft.title.trim() === record.title ? {} : { title: draft.title.trim() }),
    ...(transferred ? { resourceIds: ids } : {}), ...(participants === undefined ? {} : { participants }) } };
}
