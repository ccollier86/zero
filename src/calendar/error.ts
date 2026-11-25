/** Internal calendar errors. Messages are static and never include appointment or provider input. */
import { DatabaseError } from '../databases/database-error';

export const CALENDAR_REJECTIONS = [
  'CALENDAR_INPUT_INVALID', 'CALENDAR_FORBIDDEN', 'CALENDAR_NOT_FOUND',
  'CALENDAR_REVISION_CONFLICT', 'CALENDAR_BOOKING_CONFLICT', 'CALENDAR_INTENT_CONFLICT',
  'CALENDAR_CAPACITY', 'CALENDAR_STATE_INVALID',
  'CALENDAR_AVAILABILITY_CONFLICT',
  'CALENDAR_HOLD_EXPIRED', 'CALENDAR_HOLD_STALE',
  'CALENDAR_TYPE_STALE', 'CALENDAR_TYPE_CONFLICT',
  'CALENDAR_TRANSITION_INVALID', 'CALENDAR_REASON_REQUIRED', 'CALENDAR_POLICY_STALE',
  'CALENDAR_VISIT_CONFLICT', 'CALENDAR_VISIT_STALE',
  'CALENDAR_AVAILABILITY_COVERAGE_REQUIRED', 'CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED', 'CALENDAR_TIME_RULES_UNAVAILABLE',
  'CALENDAR_LOCATION_FORMAT_UNSUPPORTED',
  'CALENDAR_OVERRIDE_STALE', 'CALENDAR_OVERRIDE_NOT_ALLOWED',
  // Append only: actor transport domainCode ordinals are retained evidence.
  'CALENDAR_SERIES_ACTION_REQUIRED',
] as const;
export type CalendarErrorCode = typeof CALENDAR_REJECTIONS[number]
  | 'CALENDAR_CONFIG_INVALID' | 'CALENDAR_NOT_READY' | 'CALENDAR_OUTCOME_UNKNOWN';

export class CalendarError extends Error {
  readonly status: number;
  readonly outcome: 'not-started' | 'not-committed' | 'unknown';
  constructor(readonly code: CalendarErrorCode, outcome: 'not-started' | 'not-committed' | 'unknown' = 'not-started') {
    super(code === 'CALENDAR_OUTCOME_UNKNOWN'
      ? 'Calendar operation outcome is unknown; reconcile the original request before retrying.'
      : 'Calendar operation could not be admitted.');
    this.name = 'CalendarError';
    this.outcome = code === 'CALENDAR_OUTCOME_UNKNOWN' ? 'unknown' : outcome;
    this.status = code === 'CALENDAR_INPUT_INVALID' ? 400 : code === 'CALENDAR_FORBIDDEN' ? 403
      : code === 'CALENDAR_NOT_FOUND' ? 404 : code === 'CALENDAR_CONFIG_INVALID' || code === 'CALENDAR_STATE_INVALID' ? 500
      : code === 'CALENDAR_NOT_READY' || code === 'CALENDAR_OUTCOME_UNKNOWN' || code === 'CALENDAR_TIME_RULES_UNAVAILABLE' ? 503 : 409;
  }
}

/** Domain rejections must throw through the actual actor transaction, not commit an error envelope. */
export function calendarCommand<T>(run: () => T): { ok: true; value: T } {
  try { return { ok: true, value: run() }; }
  catch (error) {
    if (error instanceof CalendarError) {
      const index = CALENDAR_REJECTIONS.indexOf(error.code as typeof CALENDAR_REJECTIONS[number]);
      if (index >= 0) throw new DatabaseError('DATABASE_CONFLICT', 'Calendar command was rejected.', {
        outcome: 'not-committed', retryable: false, details: { domainCode: index + 1 },
      });
    }
    throw error;
  }
}

/** Read failures also cross the native actor error envelope, without claiming a mutation rolled back. */
export function calendarRead<T>(run: () => T): T {
  try { return run(); }
  catch (error) {
    if (error instanceof CalendarError) {
      const index = CALENDAR_REJECTIONS.indexOf(error.code as typeof CALENDAR_REJECTIONS[number]);
      if (index >= 0) throw new DatabaseError('DATABASE_CONFLICT', 'Calendar query was rejected.', {
        outcome: 'not-started', retryable: false, details: { domainCode: index + 1, calendarRead: true },
      });
    }
    throw error;
  }
}

export function readCalendarRejection(error: unknown): CalendarError | null {
  if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT') return null;
  const read = error.details.calendarRead === true && error.outcome === 'not-started';
  const command = error.details.calendarRead === undefined && error.outcome === 'not-committed';
  if (!read && !command) return null;
  const index = error.details.domainCode;
  return typeof index === 'number' && Number.isInteger(index) && index > 0 && index <= CALENDAR_REJECTIONS.length
    ? new CalendarError(CALENDAR_REJECTIONS[index - 1]!, read ? 'not-started' : 'not-committed') : null;
}
