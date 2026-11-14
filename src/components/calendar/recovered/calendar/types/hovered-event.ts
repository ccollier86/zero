import type { CalendarEvent } from './calendar-event';
import type { WeekCalendarEvent } from './week-calendar-event';

/**
 * Event with mouse position for popover display
 */
export type HoveredEvent =
  | ((CalendarEvent | WeekCalendarEvent) & {
      x: number;
      y: number;
    })
  | null;
