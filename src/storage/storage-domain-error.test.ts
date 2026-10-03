/**
 * storage-domain-error.test.ts
 *
 * Verifies closed Storage failures and privacy-safe HTTP projection.
 */

import { describe, expect, test } from 'bun:test';
import {
  STORAGE_ERROR_CODES,
  StorageDomainError,
  isStorageErrorCode,
  normalizeStorageError,
} from './storage-domain-error';
import { toStorageHttpFailure } from './storage-http-error';

describe('StorageDomainError', () => {
  test('uses closed outcome defaults and rejects ambiguous retries', () => {
    const conflict = new StorageDomainError('STORAGE_CONFLICT', 'Conflict.');
    expect(conflict.retryable).toBe(false);
    expect(conflict.outcome).toBe('not-committed');
    expect(STORAGE_ERROR_CODES.every(isStorageErrorCode)).toBe(true);
    expect(Object.isFrozen(STORAGE_ERROR_CODES)).toBe(true);

    expect(() => new StorageDomainError(
      'STORAGE_OPERATION_OUTCOME_UNKNOWN',
      'Unknown.',
      { retryable: true },
    )).toThrow('unknown outcome cannot be retryable');
  });

  test('bounds and freezes safe scalar details', () => {
    const error = new StorageDomainError('STORAGE_QUOTA_EXCEEDED', 'Quota.', {
      details: { dimension: 'x'.repeat(400), limit: 5 },
    });
    expect(error.details.dimension).toHaveLength(256);
    expect(error.details.limit).toBe(5);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(() => new StorageDomainError(
      'STORAGE_METADATA_INVALID',
      'Invalid.',
      { details: { nested: {} as never } },
    )).toThrow('scalar values only');
  });

  test('normalizes hostile failures without reflecting sensitive text', () => {
    const normalized = normalizeStorageError(
      new Error('checksum path=/private/tenant/object capability=secret'),
    );
    expect(normalized.code).toBe('STORAGE_INTERNAL');
    expect(normalized.message).toBe('Storage operation failed.');

    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('hostile trap');
      },
    });
    expect(normalizeStorageError(hostile).code).toBe('STORAGE_INTERNAL');
  });
});

describe('Storage HTTP failure projection', () => {
  test('uses fixed public messages and retains the compatible error/code shape', () => {
    const failure = toStorageHttpFailure(new StorageDomainError(
      'STORAGE_METADATA_INVALID',
      'metadata field private_patient_id is invalid',
    ), 'write');

    expect(failure).toEqual({
      ok: false,
      status: 400,
      body: {
        error: 'Storage metadata is invalid.',
        code: 'STORAGE_METADATA_INVALID',
        retryable: false,
        outcome: 'not-started',
      },
    });
    expect(JSON.stringify(failure)).not.toContain('private_patient_id');
  });

  test('requires the same idempotency key for ambiguous writes', () => {
    const failure = toStorageHttpFailure(new StorageDomainError(
      'STORAGE_OPERATION_OUTCOME_UNKNOWN',
      'Unknown.',
    ), 'write');

    expect(failure).toEqual({
      ok: false,
      status: 503,
      body: {
        error: 'Storage mutation outcome is unknown.',
        code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
        retryable: false,
        outcome: 'unknown',
        requiresSameIdempotencyKey: true,
      },
    });
  });

  test('maps arbitrary failures to a generic internal response', () => {
    const failure = toStorageHttpFailure('raw filesystem failure', 'read');
    expect(failure.status).toBe(500);
    expect(failure.body).toMatchObject({
      error: 'Storage operation failed.',
      code: 'STORAGE_INTERNAL',
      retryable: false,
      outcome: 'unknown',
    });
    expect(failure.body).not.toHaveProperty('requiresSameIdempotencyKey');
  });
});
