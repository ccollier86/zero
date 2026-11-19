import { expect, test } from 'bun:test';
import type { CalendarAppointmentView } from '../../../calendar/contracts';
import { calendarWorkspaceDateQueries, mergeCalendarAppointmentPages, projectCalendarAllDayAppointments } from './calendar-all-day-model';
import { calendarCivilDays } from './calendar-local-date';
import { projectCalendarAppointments } from './calendar-workspace-model';
const allDay: CalendarAppointmentView = { id: 'all-day', revision: 2, resourceIds: ['a', 'b'], title: 'Authored New Year',
  interval: { kind: 'all-day-local-v1', startDate: '2027-01-01', endDate: '2027-01-03', timeZone: 'Pacific/Kiritimati' },
  startAt: '2026-12-31T10:00:00.000Z', endAt: '2027-01-02T10:00:00.000Z', timeZone: 'Pacific/Kiritimati',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic' };
test('DATE projection includes authored Kiritimati labels independent of Honolulu UTC display windows, with exclusive ends', () => {
  const days = ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'];
  const projection = projectCalendarAllDayAppointments([allDay], ['a'], days);
  expect(projection.occurrences.map(item => item.date)).toEqual(['2027-01-01', '2027-01-02']);
  expect(projection.occurrences.every(item => !('start' in item) && !('end' in item))).toBe(true);
  expect(projection.sourceByOccurrenceId.get(projection.occurrences[0]!.id)).toBe(allDay);
  for (const zone of ['Pacific/Honolulu', 'UTC', 'Pacific/Kiritimati']) expect(projectCalendarAppointments([allDay], ['a'], days, zone, 'week')).toEqual({ events: [], sourceByEventId: new Map(), supplemental: [] });
});
test('month date reads split 42 Gregorian dates into two bounded native ranges without UTC offset widening', () => {
  const days = calendarCivilDays('2026-11-19', 'month'), queries = calendarWorkspaceDateQueries(days, ['a']);
  expect(queries).toEqual([{ resourceIds: ['a'], startDate: '2026-10-26', endDate: '2026-11-26' }, { resourceIds: ['a'], startDate: '2026-11-26', endDate: '2026-12-07' }]);
  expect(calendarWorkspaceDateQueries(['0000-02-28', '0000-02-29'], ['a'])).toEqual([{ resourceIds: ['a'], startDate: '0000-02-28', endDate: '0000-03-01' }]);
  expect(() => calendarWorkspaceDateQueries(['9999-12-31'], ['a'])).toThrow();
  expect(() => calendarWorkspaceDateQueries(['2026-01-01', '2026-01-03'], ['a'])).toThrow();
});
test('watch-family dedup selects logical revision once across all-day/timed conversion and fails closed on contradictory same revision', () => {
  const { interval: _, ...timed } = allDay;
  const current = { ...timed, revision: 3, title: 'Converted' };
  expect(mergeCalendarAppointmentPages([[allDay], [allDay], [current]])).toEqual({ records: [current], inconsistent: false });
  expect(projectCalendarAllDayAppointments(mergeCalendarAppointmentPages([[allDay], [current]]).records, ['a'], ['2027-01-01']).occurrences).toEqual([]);
  expect(mergeCalendarAppointmentPages([[allDay], [{ ...allDay, title: 'Contradiction' }]])).toEqual({ records: [], inconsistent: true });
});
