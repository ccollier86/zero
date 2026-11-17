/** Server-facing setup and facade types only. Private Fabric owners, raw actors and commands are not public APIs. */
export type { CalendarConfig, ResolvedCalendarConfig } from './config';
export type { CalendarResourceKind, CalendarResourceView, CalendarResourceInput, CalendarGrant,
  CalendarAppointmentView, CalendarAppointmentInput, CalendarRescheduleInput, CalendarCommandReceipt,
  CalendarRangeQuery, CalendarRequestOptions, CalendarControlOptions, CalendarReadOptions,
  CalendarResourcePageQuery, CalendarResourcePage, CalendarAppointmentPage, CalendarBusyPage,
  CalendarWatchUpdate, CalendarWatchOptions, ScopedCalendar } from './contracts';
export { CalendarError } from './error';
export type { CalendarErrorCode } from './error';
