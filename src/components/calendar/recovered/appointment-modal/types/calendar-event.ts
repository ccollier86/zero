import type { CalendarEventBase } from '../../shared/types/index';

/**
 * Calendar event with metadata for modal
 */
export interface CalendarEvent extends CalendarEventBase {
  meta: string;
}
