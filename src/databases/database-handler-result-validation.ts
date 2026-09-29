/** Producer-side validation for registered query and command return values. */

import { DatabaseError } from './database-error';
import {
  cloneDatabaseSerializableValue,
  type DatabaseSerializableValue,
} from './database-operations';

/**
 * Detach one synchronous handler result and classify malformed/oversized
 * producer output separately from already-admitted caller input.
 */
export function cloneDatabaseHandlerResult(
  value: unknown,
): DatabaseSerializableValue {
  try {
    return cloneDatabaseSerializableValue(value);
  } catch (error) {
    if (error instanceof DatabaseError
      && (error.code === 'DATABASE_PAYLOAD_INVALID'
        || error.code === 'DATABASE_PAYLOAD_LIMIT')) {
      throw invalidDatabaseHandlerResult(error);
    }
    throw error;
  }
}

/** Classify a failure while inspecting producer-owned handler output. */
export function invalidDatabaseHandlerResult(cause: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_RESULT_LIMIT',
    'Database registered handler result is outside the supported contract.',
    { cause, retryable: false, outcome: null },
  );
}
