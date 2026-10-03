/** Privacy-safe mapping from Fabric database failures into Data Studio errors. */

import { classifyDatabaseHttpFailure } from '../databases/database-http-error';
import { DataStudioError, isDataStudioError } from './data-studio-error';

export function mapDataStudioDatabaseFailure(
  error: unknown,
  operation: 'read' | 'write',
): DataStudioError {
  if (isDataStudioError(error)) return error;
  const failure = classifyDatabaseHttpFailure(error, operation);
  const options = {
    retryable: failure.retryable,
    outcome: failure.outcome,
    details: {
      databaseCode: failure.databaseCode,
      failureKind: failure.kind,
    },
  } as const;

  if (failure.receiptState === 'expired'
    || failure.conflictType === 'idempotency-key-reused') {
    return new DataStudioError(
      'DATA_STUDIO_IDEMPOTENCY_CONFLICT',
      'Data Studio idempotency receipt cannot be replayed.',
      { ...options, retryable: false, outcome: 'not-committed' },
    );
  }
  switch (failure.kind) {
    case 'authority':
      return new DataStudioError(
        'DATA_STUDIO_AUTHORITY_CHANGED',
        'Data Studio authority changed.',
        { ...options, retryable: false },
      );
    case 'invalid':
      switch (failure.databaseCode) {
        case 'DATABASE_PAYLOAD_INVALID':
          return new DataStudioError(
            'DATA_STUDIO_VALUE_INVALID',
            'Data Studio operation input is invalid.',
            { ...options, retryable: false },
          );
        case 'DATABASE_PAYLOAD_LIMIT':
          return new DataStudioError(
            'DATA_STUDIO_LIMIT_EXCEEDED',
            'Data Studio operation input exceeds a limit.',
            { ...options, retryable: false },
          );
        case 'DATABASE_OPERATION_UNSUPPORTED':
          return new DataStudioError(
            'DATA_STUDIO_NOT_READY',
            'Data Studio database realm is not ready.',
            { ...options, retryable: false },
          );
        case 'DATABASE_RESULT_LIMIT':
          return new DataStudioError(
            'DATA_STUDIO_INTERNAL_ERROR',
            'Data Studio actor result exceeded its contract.',
            { ...options, retryable: false },
          );
        default:
          return new DataStudioError(
            'DATA_STUDIO_INTERNAL_ERROR',
            'Data Studio database failure was misclassified.',
            { ...options, retryable: false },
          );
      }
    case 'conflict':
      return new DataStudioError(
        failure.conflictType === 'cas'
          ? 'DATA_STUDIO_REVISION_CONFLICT'
          : 'DATA_STUDIO_IDEMPOTENCY_CONFLICT',
        'Data Studio operation conflicted.',
        { ...options, retryable: false, outcome: 'not-committed' },
      );
    case 'write-outcome-unknown':
      return new DataStudioError(
        'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN',
        'Data Studio mutation outcome is unknown.',
        { ...options, retryable: false, outcome: 'unknown' },
      );
    case 'capacity':
    case 'unavailable':
      return new DataStudioError(
        'DATA_STUDIO_UNAVAILABLE',
        'Data Studio persistence is unavailable.',
        options,
      );
  }
}
