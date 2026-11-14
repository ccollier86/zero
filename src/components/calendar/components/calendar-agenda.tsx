/** One shared, chronologically ordered day across the supplied calendar/location scope. */
import type { CSSProperties } from 'react';
import { Avatar, Text } from './calendar-ui';
import { ClockIcon, PinIcon } from './prototype-icons';
import { agendaEntries } from '../models/agenda-model';
import { formatDay, formatMinute } from '../models/calendar-model';
import { attentionLabel, eventColor, progressLabel } from '../models/appointment-presentation';
import { AppointmentStatusPopover, VisitIcon } from './appointment-controls';
import type { CalendarResource, EventDraft, EventPresentation, MenuTarget, ScheduleEvent } from '../types';
import '../styles/calendar-agenda.css';
export interface CalendarAgendaProps {
  date: string; events: readonly ScheduleEvent[]; resources: readonly CalendarResource[];
  eventPresentation?(event: ScheduleEvent): EventPresentation;
  onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void;
  onUpdate?(id: string, change: Partial<EventDraft>): void;
  onDetails?(event: ScheduleEvent): void;
}
export function CalendarAgenda({ date, events, resources, eventPresentation, onMenu, onUpdate, onDetails }: CalendarAgendaProps) {
  const entries = agendaEntries(events, resources, date, eventPresentation);
  return <section className="calendar-agenda calendar-scroll" aria-label={`Appointment list, ${formatDay(date)}`}>
    <div className="calendar-agenda-heading"><div><b>{formatDay(date)}</b><small>All selected calendars · ordered by start time</small></div><span>{entries.length} {entries.length === 1 ? 'event' : 'events'}</span></div>
    {!entries.length ? <div className="calendar-agenda-empty"><ClockIcon size="var(--calendar-size-20)" /><Text size="sm" fw="var(--calendar-weight-medium)">No appointments on this day</Text><Text size="xs" c="dimmed">Choose another day or adjust the selected calendars and locations.</Text></div> : <ol className="calendar-agenda-list">{entries.map(({ event, resource, presentation }) => {
      const color = eventColor(event, resource, presentation.colorBy), attention = attentionLabel(event);
      const variables = { '--event-color': `var(--calendar-color-${color}-6)`, '--event-tint': `var(--calendar-color-${color}-0)` } as CSSProperties;
      if (presentation.busyOnly) return <li key={event.id} className="calendar-agenda-row is-busy" data-calendar-busy style={variables}><time>{formatMinute(event.start)}<small>{formatMinute(event.end)}</small></time><div className="calendar-agenda-appointment"><b>Busy · other location</b><small>{resource.name}</small></div></li>;
      return <li key={event.id} data-agenda-event={event.id} className={`calendar-agenda-row ${attention ? 'has-attention' : ''} ${event.status === 'cancelled' ? 'is-cancelled' : ''}`} style={variables}>
        <time>{formatMinute(event.start)}<small>{formatMinute(event.end)}</small></time>
        <button type="button" className="calendar-agenda-appointment" aria-label={`${event.title}, ${resource.name}, ${formatMinute(event.start)}, ${progressLabel(event, presentation.clinical)}`} aria-haspopup="menu"
          onClick={e => onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, e.detail ? { x: e.clientX, y: e.clientY } : undefined)}
          onContextMenu={e => { e.preventDefault(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, { x: e.clientX, y: e.clientY }); }}
          onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget); } }}>
          <b>{event.title}</b><small><VisitIcon event={event} clinical={presentation.clinical} size="var(--calendar-size-11)" />{event.kind === 'block' ? 'Time blocked' : progressLabel(event, presentation.clinical)}{attention && <span className="calendar-agenda-attention">{attention}</span>}</small>
          {event.kind !== 'block' && <small><PinIcon size="var(--calendar-size-11)" />{event.location}{presentation.siteLabel && ` · ${presentation.siteLabel}`}</small>}
        </button>
        <div className="calendar-agenda-provider"><Avatar size="var(--calendar-size-28)" radius="xl" src={resource.avatar} color={resource.color}>{resource.initials}</Avatar><span>{resource.name}</span></div>
        {event.kind === 'appointment' && <AppointmentStatusPopover event={event} clinical={presentation.clinical ?? true} onChange={onUpdate ? change => onUpdate(event.id, change) : undefined} onDetails={onDetails ? () => onDetails(event) : undefined} />}
      </li>;
    })}</ol>}
  </section>;
}
