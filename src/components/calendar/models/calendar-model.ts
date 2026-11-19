/** Local wall-date arithmetic and draft validation for a single-browser calendar prototype. */
import { attendeeKey, sameAttendees } from './attendee-model';
import { cloneRepeat, repeatError, sameRepeat } from './recurrence-model';
import { appointmentTypes, suggestedTitle } from './appointment-types';
import { dateKey, isDay, parseDay } from './calendar-date';
import { appearanceOf, presentationError, statusOptions, visitOf } from './appointment-presentation';
import { calendarFormatCivilDate, calendarLocalDate } from './calendar-local-date';
export { dateKey, isDay, parseDay } from './calendar-date';
import { DAY_END, DAY_START, type CalendarResource, type EventDraft, type ScheduleEvent, type SlotTarget } from '../types';

/** Keep local dates local: converting a selected day to UTC can shift its calendar date. */
export function weekDates(date: Date): string[] {
  const start = new Date(date); start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return dateKey(day); });
}
export function monthDates(date: Date): string[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => { const day = new Date(first); day.setDate(day.getDate() + index); return dateKey(day); });
}
export function shiftCalendarDate(date: Date, view: 'day' | 'week' | 'month' | 'agenda', direction: number): Date {
  const next = new Date(date); next.setHours(12, 0, 0, 0);
  if (view === 'month') {
    const wantedDay = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + direction);
    next.setDate(Math.min(wantedDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  } else next.setDate(next.getDate() + direction * (view === 'week' ? 7 : 1));
  return next;
}
export function formatDay(value: string, short = false): string {
  if (!calendarLocalDate(value)) return 'Choose a date';
  return calendarFormatCivilDate(value, { weekday: short ? 'short' : 'long', month: 'short', day: 'numeric' });
}
export function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60), rest = minute % 60;
  return `${hour % 12 || 12}:${String(rest).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
export function inputTime(minute: number): string { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
export function minuteFromInput(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour! <= 23 && minute! <= 59 ? hour! * 60 + minute! : NaN;
}
export function newDraft(slot: SlotTarget, kind: EventDraft['kind']): EventDraft {
  return { resourceId: slot.resourceId, date: slot.date, title: kind === 'block' ? 'Unavailable' : suggestedTitle('intake', '', []), titleMode: kind === 'block' ? 'custom' : 'automatic', start: slot.minute, end: Math.min(slot.minute + 60, DAY_END), kind, status: 'confirmed', location: 'Telehealth', notes: '', patientId: null, attendees: [], visitType: kind === 'appointment' ? 'intake' : null, customVisitType: '', recurrence: null, reminder: kind === 'appointment' ? '30' : null, sendReminder: kind === 'appointment', siteId: kind === 'block' ? null : slot.siteId };
}
/** No silent time adjustment or resource reassignment: return the exact draft's errors. */
export function validateDraft(draft: EventDraft, resources: readonly CalendarResource[]): string | null {
  if (!resources.some(resource => resource.id === draft.resourceId)) return 'Choose a calendar for this event.';
  if (!isDay(draft.date)) return 'Choose a valid date.';
  if (!draft.title.trim() || draft.title.trim().length > 160) return 'Enter a title of up to 160 characters.';
  if (![draft.start, draft.end].every(Number.isInteger)) return 'Enter valid start and end times, such as 9:10 AM or 14:37.';
  if (draft.start < DAY_START || draft.end > DAY_END || draft.start >= draft.end) return 'Choose an end time after the start, between 7:00 AM and 7:00 PM.';
  if (!['appointment', 'block'].includes(draft.kind) || !statusOptions.some(status => status.value === draft.status) || !['Telehealth', 'In-person', 'Phone'].includes(draft.location)) return 'Choose valid event settings.';
  const displayError = presentationError(draft); if (displayError) return displayError;
  if (draft.notes.length > 2000) return 'Keep the notes under 2,000 characters.';
  const recurrenceError = repeatError(draft.recurrence, draft.date); if (recurrenceError) return recurrenceError;
  if (draft.kind === 'appointment' && !appointmentTypes.some(type => type.id === draft.visitType) && draft.visitType !== 'other') return 'Choose an appointment type.';
  if (draft.visitType === 'other' && (!draft.customVisitType.trim() || draft.customVisitType.trim().length > 80)) return 'Describe the other appointment type in up to 80 characters.';
  if (draft.reminder !== null && !['15', '30', '60'].includes(draft.reminder)) return 'Choose a reminder preference.';
  if (draft.kind === 'block' && draft.attendees.length) return 'Time blocks do not have invitees.';
  if (new Set(draft.attendees.map(attendeeKey)).size !== draft.attendees.length) return 'Each invitee can only be added once.';
  return null;
}
export function eventDraft(event: ScheduleEvent): EventDraft { const { id: _, ...draft } = event; return { ...draft, recurrence: cloneRepeat(draft.recurrence), attendees: draft.attendees.map(person => ({ ...person })), appearance: appearanceOf(draft), visit: visitOf(draft) }; }
export function sameDraft(a: EventDraft, b: EventDraft): boolean {
  if ((a.cancellationReason ?? '') !== (b.cancellationReason ?? '')) return false;
  return a.resourceId === b.resourceId && a.date === b.date && a.title === b.title && a.titleMode === b.titleMode && a.start === b.start && a.end === b.end && a.kind === b.kind && a.status === b.status && a.location === b.location && a.notes === b.notes && a.patientId === b.patientId && sameAttendees(a.attendees, b.attendees) && a.visitType === b.visitType && a.customVisitType === b.customVisitType && sameRepeat(a.recurrence, b.recurrence) && a.reminder === b.reminder && a.sendReminder === b.sendReminder && a.siteId === b.siteId && JSON.stringify(appearanceOf(a)) === JSON.stringify(appearanceOf(b)) && JSON.stringify(visitOf(a)) === JSON.stringify(visitOf(b));
}
export function conflictingEvents(draft: EventDraft, events: readonly ScheduleEvent[], eventId?: string): ScheduleEvent[] {
  return events.filter(event => event.id !== eventId && event.resourceId === draft.resourceId && event.date === draft.date && event.status !== 'cancelled' && draft.status !== 'cancelled' && draft.start < event.end && event.start < draft.end);
}
