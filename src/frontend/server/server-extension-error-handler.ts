/** Privacy-safe error responses shared by Zero-native server extensions. */

import { ValidationError, type AnyElysia } from 'elysia';

import { getPublicAuthErrorMessage } from '../../auth/auth-error-response';
import { AuthError } from '../../auth/types';
import { WorkflowError } from '../../workflows/workflow-error';
import { WorkerError } from '../../workers/worker-error';
import { JobsError } from '../../jobs/error';
import { LoggingError } from '../../logging/logging-error';
import { projectLoggingHttpFailure } from '../../logging/logging-http-error';

export const ZERO_REQUEST_VALIDATION_FAILED = 'ZERO_REQUEST_VALIDATION_FAILED';
export const ZERO_REQUEST_PARSE_FAILED = 'ZERO_REQUEST_PARSE_FAILED';
export const ZERO_RESPONSE_VALIDATION_FAILED = 'ZERO_RESPONSE_VALIDATION_FAILED';

/**
 * Map errors raised before an extension handler runs without reflecting the
 * rejected body, validation schema, or parser details back to the caller.
 */
export function applyServerExtensionErrorHandler(app: AnyElysia): AnyElysia {
  return (app as AnyElysia & {
    onError(handler: (context: {
      code: string;
      error: unknown;
      set: { status?: number };
    }) => unknown): AnyElysia;
  }).onError(function mapZeroExtensionError({ code, error, set }) {
    if (error instanceof JobsError) {
      set.status = error.status;
      return { error: error.message, code: error.code, outcome: error.outcome };
    }
    if (error instanceof AuthError) {
      set.status = error.status;
      return {
        error: getPublicAuthErrorMessage(error),
        code: error.code,
      };
    }

    if (error instanceof LoggingError) {
      const failure = projectLoggingHttpFailure(error);
      set.status = failure.status;
      return failure.body;
    }

    // App-owned HTTP/MCP adapters use the same public Torrent contracts as
    // native workflow routes. Preserve domain codes without exposing 5xx detail.
    if (error instanceof WorkflowError) {
      set.status = error.status;
      return { error: error.status >= 500 ? 'Workflow operation failed.' : error.message,
        code: error.code, ...(error.retryable ? { retryable: true } : {}) };
    }

    if (error instanceof WorkerError) {
      const status = error.code === 'WORKER_CAPACITY' ? 429
        : error.code === 'WORKER_CANCELLED' ? 409
        : error.code === 'WORKER_TASK_INVALID' ? 422
          : error.code === 'WORKER_QUEUE_TIMEOUT' || error.code === 'WORKER_NOT_READY' || error.code === 'WORKER_AUTHORITY_CHANGED' ? 503
            : error.code === 'WORKER_EXECUTION_TIMEOUT' ? 504 : 500;
      set.status = status;
      return { error: error.code === 'WORKER_CANCELLED' ? 'Worker task was cancelled.' : status === 422 ? 'Worker task input was rejected.' : 'Worker operation could not be completed.',
        code: error.code, outcome: error.outcome,
        ...(error.outcome === 'not-started' && (status === 429 || error.code === 'WORKER_QUEUE_TIMEOUT') ? { retryable: true } : {}) };
    }

    if (code === 'VALIDATION' && error instanceof ValidationError
      && error.type === 'response') {
      set.status = 500;
      return {
        error: 'Invalid server response.',
        code: ZERO_RESPONSE_VALIDATION_FAILED,
      };
    }

    if (code === 'VALIDATION') {
      set.status = 422;
      return {
        error: 'Invalid request.',
        code: ZERO_REQUEST_VALIDATION_FAILED,
      };
    }

    if (code === 'PARSE') {
      set.status = 400;
      return {
        error: 'Invalid request body.',
        code: ZERO_REQUEST_PARSE_FAILED,
      };
    }

    return undefined;
  });
}
