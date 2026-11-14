import { mockDayEvents } from './mock-day-events';
import { mockWeekEvents } from './mock-week-events';
import { dateKey, newDraft, weekDates } from '../models/calendar-model';
import type { CalendarResource, ScheduleEvent } from '../types';
/** Fixed synthetic people, anchored to the current displayed week rather than every date forever. */
export function seedEvents(resources: readonly CalendarResource[], today: Date): ScheduleEvent[] {
  if (!resources.length) return [];
  const dates = weekDates(today), day = dateKey(today);
  const create = (event: typeof mockDayEvents[number], resourceId: string, date: string): ScheduleEvent => ({ ...newDraft({ resourceId, date, minute: Math.round(event.start * 60) }, 'appointment'), id: event.id, title: event.title, titleMode: 'custom', end: Math.round(event.end * 60), visitType: event.title.toLowerCase().includes('therapy') ? 'therapy' : 'follow-up', location: event.meta === 'In-person' ? 'In-person' : event.meta === 'Phone' ? 'Phone' : 'Telehealth' });
  const events = mockDayEvents.map((event, index) => create(event, resources[index % resources.length]!.id, day));
  for (const [index, event] of mockWeekEvents.entries()) if (dates[event.dayIndex] !== day) events.push(create(event, resources[index % resources.length]!.id, dates[event.dayIndex]!));
  events.push({ ...newDraft({ resourceId: resources[0]!.id, date: day, minute: 9 * 60 + 30 }, 'appointment'), id: 'demo-overlap', title: 'Care coordination', titleMode: 'custom', end: 10 * 60 + 15 });
  events.push({ ...newDraft({ resourceId: resources[0]!.id, date: day, minute: 12 * 60 + 30 }, 'block'), id: 'demo-break', title: 'Lunch break', end: 13 * 60 + 15 });
  // Deliberately varied synthetic examples, with confirmation independent of arrival.
  const examples = events.filter(event => event.date === day && event.kind === 'appointment');
  if (examples[0]) examples[0] = Object.assign(examples[0], { visit: { stage: 'waiting', waitingRoom: examples[0].location === 'Telehealth' ? 'virtual' : examples[0].location === 'In-person' ? 'office' : 'none', arrivedAt: today.getTime() - 4 * 60000 } });
  if (examples[1]) Object.assign(examples[1], { status: 'tentative', appearance: { color: 'automatic', attention: 'missing-details' } });
  if (examples[2]) Object.assign(examples[2], { visit: { stage: 'in-session', waitingRoom: 'none', arrivedAt: today.getTime() - 20 * 60000 } });
  if (examples[3]) Object.assign(examples[3], { location: 'In-person', visit: { stage: 'waiting', waitingRoom: 'office', arrivedAt: today.getTime() - 8 * 60000 } });
  const future = new Date(today); future.setDate(future.getDate() + 7);
  while ([0, 6].includes(future.getDay())) future.setDate(future.getDate() + 1);
  for (const [index, resource] of resources.entries()) for (const attention of [false, true]) {
    const start = attention ? 10 * 60 + 30 : 9 * 60;
    events.push({ ...newDraft({ resourceId: resource.id, date: dateKey(future), minute: start }, 'appointment'), id: `demo-tone-${index}-${attention ? 'attention' : 'ready'}`, title: attention ? 'Future appointment · missing details' : 'Future appointment · ready', titleMode: 'custom', end: start + 75, appearance: { color: 'blue', attention: attention ? 'missing-details' : 'none' } });
  }
  return events;
}
