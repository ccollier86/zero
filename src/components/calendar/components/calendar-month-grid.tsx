/** One-provider month UI using the same local events and contextual actions as day/week. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconLock } from './calendar-icons';
import { dateKey, formatDay, formatMinute, monthDates, parseDay } from '../models/calendar-model';
import type { CalendarResource, EventPresentation, MenuTarget, ScheduleEvent } from '../types';
import { attentionLabel, eventColor, progressLabel } from '../models/appointment-presentation';
import { VisitIcon } from './appointment-controls';
import type { CalendarAllDayOccurrence } from '../models/calendar-all-day-model';
import { CalendarAllDayEvents } from './calendar-all-day-events';
import { calendarFormatCivilDate } from '../models/calendar-local-date';

interface Props {
  date: Date; provider: CalendarResource; events: readonly ScheduleEvent[];
  civilDate?: string; days?: readonly string[]; onDaySelect?(day: string): void; allDayOccurrences?: readonly CalendarAllDayOccurrence[];
  today?: string;
  onDateSelect(date: Date): void;
  onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void;
  eventPresentation(event: ScheduleEvent): EventPresentation;
}
function MonthDay({ day, currentMonth, selected, tabbable, provider, events, allDayOccurrences, civilDate, onDaySelect, onMenu, onDateSelect, eventPresentation, buttonRef, onKeyDown, today: displayToday }: Props & { day: string; currentMonth: boolean; selected: boolean; tabbable: boolean; buttonRef(node: HTMLButtonElement | null): void; onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void }) {
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const today = day === (displayToday ?? dateKey(new Date()));
  function measure() { const node = list.current; if (node) setEdges({ top: node.scrollTop > 1, bottom: node.scrollTop + node.clientHeight < node.scrollHeight - 1 }); }
  useLayoutEffect(() => { if (!(events.length + (allDayOccurrences?.length ?? 0)) || !list.current) return; const observer = new ResizeObserver(measure); observer.observe(list.current); const frame = requestAnimationFrame(measure); return () => { observer.disconnect(); cancelAnimationFrame(frame); }; }, [events.length, allDayOccurrences?.length]);
  const label = civilDate ? calendarFormatCivilDate(day) : formatDay(day);
  return <div className={`calendar-month-day ${currentMonth ? '' : 'is-other-month'} ${selected ? 'is-selected' : ''}`} data-month-day={day} role="group" aria-label={label}>
    <button type="button" className="calendar-month-add" ref={buttonRef} tabIndex={tabbable ? 0 : -1} data-month-slot={day} aria-label={`Schedule ${provider.name}, ${formatDay(day)}`} aria-haspopup="menu" onKeyDown={onKeyDown} onClick={event => onMenu({ kind: 'slot', slot: { resourceId: provider.id, date: day, minute: 540 } }, event.currentTarget, event.detail ? { x: event.clientX, y: event.clientY } : undefined)} onContextMenu={event => { event.preventDefault(); onMenu({ kind: 'slot', slot: { resourceId: provider.id, date: day, minute: 540 } }, event.currentTarget, { x: event.clientX, y: event.clientY }); }} />
    <div className="calendar-month-day-heading"><button type="button" tabIndex={-1} className={`calendar-month-date ${today ? 'is-today' : ''}`} aria-label={`Select ${label}`} onClick={() => onDaySelect ? onDaySelect(day) : onDateSelect(parseDay(day))}>{civilDate ? Number(day.slice(8)) : parseDay(day).getDate()}</button>{events.length + (allDayOccurrences?.length ?? 0) > 0 && <span>{events.length + (allDayOccurrences?.length ?? 0)}</span>}</div>
    <div className="calendar-month-events practice-scroll-list" ref={list} onScroll={measure} style={{ '--fade-top': edges.top ? 'var(--calendar-size-6)' : '0px', '--fade-bottom': edges.bottom ? 'var(--calendar-size-8)' : '0px' } as CSSProperties}>
      {allDayOccurrences && <CalendarAllDayEvents items={allDayOccurrences} onMenu={onMenu} />}
      {events.map(event => {
        const display = eventPresentation(event);
        const text = display.busyOnly ? 'Busy · other location' : event.title;
        const color = eventColor(event, provider, display.colorBy), attention = attentionLabel(event);
        if (display.busyOnly) return <div key={event.id} className="calendar-month-event is-busy" data-calendar-busy data-schedule-event={event.id} role="img" aria-label={`${text}, ${formatMinute(event.start)}`}><IconLock size="var(--calendar-size-10)" /><span>{formatMinute(event.start).replace(':00', '')}</span><span className="calendar-month-event-name">{text}</span></div>;
        return <button key={event.id} type="button" data-schedule-event={event.id} className={`calendar-month-event ${event.kind === 'block' ? 'is-block' : ''} ${event.status === 'cancelled' ? 'is-cancelled' : ''} ${attention ? 'has-attention' : ''}`} style={{ '--month-event-color': `var(--calendar-color-${color}-6)`, '--month-event-tint': `var(--calendar-color-${color}-0)` } as CSSProperties} aria-label={`${event.title}, ${formatDay(day)}, ${formatMinute(event.start)} to ${formatMinute(event.end)}, ${progressLabel(event, display.clinical)}${attention ? `, ${attention}` : ''}`} aria-haspopup="menu" title={`${event.title} · ${formatMinute(event.start)} – ${formatMinute(event.end)} · ${progressLabel(event, display.clinical)}${attention ? ` · ${attention}` : ''}`} onClick={e => onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, e.detail ? { x: e.clientX, y: e.clientY } : undefined)} onContextMenu={e => { e.preventDefault(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget, { x: e.clientX, y: e.clientY }); }} onKeyDown={e => { if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); onMenu({ kind: 'event', eventId: event.id }, e.currentTarget); } }}><span>{formatMinute(event.start).replace(':00', '')}</span><span className="calendar-month-event-name">{event.title}</span>{!display.coreOnly && event.kind === 'appointment' && <VisitIcon event={event} clinical={display.clinical} size="var(--calendar-size-11)" />}{attention && <span aria-hidden="true">!</span>}</button>;
      })}
    </div>
  </div>;
}
export function CalendarMonthGrid(props: Props) {
  const days = props.days ?? monthDates(props.date), selectedDay = props.civilDate ?? dateKey(props.date);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focusDay, setFocusDay] = useState(selectedDay);
  useEffect(() => setFocusDay(selectedDay), [selectedDay]);
  const active = days.includes(focusDay) ? focusDay : selectedDay;
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); props.onMenu({ kind: 'slot', slot: { resourceId: props.provider.id, date: days[index]!, minute: 540 } }, event.currentTarget); return; }
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowDown' ? index + 7 : event.key === 'ArrowUp' ? index - 7 : event.key === 'Home' ? index - index % 7 : event.key === 'End' ? index + 6 - index % 7 : null;
    if (next === null) return;
    event.preventDefault(); const day = days[Math.max(0, Math.min(days.length - 1, next))]!; setFocusDay(day); refs.current.get(day)?.focus();
  }
  return <div className="calendar-scroll calendar-month-scroll" role="group" aria-label="Month calendar" data-month-provider={props.provider.id} onFocusCapture={event => { const day = (event.target as HTMLElement).getAttribute('data-month-slot'); if (day) setFocusDay(day); }}>
    <div className="calendar-month-grid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div className="calendar-month-weekday" key={day}>{day}</div>)}
      {days.map((day, index) => <MonthDay key={day} {...props} day={day} currentMonth={props.civilDate ? day.slice(0, 7) === props.civilDate.slice(0, 7) : parseDay(day).getMonth() === props.date.getMonth()} selected={day === selectedDay} tabbable={day === active} allDayOccurrences={props.allDayOccurrences?.filter(item => item.date === day && item.resourceId === props.provider.id)} events={props.events.filter(event => event.date === day).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))} buttonRef={node => { if (node) refs.current.set(day, node); else refs.current.delete(day); }} onKeyDown={event => keyboard(event, index)} />)}
    </div>
  </div>;
}
