/** Focusable event card with one consistent action surface for pointer, touch and keyboard. */
import type { CSSProperties } from 'react';
import { IconCheck, IconDots, IconLock } from './calendar-icons';
import { formatDay, formatMinute } from '../models/calendar-model';
import { DAY_START, HOUR_HEIGHT, type CalendarResource, type EventPresentation, type MenuTarget, type ScheduleEvent } from '../types';
import type { EventLane } from '../models/overlap-layout';
import { attentionLabel, eventColor, progressLabel, statusLabel } from '../models/appointment-presentation';
import { AppointmentStatusPopover, VisitIcon } from './appointment-controls';
import type { EventDraft } from '../types';
interface Props { item: EventLane; resource?: CalendarResource; onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void; onEdit(event: ScheduleEvent): void; presentation?: EventPresentation; onUpdate?(id: string, change: Partial<EventDraft>): void; onDetails?(event: ScheduleEvent): void }
export function CalendarEventCard({ item: { event, lane, lanes }, resource, onMenu, onEdit, presentation, onUpdate, onDetails }: Props) {
  const label = `${event.title}, ${resource?.name ?? 'Calendar'}, ${formatDay(event.date)}, ${formatMinute(event.start)} to ${formatMinute(event.end)}, ${event.status}`;
  const color = eventColor(event, resource, presentation?.colorBy), attention = attentionLabel(event);
  const style = { '--event-color': `var(--calendar-color-${color}-6)`, '--event-tint': `var(--calendar-color-${color}-0)`, top: `calc(${(event.start - DAY_START) / 60} * var(--calendar-hour-height))`, height: `max(var(--calendar-event-min-height), calc(${(event.end - event.start) / 60} * var(--calendar-hour-height) - var(--calendar-event-gap)))`, left: `calc(${lane / lanes * 100}% + var(--calendar-size-4))`, width: `calc(${100 / lanes}% - var(--calendar-size-8))` } as CSSProperties;
  if (presentation?.busyOnly) return <div className="schedule-event schedule-event-block schedule-event-busy" data-schedule-event={event.id} data-calendar-busy role="img" aria-label={`Busy at another location, ${resource?.name}, ${formatDay(event.date)}, ${formatMinute(event.start)} to ${formatMinute(event.end)}`} style={style}><span className="schedule-event-title"><IconLock size="var(--calendar-size-11)" />Busy · other location</span>{event.end - event.start >= 30 && <span className="schedule-event-time">{formatMinute(event.start)} – {formatMinute(event.end)}</span>}</div>;
  return <div className="schedule-event-shell" style={style}><button type="button" className={`schedule-event ${event.kind === 'block' ? 'schedule-event-block' : ''} ${event.status === 'cancelled' ? 'schedule-event-cancelled' : ''} ${attention ? 'has-attention' : ''}`} data-schedule-event={event.id} data-resource-id={event.resourceId} aria-label={label} aria-haspopup="menu" title={label}
    onClick={e => { e.stopPropagation(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, e.detail ? { x: e.clientX, y: e.clientY } : undefined); }}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, { x: e.clientX, y: e.clientY }); }}
    onDoubleClick={e => { e.stopPropagation(); onEdit(event); }}
    onKeyDown={e => { if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget); } }}>
    <span className="schedule-event-title">{event.kind === 'block' && <IconLock size="var(--calendar-size-12)" />}{event.status === 'completed' && <IconCheck size="var(--calendar-size-12)" />}{event.title}</span>
    {event.end - event.start >= 30 && <span className="schedule-event-time">{formatMinute(event.start)} – {formatMinute(event.end)}</span>}
    {!presentation?.coreOnly && event.end - event.start >= 60 && <span className="schedule-event-meta">{event.kind === 'block' ? 'Unavailable' : `${event.location}${presentation?.siteLabel ? ` · ${presentation.siteLabel}` : ''}`}{event.status !== 'confirmed' ? ` · ${statusLabel(event.status)}` : ''}</span>}
    {!presentation?.coreOnly && event.kind === 'appointment' && event.end - event.start >= 60 && <span className="schedule-event-signal"><VisitIcon event={event} clinical={presentation?.clinical} size="var(--calendar-size-10)" />{progressLabel(event, presentation?.clinical)}{attention ? ` · ${attention}` : ''}</span>}
    {event.kind === 'block' && <IconDots className="schedule-event-dots" size="var(--calendar-size-14)" aria-hidden="true" />}
  </button>{!presentation?.coreOnly && event.kind === 'appointment' && event.end - event.start >= 25 && <AppointmentStatusPopover event={event} clinical={presentation?.clinical ?? true} onChange={onUpdate ? change => onUpdate(event.id, change) : undefined} onDetails={onDetails ? () => onDetails(event) : undefined} />}</div>;
}
