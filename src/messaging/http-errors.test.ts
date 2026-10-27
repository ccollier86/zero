/** Native boundary preserves commit uncertainty and strict admission without exposing underlying messages. */
import { expect, test } from 'bun:test';
import { DatabaseError } from '../databases/database-error';
import { LoggingError } from '../logging/logging-error';
import { StorageDomainError } from '../storage/storage-domain-error';
import { projectMessagingHttpError } from './http-errors';
test('changed transport intent is a specific not-committed conflict, not a false storage outage', () => {
  const result = projectMessagingHttpError(new DatabaseError('DATABASE_CONFLICT', 'Synthetic private driver detail', { outcome: 'not-committed', details: { conflictType: 'idempotency-key-reused' } }), 'UNKNOWN');
  expect(result).toMatchObject({ status: 409, body: { code: 'MESSAGING_INTENT_CONFLICT', outcome: 'not-committed' } });
  expect(JSON.stringify(result)).not.toContain('driver detail');
});
test('uncertain commits and private byte outcomes retain reconciliation rather than permission to send a different command', () => {
  expect(projectMessagingHttpError(new DatabaseError('DATABASE_EXECUTOR_FAILED', 'Private adapter error', { outcome: 'unknown' }), 'UNKNOWN')).toMatchObject({ status: 409, body: { code: 'MESSAGING_OUTCOME_UNKNOWN', outcome: 'unknown' } });
  expect(projectMessagingHttpError(new StorageDomainError('STORAGE_OPERATION_OUTCOME_UNKNOWN', 'Private provider error', { outcome: 'unknown' }), 'UNKNOWN')).toMatchObject({ status: 503, body: { code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN', outcome: 'unknown', requiresSameIdempotencyKey: true } });
  expect(projectMessagingHttpError(new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Private gate reason'), 'UNKNOWN')).toMatchObject({ status: 428, body: { code: 'LOGGING_ADMISSION_REQUIRED' } });
});
