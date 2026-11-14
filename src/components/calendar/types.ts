/** Local prototype contracts. These are not Zero scheduling or authorization APIs. */
import type { CalendarUser } from './recovered/calendar/types/index';
import type { AppointmentAttendee } from './models/attendee-model';
import type { RepeatRule } from './models/recurrence-model';
export type CalendarResource = CalendarUser;
export type AppointmentStatus = 'confirmed' | 'tentative' | 'completed' | 'cancelled' | 'no-show';
export type VisitStage = 'scheduled' | 'checked-in' | 'waiting' | 'triage' | 'in-session';
export type WaitingRoom = 'none' | 'office' | 'virtual';
export type AttentionReason = 'none' | 'needs-review' | 'missing-details' | 'running-late';
export type AppointmentColor = 'automatic' | 'blue' | 'violet' | 'teal' | 'orange' | 'pink' | 'grape';
export interface AppointmentAppearance { color: AppointmentColor; attention: AttentionReason }
export interface VisitProgress { stage: VisitStage; waitingRoom: WaitingRoom; arrivedAt: number | null }
export interface CalendarUiOptions { workflow: 'simple' | 'clinical'; colorBy: 'calendar' | 'type' }
export interface ScheduleEvent {
  id: string;
  resourceId: string;
  date: string;
  title: string;
  titleMode: 'automatic' | 'custom';
  start: number;
  end: number;
  kind: 'appointment' | 'block';
  status: AppointmentStatus;
  location: 'Telehealth' | 'In-person' | 'Phone';
  notes: string;
  patientId: string | null;
  attendees: AppointmentAttendee[];
  visitType: string | null;
  customVisitType: string;
  recurrence: RepeatRule | null;
  reminder: '15' | '30' | '60' | null;
  sendReminder: boolean;
  /** Local preview office identity, separate from the visit mode (phone/video/in-person). */
  siteId?: string | null;
  /** Optional presentation and explicit visit state; never inferred from online presence. */
  appearance?: AppointmentAppearance;
  visit?: VisitProgress;
  /** Optional cancellation annotation owned by the consuming UI, not a delivery receipt. */
  cancellationReason?: string;
}
export type EventDraft = Omit<ScheduleEvent, 'id'>;
export interface EventPresentation { busyOnly?: boolean; siteLabel?: string; colorBy?: CalendarUiOptions['colorBy']; clinical?: boolean }
export interface SlotTarget { resourceId: string; date: string; minute: number; siteId?: string }
export type MenuTarget = { kind: 'slot'; slot: SlotTarget } | { kind: 'event'; eventId: string };
export interface ContextTarget { key: number; target: MenuTarget; x: number; y: number; trigger: HTMLElement }
export type EditorIntent = 'create' | 'edit' | 'reschedule' | 'duplicate' | 'status';
export interface EditorSession { key: number; intent: EditorIntent; eventId?: string; initial: EventDraft; trigger?: HTMLElement }
export interface GridColumn { id: string; date: string; resourceId?: string; title: string; subtitle: string; color?: string; initials?: string }
export const DAY_START = 7 * 60;
export const DAY_END = 19 * 60;
export const SLOT_MINUTES = 15;
export const HOUR_HEIGHT = 72;
