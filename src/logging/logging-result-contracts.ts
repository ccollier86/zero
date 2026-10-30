/** Ordered historical release manifests. These describe what was returned, not proof of human attention. */
import type { LoggingScalar } from './logging-contracts';
/** Matches the bounded database facade's 1000-row page plus one lookahead row. */
export const LOGGING_RESULT_MAX_RECORDS = 1001;

export interface LoggingResultRecord {
  readonly type: string;
  readonly id: string;
  /** Source snapshot revision when supplied; otherwise an explicit release reference, never a fabricated DB version. */
  readonly revision: string;
  readonly values: Readonly<Record<string, LoggingScalar>>;
}
export interface LoggingResultReceipt {
  readonly id: string;
  readonly digest: string;
  readonly kind: 'record' | 'list';
  readonly table: string;
  readonly count: number;
  readonly expiresAt: number;
}
export interface LoggingResultManifest {
  readonly version: 1;
  readonly id: string;
  readonly kind: 'record' | 'list';
  readonly table: string;
  readonly preparedAt: number;
  readonly criteriaDigest: string;
  readonly records: readonly LoggingResultRecord[];
  readonly complete: boolean;
  /** Flat, bounded release lineage. Selected records keep the original revision, not a fresh-query version. */
  readonly sources?: readonly Readonly<{ receiptId: string; digest: string }>[];
}
export interface LoggingDeriveResultInput {
  /** Stable retry identity, generated once for this committed displayed selection. */
  readonly id: string;
  readonly kind: 'record' | 'list';
  /** Ordered positions in previously released results. At least one source also identifies an empty list. */
  readonly sources: readonly Readonly<{ receiptId: string; positions: readonly number[] }>[];
}
export interface LoggingResultVersions {
  readonly items: readonly Readonly<{ receipt: LoggingResultReceipt; preparedAt: number; ordinal: number }>[];
  readonly nextBeforeOrdinal: number | null;
}
/** Trusted server rows must already have passed domain authorization/projection. Never accepted from browser JSON. */
export interface LoggingPrepareResultInput {
  readonly table: string;
  readonly kind: 'record' | 'list';
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly primaryKey?: string;
  readonly revision?: string;
  /** Only its canonical digest is retained. Never pass credentials or arbitrary request bodies. */
  readonly criteria?: unknown;
}
export interface LoggingResultReference {
  readonly kind: 'result';
  readonly receiptId: string;
  readonly digest: string;
  readonly resultKind: 'record' | 'list';
  readonly table: string;
  readonly recordCount: number;
  readonly complete: boolean;
}
export function isLoggingResultReference(value: unknown): value is LoggingResultReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as LoggingResultReference;
  return Object.keys(v).every(key => ['kind', 'receiptId', 'digest', 'resultKind', 'table', 'recordCount', 'complete'].includes(key))
    && v.kind === 'result' && typeof v.receiptId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v.receiptId)
    && typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest) && ['record', 'list'].includes(v.resultKind)
    && typeof v.table === 'string' && v.table.length > 0 && v.table.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(v.table)
    && Number.isSafeInteger(v.recordCount) && v.recordCount >= 0 && v.recordCount <= LOGGING_RESULT_MAX_RECORDS && typeof v.complete === 'boolean';
}
