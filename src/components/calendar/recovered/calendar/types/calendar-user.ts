/**
 * Represents a user/provider in the calendar
 */
export interface CalendarUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  initials: string;
}
