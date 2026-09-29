/** Writer failure normalization and receipt-specific error identities. */

import {
  DatabaseError,
  isDatabaseError,
  normalizeDatabaseError,
} from './database-error';
import { readDatabaseCaughtErrorDataProperty } from './database-error-inspection';
import {
  databaseMutationConflictType,
  isExpectedDatabaseMutationConflict,
} from './database-writer-mutation-executor';

const EXPIRED_RECEIPT_ERRORS = new WeakSet<DatabaseError>();

export function databaseWriterReceiptExpired(): DatabaseError {
  const error = new DatabaseError(
    'DATABASE_OUTCOME_UNKNOWN',
    'Database idempotency receipt result is no longer retained.',
    {
      retryable: false,
      outcome: 'unknown',
      details: { receiptState: 'expired' },
    },
  );
  EXPIRED_RECEIPT_ERRORS.add(error);
  return error;
}

export function databaseWriterReceiptCorrupt(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database idempotency receipt is incompatible.',
    cause === undefined ? undefined : { cause },
  );
}

export function normalizeDatabaseWriterFailure(error: unknown): DatabaseError {
  if (isDatabaseError(error)) {
    const normalized = normalizeDatabaseError(error);
    if (EXPIRED_RECEIPT_ERRORS.has(error)) return normalized;
    if (normalized.outcome === 'not-started'
      || normalized.outcome === 'not-committed') {
      return normalized;
    }
    if (normalized.code === 'DATABASE_OUTCOME_UNKNOWN') {
      return new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database write operation failed.',
        {
          cause: normalized,
          retryable: false,
          outcome: 'not-committed',
        },
      );
    }
    return new DatabaseError(normalized.code, normalized.message, {
      cause: normalized,
      retryable: normalized.retryable,
      outcome: 'not-committed',
      details: normalized.details,
    });
  }
  if (isExpectedDatabaseMutationConflict(error)) {
    return new DatabaseError(
      'DATABASE_CONFLICT',
      'Database mutation conflicted.',
      {
        cause: error,
        retryable: false,
        outcome: 'not-committed',
        details: { conflictType: databaseMutationConflictType(error) },
      },
    );
  }
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database write operation failed.',
    {
      cause: error,
      retryable: false,
      outcome: 'not-committed',
    },
  );
}

export function isDatabaseWriterSQLiteFull(error: unknown): boolean {
  const code = readDatabaseCaughtErrorDataProperty(error, 'code');
  return typeof code === 'string'
    && (code === 'SQLITE_FULL' || code.startsWith('SQLITE_FULL_'));
}
