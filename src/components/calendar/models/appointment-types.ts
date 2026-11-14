import type { AppointmentAttendee } from './attendee-model';
export interface AppointmentTypeOption { id: string; label: string; description?: string; color?: string }
/** The eventual app supplies its permitted types; fixture data is not authorization. */
export const appointmentTypes: readonly AppointmentTypeOption[] = [
  { id: 'intake', label: 'Initial Intake', description: 'First visit & assessment', color: 'blue' },
  { id: 'follow-up', label: 'Follow-up', description: 'Ongoing care & check-ins', color: 'teal' },
  { id: 'med-mgmt', label: 'Med Management', description: 'Medication review', color: 'violet' },
  { id: 'therapy', label: 'Therapy Session', description: 'Individual or group therapy', color: 'orange' },
];
export function suggestedTitle(type: string | null, customType: string, attendees: readonly AppointmentAttendee[], options: readonly AppointmentTypeOption[] = appointmentTypes): string {
  const heading = type === 'other' ? customType.trim() : options.find(option => option.id === type)?.label ?? '';
  const people = attendees.map(person => person.name.trim()).filter(Boolean);
  const names = people.join(', ');
  if (!heading) return names.length > 160 ? names.slice(0, 159).trimEnd() + '…' : names;
  if (!names) return heading;
  const available = 160 - heading.length - 3;
  const displayNames = names.length > available ? names.slice(0, available - 1).trimEnd() + '…' : names;
  return `${displayNames} · ${heading}`;
}
