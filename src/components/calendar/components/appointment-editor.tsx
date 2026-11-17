/** Behavior adapter around the recovered compact modal. Keep its appearance and options. */
import { useRef, useState } from 'react';
import { Text } from './calendar-ui';
import { IconWand } from './calendar-icons';
import { AppointmentModal } from '../recovered/appointment-modal/components/appointment-modal/AppointmentModal';
import type { AppointmentFormValues } from '../recovered/appointment-modal/types/index';
import { conflictingEvents, formatMinute, inputTime, minuteFromInput, sameDraft, validateDraft } from '../models/calendar-model';
import { DAY_END, DAY_START, SLOT_MINUTES, type CalendarResource, type EditorSession, type EventDraft, type ScheduleEvent } from '../types';
import type { CalendarLocation } from '../models/calendar-geography';
import type { AppointmentAttendee } from '../models/attendee-model';
import { AttendeePicker } from './attendee-picker';
import { AppointmentTypePicker } from './appointment-type-picker';
import { RepeatPicker } from './repeat-picker';
import { TimePicker } from './time-picker';
import { cloneRepeat, repeatPresets } from '../models/recurrence-model';
import { updateAppointmentDraft } from '../models/appointment-draft';
import { AppointmentAppearancePicker, AppointmentWorkflowFields } from './appointment-controls';
import { appearanceOf, eventColor, visitOf } from '../models/appointment-presentation';
import { CancelEventDialog } from './cancel-event-dialog';

