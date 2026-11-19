/** Browser-safe failures: no server messages, private bodies, automatic retries or new request identities. */
export type CalendarOperationOutcome = 'not-started' | 'not-committed' | 'unknown';
const codes = new Set(['CALENDAR_INPUT_INVALID', 'CALENDAR_FORBIDDEN', 'CALENDAR_NOT_FOUND', 'CALENDAR_REVISION_CONFLICT',
  'CALENDAR_BOOKING_CONFLICT', 'CALENDAR_INTENT_CONFLICT', 'CALENDAR_CAPACITY', 'CALENDAR_STATE_INVALID',
  'CALENDAR_CONFIG_INVALID', 'CALENDAR_NOT_READY', 'CALENDAR_OUTCOME_UNKNOWN', 'CALENDAR_AVAILABILITY_CONFLICT',
  'CALENDAR_HOLD_EXPIRED', 'CALENDAR_HOLD_STALE', 'CALENDAR_TYPE_STALE', 'CALENDAR_TYPE_CONFLICT',
  'CALENDAR_TRANSITION_INVALID', 'CALENDAR_REASON_REQUIRED', 'CALENDAR_POLICY_STALE', 'CALENDAR_VISIT_CONFLICT', 'CALENDAR_VISIT_STALE',
  'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED', 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED', 'CALENDAR_TIME_RULES_UNAVAILABLE', 'CALENDAR_LOCATION_FORMAT_UNSUPPORTED',
  'CALENDAR_OVERRIDE_STALE', 'CALENDAR_OVERRIDE_NOT_ALLOWED']);
export class CalendarMutationError extends Error {
  readonly requiresReconciliation: boolean;
  readonly requiresSameIdempotencyKey: boolean;
  constructor(readonly idempotencyKey: string, readonly outcome: CalendarOperationOutcome,
    readonly code: string | null, readonly status: number | null, readonly cancelled = false) {
    super(outcome === 'unknown' ? 'The calendar operation may have been accepted. Reconcile the original request before another write.'
      : 'The calendar operation was not accepted.');
    this.name = cancelled ? 'AbortError' : 'CalendarMutationError';
    this.requiresReconciliation = this.requiresSameIdempotencyKey = outcome === 'unknown';
  }
}
export class CalendarReadError extends Error {
  constructor(readonly code: string | null, readonly status: number | null, readonly terminal = false) {
    super('Calendar data could not be loaded. Reauthorize or retry the read.'); this.name = 'CalendarReadError';
  }
}
export function calendarFailureDetails(cause: unknown): { code: string | null; status: number | null; outcome: CalendarOperationOutcome } {
  const s = own(cause, 'status'), status = Number.isInteger(s) && Number(s) >= 400 && Number(s) <= 599 ? Number(s) : null;
  const body = own(cause, 'body'), raw = own(body, 'code'), outcome = own(body, 'outcome');
  const auth = status === 401 && (raw === 'UNAUTHORIZED' || raw === 'AUTH_UNAUTHORIZED')
    || status === 403 && (raw === 'FORBIDDEN' || raw === 'AUTH_FORBIDDEN');
  const admission = status === 428 && raw === 'LOGGING_ADMISSION_REQUIRED';
  const native = typeof raw === 'string' && codes.has(raw), code = native || auth || admission ? String(raw) : null;
  return { code, status, outcome: raw === 'CALENDAR_OUTCOME_UNKNOWN' || outcome === 'unknown' ? 'unknown'
    : native && status !== null && (outcome === 'not-started' || outcome === 'not-committed') ? outcome
    : auth || admission ? 'not-started' : 'unknown' };
}
export function calendarMutationFailure(cause: unknown, key: string): CalendarMutationError {
  const { code, status, outcome } = calendarFailureDetails(cause);
  return new CalendarMutationError(key, outcome, code, status, cause instanceof Error && cause.name === 'AbortError');
}
function own(value: unknown, key: string): unknown {
  try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; } catch { return undefined; }
}
