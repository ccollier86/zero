/** Bounded numeric registered-command rejections preserve rollback outcome and privacy through both executor boundaries. */
import { expect, test } from 'bun:test';
import { DatabaseError } from './database-error';
import { privacySafeActorError } from './database-actor-error-boundary';
import { safeCoordinatorError } from './database-coordinator-errors';
test('only a bounded domain number survives; messages, data and invented HTTP status do not', () => {
  const source = new DatabaseError('DATABASE_CONFLICT', 'PRIVATE article SQL path secret', { outcome: 'not-committed', retryable: false,
    details: { domainCode: 12, httpStatus: 200, body: 'PRIVATE', reason: 'PRIVATE' } });
  const result = safeCoordinatorError(privacySafeActorError(source));
  expect(result).toMatchObject({ code: 'DATABASE_CONFLICT', outcome: 'not-committed', retryable: false, details: { domainCode: 12 } });
  expect(result.message).not.toContain('PRIVATE');
  for (const domainCode of [0, -1, 4096, 1.5, 'PRIVATE', true]) {
    expect(safeCoordinatorError(privacySafeActorError(new DatabaseError('DATABASE_CONFLICT', 'Rejected', { details: { domainCode } }))).details).toEqual({});
  }
  expect(safeCoordinatorError(privacySafeActorError(new DatabaseError('DATABASE_OUTCOME_UNKNOWN', 'Unknown', { details: { domainCode: 12 } }))).details).toEqual({});
});
