/** Server-memory anatomy checks, not browser layout, pointer/focus or packaged-output certification. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarAppointmentView } from '../../../calendar/contracts';
import { CalendarSchedule } from '../components/calendar-schedule';
import { CalendarCivilDateField } from '../components/calendar-civil-date-field';
import { calendarCivilDays, calendarCivilDisplayDate } from './calendar-local-date';
import { projectCalendarAllDayAppointments } from './calendar-all-day-model';
const source: CalendarAppointmentView = { id: 'date-only', revision: 1, title: 'Authored all-day', resourceIds: ['a'],
  interval: { kind: 'all-day-local-v1', startDate: '2027-01-01', endDate: '2027-01-03', timeZone: 'Pacific/Kiritimati' },
  startAt: '2026-12-31T10:00:00.000Z', endAt: '2027-01-02T10:00:00.000Z', timeZone: 'Pacific/Kiritimati',
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, status: 'confirmed', createdBy: 'synthetic' };
const resources = [{ id: 'a', name: 'Authorized calendar', initials: 'AC', color: 'blue' }];
test('day/week render a dedicated date lane, month renders date chips, and agenda renders all-day before timed items', () => {
  for (const view of ['day', 'week', 'month', 'agenda'] as const) {
    const days = calendarCivilDays('2027-01-01', view), projection = projectCalendarAllDayAppointments([source], ['a'], days);
    const html = renderToStaticMarkup(<CalendarSchedule date={calendarCivilDisplayDate('2027-01-01')} civilDate="2027-01-01" days={days}
      view={view} resources={resources} events={[]} allDayOccurrences={projection.occurrences} onDateSelect={() => {}} onMenu={() => {}} onEdit={() => {}} />);
    expect(html).toContain('data-calendar-all-day="date-only"');
    expect(html).not.toContain('data-schedule-event='); expect(html).not.toContain('data-agenda-event=');
    expect(html).toContain('All-day'); expect(html).toContain('Jan 1, 2027 through Jan 2, 2027'); expect(html).not.toContain('through Jan 3');
    if (view === 'day' || view === 'week') { expect(html).toContain('calendar-all-day-lane'); expect(html).toContain('grid-row:3'); }
    if (view === 'month') expect(html).toContain('calendar-month-events');
    if (view === 'agenda') expect(html).toContain('aria-label="All-day appointments"');
  }
});
test('standalone timed preview omits all-day anatomy, and a civil field keeps 0000/0099 labels without BC or host-year coercion', () => {
  const html = renderToStaticMarkup(<CalendarSchedule date={new Date(2027, 0, 1, 12)} view="day" resources={resources} events={[]}
    onDateSelect={() => {}} onMenu={() => {}} onEdit={() => {}} />);
  expect(html).not.toContain('calendar-all-day-lane'); expect(html).not.toContain('grid-row:3');
  for (const value of ['0000-02-29', '0099-12-31', '2011-12-30']) {
    const field = renderToStaticMarkup(<CalendarCivilDateField value={value} label="All-day start date" onChange={() => {}} />);
    expect(field).toContain(`value="${value}"`); expect(field).toContain(`Choose all-day start date, ${value}`); expect(field).not.toContain('1 BC');
    expect(field).not.toContain('type="date"');
  }
});
test('shared all-day agenda names both reserved calendars rather than presenting indistinguishable provider entries', () => {
  const calendars = [...resources, { id: 'b', name: 'Second authorized calendar', initials: 'SC', color: 'blue' }];
  const projection = projectCalendarAllDayAppointments([{ ...source, resourceIds: ['a', 'b'] }], ['a', 'b'], ['2027-01-01']);
  const html = renderToStaticMarkup(<CalendarSchedule date={calendarCivilDisplayDate('2027-01-01')} civilDate="2027-01-01" view="agenda"
    resources={calendars} events={[]} allDayOccurrences={projection.occurrences} onDateSelect={() => {}} onMenu={() => {}} onEdit={() => {}} />);
  expect(html.match(/class="calendar-all-day-resource"/g)).toHaveLength(2);
  expect(html).toContain('class="calendar-all-day-resource">Authorized calendar'); expect(html).toContain('class="calendar-all-day-resource">Second authorized calendar');
  expect(html).toContain('all-day, Authorized calendar, Jan 1'); expect(html).toContain('all-day, Second authorized calendar, Jan 1');
});
