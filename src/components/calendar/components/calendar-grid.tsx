/** Shared scroll viewport and roving time-slot navigation for resource-day and weekly columns. */
import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar, Text } from './calendar-ui';
import { dateKey, formatMinute } from '../models/calendar-model';
import { calendarFormatCivilDate } from '../models/calendar-local-date';
import { eventLanes } from '../models/overlap-layout';
import { CalendarEventCard } from './calendar-event';
import { CalendarAllDayEvents } from './calendar-all-day-events';
import type { CalendarAllDayOccurrence } from '../models/calendar-all-day-model';
import type { EventDraft } from '../types';
import { DAY_END, DAY_START, HOUR_HEIGHT, SLOT_MINUTES, type CalendarResource, type EventPresentation, type GridColumn, type MenuTarget, type ScheduleEvent } from '../types';
interface Props { columns: readonly GridColumn[]; events: readonly ScheduleEvent[]; resources: readonly CalendarResource[]; view: 'day' | 'week'; currentMinute: number; today?: string; allDayOccurrences?: readonly CalendarAllDayOccurrence[]; onCreateAllDay?(resourceId: string, date: string, trigger: HTMLElement): void; onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void; onEdit(event: ScheduleEvent): void; eventPresentation?(event: ScheduleEvent): EventPresentation; onUpdate?(id: string, change: Partial<EventDraft>): void; onDetails?(event: ScheduleEvent): void }
export function CalendarGrid({ columns, events, resources, view, currentMinute, today = dateKey(new Date()), allDayOccurrences, onCreateAllDay, onMenu, onEdit, eventPresentation, onUpdate, onDetails }: Props) {
  const [active, setActive] = useState({ columnId: columns[0]?.id ?? '', minute: 9 * 60 });
  const slots = useRef(new Map<string, HTMLButtonElement>());
  const activeColumn = columns.some(column => column.id === active.columnId) ? active.columnId : columns[0]?.id;
  const minutes = Array.from({ length: (DAY_END - DAY_START) / SLOT_MINUTES }, (_, i) => DAY_START + i * SLOT_MINUTES);
  function keyboard(e: KeyboardEvent<HTMLButtonElement>, columnIndex: number, minute: number) {
    const column = columns[columnIndex]!;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); onMenu({ kind: 'slot', slot: { resourceId: column.resourceId ?? resources[0]!.id, date: column.date, minute } }, e.currentTarget); return; }
    let nextColumn = columnIndex, nextMinute = minute;
    if (e.key === 'ArrowUp') nextMinute -= SLOT_MINUTES;
    else if (e.key === 'ArrowDown') nextMinute += SLOT_MINUTES;
    else if (e.key === 'ArrowLeft') nextColumn--;
    else if (e.key === 'ArrowRight') nextColumn++;
    else if (e.key === 'Home') nextMinute = DAY_START;
    else if (e.key === 'End') nextMinute = DAY_END - SLOT_MINUTES;
    else return;
    e.preventDefault(); nextColumn = Math.max(0, Math.min(columns.length - 1, nextColumn)); nextMinute = Math.max(DAY_START, Math.min(DAY_END - SLOT_MINUTES, nextMinute));
    const id = columns[nextColumn]!.id; setActive({ columnId: id, minute: nextMinute }); slots.current.get(`${id}/${nextMinute}`)?.focus();
  }
  return <div className="calendar-scroll" role="group" aria-label={view === 'day' ? 'Provider day calendar' : 'Week calendar'}>
    <div className="calendar-grid" style={{ gridTemplateRows: allDayOccurrences ? 'var(--calendar-column-header-height) auto auto' : undefined, gridTemplateColumns: `var(--calendar-time-gutter) repeat(${columns.length}, minmax(var(--calendar-${view === 'day' ? 'day' : 'week'}-column-min), 1fr))`, minWidth: `calc(var(--calendar-time-gutter) + ${columns.length} * var(--calendar-${view === 'day' ? 'day' : 'week'}-column-min))` }}>
      <div className="calendar-corner"><span>Local<br />time</span></div>
      {allDayOccurrences && <div className="calendar-all-day-label" style={{ gridColumn: 1, gridRow: 2 }}>All-day</div>}
      <div className="calendar-time-axis" style={{ gridColumn: 1, gridRow: allDayOccurrences ? 3 : 2 }} aria-hidden="true">{Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => <div key={i} className="calendar-time-label" style={{ height: 'var(--calendar-hour-height)' }}>{formatMinute(DAY_START + i * 60)}</div>)}</div>
      {columns.map((column, index) => {
        const items = events.filter(event => event.date === column.date && (!column.resourceId || event.resourceId === column.resourceId));
        const allDayItems = allDayOccurrences?.filter(item => item.date === column.date && (!column.resourceId || item.resourceId === column.resourceId));
        const count = items.filter(event => event.status !== 'cancelled').length + (allDayItems?.filter(item => item.status !== 'cancelled').length ?? 0);
        return <Fragment key={column.id}>
          <div className="calendar-column-heading" data-column-heading={column.id} style={{ gridColumn: index + 2, gridRow: 1 }}>
            {column.initials && <Avatar size="var(--calendar-size-29)" radius="xl" color={column.color} aria-hidden="true">{column.initials}</Avatar>}
            <div className="calendar-column-name"><Text size="sm" fw="var(--calendar-weight-heading)" truncate>{column.title}</Text><Text size="xs" c="dimmed" truncate>{[column.subtitle, `${count} ${count === 1 ? 'event' : 'events'}`].filter(Boolean).join(' · ')}</Text></div>
          </div>
          {allDayOccurrences && <div className="calendar-all-day-lane" data-all-day-column={column.id} style={{ gridColumn: index + 2, gridRow: 2 }}>
            <CalendarAllDayEvents items={allDayItems!} onMenu={onMenu} />
            {onCreateAllDay && <button type="button" className="calendar-all-day-add" aria-label={`New all-day appointment, ${column.title}`} onClick={event => onCreateAllDay(column.resourceId ?? resources[0]!.id, column.date, event.currentTarget)}>+ All-day</button>}
          </div>}
          <div className="calendar-column-body" data-calendar-column={column.id} data-calendar-date={column.date} style={{ gridColumn: index + 2, gridRow: allDayOccurrences ? 3 : 2, height: `calc(${(DAY_END - DAY_START) / 60} * var(--calendar-hour-height))` }}>
            {minutes.map(minute => <button key={minute} ref={node => { const key = `${column.id}/${minute}`; if (node) slots.current.set(key, node); else slots.current.delete(key); }} type="button" className={`calendar-slot ${minute % 60 === 0 ? 'calendar-slot-hour' : ''}`} style={{ height: `calc(${SLOT_MINUTES / 60} * var(--calendar-hour-height))` }} data-slot-minute={minute} data-column-id={column.id}
              tabIndex={activeColumn === column.id && active.minute === minute ? 0 : -1} aria-label={`${column.title}, ${calendarFormatCivilDate(column.date)}, ${formatMinute(minute)}`} aria-haspopup="menu"
              onFocus={() => setActive({ columnId: column.id, minute })} onKeyDown={e => keyboard(e, index, minute)}
              onClick={e => onMenu({ kind: 'slot', slot: { resourceId: column.resourceId ?? resources[0]!.id, date: column.date, minute } }, e.currentTarget, e.detail ? { x: e.clientX, y: e.clientY } : undefined)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onMenu({ kind: 'slot', slot: { resourceId: column.resourceId ?? resources[0]!.id, date: column.date, minute } }, e.currentTarget, { x: e.clientX, y: e.clientY }); }} />)}
            {eventLanes(items).map(item => <CalendarEventCard key={item.event.id} item={item} resource={resources.find(resource => resource.id === item.event.resourceId)} onMenu={onMenu} onEdit={onEdit} presentation={eventPresentation?.(item.event)} onUpdate={onUpdate} onDetails={onDetails} />)}
            {column.date === today && currentMinute >= DAY_START && currentMinute < DAY_END && <div className="calendar-now" aria-hidden="true" style={{ top: `calc(${(currentMinute - DAY_START) / 60} * var(--calendar-hour-height))` }} />}
          </div>
        </Fragment>;
      })}
    </div>
  </div>;
}
