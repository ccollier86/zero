/** Shared actor-lane normalization for trusted read-result production. */

import { DatabaseError } from './database-error';
import {
  validateDatabaseReadResult,
  type DatabaseReadResult,
} from './database-operations';

/**
 * Run trusted read work and validate its result without misclassifying an
 * invalid actor-produced value as invalid caller input.
 *
 * Operation admission must run before this boundary so malformed public
 * payloads retain their DATABASE_PAYLOAD_* classification.
 */
export function produceValidatedDatabaseReadResult(
  produce: () => Readonly<{
    readonly value: unknown;
    readonly sequence: Readonly<{ readonly seq: number }>;
  }>,
): DatabaseReadResult {
  try {
    return validateDatabaseReadResult(produce());
  } catch (error) {
    if (error instanceof DatabaseError
      && (error.code === 'DATABASE_PAYLOAD_INVALID'
        || error.code === 'DATABASE_PAYLOAD_LIMIT')) {
      throw new DatabaseError(
        'DATABASE_RESULT_LIMIT',
        'Database read result is outside the supported result contract.',
        { outcome: null, cause: error },
      );
    }
    throw error;
  }
}
