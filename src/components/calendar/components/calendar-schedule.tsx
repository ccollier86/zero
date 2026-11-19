/** Controlled calendar composition. No synthetic fixtures, persistence, identity or backend policy. */
import type { ReactNode } from 'react';
import { CalendarGrid } from './calendar-grid';
import { CalendarMonthGrid } from './calendar-month-grid';
import { CalendarAgenda } from './calendar-agenda';
import { dateKey, parseDay, weekDates } from '../models/calendar-model';
import type { CalendarResource, EventDraft, EventPresentation, GridColumn, MenuTarget, ScheduleEvent } from '../types';
import type { CalendarViewMode } from '../recovered/calendar/types/calendar-view-mode';
import type { CalendarAllDayOccurrence } from '../models/calendar-all-day-model';
import { calendarCivilDays, calendarFormatCivilDate } from '../models/calendar-local-date';
import '../styles/calendar-workspace.css';
export interface CalendarScheduleProps {
  date: Date; view: CalendarViewMode;
  /** Connected civil-date authority; omitted standalone Date behavior is unchanged. */
  civilDate?: string;
  days?: readonly string[];
  onDaySelect?(date: string): void;
  allDayOccurrences?: readonly CalendarAllDayOccurrence[];
  onCreateAllDay?(resourceId: string, date: string, trigger: HTMLElement): void;
  /** Already scoped for this view: one resource for week/month; selected resources for day/list. */
  resources: readonly CalendarResource[]; events: readonly ScheduleEvent[];
  currentMinute?: number; describeResource?(resource: CalendarResource): string;
  /** Explicit display-zone day for connected consumers. Standalone default remains browser-local. */
  today?: string;
  eventPresentation?(event: ScheduleEvent): EventPresentation;
  onDateSelect(date: Date): void;
  onMenu(target: MenuTarget, trigger: HTMLElement, point?: { x: number; y: number }): void;
  onEdit(event: ScheduleEvent): void; onUpdate?(id: string, change: Partial<EventDraft>): void;
  onDetails?(event: ScheduleEvent): void; empty?: ReactNode;
}
export function CalendarSchedule(props: CalendarScheduleProps) {
  const { date, view, resources, events, onMenu, eventPresentation = () => ({}), onDateSelect } = props;
  if (!resources.length) return props.empty ?? <div className="calendar-empty">Choose calendars to see the schedule.</div>;
  const selectedDay = props.civilDate ?? dateKey(date);
  if (view === 'agenda') return <CalendarAgenda {...props} date={selectedDay} />;
  if (view === 'month') return <CalendarMonthGrid date={date} civilDate={props.civilDate} days={props.days} onDaySelect={props.onDaySelect} allDayOccurrences={props.allDayOccurrences} today={props.today} provider={resources[0]!} events={events.filter(event => event.resourceId === resources[0]!.id)} onDateSelect={onDateSelect} onMenu={onMenu} eventPresentation={eventPresentation} />;
  const columns: GridColumn[] = view === 'day'
    ? resources.map(resource => ({ id: resource.id, resourceId: resource.id, date: selectedDay, title: resource.name, subtitle: props.describeResource?.(resource) ?? '', initials: resource.initials, color: resource.color }))
    : (props.days ?? (props.civilDate ? calendarCivilDays(props.civilDate, 'week') : weekDates(date))).map(day => ({ id: day, date: day, title: props.civilDate ? calendarFormatCivilDate(day, { weekday: 'short', day: 'numeric' }) : new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' }).format(parseDay(day)), subtitle: day === selectedDay ? 'Selected day' : '' }));
  return <CalendarGrid {...props} columns={columns} view={view} currentMinute={props.currentMinute ?? -1} eventPresentation={eventPresentation} />;
}
