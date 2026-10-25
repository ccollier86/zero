/** One privacy-safe projection for native logging and app-owned Zero endpoints. */
import type { LoggingError } from './logging-error';

export function projectLoggingHttpFailure(error: LoggingError) {
  // A corrupt worker response or server configuration is not bad client input.
  const status = error.code === 'LOGGING_FORBIDDEN' ? 403
    : error.code === 'LOGGING_ADMISSION_REQUIRED' ? 428
      : error.code === 'LOGGING_BACKPRESSURE' ? 429
        : error.code === 'LOGGING_EVENT_INVALID' || error.code === 'LOGGING_QUERY_INVALID' ? 422
          : error.code === 'LOGGING_EVENT_CONFLICT' ? 409 : 503;
  return {
    status,
    body: {
      code: error.code,
      outcome: error.outcome,
      error: error.code === 'LOGGING_ADMISSION_REQUIRED'
        ? 'Audit delivery must be confirmed before protected work continues.'
        : error.outcome === 'unknown'
          ? 'Operation outcome is unknown; reconcile before retrying.'
          : 'Logging operation could not be confirmed.',
    },
  };
}
