/** Actor-pool and persistent tenant-Sync admission policy. */

import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { DatabaseError } from './database-error';
import {
  createDatabaseRef,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';
import type { DatabaseObservability } from './database-observability';

interface DatabaseCoordinatorAdmissionOptions {
  readonly maxDatabases: number;
  readonly maxTenantSyncDatabases: number;
  readonly maxTenantSyncBindingsPerDatabase: number;
  readonly entries: ReadonlyMap<DatabaseId, DatabaseCoordinatorEntry>;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorAdmission {
  readonly #options: DatabaseCoordinatorAdmissionOptions;

  constructor(options: DatabaseCoordinatorAdmissionOptions) {
    this.#options = options;
  }

  assertTenantSync(
    id: DatabaseId,
    entry: DatabaseCoordinatorEntry | null,
  ): void {
    const databaseRef = entry?.databaseRef ?? createDatabaseRef(id);
    const bindingCount = entry?.tenantSyncBindingSlots ?? 0;
    if (bindingCount >= this.#options.maxTenantSyncBindingsPerDatabase) {
      this.#options.emit({
        type: 'queue-saturated',
        databaseRef,
        ...(entry ? { placement: entry.placement.mode } : {}),
        operation: 'sync',
        queueDepth: bindingCount,
        queueLimit: this.#options.maxTenantSyncBindingsPerDatabase,
      });
      throw new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database tenant Sync binding capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            maxTenantSyncBindingsPerDatabase:
              this.#options.maxTenantSyncBindingsPerDatabase,
          },
        },
      );
    }

    if (bindingCount > 0) return;
    const distinctDatabases = [...this.#options.entries.values()].filter(
      (candidate) => candidate.tenantSyncBindingSlots > 0,
    ).length;
    if (distinctDatabases < this.#options.maxTenantSyncDatabases) return;
    this.#options.emit({
      type: 'queue-saturated',
      databaseRef,
      ...(entry ? { placement: entry.placement.mode } : {}),
      operation: 'sync',
      queueDepth: distinctDatabases,
      queueLimit: this.#options.maxTenantSyncDatabases,
    });
    throw new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database tenant Sync database capacity is exhausted.',
      {
        retryable: true,
        outcome: 'not-started',
        details: {
          maxTenantSyncDatabases: this.#options.maxTenantSyncDatabases,
        },
      },
    );
  }

  selectCapacityEviction(): DatabaseCoordinatorEntry | null {
    return [...this.#options.entries.values()]
      .filter((entry) => this.isEvictable(entry))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0] ?? null;
  }

  isEvictable(entry: DatabaseCoordinatorEntry): boolean {
    return entry.state === 'ready'
      && entry.leases === 0
      && entry.activeOperations === 0
      && entry.recoveryWaiters === 0
      && entry.lane.depth === 0;
  }

  capacityError(databaseRef: DatabaseRef): DatabaseError {
    this.#options.emit({
      type: 'queue-saturated',
      databaseRef,
      operation: 'open',
      queueDepth: this.#options.maxDatabases,
      queueLimit: this.#options.maxDatabases,
    });
    return new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database actor capacity is exhausted.',
      {
        retryable: true,
        outcome: 'not-started',
        details: { maxDatabases: this.#options.maxDatabases },
      },
    );
  }
}
