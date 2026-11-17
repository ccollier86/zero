/** Browser-safe core calendar entry. Private actor/runtime/storage ownership is not exposed here. */
export { useCalendarResources, useCalendarAppointment, useCalendarAppointments, useCalendarLocations, useCalendarLocation, useCalendarResourceLocations } from '../../client/calendar-hooks';
export type { CalendarReadResult, UseCalendarAppointmentsResult } from '../../client/calendar-hooks';
export type { CalendarClient } from '../../client/calendar-client';
export { CalendarMutationError, CalendarReadError } from '../../client/calendar-mutation';
export type { CalendarOperationOutcome } from '../../client/calendar-mutation';
export type { CalendarResourceKind, CalendarResourceView, CalendarResourceInput, CalendarGrant,
  CalendarLocationInput, CalendarLocationReplacement, CalendarLocationView, CalendarLocationPageQuery, CalendarLocationPage, CalendarResourceLocationsView,
  CalendarAppointmentView, CalendarAppointmentInput, CalendarRescheduleInput, CalendarCommandReceipt,
  CalendarAvailabilityWindow, CalendarAvailabilityInput, CalendarAvailabilityView,
  CalendarBlockView, CalendarBlockInput, CalendarBlockRescheduleInput, CalendarBlockPage,
  CalendarHoldView, CalendarHoldInput, CalendarHoldConfirmationInput, CalendarHoldPage,
  CalendarRangeQuery, CalendarRequestOptions, CalendarControlOptions, CalendarReadOptions,
  CalendarResourcePageQuery, CalendarResourcePage, CalendarAppointmentPage, CalendarBusyPage,
  CalendarWatchUpdate, CalendarWatchOptions, ScopedCalendar } from '../../../calendar/contracts';
