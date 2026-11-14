import { describe, expect, test } from 'bun:test';
import { cloneRepeat, defaultRepeat, repeatError, repeatPresets, repeatPreview, repeatSummary, sameRepeat, type RepeatRule } from './recurrence-model';
import { parseTimeEntry } from './time-model';
import { eventDraft, newDraft, sameDraft, validateDraft } from './calendar-model';
import { updateAppointmentDraft } from './appointment-draft';
import { appointmentTypes, suggestedTitle } from './appointment-types';
import { mockCalendarUsers as resources } from '../test-support/mock-users';
import type { AppointmentAttendee } from './attendee-model';
const start = '2026-11-10';
const draft = () => newDraft({ resourceId: 'user-2', date: start, minute: 495 }, 'appointment');
const maya: AppointmentAttendee = { id: 'patient-3', type: 'patient', name: 'Maya Patel' };
const alex: AppointmentAttendee = { id: 'demo-scheduler', type: 'staff', name: 'Alex Morgan' };

describe('repeat preference date previews', () => {
  test('daily intervals and never/after/on endings count the first appointment exactly once', () => {
    const rule = defaultRepeat('daily', start, 2);
    expect(repeatPreview(rule, start)).toEqual(['2026-11-10', '2026-11-12', '2026-11-14', '2026-11-16']);
    expect(repeatPreview({ ...rule, end: { kind: 'after', count: 1 } }, start)).toEqual([start]);
    expect(repeatPreview({ ...rule, end: { kind: 'after', count: 2 } }, start)).toEqual([start, '2026-11-12']);
    expect(repeatPreview({ ...rule, end: { kind: 'on', date: '2026-11-14' } }, start)).toEqual([start, '2026-11-12', '2026-11-14']);
    expect(repeatPreview(null, start)).toEqual([start]);
  });
  test('weekly multi-day intervals anchor to Monday and preserve a first date outside the repeat days', () => {
    const rule: RepeatRule = { frequency: 'weekly', interval: 2, weekdays: [5, 1, 3], end: { kind: 'never' } };
    expect(repeatPreview(rule, start, 6)).toEqual([start, '2026-11-11', '2026-11-13', '2026-11-23', '2026-11-25', '2026-11-27']);
    expect(repeatPreview(defaultRepeat('weekly', start), start)).toEqual([start, '2026-11-17', '2026-11-24', '2026-12-01']);
  });
  test('monthly day numbers skip nonexistent dates rather than silently rolling or clamping', () => {
    expect(repeatPreview(defaultRepeat('monthly', '2027-01-31'), '2027-01-31')).toEqual(['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
    expect(repeatPreview(defaultRepeat('monthly', '2028-01-29'), '2028-01-29')).toEqual(['2028-01-29', '2028-02-29', '2028-03-29', '2028-04-29']);
  });
  test('monthly ordinal weekdays and last weekdays are exact across month lengths', () => {
    const fifth: RepeatRule = { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: 5, weekday: 2 }, end: { kind: 'never' } };
    expect(repeatPreview(fifth, '2026-03-31')).toEqual(['2026-03-31', '2026-06-30', '2026-09-29', '2026-12-29']);
    const last: RepeatRule = { ...fifth, pattern: { kind: 'weekday', ordinal: -1, weekday: 5 } };
    expect(repeatPreview(last, '2027-01-29')).toEqual(['2027-01-29', '2027-02-26', '2027-03-26', '2027-04-30']);
  });
  test('yearly leap dates skip nonleap years and the preview stays bounded', () => {
    expect(repeatPreview(defaultRepeat('yearly', '2028-02-29'), '2028-02-29')).toEqual(['2028-02-29', '2032-02-29', '2036-02-29', '2040-02-29']);
    expect(repeatPreview(defaultRepeat('daily', start), start, 99999)).toHaveLength(12);
    expect(repeatPreview(defaultRepeat('yearly', '9998-01-01', 99), '9998-01-01')).toEqual(['9998-01-01']);
  });
  test('invalid intervals, empty weekdays, dates and counts cannot produce a false preview', () => {
    for (const interval of [0, NaN, 1.5, 100]) expect(repeatError(defaultRepeat('daily', start, interval), start)).not.toBeNull();
    expect(repeatError({ frequency: 'weekly', interval: 1, weekdays: [], end: { kind: 'never' } }, start)).not.toBeNull();
    expect(repeatError({ frequency: 'monthly', interval: 1, pattern: { kind: 'day', day: 32 }, end: { kind: 'never' } }, start)).not.toBeNull();
    expect(repeatError(defaultRepeat('daily', start, 1, { kind: 'on', date: '2026-11-09' }), start)).not.toBeNull();
    expect(repeatError(defaultRepeat('daily', start, 1, { kind: 'after', count: 0 }), start)).not.toBeNull();
    expect(repeatPreview(defaultRepeat('daily', start), '')).toEqual([]);
  });
  test('clones, canonical equality and human summaries preserve actual recurrence choices', () => {
    const rule: RepeatRule = { frequency: 'weekly', interval: 2, weekdays: [3, 1], end: { kind: 'after', count: 6 } };
    expect(sameRepeat(rule, { ...rule, weekdays: [1, 3] })).toBe(true);
    expect(repeatSummary(rule, start)).toBe('Every 2 weeks on Mon, Wed · 6 occurrences');
    const copy = cloneRepeat(rule)!; if (copy.frequency === 'weekly') copy.weekdays.push(5);
    expect(sameRepeat(rule, copy)).toBe(false);
    expect(repeatPresets(start).find(item => item.id === 'biweekly')?.rule).toEqual(defaultRepeat('weekly', start, 2));
    expect(repeatSummary(null, start)).toBe('Does not repeat');
  });
  test('saved event drafts isolate recurrence edits and dirty state recognizes equivalent rules', () => {
    const rule: RepeatRule = { frequency: 'weekly', interval: 1, weekdays: [2, 5], end: { kind: 'never' } };
    const event = { ...draft(), id: 'synthetic', recurrence: rule }, copy = eventDraft(event);
    expect(sameDraft(event, copy)).toBe(true);
    if (copy.recurrence?.frequency === 'weekly') copy.recurrence.weekdays.push(1);
    expect(rule.weekdays).toEqual([2, 5]); expect(sameDraft(event, copy)).toBe(false);
  });
});
describe('exact typed times and quick-pick independence', () => {
  test('accepts 12-hour and 24-hour minute input without snapping', () => {
    for (const [text, minute] of [['9:10 AM', 550], ['09:37', 577], ['2:07 pm', 847], ['14:37', 877], ['9am', 540], ['12:00 am', 0], ['12 PM', 720], ['7:00 p.m.', 1140]] as const) expect(parseTimeEntry(text)).toBe(minute);
    for (const text of ['', '9:7', '24:00', '12:60', '0pm', '13am', '9:10:20', 'whenever']) expect(Number.isNaN(parseTimeEntry(text))).toBe(true);
  });
  test('non-quarter-hour appointments and blocks validate and retain exact minutes', () => {
    expect(validateDraft({ ...draft(), start: 550, end: 577 }, resources)).toBeNull();
    expect(validateDraft({ ...newDraft({ resourceId: 'user-2', date: start, minute: 550 }, 'block'), end: 577 }, resources)).toBeNull();
    expect(validateDraft({ ...draft(), start: 550, end: 550 }, resources)).not.toBeNull();
    expect(validateDraft({ ...draft(), start: 550.5 }, resources)).not.toBeNull();
  });
});
describe('appointment type and automatic title', () => {
  test('names lead the type, with a useful fallback before invitees are selected', () => {
    expect(draft()).toMatchObject({ title: 'Initial Intake', titleMode: 'automatic' });
    expect(suggestedTitle('therapy', '', [maya, alex])).toBe('Maya Patel, Alex Morgan · Therapy Session');
    expect(suggestedTitle('other', ' Family care meeting ', [maya])).toBe('Maya Patel · Family care meeting');
    expect(suggestedTitle(null, '', [])).toBe('');
  });
  test('automatic title reacts to type, attendee add/remove and other labels', () => {
    let current = updateAppointmentDraft(draft(), { attendees: [maya] });
    expect(current.title).toBe('Maya Patel · Initial Intake');
    current = updateAppointmentDraft(current, { visitType: 'therapy' });
    expect(current.title).toBe('Maya Patel · Therapy Session');
    expect(updateAppointmentDraft(current, { attendees: [] }).title).toBe('Therapy Session');
  });
  test('manual titles are never overwritten; switching back is explicit', () => {
    let current = updateAppointmentDraft(draft(), { title: 'My custom meeting' });
    current = updateAppointmentDraft(current, { attendees: [maya], visitType: 'therapy' });
    expect(current).toMatchObject({ title: 'My custom meeting', titleMode: 'custom' });
    expect(updateAppointmentDraft(current, { titleMode: 'automatic' })).toMatchObject({ title: 'Maya Patel · Therapy Session', titleMode: 'automatic' });
    expect(updateAppointmentDraft(current, { notes: 'Local notes' }).titleMode).toBe('custom');
  });
  test('auto titles are bounded while preserving the type suffix and other labels are validated', () => {
    const title = suggestedTitle('therapy', '', Array.from({ length: 12 }, (_, i) => ({ ...maya, id: String(i), name: 'Synthetic Attendee Number ' + i })));
    expect(title.length).toBeLessThanOrEqual(160); expect(title.endsWith(' · Therapy Session')).toBe(true);
    expect(validateDraft({ ...draft(), visitType: 'other', customVisitType: '' }, resources)).not.toBeNull();
    expect(validateDraft({ ...draft(), visitType: 'other', customVisitType: 'Family care meeting' }, resources)).toBeNull();
    expect(suggestedTitle('not-supplied', '', [maya], appointmentTypes.filter(type => type.id === 'therapy'))).toBe('Maya Patel');
  });
});
