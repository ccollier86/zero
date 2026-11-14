/** Pure UI policy, not a scheduling authority or clinical state machine. */
import { appointmentTypes } from './appointment-types';
import type { AppointmentAppearance, AppointmentColor, AppointmentStatus, CalendarResource, CalendarUiOptions, EventDraft, ScheduleEvent, VisitProgress, VisitStage, WaitingRoom } from '../types';

export const appointmentColors: readonly AppointmentColor[] = ['automatic', 'blue', 'violet', 'teal', 'orange', 'pink', 'grape'];
export const attentionReasons = [
  { value: 'none', label: 'No attention needed', hint: 'Use the regular pastel shade.' },
  { value: 'needs-review', label: 'Needs review', hint: 'A scheduler needs to review this appointment.' },
  { value: 'missing-details', label: 'Missing details', hint: 'Something needs to be completed before the visit.' },
  { value: 'running-late', label: 'Running late', hint: 'The appointment is running behind schedule.' },
] as const;
export const visitStages: readonly { value: VisitStage; label: string; short: string }[] = [
  { value: 'scheduled', label: 'Scheduled', short: 'Scheduled' },
  { value: 'checked-in', label: 'Checked in', short: 'Checked in' },
  { value: 'waiting', label: 'In waiting room', short: 'Waiting' },
  { value: 'triage', label: 'In triage', short: 'Triage' },
  { value: 'in-session', label: 'In session', short: 'In session' },
];
export const statusOptions: readonly { value: AppointmentStatus; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed' }, { value: 'tentative', label: 'Unconfirmed' },
  { value: 'completed', label: 'Completed' }, { value: 'no-show', label: 'No-show' }, { value: 'cancelled', label: 'Cancelled' },
];
export function appearanceOf(event: Pick<EventDraft, 'appearance'>): AppointmentAppearance {
  return { color: event.appearance?.color ?? 'automatic', attention: event.appearance?.attention ?? 'none' };
}
export function visitOf(event: Pick<EventDraft, 'visit'>): VisitProgress {
  return { stage: event.visit?.stage ?? 'scheduled', waitingRoom: event.visit?.waitingRoom ?? 'none', arrivedAt: event.visit?.arrivedAt ?? null };
}
export function isEnded(status: AppointmentStatus) { return ['completed', 'cancelled', 'no-show'].includes(status); }
export function statusLabel(status: AppointmentStatus) { return statusOptions.find(option => option.value === status)?.label ?? status; }
export function progressLabel(event: Pick<EventDraft, 'status' | 'visit'>, clinical = true): string {
  if (isEnded(event.status)) return statusLabel(event.status);
  const visit = visitOf(event);
  if (!clinical || visit.stage === 'scheduled') return statusLabel(event.status);
  if (visit.stage === 'waiting') return visit.waitingRoom === 'virtual' ? 'Virtual lobby' : visit.waitingRoom === 'office' ? 'Office lobby' : 'Waiting';
  return visitStages.find(stage => stage.value === visit.stage)!.label;
}
export function eventColor(event: Pick<EventDraft, 'appearance' | 'visitType'>, resource?: CalendarResource, colorBy: CalendarUiOptions['colorBy'] = 'calendar'): string {
  const color = appearanceOf(event).color;
  if (color !== 'automatic') return color;
  return (colorBy === 'type' ? appointmentTypes.find(type => type.id === event.visitType)?.color : resource?.color) ?? 'blue';
}
export function attentionLabel(event: Pick<EventDraft, 'appearance'>): string | null {
  const reason = appearanceOf(event).attention;
  return reason === 'none' ? null : attentionReasons.find(item => item.value === reason)!.label;
}
/** Explicit stage changes clear a departed lobby, and never imply confirmation. */
export function changeVisit(event: Pick<EventDraft, 'visit' | 'status' | 'location'>, stage: VisitStage, room?: WaitingRoom, now = Date.now()): VisitProgress {
  const previous = visitOf(event);
  const waitingRoom = stage === 'waiting' ? room ?? (event.location === 'Telehealth' ? 'virtual' : event.location === 'In-person' ? 'office' : 'none') : 'none';
  return { stage, waitingRoom, arrivedAt: stage === 'scheduled' ? null : previous.arrivedAt ?? now };
}
/** Repeat/duplicate/reschedule starts a new visit; do not carry a stale lobby or delay. */
export function freshVisit(event: EventDraft): EventDraft {
  return { ...event, status: 'confirmed', cancellationReason: undefined, visit: visitOf({}), appearance: { ...appearanceOf(event), attention: 'none' } };
}
export function presentationError(event: EventDraft): string | null {
  const appearance = appearanceOf(event), visit = visitOf(event);
  if (!appointmentColors.includes(appearance.color) || !attentionReasons.some(reason => reason.value === appearance.attention)) return 'Choose a valid appointment appearance.';
  if (!visitStages.some(stage => stage.value === visit.stage) || !['none', 'office', 'virtual'].includes(visit.waitingRoom)) return 'Choose a valid visit stage.';
  if (visit.stage !== 'waiting' && visit.waitingRoom !== 'none') return 'Only a waiting appointment can occupy a lobby.';
  if ((event.location !== 'In-person' && visit.waitingRoom === 'office') || (event.location !== 'Telehealth' && visit.waitingRoom === 'virtual')) return 'The waiting room must match the visit mode.';
  if (visit.arrivedAt !== null && (!Number.isFinite(visit.arrivedAt) || visit.arrivedAt < 0)) return 'Choose a valid arrival time.';
  return null;
}
