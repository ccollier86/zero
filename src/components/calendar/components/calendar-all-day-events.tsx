/** Date-only cards have no minute geometry, duration inference or client authorization. */
import type { CalendarAllDayOccurrence } from '../models/calendar-all-day-model';
import { calendarFormatAllDayDates } from '../models/calendar-local-date';
import type { MenuTarget } from '../types';
export interface CalendarAllDayEventsProps { readonly items: readonly CalendarAllDayOccurrence[];
  readonly resourceLabel?: (resourceId: string) => string;
  onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void
}
export function CalendarAllDayEvents({ items, onMenu, resourceLabel }: CalendarAllDayEventsProps) {
  return <>{items.map(item => <button key={item.id} type="button" className={`calendar-all-day-event ${item.status === 'cancelled' ? 'is-cancelled' : ''}`}
    data-calendar-all-day={item.sourceId} data-all-day-date={item.date} aria-haspopup="menu"
    aria-label={`${item.title}, all-day, ${resourceLabel ? `${resourceLabel(item.resourceId)}, ` : ''}${calendarFormatAllDayDates(item.startDate, item.endDate)}, ${item.timeZone}`}
    onClick={event => onMenu({ kind: 'event', eventId: item.id }, event.currentTarget, event.detail ? { x: event.clientX, y: event.clientY } : undefined)}
    onContextMenu={event => { event.preventDefault(); onMenu({ kind: 'event', eventId: item.id }, event.currentTarget, { x: event.clientX, y: event.clientY }); }}
    onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); onMenu({ kind: 'event', eventId: item.id }, event.currentTarget); } }}>
    <span>All-day</span><b>{item.title}</b>{resourceLabel && <small className="calendar-all-day-resource">{resourceLabel(item.resourceId)}</small>}
  </button>)}</>;
}
