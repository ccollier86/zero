import { expect, spyOn, test } from 'bun:test';
import type { CalendarAppointmentView } from '../../../calendar/contracts';
import type { CalendarAppointmentDraft } from './calendar-appointment-editor-model';
import { calendarVisitIntervalProjection } from './calendar-visit-interval-model';
const draft: CalendarAppointmentDraft = { resourceIds: ['a'], title: 'Synthetic', date: '2026-11-18', start: 600, end: 660,
  bufferBeforeMinutes: 15, bufferAfterMinutes: 30 };
const accepted: CalendarAppointmentView = { id: 'appointment', revision: 4, title: 'Accepted', resourceIds: ['a'], startAt: '2026-11-18T10:00:00.000Z',
  endAt: '2026-11-18T11:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 15, bufferAfterMinutes: 30, status: 'confirmed', createdBy: 'synthetic' };
test('timed location discovery includes both exact buffers, and unchanged accepted facts are distinguishable from fresh occupancy', () => {
  expect(calendarVisitIntervalProjection(draft, 'UTC', null, accepted)).toEqual({ kind: 'timed', preservesAcceptedInterval: true,
    interval: { startAt: '2026-11-18T09:45:00.000Z', endAt: '2026-11-18T11:30:00.000Z' } });
  expect(calendarVisitIntervalProjection({ ...draft, bufferAfterMinutes: 31 }, 'UTC', null, accepted).preservesAcceptedInterval).toBe(false);
  expect(calendarVisitIntervalProjection({ ...draft, start: 601 }, 'UTC', null, accepted).preservesAcceptedInterval).toBe(false);
});
test('incomplete, ambiguous and type-inconsistent drafts never produce a guessed eligibility interval', () => {
  const type = { id: 'type', revision: 2, label: 'Synthetic', durationMinutes: 60, bufferBeforeMinutes: 15, bufferAfterMinutes: 30, colorKey: null, active: true };
  expect(calendarVisitIntervalProjection({ ...draft, appointmentType: type }, 'UTC', { items: [type], truncated: false, nextAfter: null }).interval).toBeDefined();
  for (const value of [{ ...draft, bufferBeforeMinutes: NaN }, { ...draft, start: 660, end: 600 },
    { ...draft, appointmentType: type, end: 661 }, { ...draft, appointmentType: type, bufferAfterMinutes: 0 },
    { ...draft, appointmentType: type, resourceIds: ['new'] },
  ]) expect(calendarVisitIntervalProjection(value, 'UTC', null).interval).toBeUndefined();
  expect(calendarVisitIntervalProjection({ ...draft, date: '2026-11-01', start: 90, end: 150 }, 'America/New_York', null).interval).toBeUndefined();
});
test('retained all-day coverage uses frozen31-day fall-back UTC without Intl; authored edits/new kind/zone/buffers stay unprojected', () => {
  const record: CalendarAppointmentView = { ...accepted, interval: { kind: 'all-day-local-v1', startDate: '2026-10-15', endDate: '2026-11-15', timeZone: 'America/New_York' },
    startAt: '2026-10-15T04:00:00.000Z', endAt: '2026-11-15T05:00:00.000Z', timeZone: 'America/New_York', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
  const value: CalendarAppointmentDraft = { ...draft, intervalKind: 'all-day-local-v1', date: record.interval!.startDate, endDate: record.interval!.endDate,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, start: NaN, end: NaN };
  const unavailable = new Proxy(Intl.DateTimeFormat, {
    apply() { throw new Error('No current timezone engine.'); },
    construct() { throw new Error('No current timezone engine.'); },
  });
  const formatter = spyOn(Intl, 'DateTimeFormat').mockImplementation(unavailable);
  try {
    expect(calendarVisitIntervalProjection(value, record.timeZone, null, record)).toEqual({ kind: 'retained-all-day', preservesAcceptedInterval: true,
      interval: { startAt: record.startAt, endAt: record.endAt } });
    for (const changed of [{ ...value, date: '2026-10-16' }, { ...value, endDate: '2026-11-16' }, { ...value, bufferBeforeMinutes: 1 }])
      expect(calendarVisitIntervalProjection(changed, record.timeZone, null, record)).toEqual({ kind: 'unprojected-all-day', preservesAcceptedInterval: false });
    expect(calendarVisitIntervalProjection(value, 'UTC', null, record).interval).toBeUndefined();
    expect(calendarVisitIntervaldiagnostic(value, record.timeZone)).toBe('unprojected-all-day');
    expect(formatter).not.toHaveBeenCalled();
  } finally { formatter.mockRestore(); }
});
function calendarVisitIntervaldiagnostic(value: CalendarAppointmentDraft, timeZone: string) { return calendarVisitIntervalProjection(value, timeZone, null).kind; }
