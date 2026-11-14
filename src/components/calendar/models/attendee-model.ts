/** Invitee UI values only. These types do not establish account access or deliver invitations. */

export const attendeeTypes = [
  { id: 'patient', label: 'Patients', singular: 'Patient' },
  { id: 'staff', label: 'Staff', singular: 'Staff' },
  { id: 'contact', label: 'Contacts', singular: 'Contact' },
  { id: 'other', label: 'Other', singular: 'Guest' },
] as const;
export type AttendeeType = typeof attendeeTypes[number]['id'];
export type ContactMethod = 'email' | 'phone';
export type AppointmentAttendee =
  | { type: Exclude<AttendeeType, 'other'>; id: string; name: string; hint?: string }
  | { type: 'other'; id: string; name: string; method: ContactMethod; address: string };

export function attendeeKey(attendee: AppointmentAttendee): string { return `${attendee.type}:${attendee.id}`; }
export function attendeeTypeLabel(type: AttendeeType): string { return attendeeTypes.find(item => item.id === type)!.singular; }
export function filterAttendees(directory: readonly AppointmentAttendee[], types: readonly AttendeeType[], query: string): AppointmentAttendee[] {
  const text = query.trim().toLocaleLowerCase();
  return directory.filter(person => person.type !== 'other' && types.includes(person.type) && `${person.name} ${'hint' in person ? person.hint ?? '' : ''}`.toLocaleLowerCase().includes(text));
}
/** Formatting check for the prototype, not contact verification or a delivery guarantee. */
export function manualAttendee(method: ContactMethod, value: string, name = ''): { attendee: AppointmentAttendee; error?: never } | { error: string; attendee?: never } {
  if (name.trim().length > 80) return { error: 'Keep the name under 80 characters.' };
  let address = value.trim();
  if (method === 'email') {
    if (address.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) return { error: 'Enter a valid email address.' };
    address = address.toLowerCase();
  } else {
    if (!/^\+?[\d\s().-]+$/.test(address)) return { error: 'Enter a phone number, including its country code.' };
    let digits = address.replace(/\D/g, '');
    if (!address.startsWith('+')) {
      if (digits.length === 10) digits = '1' + digits;
      else if (!(digits.length === 11 && digits.startsWith('1'))) return { error: 'Include the country code, such as +1.' };
    }
    if (!/^[1-9]\d{6,14}$/.test(digits)) return { error: 'Enter a phone number with a valid length and country code.' };
    address = '+' + digits;
  }
  return { attendee: { type: 'other', id: `${method}:${address}`, name: name.trim() || address, method, address } };
}
/** Selection is a set; rearranging the same people is not a meaningful edit. */
export function sameAttendees(a: readonly AppointmentAttendee[], b: readonly AppointmentAttendee[]): boolean {
  const signature = (person: AppointmentAttendee) => JSON.stringify([attendeeKey(person), person.name, person.type === 'other' ? person.method : null, person.type === 'other' ? person.address : null]);
  const left = a.map(signature).sort(), right = b.map(signature).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
