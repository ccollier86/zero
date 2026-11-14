/** Fictional people for the isolated frontend preview only. */
import type { CalendarResource } from '../types';
import type { AppointmentAttendee } from '../models/attendee-model';
const patients: AppointmentAttendee[] = [
  { type: 'patient', id: 'patient-1', name: 'Roy Houchin', hint: 'Patient directory' },
  { type: 'patient', id: 'patient-2', name: 'Hannah Li', hint: 'Patient directory' },
  { type: 'patient', id: 'patient-3', name: 'Maya Patel', hint: 'Patient directory' },
];
export function attendeeDirectory(resources: readonly CalendarResource[]): AppointmentAttendee[] {
  return [...patients,
    ...resources.map(resource => ({ type: 'staff' as const, id: resource.id, name: resource.name, hint: 'Provider' })),
    { type: 'staff', id: 'demo-scheduler', name: 'Alex Morgan', hint: 'Scheduling team' },
    { type: 'contact', id: 'demo-contact-1', name: 'Taylor Reed', hint: 'Care coordinator' },
    { type: 'contact', id: 'demo-contact-2', name: 'Jamie Park', hint: 'Community contact' },
    { type: 'contact', id: 'demo-contact-3', name: 'Robin Ellis', hint: 'Interpreter' },
  ];
}
