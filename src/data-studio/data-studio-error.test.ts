/**
 * data-studio-error.test.ts
 *
 * Verifies closed domain errors and the privacy-safe HTTP projection.
 */

import { describe, expect, test } from 'bun:test';
import {
  DATA_STUDIO_ERROR_CODES,
  DataStudioError,
  isDataStudioErrorCode,
  normalizeDataStudioError,
  toDataStudioHttpFailure,
} from './index';

describe('DataStudioError', () => {
  test('uses closed defaults and enforces unknown-outcome retry safety', () => {
    const conflict = new DataStudioError(
      'DATA_STUDIO_REVISION_CONFLICT',
      'Revision changed.',
    );
    expect(conflict.retryable).toBe(false);
    expect(conflict.outcome).toBe('not-committed');
    expect(DATA_STUDIO_ERROR_CODES.every(isDataStudioErrorCode)).toBe(true);
    expect(Object.isFrozen(DATA_STUDIO_ERROR_CODES)).toBe(true);

    expect(() => new DataStudioError(
      'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN',
      'Unknown.',
      { retryable: true },
    )).toThrow('unknown outcome cannot be retryable');
  });

  test('bounds and freezes safe scalar details', () => {
    const error = new DataStudioError(
      'DATA_STUDIO_LIMIT_EXCEEDED',
      'Limit.',
      { details: { dimension: 'x'.repeat(400), limit: 5 } },
    );
    expect(error.details.dimension).toHaveLength(256);
    expect(error.details.limit).toBe(5);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(() => new DataStudioError(
      'DATA_STUDIO_VALUE_INVALID',
      'Invalid.',
      { details: { nested: {} as never } },
    )).toThrow('scalar values only');
  });

  test('normalizes unknown and hostile thrown values without reflecting them', () => {
    const unknown = normalizeDataStudioError(new Error('sqlite /secret/path bind=value'));
    expect(unknown.code).toBe('DATA_STUDIO_INTERNAL_ERROR');
    expect(unknown.message).not.toContain('secret');

    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('hostile trap');
      },
    });
    const normalized = normalizeDataStudioError(hostile);
    expect(normalized.code).toBe('DATA_STUDIO_INTERNAL_ERROR');
  });
});

describe('Data Studio HTTP error mapping', () => {
  test('returns fixed public messages instead of domain error text', () => {
    const failure = toDataStudioHttpFailure(new DataStudioError(
      'DATA_STUDIO_SCHEMA_INVALID',
      'column secret_name contains private detail',
    ), 'write');

    expect(failure).toEqual({
      ok: false,
      status: 422,
      body: {
        error: 'Data Studio schema is invalid.',
        code: 'DATA_STUDIO_SCHEMA_INVALID',
        retryable: false,
      },
    });
    expect(JSON.stringify(failure)).not.toContain('secret_name');
  });

  test('distinguishes archived tables and duplicate stable keys', () => {
    expect(toDataStudioHttpFailure(new DataStudioError(
      'DATA_STUDIO_TABLE_ARCHIVED',
      'Archived.',
    ), 'write')).toMatchObject({
      status: 409,
      body: {
        error: 'Data Studio table is archived.',
        code: 'DATA_STUDIO_TABLE_ARCHIVED',
        retryable: false,
      },
    });
    const keyConflict = new DataStudioError(
      'DATA_STUDIO_TABLE_KEY_CONFLICT',
      'Duplicate.',
    );
    expect(keyConflict.outcome).toBe('not-committed');
    expect(toDataStudioHttpFailure(keyConflict, 'write').status).toBe(409);
  });

  test('requires the same idempotency key only for ambiguous writes', () => {
    const error = new DataStudioError(
      'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN',
      'Unknown.',
    );
    expect(toDataStudioHttpFailure(error, 'write')).toEqual({
      ok: false,
      status: 503,
      body: {
        error: 'Data Studio mutation outcome is unknown.',
        code: 'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN',
        retryable: false,
        requiresSameIdempotencyKey: true,
      },
    });
    expect(toDataStudioHttpFailure(error, 'read').body).not.toHaveProperty(
      'requiresSameIdempotencyKey',
    );
  });

  test('maps arbitrary failures to a generic internal response', () => {
    const failure = toDataStudioHttpFailure('SQL and user data', 'read');
    expect(failure.status).toBe(500);
    expect(failure.body.code).toBe('DATA_STUDIO_INTERNAL_ERROR');
    expect(failure.body.error).toBe('Data Studio operation failed.');
  });
});
