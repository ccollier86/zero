/** Private shared policy/occupancy checks. Normalized candidates and a scope confer NO booking authority. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { CalendarAppointmentTypeReference, CalendarAppointmentTypeSnapshot, CalendarVisitInput, CalendarVisitSnapshot } from './contracts';
import { assertCalendarTypePolicyForScope, assertCalendarBookingTypeForScope } from './appointment-type-bindings';
import { assertCalendarVisitPolicyForScope, assertCalendarBookingVisitForScope } from './visit-bindings';
import { assertCalendarAvailability } from './availability-model';
import { assertCalendarResourcesAvailable } from './occupancy';
import type { CalendarTimedInterval } from './time';

export interface CalendarBookingCandidate {
  readonly resourceIds: readonly string[];
  readonly interval: CalendarTimedInterval;
  readonly appointmentType?: CalendarAppointmentTypeReference;
  readonly visit?: CalendarVisitInput;
}
/** Explicit existing-handler decisions, not caller JSON. Omitted checks preserve accepted history. */
export interface CalendarBookingRevalidation {
  readonly type: boolean;
  readonly visit: boolean;
  readonly availabilityResourceIds: readonly string[];
  readonly occupancy: false | {
    readonly except?: { readonly kind: 'appointment' | 'block' | 'hold'; readonly id: string };
    readonly now?: number;
  };
}
export interface CalendarBookingAdmission {
  /** Only freshly revalidated selections are returned. Skipped checks do not resolve historical catalogs. */
  readonly appointmentType?: CalendarAppointmentTypeSnapshot;
  readonly visit?: CalendarVisitSnapshot;
}

/** Call after exact replay/CAS/terminal and all-resource authority admission, inside the same short writer.
 * Wrappers retain authority, participant fences, no-op rules, budgets, bindings, receipts, effects and audit.
 */
export function admitCalendarBookingCandidate(context: DatabaseWriteCommandContext, scopeId: string,
  candidate: CalendarBookingCandidate, checks: CalendarBookingRevalidation): CalendarBookingAdmission {
  const { resourceIds, interval, appointmentType, visit } = candidate;
  // Complete BOTH intersections before resolving either client-selected private catalog generation.
  if (checks.type) assertCalendarTypePolicyForScope(context, scopeId, resourceIds, appointmentType);
  if (checks.visit) assertCalendarVisitPolicyForScope(context, scopeId, resourceIds, visit);
  const acceptedType = checks.type ? assertCalendarBookingTypeForScope(context, scopeId, resourceIds, interval, appointmentType) : undefined;
  const acceptedVisit = checks.visit ? assertCalendarBookingVisitForScope(context, scopeId, resourceIds, visit) : undefined;
  if (checks.availabilityResourceIds.length) assertCalendarAvailability(context, scopeId, checks.availabilityResourceIds, interval);
  if (checks.occupancy) assertCalendarResourcesAvailable(context, scopeId, resourceIds, interval, checks.occupancy.except, checks.occupancy.now);
  return { appointmentType: acceptedType, visit: acceptedVisit };
}
