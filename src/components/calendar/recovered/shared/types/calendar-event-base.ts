/**
 * Base calendar event type used across demos
 */
export type CalendarEventBase = {
  id: string;
  title: string;
  start: number; // Hour as decimal (9.5 = 9:30)
  end: number;
  color: string;
  background: string;
};
