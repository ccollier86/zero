/** Helpers for actor-safe Data Studio result unions. */

import {
  DataStudioError,
  isDataStudioError,
  type DataStudioErrorCode,
} from './data-studio-error';
import type {
  DataStudioOperationFailure,
  DataStudioOperationResult,
} from './data-studio-operation-contracts';

const EXPECTED_CODES = new Set<DataStudioErrorCode>([
  'DATA_STUDIO_AUTHORITY_REQUIRED',
  'DATA_STUDIO_TABLE_NOT_FOUND',
  'DATA_STUDIO_ROW_NOT_FOUND',
  'DATA_STUDIO_TABLE_ARCHIVED',
  'DATA_STUDIO_TABLE_KEY_CONFLICT',
  'DATA_STUDIO_SCHEMA_INVALID',
  'DATA_STUDIO_VALUE_INVALID',
  'DATA_STUDIO_LIMIT_EXCEEDED',
  'DATA_STUDIO_REVISION_CONFLICT',
  'DATA_STUDIO_IDEMPOTENCY_CONFLICT',
  'DATA_STUDIO_OPERATION_IN_PROGRESS',
]);

export function dataStudioSuccess<T>(value: T): DataStudioOperationResult<T> {
  return Object.freeze({ ok: true, value });
}

/** Convert only expected domain rejections; unexpected failures must roll back. */
export function dataStudioExpectedFailure(
  error: unknown,
): DataStudioOperationFailure | null {
  if (!isDataStudioError(error) || !EXPECTED_CODES.has(error.code)) return null;
  const currentRevision = error.details.currentRevision;
  return Object.freeze({
    ok: false,
    code: error.code,
    retryable: error.retryable,
    outcome: error.outcome,
    ...(Number.isSafeInteger(currentRevision) && (currentRevision as number) > 0
      ? { currentRevision: currentRevision as number }
      : {}),
  });
}

export function dataStudioRevisionConflict(currentRevision: number): DataStudioError {
  return new DataStudioError(
    'DATA_STUDIO_REVISION_CONFLICT',
    'Data Studio revision changed.',
    { details: { currentRevision }, outcome: 'not-committed' },
  );
}

