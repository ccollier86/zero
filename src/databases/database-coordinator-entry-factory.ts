/** Physical-file admission and mutable entry construction for the coordinator. */

import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { resolveCoordinatorEntryPlacement } from './database-coordinator-placement';
import { DatabaseError } from './database-error';
import {
  createDatabaseRef,
  prepareDatabaseFileWithCreationAdmission,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';
import type { DatabaseObservability } from './database-observability';
import type { DatabasePlacementPolicy } from './database-placement';
import { DatabaseWriterLane } from './database-writer-lane';

interface DatabaseCoordinatorEntryFactoryOptions {
  readonly rootDirectory: () => string;
  readonly realmName: string;
  readonly placementPolicy: DatabasePlacementPolicy;
  readonly maxDatabaseFiles: number;
  readonly maxQueuedPerDatabase: number;
  readonly maxQueuedTotal: number;
  readonly now: () => number;
  readonly observability: DatabaseObservability | null;
  readonly assertOwnedRootCurrent: () => void;
  readonly queuedOperations: () => number;
  readonly incrementQueuedOperations: () => void;
  readonly decrementQueuedOperations: () => void;
  readonly openEntry: (entry: DatabaseCoordinatorEntry) => Promise<void>;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorEntryFactory {
  readonly #options: DatabaseCoordinatorEntryFactoryOptions;
  #managedDatabaseFiles = 0;

  constructor(options: DatabaseCoordinatorEntryFactoryOptions) {
    this.#options = options;
  }

  get managedDatabaseFiles(): number {
    return this.#managedDatabaseFiles;
  }

  setManagedDatabaseFiles(count: number): void {
    this.#managedDatabaseFiles = count;
  }

  create(id: DatabaseId, slot: number): DatabaseCoordinatorEntry {
    const databaseRef = createDatabaseRef(id);
    const placement = resolveCoordinatorEntryPlacement(
      this.#options.placementPolicy,
      databaseRef,
    );
    let prepared;
    try {
      this.#options.assertOwnedRootCurrent();
      prepared = prepareDatabaseFileWithCreationAdmission(
        this.#options.rootDirectory(),
        id,
        () => this.#assertFileAdmission(databaseRef, placement.mode),
        () => { this.#managedDatabaseFiles += 1; },
      );
      this.#options.assertOwnedRootCurrent();
      const bindingIdentity = prepareDatabaseBindingIdentity({
        filePath: prepared.path,
        fileIdentity: prepared.identity,
        databaseRef,
        realmName: this.#options.realmName,
        initialize: prepared.created,
      });
      this.#options.assertOwnedRootCurrent();
      prepared = Object.freeze({ ...prepared, bindingIdentity });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Database file could not be prepared.',
      );
    }

    const entry = {
      id,
      databaseRef,
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      bindingIdentity: prepared.bindingIdentity,
      placement,
      slot,
      lane: null as unknown as DatabaseWriterLane,
      state: 'opening' as const,
      writer: null,
      reader: null,
      opening: Promise.resolve(),
      recovery: null,
      settlement: null,
      closeTask: null,
      failure: null,
      closeFailure: null,
      restartRetryCount: 0,
      restartAbortController: null,
      leases: 0,
      activeOperations: 0,
      recoveryWaiters: 0,
      lastUsedAt: this.#options.now(),
      syncIdentity: null,
      tenantSyncBindingSlots: 0,
      syncBindings: new Set(),
    } satisfies DatabaseCoordinatorEntry;
    entry.lane = new DatabaseWriterLane({
      databaseRef,
      placement: placement.mode,
      maxQueued: this.#options.maxQueuedPerDatabase,
      now: this.#options.now,
      onQueued: () => {
        if (this.#options.queuedOperations()
          >= this.#options.maxQueuedTotal) return false;
        this.#options.incrementQueuedOperations();
        return true;
      },
      onDequeued: this.#options.decrementQueuedOperations,
      observability: this.#options.observability,
    });
    entry.opening = this.#options.openEntry(entry);
    // Concurrent acquirers may all cancel before observing shared startup.
    void entry.opening.catch(() => undefined);
    return entry;
  }

  #assertFileAdmission(
    databaseRef: DatabaseRef,
    placement: DatabaseCoordinatorEntry['placement']['mode'],
  ): void {
    if (this.#managedDatabaseFiles < this.#options.maxDatabaseFiles) return;
    this.#options.emit({
      type: 'capacity-exhausted',
      databaseRef,
      placement,
      capacityType: 'files',
      capacityLimit: this.#options.maxDatabaseFiles,
    });
    throw new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'Database file capacity is exhausted.',
      {
        retryable: false,
        outcome: 'not-started',
        details: {
          capacityType: 'files',
          capacityLimit: this.#options.maxDatabaseFiles,
        },
      },
    );
  }
}
