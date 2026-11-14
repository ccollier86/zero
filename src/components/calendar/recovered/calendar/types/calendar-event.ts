/**
 * Calendar event for day view
 */
export type CalendarEvent = {
  id: string;
  title: string;
  meta: string;
  start: number; // Hour as decimal (9.5 = 9:30)
  end: number;
  color: string;
  background: string;
};
