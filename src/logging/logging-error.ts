/** Safe logging-domain failures. Never attach event bodies, SQL, actor paths or credentials. */
export type LoggingErrorCode =
  | 'LOGGING_CONFIG_INVALID' | 'LOGGING_NOT_READY' | 'LOGGING_FORBIDDEN' | 'LOGGING_AUDIT_UNAVAILABLE' | 'LOGGING_EVENT_INVALID' | 'LOGGING_EVENT_CONFLICT'
  | 'LOGGING_QUERY_INVALID' | 'LOGGING_BACKPRESSURE' | 'LOGGING_CLOSED'
  | 'LOGGING_WRITE_FAILED' | 'LOGGING_OUTCOME_UNKNOWN' | 'LOGGING_RESPONSE_INVALID';

/** A failed admission differs from a dispatched write whose acknowledgment was lost. */
export class LoggingError extends Error {
  constructor(
    readonly code: LoggingErrorCode,
    message: string,
    readonly outcome: 'not-admitted' | 'not-committed' | 'unknown' = 'not-admitted',
  ) { super(message); this.name = 'LoggingError'; }
}
