import type { CalendarEvent } from './calendar-event';

/**
 * Calendar event for week view (includes day index)
 */
export type WeekCalendarEvent = CalendarEvent & {
  dayIndex: number; // 0-6 for Mon-Sun
};
