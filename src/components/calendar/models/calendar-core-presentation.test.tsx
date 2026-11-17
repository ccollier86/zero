/** In-memory markup checks only; no browser, server, database or generated build. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarSchedule } from '../components/calendar-schedule';
import { newDraft } from './calendar-model';
import type { CalendarResource, ScheduleEvent } from '../types';
import type { CalendarViewMode } from '../recovered/calendar/types/calendar-view-mode';

const resource: CalendarResource = { id: 'resource-a', name: 'Synthetic calendar', initials: 'SC', color: 'blue' };
const event: ScheduleEvent = { ...newDraft({ resourceId: resource.id, date: '2026-11-16', minute: 540 }, 'appointment'),
  id: 'appointment-a', title: 'Core appointment', end: 600, location: 'Unspecified' };
function markup(view: CalendarViewMode, coreOnly: boolean) {
  return renderToStaticMarkup(<CalendarSchedule date={new Date(2026, 10, 16, 12)} view={view} resources={[resource]} events={[event]}
    onDateSelect={() => {}} onMenu={() => {}} onEdit={() => {}} eventPresentation={() => ({ clinical: false, coreOnly })} />);
}
for (const view of ['day', 'week', 'month', 'agenda'] as const) {
  test(`connected ${view} renders the core record without visit glyphs, location metadata or clinical controls`, () => {
    const html = markup(view, true);
    expect(html).toContain(event.title);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('Unspecified');
    expect(html).not.toContain('Appointment status:');
    expect(html).not.toContain('Visit at a glance');
  });
}
test('the standalone month keeps its reviewed visit glyph when core-only presentation is not requested', () => {
  expect(markup('month', false)).toContain('<svg');
});
