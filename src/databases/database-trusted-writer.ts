/**
 * Narrow framework-internal write capability for logical request receipts.
 * Public AsyncDatabaseClient deliberately does not expose these methods.
 */

import { DatabaseError } from './database-error';
import {
  isDatabaseIdempotencyKey,
  type DatabaseCommitResult,
} from './database-operations';
import type { DatabaseWriterCommitValue } from './database-writer-engine';

const LOGICAL_RECEIPT_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** Stable, content-free identity for one logical framework request. */
export type DatabaseLogicalReceiptFingerprint = `sha256:${string}`;

export interface DatabaseTrustedWriteExecutionOptions {
  readonly logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint;
  readonly signal?: AbortSignal;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

export interface DatabaseTrustedReceiptExecutionOptions {
  readonly signal?: AbortSignal;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

export type DatabaseTrustedReceiptLookup =
  | Readonly<{ readonly status: 'miss' }>
  | Readonly<{
      readonly status: 'hit';
      readonly result: DatabaseCommitResult<DatabaseWriterCommitValue>;
    }>;

/** Authority-fenced writer-only receipt capability. */
export interface DatabaseTrustedWriteExecutor {
  findReceipt(
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    options?: DatabaseTrustedReceiptExecutionOptions,
  ): Promise<DatabaseTrustedReceiptLookup>;
  executeWrite(
    operation: unknown,
    options: DatabaseTrustedWriteExecutionOptions,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>>;
}

export function validateDatabaseLogicalReceiptFingerprint(
  value: unknown,
): DatabaseLogicalReceiptFingerprint {
  if (typeof value !== 'string'
    || !LOGICAL_RECEIPT_FINGERPRINT_PATTERN.test(value)) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database logical receipt fingerprint is invalid.',
    );
  }
  return value as DatabaseLogicalReceiptFingerprint;
}

export function validateDatabaseReceiptLookupIdentity(
  idempotencyKey: unknown,
  logicalReceiptFingerprint: unknown,
): Readonly<{
  readonly idempotencyKey: string;
  readonly logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint;
}> {
  if (!isDatabaseIdempotencyKey(idempotencyKey)) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database receipt idempotency key is invalid.',
    );
  }
  return Object.freeze({
    idempotencyKey,
    logicalReceiptFingerprint: validateDatabaseLogicalReceiptFingerprint(
      logicalReceiptFingerprint,
    ),
  });
}
