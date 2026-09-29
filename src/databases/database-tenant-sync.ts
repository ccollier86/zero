/**
 * database-tenant-sync.ts
 *
 * Strict, database-internal contracts used to bridge one actor-backed tenant
 * database into Zero Sync. This is deliberately separate from
 * AsyncDatabaseClient: ordinary application code cannot subscribe to actor
 * lifecycle wakeups or request unfiltered multi-table snapshots.
 */

import { DatabaseError } from './database-error';
import {
  normalizeDatabaseRef,
  type DatabaseRef,
} from './database-file';
import {
  createDatabaseSequenceToken,
  type DatabaseSequenceToken,
  type AsyncDatabaseClient,
} from './database-operations';
import type {
  DatabaseChangeReplayPage,
} from './database-writer-engine';
import type { DatabaseTrustedWriteExecutor } from './database-trusted-writer';
import type {
  DatabaseActorTenantSyncSnapshotPageRow,
} from './database-tenant-sync-snapshot-protocol';

const SAFE_EPOCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Replay page correlated with the exact writer epoch and generation. */
export interface DatabaseTenantSyncReplayResult {
  readonly databaseRef: DatabaseRef;
  readonly syncEpoch: string;
  readonly generation: number;
  readonly value: DatabaseChangeReplayPage;
  readonly sequence: DatabaseSequenceToken;
}

/** One retry-safe page from an immutable actor snapshot session. */
export interface DatabaseTenantSyncSnapshotPage {
  readonly cursor: number;
  readonly rows: readonly DatabaseActorTenantSyncSnapshotPageRow[];
  readonly nextCursor: number | null;
}

/**
 * Generation/owner-bound immutable baseline. Callers must abort in `finally`;
 * binding and actor teardown provide defense-in-depth cleanup.
 */
export interface DatabaseTenantSyncSnapshotSession extends AsyncDisposable {
  readonly databaseRef: DatabaseRef;
  readonly generation: number;
  readonly syncEpoch: string;
  readonly sequence: DatabaseSequenceToken;
  readonly tables: readonly string[];
  readonly totalRows: number;
  readonly totalSourceBytes: number;
  readonly expiresAt: number;
  readonly aborted: boolean;
  page(
    cursor: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotPage>;
  abort(options?: DatabaseTenantSyncExecutionOptions): Promise<void>;
}

/** A confirmed commit made a contiguous durable range available. */
export interface DatabaseTenantSyncChangesWakeup {
  readonly type: 'changes';
  readonly databaseRef: DatabaseRef;
  readonly syncEpoch: string;
  readonly generation: number;
  /** Cursor immediately before the newly available range. */
  readonly afterSeq: number;
  readonly throughSeq: number;
  /** Internal correlation key for origin suppression after a fresh commit. */
  readonly idempotencyKey: string;
}

/** Actor recovery invalidated every cursor tied to the prior epoch. */
export interface DatabaseTenantSyncResetWakeup {
  readonly type: 'reset';
  readonly databaseRef: DatabaseRef;
  readonly syncEpoch: string;
  readonly generation: number;
  /** Durable head observed when the replacement writer became ready. */
  readonly sequence: DatabaseSequenceToken;
}

/**
 * The coordinator could not retain or replace this physical binding.
 * Consumers must discard the binding and reconnect before serving more data.
 */
export interface DatabaseTenantSyncUnavailableWakeup {
  readonly type: 'unavailable';
  readonly databaseRef: DatabaseRef;
}

export type DatabaseTenantSyncWakeup =
  | DatabaseTenantSyncChangesWakeup
  | DatabaseTenantSyncResetWakeup
  | DatabaseTenantSyncUnavailableWakeup;

export type DatabaseTenantSyncWakeupListener = (
  wakeup: DatabaseTenantSyncWakeup,
) => void;

/** Execution deadlines shared with the coordinator without importing it. */
export interface DatabaseTenantSyncExecutionOptions {
  readonly signal?: AbortSignal;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

/**
 * Internal, persistent database binding consumed by the tenant Sync bridge.
 * Its lease pins the actor binding until release, including across recovery.
 */
export interface DatabaseTenantSyncBinding extends AsyncDisposable {
  readonly databaseRef: DatabaseRef;
  /** Public-shaped client pinned to this exact authority-fenced lease. */
  readonly client: AsyncDatabaseClient;
  /** Internal logical-receipt writer pinned to this exact lease. */
  readonly trustedWriter: DatabaseTrustedWriteExecutor;
  readonly released: boolean;
  beginSnapshot(
    tables: readonly string[],
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotSession>;
  replay(
    afterSeq: number,
    limit?: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncReplayResult>;
  onWakeup(listener: DatabaseTenantSyncWakeupListener): () => void;
  release(): void;
}

/** Correlate a validated replay page with its coordinator generation. */
export function createDatabaseTenantSyncReplayResult(
  databaseRef: DatabaseRef,
  syncEpoch: string,
  generation: number,
  value: DatabaseChangeReplayPage,
  sequence: DatabaseSequenceToken,
): DatabaseTenantSyncReplayResult {
  assertGeneration(generation);
  if (!SAFE_EPOCH_PATTERN.test(syncEpoch)) {
    throw new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Database tenant replay epoch is invalid.',
      { retryable: false, outcome: null },
    );
  }
  return Object.freeze({
    databaseRef: normalizeDatabaseRef(databaseRef),
    syncEpoch,
    generation,
    value,
    sequence: createDatabaseSequenceToken(sequence.seq),
  });
}

function assertGeneration(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Database tenant Sync generation is invalid.',
      { retryable: false, outcome: null },
    );
  }
}
