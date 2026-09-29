/**
 * Public contracts for the bounded database coordinator.
 *
 * This module intentionally contains no runtime coordinator implementation so
 * downstream packages can consume the stable capability and diagnostics types
 * without coupling to actor lifecycle internals.
 */

import type { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import type { DatabaseCommitAuthority } from './database-commit-authority';
import type {
  DatabaseActorPlacementConfig,
  DatabaseActorRole,
  DatabaseActorSQLiteConfig,
} from './database-actor-protocol';
import type { DatabaseErrorCode } from './database-error';
import type { DatabaseExecutor } from './database-executor';
import type { DatabaseRef } from './database-file';
import type { DatabaseObservability } from './database-observability';
import type {
  DatabaseCommitResult,
  DatabaseReadResult,
} from './database-operations';
import type { DatabasePlacementPolicy } from './database-placement';
import type { DatabaseRealm } from './database-realm';
import type { DatabaseCoordinatorRestartPolicy } from './database-restart-policy';
import type { DatabaseTrustedWriteExecutor } from './database-trusted-writer';

export type DatabaseCoordinatorState =
  | 'created'
  | 'started'
  | 'draining'
  | 'close-failed'
  | 'closed';

export interface DatabaseExecutorFactoryContext {
  readonly role: DatabaseActorRole;
  readonly slot: number;
}

export type DatabaseExecutorFactory = (
  context: DatabaseExecutorFactoryContext,
) => DatabaseExecutor;

export interface DatabaseCoordinatorOptions {
  /** Private root containing only Zero-managed flat database files. */
  readonly rootDirectory: string;
  /** Immutable actor-local schema and named-operation registry. */
  readonly realm: DatabaseRealm;
  /** Creates one exact-generation executor for a bounded pool slot. */
  readonly createExecutor: DatabaseExecutorFactory;
  /** File/hot policy resolved once and pinned for each opened generation. */
  readonly placement?: DatabasePlacementPolicy;
  readonly sqlite?: DatabaseActorSQLiteConfig;
  readonly maxDatabases?: number;
  /** Hard limit for Zero-managed physical main database files. Default: 10000. */
  readonly maxDatabaseFiles?: number;
  /** Maximum remembered permanent-open failures. Oldest records are retried. */
  readonly maxBlockedDatabases?: number;
  /** Distinct databases persistent tenant Sync may pin. Reserves one slot when possible. */
  readonly maxTenantSyncDatabases?: number;
  /** Persistent tenant Sync capabilities allowed per database. Default: 64. */
  readonly maxTenantSyncBindingsPerDatabase?: number;
  /** Set false to route every read through the writer actor. Default: true. */
  readonly readers?: boolean;
  readonly maxQueuedPerDatabase?: number;
  readonly maxQueuedTotal?: number;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  /** Bounded exponential restart and circuit-breaker policy. */
  readonly restart?: DatabaseCoordinatorRestartPolicy;
  readonly idleTimeoutMs?: number;
  readonly sweepIntervalMs?: number | false;
  readonly observability?: DatabaseObservability;
  /** Shared/exclusive gate also used by control-plane authority mutations. */
  readonly authorityCommitCoordinator?: AuthorityCommitCoordinator;
  /** Require every acquired capability to carry live commit authority. */
  readonly requireCommitAuthority?: boolean;
  /** Deterministic test seam. */
  readonly now?: () => number;
}

export interface DatabaseExecutionOptions {
  /** Cancellation is honored while waiting for recovery or in the writer FIFO. */
  readonly signal?: AbortSignal;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

export interface DatabaseAcquireOptions {
  /** Opaque live-authority context minted by trusted tenant routing. */
  readonly commitAuthority?: DatabaseCommitAuthority;
}

/** @internal Authority options for a persistent tenant Sync capability. */
export interface DatabaseTenantSyncAcquireOptions
  extends DatabaseAcquireOptions {
  /** Additional request/session read fence, checked before and after reads. */
  readonly assertReadAuthority?: () => undefined;
}

export interface DatabaseCoordinatorLease extends AsyncDisposable {
  readonly databaseRef: DatabaseRef;
  /** @internal Framework logical-request receipt capability. */
  readonly trustedWriter: DatabaseTrustedWriteExecutor;
  readonly released: boolean;
  execute(
    operation: unknown,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult | DatabaseCommitResult>;
  replay(
    afterSeq: number,
    limit?: number,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult>;
  release(): void;
}

export type DatabaseCoordinatorEntryState =
  | 'opening'
  | 'ready'
  | 'closing'
  | 'failed'
  | 'quarantined'
  | 'closed';

export interface DatabaseCoordinatorEntryDiagnostics {
  readonly databaseRef: DatabaseRef;
  readonly placement: DatabaseActorPlacementConfig['mode'];
  readonly state: DatabaseCoordinatorEntryState;
  readonly slot: number;
  readonly leases: number;
  readonly tenantSyncBindings: number;
  readonly activeOperations: number;
  readonly queueDepth: number;
  readonly writerGeneration: number | null;
  readonly readerGeneration: number | null;
  /** Consecutive replacement attempt number; zero for a stable/initial generation. */
  readonly restartRetryCount: number;
  /** True while replacement attempts are held to circuit cooldown cadence. */
  readonly restartCircuitOpen: boolean;
  readonly lastUsedAt: number;
}

export interface DatabaseCoordinatorDiagnostics {
  readonly state: DatabaseCoordinatorState;
  readonly maxDatabases: number;
  readonly maxDatabaseFiles: number;
  readonly maxBlockedDatabases: number;
  readonly maxTenantSyncDatabases: number;
  readonly maxTenantSyncBindingsPerDatabase: number;
  readonly readersEnabled: boolean;
  readonly fileDatabases: number;
  readonly hotDatabases: number;
  readonly openDatabases: number;
  readonly databaseFiles: number;
  readonly tenantSyncDatabases: number;
  readonly tenantSyncBindings: number;
  readonly queuedOperations: number;
  readonly activeOperations: number;
  readonly availableSlots: number;
  readonly quarantinedSlots: number;
  readonly heldAuthorityLeases: number;
  readonly blockedDatabases: readonly Readonly<{
    readonly databaseRef: DatabaseRef;
    readonly failureCode: DatabaseErrorCode;
  }>[];
  readonly databases: readonly DatabaseCoordinatorEntryDiagnostics[];
}
