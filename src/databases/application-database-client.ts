/** Async application facade over the already-owned primary ReactiveDB runtime. */

import type { TableSchema } from '../sync/types';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import { createAsyncDatabaseClient } from './database-client';
import { queueCancelled } from './database-coordinator-errors';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';
import {
  validateDatabaseOperation,
  type AsyncDatabaseClient,
  type AsyncDatabaseOperationExecutor,
  type DatabaseOperation,
  type DatabaseOperationCatalog,
  type DatabaseOperationExecutionOptions,
} from './database-operations';
import { createDatabaseRealmOperationCatalog, defineDatabaseRealm, type DatabaseRealm } from './database-realm';
import type { DatabaseRuntime } from './database-runtime';
import { DatabaseWriterOperationEngine } from './database-writer-engine';
import { executeDatabaseWriterRead } from './database-writer-read-executor';
import { assertDatabaseWriterRealmMatchesRuntime } from './database-writer-realm-validation';
import { DatabaseWriterLane } from './database-writer-lane';

export interface ApplicationDatabaseClientOptions {
  readonly runtime: DatabaseRuntime;
  /** Only application declarations, never inferred system/service tables. */
  readonly tables: Readonly<Record<string, TableSchema>>;
  readonly realm?: DatabaseRealm;
  readonly assertStarted: () => void;
}

/**
 * One owner per primary runtime, not per request. Reuses the Fabric operation
 * engine, receipts and FIFO without opening another connection or snapshot.
 * SQLite work remains synchronous; an async facade is not worker offloading.
 */
export class ApplicationDatabaseClients {
  readonly #options: ApplicationDatabaseClientOptions;
  readonly #lane: DatabaseWriterLane;
  #realm: DatabaseRealm | null = null;
  #catalog: DatabaseOperationCatalog | null = null;
  #writer: DatabaseWriterOperationEngine | null = null;
  #closed = false;

  constructor(options: ApplicationDatabaseClientOptions) {
    // Preserve column order and schema metadata while detaching caller objects.
    this.#options = { ...options, tables: Object.fromEntries(
      Object.entries(options.tables).map(([name, schema]) => [name, { ...schema }]),
    ) };
    this.#lane = new DatabaseWriterLane({
      databaseRef: createDatabaseRef('application'),
      placement: options.runtime.sqlite.mode === 'hot' ? 'hot' : 'file',
      maxQueued: 256,
      now: () => performance.now(),
      onQueued: () => true,
      onDequeued: () => {},
      observability: null,
    });
  }

  bind(assertCurrentAuthority: () => undefined): AsyncDatabaseClient {
    const executor = {
      execute: async (operation: DatabaseOperation, options?: DatabaseOperationExecutionOptions) => {
        this.#assertOpen();
        assertAuthority(assertCurrentAuthority, 'not-started');
        const queueTimeoutMs = positiveTimeout(options?.queueTimeoutMs, 30_000);
        // Validate the shared execution contract even though synchronous SQLite
        // cannot be interrupted after dispatch. Never report an elapsed write
        // as cancelled/not-committed after it actually committed.
        positiveTimeout(options?.operationTimeoutMs, 30_000);
        const { realm, catalog } = this.#admit();
        const admitted = validateDatabaseOperation(operation, catalog);
        const result = await this.#lane.enqueue(async () => {
          this.#assertOpen();
          if (options?.signal?.aborted) throw queueCancelled();
          assertAuthority(assertCurrentAuthority, 'not-started');
          if (admitted.type === 'mutate' || admitted.type === 'batch' || admitted.type === 'command') {
            // No authority lease spans an await or post-commit notification.
            // Existing primary commit/revision guards remain in force.
            this.#writer ??= new DatabaseWriterOperationEngine({ runtime: this.#options.runtime, realm });
            return this.#writer.execute(admitted, undefined, () => {
              assertAuthority(assertCurrentAuthority, 'not-committed');
              return undefined;
            });
          }
          return executeDatabaseWriterRead(this.#options.runtime, realm, catalog, admitted, { reusePinnedHandle: true });
        }, { signal: options?.signal, timeoutMs: queueTimeoutMs,
          operationClass: admitted.type === 'mutate' || admitted.type === 'batch' || admitted.type === 'command' ? 'mutation' : 'query' });
        this.#assertOpen();
        // Revocation while a promise is settling must not deliver old data or
        // a canonical receipt. This is not proof that a write rolled back.
        assertAuthority(assertCurrentAuthority, null);
        return result;
      },
    } as AsyncDatabaseOperationExecutor;
    return createAsyncDatabaseClient({ executor, assertReadAuthority: assertCurrentAuthority });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#lane.rejectQueued(closed());
    await this.#lane.idle();
    this.#writer?.close();
    this.#writer = null;
  }

  #admit(): { realm: DatabaseRealm; catalog: DatabaseOperationCatalog } {
    if (!this.#realm || !this.#catalog) {
      // Lazy admission keeps older apps with non-portable schemas working on
      // zero.db until they deliberately adopt the serializable async API.
      const realm = this.#options.realm ?? defineDatabaseRealm({
        name: 'application', version: '1', tables: this.#options.tables,
      });
      const catalog = createDatabaseRealmOperationCatalog(realm);
      assertDatabaseWriterRealmMatchesRuntime(this.#options.runtime, realm, catalog);
      this.#realm = realm;
      this.#catalog = catalog;
    }
    return { realm: this.#realm, catalog: this.#catalog };
  }

  #assertOpen(): void {
    if (this.#closed) throw closed();
    this.#options.assertStarted();
  }
}

function assertAuthority(check: () => undefined, outcome: 'not-started' | 'not-committed' | null): void {
  let value: unknown;
  try { value = check(); } catch {
    throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Application database authority changed.', { retryable: false, outcome });
  }
  if (value !== undefined) {
    void Promise.resolve(value).catch(() => undefined);
    throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database authority checks must be synchronous.');
  }
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RUNTIME_TIMER_INTERVAL_MS) {
    throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Database timeout is outside the supported timer range.');
  }
  return value;
}

function closed(): DatabaseError {
  return new DatabaseError('DATABASE_CLOSED', 'Application database is not accepting work.', { outcome: 'not-started' });
}

