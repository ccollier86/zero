/** Read-only day projection. The caller supplies its permitted resources and event presentation. */
import type { CalendarResource, EventPresentation, ScheduleEvent } from '../types';
export interface AgendaEntry { event: ScheduleEvent; resource: CalendarResource; presentation: EventPresentation }
export function agendaEntries(events: readonly ScheduleEvent[], resources: readonly CalendarResource[], day: string, present: (event: ScheduleEvent) => EventPresentation = () => ({})): AgendaEntry[] {
  const byId = new Map(resources.map(resource => [resource.id, resource]));
  return events.filter(event => event.date === day && byId.has(event.resourceId))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.resourceId.localeCompare(b.resourceId) || a.id.localeCompare(b.id))
    .map(event => ({ event, resource: byId.get(event.resourceId)!, presentation: present(event) }));
}
