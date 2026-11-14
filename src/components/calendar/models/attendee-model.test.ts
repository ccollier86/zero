import { describe, expect, test } from 'bun:test';
import { attendeeKey, filterAttendees, manualAttendee, sameAttendees } from './attendee-model';
import { eventDraft, newDraft, sameDraft, validateDraft } from './calendar-model';
import { mockCalendarUsers as resources } from '../recovered/calendar/data/mock-users';

import { attendeeDirectory } from '../test-support/attendee-directory';
const directory = attendeeDirectory(resources);
const patient = directory.find(person => person.id === 'patient-3')!;
const staff = directory.find(person => person.id === 'user-2')!;
const draft = () => ({ ...newDraft({ resourceId: 'user-2', date: '2026-11-10', minute: 495 }, 'appointment'), title: 'Synthetic visit' });
describe('appointment invitee selection', () => {
  test('checked categories constrain search rather than broadening it', () => {
    expect(filterAttendees(directory, ['patient'], '').map(person => person.type)).toEqual(['patient', 'patient', 'patient']);
    expect(filterAttendees(directory, ['staff'], '  MICHAEL ').map(person => person.id)).toEqual(['user-2']);
    expect(filterAttendees(directory, ['patient'], 'Michael')).toEqual([]);
    expect(filterAttendees(directory, ['staff', 'contact'], '').some(person => person.type === 'patient')).toBe(false);
    expect(filterAttendees(directory, ['contact'], 'interpreter').map(person => person.name)).toEqual(['Robin Ellis']);
    expect(filterAttendees(directory, [], '')).toEqual([]);
    expect(filterAttendees(directory, ['other'], '')).toEqual([]);
  });
  test('staff directory includes non-provider staff without assigning a calendar', () => {
    expect(filterAttendees(directory, ['staff'], 'Alex')).toMatchObject([{ id: 'demo-scheduler', type: 'staff' }]);
    expect(draft().resourceId).toBe('user-2');
    expect(new Set(directory.map(attendeeKey)).size).toBe(directory.length);
    expect(attendeeKey({ type: 'patient', id: 'same', name: 'One' })).not.toBe(attendeeKey({ type: 'staff', id: 'same', name: 'Two' }));
  });
  test('manual email normalizes for duplicate detection without losing plus addressing', () => {
    const first = manualAttendee('email', '  Guest+Family@Example.test ', '  Guest One ');
    const second = manualAttendee('email', 'guest+family@example.test');
    expect(first.attendee).toMatchObject({ address: 'guest+family@example.test', name: 'Guest One', method: 'email' });
    expect(attendeeKey(first.attendee!)).toBe(attendeeKey(second.attendee!));
    for (const value of ['', 'not-an-email', 'a@b', 'a b@example.test', '<guest@example.test>']) expect(manualAttendee('email', value).error).toBeDefined();
  });
  test('manual phone uses +1 for US numbers and requires explicit international country codes', () => {
    const first = manualAttendee('phone', '(555) 010-0123');
    expect(first.attendee).toMatchObject({ address: '+15550100123', method: 'phone' });
    expect(attendeeKey(first.attendee!)).toBe(attendeeKey(manualAttendee('phone', '+1 555 010 0123').attendee!));
    expect(manualAttendee('phone', '+44 20 7946 0123').attendee).toMatchObject({ address: '+442079460123' });
    for (const value of ['', '123', '555CALLME', '02079460123', '+0 12345678', '+1234567890123456']) expect(manualAttendee('phone', value).error).toBeDefined();
    expect(manualAttendee('email', 'guest@example.test', 'x'.repeat(81)).error).toBeDefined();
  });
  test('dirty comparison accounts for invitees without treating selection order as an edit', () => {
    expect(sameAttendees([patient, staff], [{ ...staff }, { ...patient }])).toBe(true);
    expect(sameDraft(draft(), { ...draft(), attendees: [patient] })).toBe(false);
    expect(sameDraft({ ...draft(), attendees: [patient, staff] }, { ...draft(), attendees: [staff, patient] })).toBe(true);
    const guest = manualAttendee('email', 'guest@example.test').attendee!;
    expect(sameAttendees([guest], [{ ...guest, name: 'New label' }])).toBe(false);
  });
  test('copying an event protects the saved selection from draft edits', () => {
    const accepted = { ...draft(), id: 'synthetic', attendees: [{ ...patient }] };
    const copy = eventDraft(accepted); copy.attendees[0]!.name = 'Edited'; copy.attendees.push(staff);
    expect(accepted.attendees).toEqual([patient]);
  });
  test('time blocks have no invitees and duplicate selections are rejected', () => {
    expect(newDraft({ resourceId: 'user-2', date: '2026-11-10', minute: 495 }, 'block').attendees).toEqual([]);
    expect(validateDraft({ ...draft(), attendees: [patient, { ...patient }] }, resources)).toBe('Each invitee can only be added once.');
    expect(validateDraft({ ...draft(), kind: 'block', attendees: [patient] }, resources)).toBe('Time blocks do not have invitees.');
    expect(validateDraft({ ...draft(), attendees: [patient, staff] }, resources)).toBeNull();
  });
});
