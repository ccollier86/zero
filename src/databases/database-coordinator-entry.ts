/** Internal mutable state owned by exactly one DatabaseCoordinator. */

import type { DatabaseActorPlacementConfig } from './database-actor-protocol';
import type { DatabaseBindingIdentity } from './database-binding-identity';
import type { DatabaseCoordinatorEntryState } from './database-coordinator-contract';
import type { DatabaseError } from './database-error';
import type { DatabaseExecutor } from './database-executor';
import type { DatabaseFileIdentityProof } from './database-file-identity';
import type { DatabaseId, DatabaseRef } from './database-file';
import type { DatabaseTenantSyncWakeup } from './database-tenant-sync';
import type { DatabaseWriterLane } from './database-writer-lane';

export interface DatabaseCoordinatorSyncBindingHandle {
  notify(wakeup: DatabaseTenantSyncWakeup): void;
  coordinatorClosed(): void;
}

export interface DatabaseTenantSyncIdentity {
  readonly syncEpoch: string;
  readonly generation: number;
  readonly sequence: number;
}

export interface DatabaseCoordinatorEntry {
  readonly id: DatabaseId;
  readonly databaseRef: DatabaseRef;
  readonly filePath: string;
  fileIdentity: DatabaseFileIdentityProof;
  readonly bindingIdentity: DatabaseBindingIdentity;
  readonly placement: DatabaseActorPlacementConfig;
  readonly slot: number;
  readonly lane: DatabaseWriterLane;
  state: DatabaseCoordinatorEntryState;
  writer: DatabaseExecutor | null;
  reader: DatabaseExecutor | null;
  opening: Promise<void>;
  recovery: Promise<void> | null;
  settlement: Promise<void> | null;
  closeTask: Promise<void> | null;
  failure: DatabaseError | null;
  /** Latched when actor shutdown could not prove its durability boundary. */
  closeFailure: DatabaseError | null;
  /** Consecutive replacement attempts since the last ready generation. */
  restartRetryCount: number;
  /** Cancels only a pending backoff/circuit delay, never dispatched actor work. */
  restartAbortController: AbortController | null;
  leases: number;
  activeOperations: number;
  recoveryWaiters: number;
  lastUsedAt: number;
  syncIdentity: DatabaseTenantSyncIdentity | null;
  /** Active plus in-flight persistent tenant Sync capability reservations. */
  tenantSyncBindingSlots: number;
  readonly syncBindings: Set<DatabaseCoordinatorSyncBindingHandle>;
}
