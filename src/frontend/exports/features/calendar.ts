/** Browser-safe core calendar entry. Private actor/runtime/storage ownership is not exposed here. */
export { useCalendarResources, useCalendarAppointment, useCalendarAppointments } from '../../client/calendar-hooks';
export type { CalendarReadResult, UseCalendarAppointmentsResult } from '../../client/calendar-hooks';
export type { CalendarClient } from '../../client/calendar-client';
export { CalendarMutationError, CalendarReadError } from '../../client/calendar-mutation';
export type { CalendarOperationOutcome } from '../../client/calendar-mutation';
export type { CalendarResourceKind, CalendarResourceView, CalendarResourceInput, CalendarGrant,
  CalendarAppointmentView, CalendarAppointmentInput, CalendarRescheduleInput, CalendarCommandReceipt,
  CalendarRangeQuery, CalendarRequestOptions, CalendarControlOptions, CalendarReadOptions,
  CalendarResourcePageQuery, CalendarResourcePage, CalendarAppointmentPage, CalendarBusyPage,
  CalendarWatchUpdate, CalendarWatchOptions, ScopedCalendar } from '../../../calendar/contracts';
