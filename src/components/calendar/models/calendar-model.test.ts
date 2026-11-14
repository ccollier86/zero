import { describe, expect, test } from 'bun:test';
import { conflictingEvents, dateKey, formatDay, inputTime, isDay, minuteFromInput, monthDates, newDraft, parseDay, sameDraft, shiftCalendarDate, validateDraft, weekDates } from './calendar-model';
import { seedEvents } from '../test-support/seed-events';
import { eventLanes } from './overlap-layout';
import { mockCalendarUsers as resources } from '../test-support/mock-users';
import type { ScheduleEvent } from '../types';
import { defaultRepeat } from './recurrence-model';

const slot = { resourceId: 'user-2', date: '2026-11-10', minute: 495 };
const draft = () => ({ ...newDraft(slot, 'appointment'), title: 'Synthetic appointment' });
const event = (id: string, start: number, end: number): ScheduleEvent => ({ ...draft(), id, start, end });

describe('calendar wall dates and exact slot context', () => {
  test('round-trips local dates, including leap days and year boundaries', () => {
    for (const key of ['2026-01-01', '2026-12-31', '2028-02-29']) expect(dateKey(parseDay(key))).toBe(key);
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('')).toBe(false);
    expect(formatDay('')).toBe('Choose a date');
  });
  test('Monday weeks cross a year without shifting dates', () => {
    expect(weekDates(parseDay('2027-01-03'))).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  });
  test('month grids have six complete Monday-based weeks, including leap days', () => {
    const days = monthDates(parseDay('2028-02-29'));
    expect(days).toHaveLength(42); expect(days).toContain('2028-02-29'); expect(parseDay(days[0]!).getDay()).toBe(1);
    expect(new Set(days).size).toBe(42);
  });
  test('month navigation clamps end-of-month dates and does not skip February', () => {
    expect(dateKey(shiftCalendarDate(parseDay('2027-01-31'), 'month', 1))).toBe('2027-02-28');
    expect(dateKey(shiftCalendarDate(parseDay('2028-01-31'), 'month', 1))).toBe('2028-02-29');
    expect(dateKey(shiftCalendarDate(parseDay('2027-01-10'), 'week', -1))).toBe('2027-01-03');
  });
  test('new drafts preserve the clicked provider, date and quarter-hour', () => {
    expect(draft()).toMatchObject({ start: 495, end: 555, resourceId: 'user-2', date: '2026-11-10' });
    expect(newDraft({ ...slot, minute: 1125 }, 'block')).toMatchObject({ start: 1125, end: 1140, kind: 'block', title: 'Unavailable' });
  });
  test('time inputs do not silently coerce invalid values', () => {
    expect(minuteFromInput('08:15')).toBe(495);
    expect(inputTime(1125)).toBe('18:45');
    for (const value of ['', '24:00', '12:60', 'abc']) expect(Number.isNaN(minuteFromInput(value))).toBe(true);
  });
});
describe('event validation and conflict warnings', () => {
  test('valid draft and an unchanged draft are recognized', () => {
    expect(validateDraft(draft(), resources)).toBeNull();
    expect(sameDraft(draft(), { ...draft() })).toBe(true);
    expect(sameDraft(draft(), { ...draft(), resourceId: 'user-1' })).toBe(false);
    for (const change of [{ patientId: 'patient-3' }, { visitType: 'therapy' }, { recurrence: defaultRepeat('weekly', slot.date) }, { reminder: '15' as const }, { sendReminder: false }]) expect(sameDraft(draft(), { ...draft(), ...change })).toBe(false);
  });
  test('blocks do not acquire patient, visit or notification preferences', () => {
    const block = newDraft(slot, 'block');
    expect(block).toMatchObject({ patientId: null, visitType: null, reminder: null, sendReminder: false });
    expect(validateDraft(block, resources)).toBeNull();
  });
  test('invalid dates, calendars, titles and times are rejected', () => {
    for (const change of [{ date: '' }, { resourceId: 'missing' }, { title: ' ' }, { start: NaN }, { start: 496.5 }, { start: 400 }, { end: 1200 }, { end: 495 }, { notes: 'x'.repeat(2001) }]) {
      expect(validateDraft({ ...draft(), ...change }, resources)).not.toBeNull();
    }
  });
  test('conflicts are scoped to the same resource and day, and ignore cancellation', () => {
    const events = [event('overlap', 510, 570), { ...event('other-calendar', 510, 570), resourceId: 'user-3' }, { ...event('other-day', 510, 570), date: '2026-11-11' }, { ...event('cancelled', 510, 570), status: 'cancelled' as const }, event('adjacent', 555, 615)];
    expect(conflictingEvents(draft(), events).map(event => event.id)).toEqual(['overlap']);
    expect(conflictingEvents(draft(), events, 'overlap')).toEqual([]);
    expect(conflictingEvents({ ...draft(), status: 'cancelled' }, events)).toEqual([]);
  });
  test('synthetic data has unique IDs, valid context and no regenerated daily copies', () => {
    const events = seedEvents(resources, parseDay('2026-11-10'));
    expect(new Set(events.map(event => event.id)).size).toBe(events.length);
    for (const event of events) expect(validateDraft(event, resources)).toBeNull();
    expect(events.filter(event => event.id === 'demo-overlap')).toHaveLength(1);
    expect(seedEvents([], parseDay('2026-11-10'))).toEqual([]);
  });
});
describe('overlap lanes', () => {
  test('overlapping appointments use separate lanes and adjacent appointments reset to full width', () => {
    expect(eventLanes([event('a', 540, 600), event('b', 570, 615), event('c', 615, 660)]).map(({ event, lane, lanes }) => [event.id, lane, lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });
  test('transitively overlapping clusters reuse lanes without colliding', () => {
    const placed = eventLanes([event('a', 480, 540), event('b', 510, 570), event('c', 540, 600), event('d', 555, 615)]);
    expect(placed.every(item => item.lanes === 3)).toBe(true);
    for (const a of placed) for (const b of placed) if (a !== b && a.lane === b.lane) expect(a.event.end <= b.event.start || b.event.end <= a.event.start).toBe(true);
  });
  test('does not mutate its source and handles an empty calendar', () => {
    const source = [event('later', 600, 660), event('earlier', 540, 600)];
    eventLanes(source);
    expect(source.map(event => event.id)).toEqual(['later', 'earlier']);
    expect(eventLanes([])).toEqual([]);
  });
});