interface Props {
  session: EditorSession;
  resources: readonly CalendarResource[];
  events: readonly ScheduleEvent[];
  onClose(): void;
  onSave(draft: EventDraft): string | null;
  onCancel?(): void;
  opened?: boolean;
  locations?: readonly CalendarLocation[];
  locationsForResource?(resourceId: string): readonly string[];
  attendeeDirectory?: readonly AppointmentAttendee[];
  clinical?: boolean;
  colorBy?: 'calendar' | 'type';
}
const locationValues = { Telehealth: 'telehealth', 'In-person': 'in-person', Phone: 'phone', Unspecified: 'unspecified' } as const;
const locationLabels = { telehealth: 'Telehealth', 'in-person': 'In-person', phone: 'Phone', unspecified: 'Unspecified' } as const;
const times = Array.from({ length: (DAY_END - DAY_START) / SLOT_MINUTES + 1 }, (_, i) => DAY_START + i * SLOT_MINUTES);
function valuesOf(draft: EventDraft, locations: readonly CalendarLocation[]): AppointmentFormValues {
  return { title: draft.title, date: draft.date, providerId: draft.resourceId, patientId: draft.patientId, visitType: draft.visitType, recurrence: draft.recurrence ? 'custom' : 'none', location: locationValues[draft.location], notes: draft.notes, reminder: draft.reminder, sendReminder: draft.sendReminder, status: draft.status, siteId: draft.kind === 'block' ? null : draft.siteId === undefined ? locations[0]?.id ?? null : draft.siteId };
}
export function AppointmentEditor({ session, resources, events, onClose, onSave, onCancel, opened = true, locations = [], locationsForResource = () => [], attendeeDirectory = [], clinical = true, colorBy = 'calendar' }: Props) {
  const [draft, setDraft] = useState<EventDraft>(() => ({ ...session.initial, recurrence: cloneRepeat(session.initial.recurrence), attendees: session.initial.attendees.map(person => ({ ...person })), appearance: appearanceOf(session.initial), visit: visitOf(session.initial) }));
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [repeatOpened, setRepeatOpened] = useState(false);
  const [appearanceOpened, setAppearanceOpened] = useState(false);
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const submitting = useRef(false);
  const siteOptions = locations.filter(location => locationsForResource(draft.resourceId).includes(location.id));
  const formValue = valuesOf(draft, siteOptions);
  const invalid = validateDraft(draft, resources) ?? (draft.kind === 'appointment' && locations.length > 0 && !siteOptions.some(site => site.id === formValue.siteId) ? 'Choose an office assigned to this provider.' : null), overlaps = conflictingEvents(draft, events, session.eventId);
  const changed = !session.eventId || !sameDraft(draft, session.initial);
  const blocked = overlaps.some(event => event.kind === 'block');
  const warning = !overlaps.length ? undefined : draft.kind === 'block'
    ? `This block overlaps ${overlaps.length} existing ${overlaps.length === 1 ? 'event' : 'events'}. They are not cancelled or moved. Availability is not enforced in this UI prototype.`
    : blocked ? 'This time is blocked on the selected calendar. This UI prototype warns about the conflict; it does not enforce availability yet.'
    : `Overlaps ${overlaps.length} other ${overlaps.length === 1 ? 'appointment' : 'appointments'} on this calendar. Overlaps are allowed in this UI prototype.`;
  function change(partial: Partial<AppointmentFormValues>) {
    setDraft(current => {
      const value = { ...valuesOf(current, locations.filter(location => locationsForResource(current.resourceId).includes(location.id))), ...partial };
      const eligible = locations.filter(location => locationsForResource(value.providerId).includes(location.id));
      if (partial.providerId && !eligible.some(site => site.id === value.siteId)) value.siteId = eligible.length === 1 ? eligible[0]!.id : null;
      const preset = partial.recurrence === undefined ? undefined : repeatPresets(value.date).find(item => item.id === partial.recurrence);
      return updateAppointmentDraft(current, { ...(partial.title !== undefined ? { title: value.title } : {}), date: value.date, resourceId: value.providerId, patientId: value.patientId, visitType: value.visitType, recurrence: preset ? cloneRepeat(preset.rule) : current.recurrence, location: locationLabels[value.location as keyof typeof locationLabels], notes: value.notes, reminder: value.reminder as EventDraft['reminder'], sendReminder: value.sendReminder, status: value.status as EventDraft['status'], siteId: current.kind === 'block' ? null : value.siteId });
    });
    setError(null);
  }
  function update(changes: Partial<EventDraft>) { setDraft(current => updateAppointmentDraft(current, changes)); setError(null); }
  function commitStart(start: number) {
    if (!Number.isInteger(start) || start < DAY_START || start >= DAY_END) return;
    setDraft(current => current.end <= start ? { ...current, end: Math.min(start + 60, DAY_END) } : current);
  }
  function submit() {
    if (!changed || submitting.current) return false;
    if (invalid) { setError(invalid); return false; }
    submitting.current = true;
    try { const rejected = onSave({ ...draft, siteId: formValue.siteId }); setError(rejected); return !rejected; } finally { submitting.current = false; }
  }
  const subject = draft.kind === 'block' ? 'Time Block' : 'Appointment';
  const heading = session.intent === 'reschedule' ? `Reschedule ${subject}` : session.intent === 'duplicate' ? `Duplicate ${subject}` : session.intent === 'status' ? 'Change Appointment Status' : undefined;
  return <><AppointmentModal
    opened={opened} onClose={onClose}
    isAddMode={!session.eventId}
    event={{ id: session.eventId ?? 'draft', title: draft.title, start: draft.start / 60, end: draft.end / 60, meta: draft.location, color: 'var(--calendar-color-blue-6)', background: 'var(--calendar-color-blue-1)' }}
    providerOptions={resources.map(resource => ({ value: resource.id, label: resource.name }))}
    selectedStartTime={Number.isFinite(draft.start) ? inputTime(draft.start) : null}
    selectedEndTime={Number.isFinite(draft.end) ? inputTime(draft.end) : null}
    startTimeOptions={times.filter(time => time < DAY_END).map(time => ({ value: inputTime(time), label: formatMinute(time) }))}
    endTimeOptions={times.filter(time => time > draft.start).map(time => ({ value: inputTime(time), label: formatMinute(time) }))}
    onStartTimeChange={value => {
      if (!value) return;
      const start = minuteFromInput(value);
      setDraft(current => ({ ...current, start, end: current.end > start ? current.end : Math.min(start + 60, DAY_END) }));
      setError(null);
    }}
    onEndTimeChange={value => { if (value) { setDraft(current => ({ ...current, end: minuteFromInput(value) })); setError(null); } }}
    form={{
      value: formValue, onChange: change, onSubmit: submit, kind: draft.kind, heading, trigger: session.trigger,
      appearanceControl: <AppointmentAppearancePicker event={draft} colorBy={colorBy} effectiveColor={eventColor(draft, resources.find(resource => resource.id === draft.resourceId), colorBy)} onChange={update} onOpenChange={setAppearanceOpened} />,
      workflowControl: <div className="appointment-editor-workflow"><AppointmentWorkflowFields event={draft} clinical={clinical} onChange={update} onStatusChangeRequested={request => { if (request.next === 'cancelled') setCancellationRequested(true); else update(request.change); }} /></div>,
      siteOptions: siteOptions.map(site => ({ value: site.id, label: `${site.name}, ${site.state}` })),
      attendeeControl: <AttendeePicker value={draft.attendees} directory={attendeeDirectory} onChange={attendees => update({ attendees })} />,
      repeatControl: <RepeatPicker value={draft.recurrence} start={draft.date} onChange={recurrence => update({ recurrence })} onOpenChange={setRepeatOpened} />,
      closeOnEscape: !repeatOpened && !appearanceOpened,
      timeControls: <><TimePicker label="Start time" value={draft.start} options={times.filter(time => time < DAY_END)} onChange={start => update({ start })} onCommit={commitStart} /><Text size="xs" c="dimmed">→</Text><TimePicker label="End time" value={draft.end} options={times.filter(time => !Number.isFinite(draft.start) || time > draft.start)} onChange={end => update({ end })} /></>,
      appointmentTypeControl: <AppointmentTypePicker value={draft.visitType} customLabel={draft.customVisitType} onChange={(visitType, customVisitType) => update({ visitType, customVisitType })} />,
      titleHelper: draft.kind === 'appointment' && <div className={`appointment-title-helper ${draft.titleMode === 'automatic' ? 'is-auto' : ''}`}><IconWand size="var(--calendar-size-10)" />{draft.titleMode === 'automatic' ? <span>Automatic title · follows type & invitees</span> : <><span>Custom title ·</span><button type="button" onClick={() => update({ titleMode: 'automatic' })}>Use automatic title</button></>}</div>,
      submitDisabled: !changed || !!invalid,
      error: error ?? (invalid && draft.title.trim() ? invalid : null), warning,
      notice: hint || (draft.recurrence ? 'Repeat preference is saved locally; recurring occurrences are not generated yet.' : draft.kind === 'block' ? 'Local preview only · no appointments are moved.' : 'Local preview only · no invitations or reminders are sent.'),
      onCancelAppointment: onCancel,
      onPreviewTelehealth: () => setHint('Telehealth is a preview placeholder. No external video service is connected.'),
    }}
  />{cancellationRequested && <CancelEventDialog event={{ ...draft, id: session.eventId ?? 'unsaved-draft' }} onClose={() => setCancellationRequested(false)} onConfirm={reason => { update({ status: 'cancelled', cancellationReason: reason }); }} />}</>;
}
