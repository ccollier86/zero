/** Stable limits and aggregate shapes for actor-local durable receipts. */

/** Current row schema of the private durable write-receipt ledger. */
export const DATABASE_WRITER_RECEIPT_SCHEMA_VERSION = 2 as const;

/** Full receipt results retained per database before FIFO compaction. */
export const DATABASE_WRITER_MAX_RECEIPTS = 10_000 as const;

/** Permanent receipt identities admitted by one physical database. */
export const DATABASE_WRITER_MAX_RECEIPT_KEYS = 1_000_000 as const;

/** Maximum UTF-8 JSON bytes retained for one canonical actor receipt result. */
export const DATABASE_WRITER_MAX_RECEIPT_RESULT_BYTES = 8_388_608 as const;

/** Maximum aggregate UTF-8 JSON bytes retained across full receipt results. */
export const DATABASE_WRITER_MAX_RETAINED_RECEIPT_BYTES = 67_108_864 as const;

/** Aggregate-only receipt retention state; contains no receipt identities. */
export interface DatabaseWriterReceiptRetentionCounts {
  readonly totalKeys: number;
  readonly retainedResults: number;
  readonly expiredTombstones: number;
  readonly retainedResultBytes: number;
  readonly keyLimit: number;
  readonly retainedLimit: number;
  readonly retainedByteLimit: number;
  readonly resultByteLimit: number;
}

/** Aggregate-only compaction result; receipt identities never leave the actor. */
export interface DatabaseWriterReceiptCompaction
  extends DatabaseWriterReceiptRetentionCounts {
  readonly prunedCount: number;
  readonly prunedResultBytes: number;
}
