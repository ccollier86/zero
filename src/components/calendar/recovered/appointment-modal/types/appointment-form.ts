/** Optional controlled values for the recovered modal; legacy demo props remain supported. */
import type { ReactNode } from 'react';
export interface AppointmentFormValues {
  title: string;
  date: string;
  patientId: string | null;
  providerId: string;
  visitType: string | null;
  recurrence: string;
  location: string;
  notes: string;
  reminder: string | null;
  sendReminder: boolean;
  status: string;
  siteId?: string | null;
}
export interface AppointmentFormControls {
  value: AppointmentFormValues;
  onChange(change: Partial<AppointmentFormValues>): void;
  onSubmit(): boolean | void;
  trigger?: HTMLElement;
  kind: 'appointment' | 'block';
  heading?: string;
  submitDisabled?: boolean;
  error?: string | null;
  warning?: string;
  notice?: string;
  onCancelAppointment?(): void;
  onPreviewTelehealth?(): void;
  siteOptions?: Array<{ value: string; label: string }>;
  /** Optional composition slot; reference callers retain their original patient select. */
  attendeeControl?: ReactNode;
  repeatControl?: ReactNode;
  timeControls?: ReactNode;
  appointmentTypeControl?: ReactNode;
  titleHelper?: ReactNode;
  appearanceControl?: ReactNode;
  workflowControl?: ReactNode;
  /** Undefined retains the reference control; null deliberately omits it. */
  resourceControl?: ReactNode;
  locationControl?: ReactNode;
  notesControl?: ReactNode;
  reminderControl?: ReactNode;
  sendReminderControl?: ReactNode;
  telehealthControl?: ReactNode;
  /** Nested composed menus may own Escape until they have closed. */
  closeOnEscape?: boolean;
}
