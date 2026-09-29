/** Immutable diagnostics projection for the coordinator's mutable catalog. */

import type {
  DatabaseCoordinatorDiagnostics,
  DatabaseCoordinatorEntryDiagnostics,
  DatabaseCoordinatorState,
} from './database-coordinator-contract';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import type { DatabaseError } from './database-error';
import type { DatabaseExecutor } from './database-executor';
import type { DatabaseId, DatabaseRef } from './database-file';

interface DatabaseCoordinatorDiagnosticsOptions {
  readonly state: DatabaseCoordinatorState;
  readonly maxDatabases: number;
  readonly maxDatabaseFiles: number;
  readonly maxBlockedDatabases: number;
  readonly maxTenantSyncDatabases: number;
  readonly maxTenantSyncBindingsPerDatabase: number;
  readonly readersEnabled: boolean;
  readonly databaseFiles: number;
  readonly queuedOperations: number;
  readonly heldAuthorityLeases: number;
  readonly restartCircuitFailureThreshold: number;
  readonly executorGeneration: (
    executor: DatabaseExecutor | null,
  ) => number | null;
  readonly entries: ReadonlyMap<DatabaseId, DatabaseCoordinatorEntry>;
  readonly freeSlots: ReadonlySet<number>;
  readonly quarantinedSlots: ReadonlySet<number>;
  readonly blockedDatabases: ReadonlyMap<DatabaseId, Readonly<{
    readonly databaseRef: DatabaseRef;
    readonly failure: DatabaseError;
  }>>;
}

export function createDatabaseCoordinatorDiagnostics(
  options: DatabaseCoordinatorDiagnosticsOptions,
): DatabaseCoordinatorDiagnostics {
  const databases = [...options.entries.values()]
    .map((entry): DatabaseCoordinatorEntryDiagnostics => Object.freeze({
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      state: entry.state,
      slot: entry.slot,
      leases: entry.leases,
      tenantSyncBindings: entry.tenantSyncBindingSlots,
      activeOperations: entry.activeOperations,
      queueDepth: entry.lane.depth + entry.recoveryWaiters,
      writerGeneration: options.executorGeneration(entry.writer),
      readerGeneration: options.executorGeneration(entry.reader),
      restartRetryCount: entry.restartRetryCount,
      restartCircuitOpen: entry.restartRetryCount
        >= options.restartCircuitFailureThreshold,
      lastUsedAt: entry.lastUsedAt,
    }))
    .sort((left, right) => left.databaseRef.localeCompare(right.databaseRef));

  return Object.freeze({
    state: options.state,
    maxDatabases: options.maxDatabases,
    maxDatabaseFiles: options.maxDatabaseFiles,
    maxBlockedDatabases: options.maxBlockedDatabases,
    maxTenantSyncDatabases: options.maxTenantSyncDatabases,
    maxTenantSyncBindingsPerDatabase:
      options.maxTenantSyncBindingsPerDatabase,
    readersEnabled: options.readersEnabled,
    fileDatabases: databases.filter((entry) => entry.placement === 'file').length,
    hotDatabases: databases.filter((entry) => entry.placement === 'hot').length,
    openDatabases: databases.filter((entry) => entry.state === 'ready').length,
    databaseFiles: options.databaseFiles,
    tenantSyncDatabases: databases.filter(
      (entry) => entry.tenantSyncBindings > 0,
    ).length,
    tenantSyncBindings: databases.reduce(
      (sum, entry) => sum + entry.tenantSyncBindings,
      0,
    ),
    queuedOperations: options.queuedOperations,
    activeOperations: databases.reduce(
      (sum, entry) => sum + entry.activeOperations,
      0,
    ),
    availableSlots: options.freeSlots.size,
    quarantinedSlots: options.quarantinedSlots.size,
    heldAuthorityLeases: options.heldAuthorityLeases,
    blockedDatabases: Object.freeze(
      [...options.blockedDatabases.values()]
        .map((blocked) => Object.freeze({
          databaseRef: blocked.databaseRef,
          failureCode: blocked.failure.code,
        }))
        .sort((left, right) => left.databaseRef.localeCompare(right.databaseRef)),
    ),
    databases: Object.freeze(databases),
  });
}
