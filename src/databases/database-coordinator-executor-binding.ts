/** Executor construction, identity validation, and settlement supervision. */

import type {
  DatabaseActorBindResult,
  DatabaseActorRole,
} from './database-actor-protocol';
import type {
  DatabaseCoordinatorState,
  DatabaseExecutorFactory,
} from './database-coordinator-contract';
import {
  bindDatabaseCoordinatorExecutor,
  DatabaseCoordinatorBoundExecutor,
} from './database-coordinator-bound-executor';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { safeCoordinatorError } from './database-coordinator-errors';
import { sameCoordinatorActorPlacement } from './database-coordinator-placement';
import { DatabaseError } from './database-error';
import type { DatabaseExecutor } from './database-executor';
import { sameDatabaseFileIdentity } from './database-file-identity';
import type { DatabaseHotDurabilitySupervisor } from './database-hot-durability-supervisor';
import type { DatabaseObservability } from './database-observability';
import type { DatabaseRealm } from './database-realm';

interface DatabaseCoordinatorExecutorBindingOptions {
  readonly realm: DatabaseRealm;
  readonly createExecutor: DatabaseExecutorFactory;
  readonly hotDurabilitySupervisor: DatabaseHotDurabilitySupervisor;
  readonly entries: Map<DatabaseCoordinatorEntry['id'], DatabaseCoordinatorEntry>;
  readonly state: () => DatabaseCoordinatorState;
  readonly retire: (
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
  ) => Promise<void>;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

/** Owns the parent-side executor identity boundary for coordinator entries. */
export class DatabaseCoordinatorExecutorBinding {
  readonly #realm: DatabaseRealm;
  readonly #createExecutor: DatabaseExecutorFactory;
  readonly #hotDurabilitySupervisor: DatabaseHotDurabilitySupervisor;
  readonly #entries: Map<
    DatabaseCoordinatorEntry['id'],
    DatabaseCoordinatorEntry
  >;
  readonly #state: () => DatabaseCoordinatorState;
  readonly #retire: DatabaseCoordinatorExecutorBindingOptions['retire'];
  readonly #emit: DatabaseCoordinatorExecutorBindingOptions['emit'];
  readonly #lastGenerationBySlot = new Map<string, number>();

  constructor(options: DatabaseCoordinatorExecutorBindingOptions) {
    this.#realm = options.realm;
    this.#createExecutor = options.createExecutor;
    this.#hotDurabilitySupervisor = options.hotDurabilitySupervisor;
    this.#entries = options.entries;
    this.#state = options.state;
    this.#retire = options.retire;
    this.#emit = options.emit;
  }

  create(
    entry: DatabaseCoordinatorEntry,
    role: DatabaseActorRole,
  ): DatabaseExecutor {
    let candidate: unknown;
    try {
      candidate = this.#createExecutor(Object.freeze({
        role,
        slot: entry.slot,
      }));
    } catch {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor factory failed.',
      );
    }
    const executor = bindDatabaseCoordinatorExecutor(candidate, entry.slot);

    // Publish the guarded executor before validating optional surfaces so the
    // caller's startup-failure cleanup can always close the created handle.
    if (role === 'writer') entry.writer = executor;
    else entry.reader = executor;

    const requiresEventListener = role === 'writer'
      && entry.placement.mode === 'hot'
      && entry.placement.durability === 'periodic';
    let acceptsEvents = false;
    let prematureEvent = false;
    const eventListenerInstalled = executor.installEventListener((event) => {
      if (!acceptsEvents) {
        prematureEvent = true;
        return;
      }
      try {
        this.#hotDurabilitySupervisor.observe(entry, executor, role, event);
      } catch {
        // Executor lifecycle callbacks remain synchronous and non-throwing.
      }
    });
    if (requiresEventListener && !eventListenerInstalled) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Periodic hot database executors require an event boundary.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    if (prematureEvent) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor emitted an event before identity assignment.',
        { retryable: false, outcome: 'not-started' },
      );
    }

    const generationKey = `${role}:${entry.slot}`;
    const previousGeneration = this.#lastGenerationBySlot.get(generationKey) ?? 0;
    const diagnostics = executor.pinIdentity(previousGeneration);
    this.#lastGenerationBySlot.set(generationKey, diagnostics.generation);
    acceptsEvents = true;
    return executor;
  }

  generation(executor: DatabaseExecutor): number | null {
    return executor instanceof DatabaseCoordinatorBoundExecutor
      ? executor.pinnedGeneration
      : null;
  }

  assertBindResult(
    entry: DatabaseCoordinatorEntry,
    role: DatabaseActorRole,
    result: DatabaseActorBindResult,
  ): void {
    if (result.databaseRef !== entry.databaseRef
      || result.role !== role
      || !sameDatabaseFileIdentity(result.fileIdentity, entry.fileIdentity)
      || result.instanceId !== entry.bindingIdentity.instanceId
      || !sameCoordinatorActorPlacement(result.placement, entry.placement)
      || result.realmFingerprint !== this.#realm.fingerprint
      || result.schemaChecksum !== this.#realm.schemaChecksum) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database actor binding did not match its assigned realm.',
      );
    }
  }

  watchUnexpectedSettlement(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
  ): void {
    void Promise.resolve().then(() => executor.settled()).then(
      () => this.#handleUnexpectedSettlement(entry, executor, role),
      () => this.#handleUnexpectedSettlement(entry, executor, role),
    ).catch((caught) => {
      this.#emit({
        type: 'coordinator-failed',
        phase: 'close',
        error: safeCoordinatorError(caught),
      });
    }).catch(() => undefined);
  }

  emitRestarted(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
    retryCount: number,
  ): void {
    this.#emit({
      type: 'executor-restarted',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role,
      slot: entry.slot,
      generation: this.#requireGeneration(executor),
      reason: 'failure',
      retryCount,
    });
  }

  #handleUnexpectedSettlement(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
  ): void {
    if (this.#state() !== 'started'
      || entry.state !== 'ready'
      || this.#entries.get(entry.id) !== entry
      || (role === 'writer' ? entry.writer : entry.reader) !== executor) return;
    this.#hotDurabilitySupervisor.clear(executor);
    const error = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor settlement boundary failed.',
      { retryable: false, outcome: 'unknown' },
    );
    this.#emit({
      type: 'executor-failed',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role,
      slot: entry.slot,
      generation: this.#requireGeneration(executor),
      phase: 'execute',
      error,
    });
    void this.#retire(entry, executor, error).catch((caught) => {
      this.#emit({
        type: 'coordinator-failed',
        phase: 'close',
        error: safeCoordinatorError(caught),
      });
    }).catch(() => undefined);
  }

  #requireGeneration(executor: DatabaseExecutor): number {
    const generation = this.generation(executor);
    if (generation === null) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor identity is unavailable.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    return generation;
  }
}
