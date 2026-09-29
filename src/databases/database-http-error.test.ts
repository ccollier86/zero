import { describe, expect, test } from 'bun:test';

import { DatabaseError } from './database-error';
import { classifyDatabaseHttpFailure } from './database-http-error';

describe('database HTTP error classification', () => {
  test('uses stable privacy-safe status categories', () => {
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      '/private/authority detail',
    ), 'read')).toMatchObject({
      status: 403,
      kind: 'authority',
      databaseCode: 'DATABASE_AUTHORITY_CHANGED',
    });
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'sensitive payload detail',
    ), 'read')).toMatchObject({
      status: 400,
      kind: 'invalid',
    });
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_CONFLICT',
      'sensitive row detail',
    ), 'write')).toMatchObject({
      status: 409,
      kind: 'conflict',
    });
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_MIGRATION_FAILED',
      '/private/database.sqlite',
    ), 'read')).toMatchObject({
      status: 503,
      kind: 'unavailable',
    });
  });

  test('makes unknown write outcomes explicit without misclassifying reads', () => {
    const timeout = new DatabaseError(
      'DATABASE_OPERATION_TIMEOUT',
      'operation timeout',
    );
    expect(classifyDatabaseHttpFailure(timeout, 'write')).toMatchObject({
      status: 503,
      kind: 'write-outcome-unknown',
      outcome: 'unknown',
    });
    expect(classifyDatabaseHttpFailure(timeout, 'read')).toMatchObject({
      status: 503,
      kind: 'unavailable',
      outcome: 'unknown',
    });
    expect(classifyDatabaseHttpFailure(new Error('/private/actor path'), 'write'))
      .toMatchObject({
        status: 503,
        kind: 'write-outcome-unknown',
        databaseCode: 'DATABASE_EXECUTOR_FAILED',
      });
  });

  test('carries only the fixed expired receipt state', () => {
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'private receipt details',
      {
        outcome: 'unknown',
        details: {
          receiptState: 'expired',
          receiptKey: 'must-not-cross',
        },
      },
    ), 'write')).toEqual({
      status: 503,
      kind: 'write-outcome-unknown',
      databaseCode: 'DATABASE_OUTCOME_UNKNOWN',
      outcome: 'unknown',
      retryable: false,
      receiptState: 'expired',
    });
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'private receipt details',
      {
        outcome: 'unknown',
        details: { receiptState: 'private-receipt-id' },
      },
    ), 'write')).not.toHaveProperty('receiptState');
  });

  test('exposes only validated privacy-safe conflict subtypes', () => {
    for (const conflictType of [
      'cas',
      'idempotency-key-reused',
      'primary-key',
      'constraint',
    ] as const) {
      expect(classifyDatabaseHttpFailure(new DatabaseError(
        'DATABASE_CONFLICT',
        'private conflict details',
        { details: { conflictType, privateValue: '/private/row' } },
      ), 'write')).toEqual({
        status: 409,
        kind: 'conflict',
        databaseCode: 'DATABASE_CONFLICT',
        outcome: 'not-committed',
        retryable: true,
        conflictType,
      });
    }

    const unrecognized = classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_CONFLICT',
      'private conflict details',
      { details: { conflictType: 'tenant-secret', table: 'patients' } },
    ), 'write');
    expect(unrecognized).not.toHaveProperty('conflictType');
    expect(unrecognized).not.toHaveProperty('table');

    const nonConflict = classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'private invalid details',
      { details: { conflictType: 'cas' } },
    ), 'write');
    expect(nonConflict).not.toHaveProperty('conflictType');
  });

  test('exposes only the closed permanent-capacity dimension', () => {
    expect(classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      '/private/database.sqlite',
      {
        details: {
          capacityType: 'receipts',
          capacityLimit: 1_000_000,
          tenant: 'private-tenant',
        },
      },
    ), 'write')).toEqual({
      status: 503,
      kind: 'capacity',
      databaseCode: 'DATABASE_CAPACITY_EXHAUSTED',
      outcome: 'not-started',
      retryable: false,
      capacityType: 'receipts',
      capacityLimit: 1_000_000,
    });
    const invalid = classifyDatabaseHttpFailure(new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'private',
      { details: { capacityType: 'private-tenant' } },
    ), 'read');
    expect(invalid.kind).toBe('capacity');
    expect(invalid).not.toHaveProperty('capacityType');
  });
});
