/** Receipt fingerprints and retained-result compatibility validation. */

import { createHash } from 'node:crypto';
import { stableStringify } from '../migrations/schema-snapshot';
import {
  validateDatabaseActorLegacyReceiptResult,
  validateDatabaseActorTrustedWriteResult,
} from './database-actor-result-validation';
import {
  type DatabaseCommitResult,
  type DatabaseOperationCatalog,
  type DatabaseWriteOperation,
} from './database-operations';
import type { DatabaseRuntime } from './database-runtime';
import type { DatabaseLogicalReceiptFingerprint } from './database-trusted-writer';
import type { DatabaseWriterCommitValue } from './database-writer-contracts';
import { databaseWriterReceiptCorrupt } from './database-writer-errors';

const OPERATION_FINGERPRINT_DOMAIN = 'zero.database-operation.v1\0';
const LOGICAL_RECEIPT_FINGERPRINT_DOMAIN = 'zero.database-logical-receipt.v1\0';

export function fingerprintDatabaseWriterOperation(
  realmFingerprint: string,
  operation: DatabaseWriteOperation,
): string {
  return `sha256:${createHash('sha256')
    .update(OPERATION_FINGERPRINT_DOMAIN, 'utf8')
    .update(stableStringify({ realmFingerprint, operation }), 'utf8')
    .digest('hex')}`;
}

export function fingerprintDatabaseWriterLogicalReceipt(
  realmFingerprint: string,
  logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
): string {
  return `sha256:${createHash('sha256')
    .update(LOGICAL_RECEIPT_FINGERPRINT_DOMAIN, 'utf8')
    .update(stableStringify({ realmFingerprint, logicalReceiptFingerprint }), 'utf8')
    .digest('hex')}`;
}

export function parseRetainedDatabaseWriterReceipt(
  runtime: DatabaseRuntime,
  catalog: DatabaseOperationCatalog,
  row: Readonly<{ resultJson: string; finalSeq: number }>,
  idempotencyKey: string,
  resultVersion: number,
): DatabaseCommitResult<DatabaseWriterCommitValue> {
  if (row.finalSeq > runtime.db.currentSeq) {
    throw databaseWriterReceiptCorrupt();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resultJson);
  } catch (cause) {
    throw databaseWriterReceiptCorrupt(cause);
  }
  let result: DatabaseCommitResult<DatabaseWriterCommitValue>;
  try {
    result = resultVersion === 1
      ? validateDatabaseActorLegacyReceiptResult(
        parsed,
        idempotencyKey,
        catalog,
      )
      : validateDatabaseActorTrustedWriteResult(
        parsed,
        idempotencyKey,
        catalog,
      );
  } catch (cause) {
    throw databaseWriterReceiptCorrupt(cause);
  }
  if (result.idempotencyKey !== idempotencyKey
    || result.sequence.seq !== row.finalSeq
    || result.replayed) {
    throw databaseWriterReceiptCorrupt();
  }
  return result;
}
