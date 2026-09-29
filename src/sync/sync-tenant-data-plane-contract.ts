/**
 * Public contracts for the actor-backed tenant Sync data plane.
 *
 * This module contains serializable data shapes and narrow capabilities only.
 * Socket lifecycle, transport, validation, and mutation orchestration remain
 * in their dedicated runtime modules.
 */

import type {
  AsyncDatabaseClient,
  DatabaseAssertion,
  DatabaseMutation,
  DatabaseOperationRow,
} from '../databases/database-operations';
import type {
  DatabaseLogicalReceiptFingerprint,
  DatabaseTrustedWriteExecutor,
} from '../databases/database-trusted-writer';
import type {
  Change,
  SyncAuthContext,
  SyncMutateMessage,
} from './types';

export interface SyncTenantDataPlaneTable {
  readonly primaryKey: string;
  readonly columns: readonly string[];
  /** Natural identity fields which allow actor-side primary-key derivation. */
  readonly identity?: readonly string[];
}

export interface SyncTenantDataPlaneBindContext {
  /** Immutable authority captured from the accepted socket handshake. */
  readonly authContext: SyncAuthContext;
  /** Synchronous durable fence evaluated at the writer FIFO head. */
  readonly assertCurrentAuthoritySync: () => undefined;
  /** Synchronous fence evaluated before dispatch and after actor reads. */
  readonly assertCurrentReadAuthority: () => undefined;
}

export interface SyncTenantDataPlaneSnapshotPageRow {
  readonly ordinal: number;
  readonly tableIndex: number;
  readonly rowId: string;
  readonly row: DatabaseOperationRow;
}

export interface SyncTenantDataPlaneSnapshotSession {
  readonly databaseRef: string;
  readonly generation: number;
  readonly syncEpoch: string;
  readonly sequence: Readonly<{ seq: number }>;
  readonly tables: readonly string[];
  readonly totalRows: number;
  readonly totalSourceBytes: number;
  readonly expiresAt: number;
  readonly aborted: boolean;
  page(cursor: number): Promise<Readonly<{
    cursor: number;
    rows: readonly SyncTenantDataPlaneSnapshotPageRow[];
    nextCursor: number | null;
  }>>;
  abort(): Promise<void>;
}

export interface SyncTenantDataPlaneReplayChange {
  readonly seq: number;
  readonly table: string;
  readonly op: Change['op'];
  readonly rowId: string;
  readonly row: DatabaseOperationRow | null;
  readonly previousRow: DatabaseOperationRow | null;
  readonly ts: number;
}

export interface SyncTenantDataPlaneReplay {
  readonly databaseRef: string;
  readonly generation: number;
  readonly syncEpoch: string;
  readonly sequence: Readonly<{ seq: number }>;
  readonly value: Readonly<{
    readonly afterSeq: number;
    readonly throughSeq: number;
    readonly nextAfterSeq: number | null;
    readonly changes: readonly SyncTenantDataPlaneReplayChange[];
  }>;
}

export type SyncTenantDataPlaneWakeup =
  | Readonly<{
    type: 'changes';
    databaseRef: string;
    generation: number;
    syncEpoch: string;
    afterSeq: number;
    throughSeq: number;
  }>
  | Readonly<{
    type: 'reset';
    databaseRef: string;
    generation: number;
    syncEpoch: string;
    sequence: Readonly<{ seq: number }>;
  }>
  | Readonly<{
    type: 'unavailable';
    databaseRef: string;
  }>;

export interface SyncTenantDataPlaneBinding {
  readonly databaseRef: string;
  readonly released: boolean;
  /** The same authority-bound client used by server Resource CRUD. */
  readonly client: AsyncDatabaseClient;
  /** Framework-only logical receipt capability; never projected to app code. */
  readonly trustedWriter: DatabaseTrustedWriteExecutor;
  /** Begin one exact immutable actor snapshot; callers abort in `finally`. */
  beginSnapshot(
    tables: readonly string[],
  ): Promise<SyncTenantDataPlaneSnapshotSession>;
  replay(afterSeq: number, limit?: number): Promise<SyncTenantDataPlaneReplay>;
  onWakeup(listener: (wakeup: SyncTenantDataPlaneWakeup) => void): () => void;
  release(): void;
}

/** Trusted app-local adapter. Its table catalog is configuration, not input. */
export interface SyncTenantDataPlane {
  readonly tables: Readonly<Record<string, SyncTenantDataPlaneTable>>;
  bind(context: SyncTenantDataPlaneBindContext): Promise<SyncTenantDataPlaneBinding>;
}

export interface SyncTenantMutationCommit {
  readonly mutation: DatabaseMutation;
  readonly assertions?: readonly DatabaseAssertion[];
  readonly idempotencyKey: string;
  readonly logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint;
  readonly authorityFingerprint?: string;
  /** Called while replay for this socket is gated, before it may see the seq. */
  readonly acknowledge: (change: Change) => void;
}

export interface SyncTenantMutationReceiptReplay {
  readonly idempotencyKey: string;
  readonly logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint;
  readonly expected: Readonly<{
    table: string;
    op: SyncMutateMessage['op'];
    rowId?: string;
  }>;
  readonly authorize: (change: Change) => boolean | Promise<boolean>;
  readonly acknowledge: (change: Change) => void;
}
