/**
 * data-studio-http-error.ts
 *
 * Maps domain failures to a privacy-safe HTTP result. This adapter exposes
 * stable codes and fixed messages only; it never reflects caught error text.
 */

import {
  normalizeDataStudioError,
  type DataStudioErrorCode,
  type DataStudioOperationOutcome,
} from './data-studio-error';

export type DataStudioHttpOperation = 'read' | 'write';

export interface DataStudioHttpFailure {
  readonly ok: false;
  readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 500 | 503;
  readonly body: Readonly<{
    error: string;
    code: DataStudioErrorCode;
    retryable: boolean;
    /** Present only for a write whose commit outcome cannot be established. */
    requiresSameIdempotencyKey?: true;
  }>;
}

interface PublicErrorShape {
  readonly status: DataStudioHttpFailure['status'];
  readonly message: string;
}

const PUBLIC_ERRORS = Object.freeze({
  DATA_STUDIO_DISABLED: publicError(503, 'Data Studio is disabled.'),
  DATA_STUDIO_NOT_READY: publicError(503, 'Data Studio is not ready.'),
  DATA_STUDIO_AUTHORITY_REQUIRED: publicError(403, 'Data Studio access is forbidden.'),
  DATA_STUDIO_AUTHORITY_CHANGED: publicError(403, 'Data Studio authority changed.'),
  DATA_STUDIO_TABLE_NOT_FOUND: publicError(404, 'Data Studio table was not found.'),
  DATA_STUDIO_TABLE_ARCHIVED: publicError(409, 'Data Studio table is archived.'),
  DATA_STUDIO_TABLE_KEY_CONFLICT: publicError(409, 'Data Studio table key is already in use.'),
  DATA_STUDIO_ROW_NOT_FOUND: publicError(404, 'Data Studio row was not found.'),
  DATA_STUDIO_SCHEMA_INVALID: publicError(422, 'Data Studio schema is invalid.'),
  DATA_STUDIO_VALUE_INVALID: publicError(422, 'Data Studio value is invalid.'),
  DATA_STUDIO_LIMIT_EXCEEDED: publicError(413, 'Data Studio input exceeds a limit.'),
  DATA_STUDIO_REVISION_CONFLICT: publicError(409, 'Data Studio revision changed.'),
  DATA_STUDIO_IDEMPOTENCY_CONFLICT: publicError(409, 'Data Studio mutation conflicts with an earlier request.'),
  DATA_STUDIO_OPERATION_IN_PROGRESS: publicError(409, 'Data Studio operation is already in progress.'),
  DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN: publicError(503, 'Data Studio mutation outcome is unknown.'),
  DATA_STUDIO_UNAVAILABLE: publicError(503, 'Data Studio is temporarily unavailable.'),
  DATA_STUDIO_INTERNAL_ERROR: publicError(500, 'Data Studio operation failed.'),
} satisfies Record<DataStudioErrorCode, PublicErrorShape>);

/** Convert any caught value into a stable, privacy-safe HTTP failure. */
export function toDataStudioHttpFailure(
  error: unknown,
  operation: DataStudioHttpOperation,
): DataStudioHttpFailure {
  const normalized = normalizeDataStudioError(error);
  const publicShape = PUBLIC_ERRORS[normalized.code];
  const ambiguousWrite = operation === 'write' && normalized.outcome === 'unknown';
  return Object.freeze({
    ok: false,
    status: ambiguousWrite ? 503 : publicShape.status,
    body: Object.freeze({
      error: ambiguousWrite
        ? 'Data Studio mutation outcome is unknown.'
        : publicShape.message,
      code: normalized.code,
      retryable: normalized.retryable,
      ...(ambiguousWrite ? { requiresSameIdempotencyKey: true as const } : {}),
    }),
  });
}

function publicError(
  status: PublicErrorShape['status'],
  message: string,
): PublicErrorShape {
  return Object.freeze({ status, message });
}

/** @internal Exposed only for exhaustive contract testing. */
export function dataStudioOutcomeRequiresSameIdempotencyKey(
  operation: DataStudioHttpOperation,
  outcome: DataStudioOperationOutcome | null,
): boolean {
  return operation === 'write' && outcome === 'unknown';
}
