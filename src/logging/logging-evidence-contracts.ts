/** Browser-safe evidence lifecycle contracts. Hash verification is consistency checking, not independent custody. */
import type { LoggingQuery, LoggingStream } from './logging-contracts';

export interface LoggingCheckpoint { readonly version: 1; readonly stream: LoggingStream; readonly ordinal: number; readonly hash: string }
export interface LoggingVerification { readonly checked: number; readonly expired: number; readonly throughOrdinal: number; readonly hasMore: boolean; readonly checkpoint: LoggingCheckpoint }
export interface LoggingHold { readonly id: string; readonly since: number; readonly until: number; readonly reasonRef: string; readonly active: boolean; readonly createdAt: number; readonly createdBy: string; readonly releasedAt: number | null; readonly releasedBy: string | null }
export interface LoggingReview { readonly id: string; readonly query: LoggingQuery; readonly highWaterOrdinal: number; readonly result: 'reviewed' | 'follow-up'; readonly reference: string; readonly reviewedAt: number; readonly reviewedBy: string }
/** Composite cursors do not skip records sharing a millisecond. Null retires a completed catalog. */
export interface LoggingEvidenceCursor {
  readonly version: 1;
  readonly holds: Readonly<{ at: number; id: string }> | null;
  readonly reviews: Readonly<{ at: number; id: string }> | null;
}
export interface LoggingExport { readonly version: 1; readonly id: string; readonly stream: LoggingStream; readonly highWaterOrdinal: number; readonly count: number; readonly complete: boolean; readonly nextBeforeOrdinal: number | null; readonly sha256: string; readonly ndjson: string }
export interface LoggingEvidencePage { readonly holds: readonly LoggingHold[]; readonly reviews: readonly LoggingReview[]; readonly hasMoreHolds: boolean; readonly hasMoreReviews: boolean; readonly nextReviewBefore: number | null; readonly nextCursor: LoggingEvidenceCursor | null }
export interface LoggingHoldReceipt { readonly id: string; readonly active: boolean }
export interface LoggingReviewReceipt { readonly id: string; readonly reviewedAt: number }
