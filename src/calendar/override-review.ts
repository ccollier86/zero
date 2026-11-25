/** Native readonly decision entry points. No receipts, writes, offers or repairs.
 * Normal and independent authority precede private catalog/conflict probes.
 */
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import type { CalendarOverrideReview } from './override-contracts';
import { createCalendarReadContext, type CalendarReadContext } from './calendar-read-store';
import { CalendarError } from './error';
import { assertCalendarOwner, calendarActor, calendarAppointment, calendarResource, requireCalendarRight } from './realm-model';
import { calendarHash, calendarKey, calendarRecord } from './validation';
import { CALENDAR_APPOINTMENT_CREATE_FIELDS, CALENDAR_APPOINTMENT_UPDATE_FIELDS, normalizeCalendarAppointmentCreate,
  normalizeCalendarAppointmentUpdate, prepareNormalizedCalendarAppointmentCreate, prepareCalendarAppointmentUpdate } from './appointment-preparation';
import { assertCalendarOverrideReviewAuthority, isCalendarOverrideHardRefusal, reviewPreparedCalendarAppointmentOverride } from './overrides';

function reviewCandidate(prepare: () => CalendarOverrideReview): CalendarOverrideReview {
  try { return prepare(); }
  catch (error) { if (isCalendarOverrideHardRefusal(error)) return { status: 'non-reviewable' }; throw error; }
}

/** The proposed key is reserved only in the caller's draft, never by review.
 * Point-read the existing logical key namespace; never buy a transport receipt.
 */
function assertUnspent(context: CalendarReadContext, scopeId: string, principal: string, requestId: string): void {
  const id = calendarHash([scopeId, principal, requestId]);
  for (const table of ['_calendar_receipts', '_calendar_block_receipts', '_calendar_hold_receipts', '_calendar_location_receipts', '_calendar_type_receipts', '_calendar_lifecycle_receipts']) {
    if (context.db.get(table, id)) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  }
  if (context.db.get('_calendar_integration_operator_requests', calendarHash(['calendar-operator-v1', scopeId, principal, requestId]))) {
    throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  }
}

export function reviewCalendarAppointmentCreate(context: DatabaseReadQueryContext, input: unknown): CalendarOverrideReview {
  return reviewCalendarAppointmentCreateWithStore(createCalendarReadContext(context), input);
}
/** Trusted native composition only. The store is a fixed read capability,
 * never a strategy/callback/identifier accepted from authored command JSON. */
export function reviewCalendarAppointmentCreateWithStore(store: CalendarReadContext, input: unknown): CalendarOverrideReview {
  const r = calendarRecord(input, ['actor', 'requestId', 'id', ...CALENDAR_APPOINTMENT_CREATE_FIELDS]), actor = calendarActor(r.actor);
  const requestId = calendarKey(r.requestId), id = calendarKey(r.id);
  const authored = Object.fromEntries(Object.entries(r).filter(([key]) => !['actor', 'requestId', 'id'].includes(key)));
  // This stage normalizes only authored input and normal all-resource rights;
  // selected type/defaults/visits/LocalDate compilation happen below the fence.
  const value = normalizeCalendarAppointmentCreate(store, actor, id, authored);
  assertCalendarOverrideReviewAuthority(store, actor, value.resourceIds);
  assertUnspent(store, actor.scopeId, actor.principal, requestId);
  return reviewCandidate(() => reviewPreparedCalendarAppointmentOverride(store, actor, requestId, prepareNormalizedCalendarAppointmentCreate(store, actor, value)));
}

export function reviewCalendarAppointmentUpdate(context: DatabaseReadQueryContext, input: unknown): CalendarOverrideReview {
  return reviewCalendarAppointmentUpdateWithStore(createCalendarReadContext(context), input);
}
export function reviewCalendarAppointmentUpdateWithStore(store: CalendarReadContext, input: unknown): CalendarOverrideReview {
  const r = calendarRecord(input, ['actor', 'requestId', 'id', 'expectedRevision', ...CALENDAR_APPOINTMENT_UPDATE_FIELDS]), actor = calendarActor(r.actor);
  const requestId = calendarKey(r.requestId);
  assertCalendarOwner(store, actor.scopeId);
  const { row, resourceIds } = calendarAppointment(store, actor, r.id, 'manage');
  const patch = normalizeCalendarAppointmentUpdate(Object.fromEntries(Object.entries(r).filter(([key]) => !['actor', 'requestId', 'id', 'expectedRevision'].includes(key))));
  const resulting = patch.resourceIds ?? resourceIds;
  // Review never relaxes resulting-book authority for a no-op. Ordinary writes
  // retain their original grandfather/no-op masks in the shared preparation.
  for (const id of resulting) requireCalendarRight(store, actor, calendarResource(store, actor, id), 'book');
  assertCalendarOverrideReviewAuthority(store, actor, resulting);
  assertUnspent(store, actor.scopeId, actor.principal, requestId);
  return reviewCandidate(() => reviewPreparedCalendarAppointmentOverride(store, actor, requestId,
    prepareCalendarAppointmentUpdate(store, actor, row.id, r.expectedRevision, patch)));
}
