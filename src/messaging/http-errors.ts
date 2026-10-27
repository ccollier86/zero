/** Safe transport outcomes. No SQL, message bodies, upload grants, scope keys or provider secrets cross this boundary. */
import { AuthError } from '../auth/types';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { DatabaseError } from '../databases/database-error';
import { LoggingError } from '../logging/logging-error';
import { projectLoggingHttpFailure } from '../logging/logging-http-error';
import { isStorageDomainError } from '../storage/storage-domain-error';
import { toStorageHttpFailure } from '../storage/storage-http-error';
export function projectMessagingHttpError(error: unknown, code: string | number) {
  if (error instanceof LoggingError) return projectLoggingHttpFailure(error);
  if (isStorageDomainError(error)) return toStorageHttpFailure(error, 'write');
  if (error instanceof AuthError) return { status: error.status, body: { code: error.code, error: error.code.startsWith('MESSAGING_') ? 'The messaging request was not accepted.' : getPublicAuthErrorMessage(error) } };
  if (error instanceof DatabaseError) {
    if (error.outcome === 'unknown') return { status: 409, body: { code: 'MESSAGING_OUTCOME_UNKNOWN', outcome: 'unknown', error: 'The change may have committed; reconcile its original request identity before sending again.' } };
    if (error.code === 'DATABASE_CONFLICT' && error.outcome === 'not-committed' && error.details.conflictType === 'idempotency-key-reused') return { status: 409, body: { code: 'MESSAGING_INTENT_CONFLICT', outcome: 'not-committed', error: 'The request identity was already used for a different messaging operation.' } };
    if (error.code === 'DATABASE_AUTHORITY_CHANGED') return { status: 409, body: { code: 'MESSAGING_AUTHORITY_CHANGED', error: 'Messaging authority changed.' } };
    if (['DATABASE_CAPACITY_EXHAUSTED', 'DATABASE_BACKPRESSURE', 'DATABASE_QUEUE_TIMEOUT'].includes(error.code)) return { status: 429, body: { code: 'MESSAGING_CAPACITY', error: 'Messaging capacity is temporarily exhausted.' } };
    return { status: 503, body: { code: 'MESSAGING_NOT_READY', error: 'Messaging storage is unavailable.' } };
  }
  const status = code === 'PARSE' || code === 'VALIDATION' ? 422 : 500;
  return { status, body: { code: status === 422 ? 'MESSAGING_INPUT_INVALID' : 'MESSAGING_INTERNAL_ERROR', error: 'The messaging request could not be completed.' } };
}
