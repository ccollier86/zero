/** Server-facing setup and facade types only. Private Fabric owners, raw actors and commands are not public APIs. */
export type { CalendarConfig, ResolvedCalendarConfig } from './config';
export type { CalendarResourceKind, CalendarResourceView, CalendarResourceInput, CalendarGrant,
  CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot, CalendarAppointmentTypeInput, CalendarAppointmentTypeReplacement,
  CalendarAppointmentTypeView, CalendarAppointmentTypePageQuery, CalendarAppointmentTypePage, CalendarResourceTypesInput, CalendarResourceTypesView,
  CalendarLocationInput, CalendarLocationReplacement, CalendarLocationView, CalendarLocationPageQuery, CalendarLocationPage, CalendarResourceLocationsView,
  CalendarAppointmentView, CalendarAppointmentInput, CalendarRescheduleInput, CalendarCommandReceipt,
  CalendarAvailabilityWindow, CalendarAvailabilityInput, CalendarAvailabilityView,
  CalendarBlockView, CalendarBlockInput, CalendarBlockRescheduleInput, CalendarBlockPage,
  CalendarHoldView, CalendarHoldInput, CalendarHoldConfirmationInput, CalendarHoldPage,
  CalendarRangeQuery, CalendarRequestOptions, CalendarControlOptions, CalendarReadOptions,
  CalendarResourcePageQuery, CalendarResourcePage, CalendarAppointmentPage, CalendarBusyPage,
  CalendarWatchUpdate, CalendarWatchOptions, ScopedCalendar } from './contracts';
export { CalendarError } from './error';
export type { CalendarErrorCode } from './error';
