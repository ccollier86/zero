/** Server-facing setup and facade types only. Private Fabric owners, raw actors and commands are not public APIs. */
export type { CalendarConfig, ResolvedCalendarConfig } from './config';
export type { CalendarResourceKind, CalendarResourceView, CalendarResourceInput, CalendarGrant,
  CalendarCapabilities,
  CalendarAvailabilityPolicyInput, CalendarAvailabilityPolicyView, CalendarExplicitAvailabilityPolicyInput,
  CalendarWeeklyAvailabilityPolicyInput, CalendarWorkingHoursSnapshot,
  CalendarParticipantReference, CalendarParticipantView, CalendarParticipantDirectoryQuery, CalendarParticipantDirectoryPage, CalendarParticipantsView,
  CalendarVisitMode, CalendarVisitInput, CalendarVisitSnapshot, CalendarLocationReference, CalendarLocationSnapshot, CalendarVisitLocationQuery,
  CalendarAppointmentStatus, CalendarAppointmentLifecycle, CalendarAppointmentTransitionInput, CalendarAppointmentTransitions,
  CalendarLifecyclePolicyInput, CalendarLifecyclePolicy, CalendarCancellationOptions,
  CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot, CalendarAppointmentTypeInput, CalendarAppointmentTypeReplacement,
  CalendarAppointmentTypeView, CalendarAppointmentTypePageQuery, CalendarAppointmentTypePage, CalendarResourceTypesInput, CalendarResourceTypesView,
  CalendarLocationInput, CalendarLocationReplacement, CalendarLocationView, CalendarLocationPageQuery, CalendarLocationPage, CalendarResourceLocationsView,
  CalendarAppointmentView, CalendarAppointmentInput, CalendarRescheduleInput, CalendarAppointmentUpdateInput, CalendarCommandReceipt,
  CalendarAppointmentCreateInput, CalendarExplicitAppointmentInput, CalendarAppointmentIntervalInput,
  CalendarAllDayAppointmentInterval, CalendarExplicitTimedAppointmentInterval, CalendarDateRangeQuery,
  CalendarAvailabilityWindow, CalendarAvailabilityInput, CalendarAvailabilityView,
  CalendarBlockView, CalendarBlockInput, CalendarBlockRescheduleInput, CalendarBlockPage,
  CalendarHoldView, CalendarHoldInput, CalendarHoldConfirmationInput, CalendarHoldPage,
  CalendarRangeQuery, CalendarRequestOptions, CalendarControlOptions, CalendarReadOptions,
  CalendarResourcePageQuery, CalendarResourcePage, CalendarAppointmentPage, CalendarBusyPage,
  CalendarWatchUpdate, CalendarWatchOptions, ScopedCalendar } from './contracts';
export { CalendarError } from './error';
export type { CalendarErrorCode } from './error';
