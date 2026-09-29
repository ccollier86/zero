/** Actor generation startup, recovery, quarantine, settlement, and closure. */

import {
  DATABASE_ACTOR_OPERATIONS,
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  type DatabaseActorSQLiteConfig,
} from './database-actor-protocol';
import type { DatabaseActorLivenessBinding } from './database-actor-liveness';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import type {
  DatabaseCoordinatorState,
  DatabaseExecutorFactory,
} from './database-coordinator-contract';
import type {
  DatabaseCoordinatorEntry,
  DatabaseTenantSyncIdentity,
} from './database-coordinator-entry';
import {
  elapsed,
  isPermanentOpenFailure,
  safeCoordinatorError,
} from './database-coordinator-errors';
import { DatabaseCoordinatorExecutorBinding } from './database-coordinator-executor-binding';
import { compactExecutors } from './database-coordinator-runtime';
import type { DatabaseCoordinatorSyncPublication } from './database-coordinator-sync-publication';
import { DatabaseError } from './database-error';
import type { DatabaseExecutor, DatabaseExecutorValue } from './database-executor';
import { openDatabaseFileIdentityGuard } from './database-file-identity';
import { DatabaseHotDurabilitySupervisor } from './database-hot-durability-supervisor';
import type { DatabaseObservability } from './database-observability';
import type { DatabaseRealm } from './database-realm';
import {
  nextDatabaseRestartPlan,
  waitForDatabaseRestart,
  type NormalizedDatabaseCoordinatorRestartPolicy,
} from './database-restart-policy';

export type DatabaseBindingRetirementReason =
  | 'runtime-failure'
  | 'periodic-durability-failure';

export type DatabaseCloseReason = 'requested' | 'idle' | 'capacity' | 'shutdown';

interface DatabaseCoordinatorEntryLifecycleOptions {
  readonly realm: DatabaseRealm;
  readonly sqlite: DatabaseActorSQLiteConfig;
  readonly readersEnabled: boolean;
  readonly operationTimeoutMs: number;
  readonly createExecutor: DatabaseExecutorFactory;
  readonly restartPolicy: NormalizedDatabaseCoordinatorRestartPolicy;
  readonly observability: DatabaseObservability | null;
  readonly now: () => number;
  readonly entries: Map<DatabaseCoordinatorEntry['id'], DatabaseCoordinatorEntry>;
  readonly quarantinedSlots: Set<number>;
  readonly state: () => DatabaseCoordinatorState;
  readonly actorLiveness: () => DatabaseActorLivenessBinding;
  readonly assertOwnedRootCurrent: () => void;
  readonly releaseSlot: (slot: number) => void;
  readonly rememberBlockedDatabase: (
    entry: DatabaseCoordinatorEntry,
    failure: DatabaseError,
  ) => void;
  readonly syncPublication: DatabaseCoordinatorSyncPublication;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorEntryLifecycle {
  readonly #realm: DatabaseRealm;
  readonly #sqlite: DatabaseActorSQLiteConfig;
  readonly #readersEnabled: boolean;
  readonly #operationTimeoutMs: number;
  readonly #restartPolicy: NormalizedDatabaseCoordinatorRestartPolicy;
  readonly #now: () => number;
  readonly #entries: Map<
    DatabaseCoordinatorEntry['id'],
    DatabaseCoordinatorEntry
  >;
  readonly #quarantinedSlots: Set<number>;
  readonly #state: () => DatabaseCoordinatorState;
  readonly #actorLiveness: () => DatabaseActorLivenessBinding;
  readonly #assertOwnedRootCurrent: () => void;
  readonly #releaseSlot: (slot: number) => void;
  readonly #rememberBlockedDatabase:
    DatabaseCoordinatorEntryLifecycleOptions['rememberBlockedDatabase'];
  readonly #syncPublication: DatabaseCoordinatorSyncPublication;
  readonly #emit: DatabaseCoordinatorEntryLifecycleOptions['emit'];
  readonly #hotDurabilitySupervisor: DatabaseHotDurabilitySupervisor;
  readonly #executorBinding: DatabaseCoordinatorExecutorBinding;

  constructor(options: DatabaseCoordinatorEntryLifecycleOptions) {
    this.#realm = options.realm;
    this.#sqlite = options.sqlite;
    this.#readersEnabled = options.readersEnabled;
    this.#operationTimeoutMs = options.operationTimeoutMs;
    this.#restartPolicy = options.restartPolicy;
    this.#now = options.now;
    this.#entries = options.entries;
    this.#quarantinedSlots = options.quarantinedSlots;
    this.#state = options.state;
    this.#actorLiveness = options.actorLiveness;
    this.#assertOwnedRootCurrent = options.assertOwnedRootCurrent;
    this.#releaseSlot = options.releaseSlot;
    this.#rememberBlockedDatabase = options.rememberBlockedDatabase;
    this.#syncPublication = options.syncPublication;
    this.#emit = options.emit;
    this.#hotDurabilitySupervisor = new DatabaseHotDurabilitySupervisor({
      now: this.#now,
      observability: options.observability,
      isObservedEntryCurrent: (entry, executor, role) => (
        (entry.state === 'ready' || entry.state === 'opening')
        && this.#entries.get(entry.id) === entry
        && (role === 'writer' ? entry.writer : entry.reader) === executor
      ),
      isReadyWriterCurrent: (entry, executor) => (
        this.#state() === 'started'
        && entry.state === 'ready'
        && this.#entries.get(entry.id) === entry
        && entry.writer === executor
      ),
      onFatal: (entry, executor, error) => {
        void this.retireBinding(
          entry,
          executor,
          error,
          'periodic-durability-failure',
        ).catch((caught) => {
          this.#emit({
            type: 'coordinator-failed',
            phase: 'close',
            error: safeCoordinatorError(caught),
          });
        });
      },
    });
    this.#executorBinding = new DatabaseCoordinatorExecutorBinding({
      realm: this.#realm,
      createExecutor: options.createExecutor,
      hotDurabilitySupervisor: this.#hotDurabilitySupervisor,
      entries: this.#entries,
      state: this.#state,
      retire: (entry, executor, error) => this.retireBinding(
        entry,
        executor,
        error,
        'runtime-failure',
      ),
      emit: this.#emit,
    });
  }

  async openEntry(
    entry: DatabaseCoordinatorEntry,
    restartRetryCount = 0,
  ): Promise<void> {
    const startedAt = this.#now();
    const previousSyncIdentity = entry.syncIdentity;
    try {
      const payload = validateDatabaseActorBindPayload({
        databaseRef: entry.databaseRef,
        filePath: entry.filePath,
        fileIdentity: entry.fileIdentity,
        instanceId: entry.bindingIdentity.instanceId,
        actorLiveness: this.#actorLiveness(),
        placement: entry.placement,
        realmFingerprint: this.#realm.fingerprint,
        sqlite: this.#sqlite,
      });
      entry.writer = this.#executorBinding.create(entry, 'writer');
      await entry.writer.start();
      const writerResult = validateDatabaseActorBindResult(
        await entry.writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.bindWriter,
          kind: 'write',
          payload: payload as unknown as DatabaseExecutorValue,
        }, { timeoutMs: this.#operationTimeoutMs }),
      );
      this.#executorBinding.assertBindResult(entry, 'writer', writerResult);

      if (this.#readersEnabled && entry.placement.mode === 'file') {
        entry.reader = this.#executorBinding.create(entry, 'reader');
        await entry.reader.start();
        const readerResult = validateDatabaseActorBindResult(
          await entry.reader.execute({
            operation: DATABASE_ACTOR_OPERATIONS.bindReader,
            kind: 'read',
            payload: payload as unknown as DatabaseExecutorValue,
          }, { timeoutMs: this.#operationTimeoutMs }),
        );
        this.#executorBinding.assertBindResult(entry, 'reader', readerResult);
      }
      if (this.#state() !== 'started' || entry.state !== 'opening') {
        throw closedError();
      }
      const syncEpoch = writerResult.syncEpoch;
      if (syncEpoch === null) {
        throw new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Database writer did not provide a Sync epoch.',
          { retryable: false, outcome: 'not-started' },
        );
      }
      const nextSyncIdentity: DatabaseTenantSyncIdentity = Object.freeze({
        syncEpoch,
        generation: this.#requireExecutorGeneration(entry.writer),
        sequence: writerResult.sequence.seq,
      });
      if (entry.writer.diagnostics().state !== 'ready'
        || (entry.reader && entry.reader.diagnostics().state !== 'ready')) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_START_FAILED',
          'Database executor settled during binding.',
        );
      }
      entry.failure = null;
      entry.syncIdentity = nextSyncIdentity;
      entry.state = 'ready';
      entry.restartRetryCount = 0;
      this.#executorBinding.watchUnexpectedSettlement(
        entry,
        entry.writer,
        'writer',
      );
      if (entry.reader) {
        this.#executorBinding.watchUnexpectedSettlement(
          entry,
          entry.reader,
          'reader',
        );
      }
      if (previousSyncIdentity
        && (previousSyncIdentity.syncEpoch !== nextSyncIdentity.syncEpoch
          || previousSyncIdentity.generation !== nextSyncIdentity.generation)) {
        this.#syncPublication.publishReset(entry, nextSyncIdentity);
      }
      if (restartRetryCount > 0) {
        this.#executorBinding.emitRestarted(
          entry,
          entry.writer,
          'writer',
          restartRetryCount,
        );
        if (entry.reader) {
          this.#executorBinding.emitRestarted(
            entry,
            entry.reader,
            'reader',
            restartRetryCount,
          );
        }
      }
      this.#emit({
        type: 'runtime-opened',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        durationMs: elapsed(startedAt, this.#now()),
      });
    } catch (caught) {
      const originalError = safeCoordinatorError(caught);
      const writer = entry.writer;
      const reader = entry.reader;
      const actors = compactExecutors(writer, reader);
      entry.failure = originalError;
      if (entry.state !== 'closing') entry.state = 'failed';
      const cleanupFailures = await this.#closeBoundActors(writer, reader);
      const error = cleanupFailures.length === 0
        ? originalError
        : new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database actor startup failed and cleanup was incomplete.',
          { retryable: false, outcome: 'unknown' },
        );
      entry.failure = error;
      if (cleanupFailures.length > 0
        && requiresHotCloseDurabilityProof(entry)) {
        this.#latchCloseFailure(entry);
        if (!this.#executorsSettled(actors)) {
          this.#watchSettlement(entry, actors, () => {
            this.#latchCloseFailure(entry);
          });
        }
        this.#emit({
          type: 'runtime-open-failed',
          databaseRef: entry.databaseRef,
          placement: entry.placement.mode,
          slot: entry.slot,
          durationMs: elapsed(startedAt, this.#now()),
          error,
        });
        throw error;
      }
      const finishFailure = restartRetryCount > 0
        ? () => this.#finishRecoveryOpenFailure(
            entry,
            writer,
            reader,
            originalError,
          )
        : () => this.#finishOpenFailure(
            entry,
            writer,
            reader,
            originalError,
          );
      if (this.#executorsSettled(actors)) {
        finishFailure();
      } else {
        entry.state = 'quarantined';
        this.#quarantinedSlots.add(entry.slot);
        this.#watchSettlement(entry, actors, finishFailure);
      }
      this.#emit({
        type: 'runtime-open-failed',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        durationMs: elapsed(startedAt, this.#now()),
        error,
      });
      throw error;
    }
  }

  canAwaitOpening(entry: DatabaseCoordinatorEntry): boolean {
    return this.#state() === 'started'
      && this.#entries.get(entry.id) === entry
      && entry.state === 'opening';
  }

  requireWriter(entry: DatabaseCoordinatorEntry): DatabaseExecutor {
    if (!entry.writer || entry.state !== 'ready') throw notReadyError();
    return entry.writer;
  }

  isTerminalExecutorFailure(
    executor: DatabaseExecutor,
    error: DatabaseError,
  ): boolean {
    let state: ReturnType<DatabaseExecutor['diagnostics']>['state'];
    try {
      state = executor.diagnostics().state;
    } catch {
      return true;
    }
    return error.code === 'DATABASE_PROTOCOL_ERROR'
      || state === 'failed'
      || state === 'quarantined'
      || state === 'closed';
  }

  executorGeneration(executor: DatabaseExecutor | null): number | null {
    return executor ? this.#executorBinding.generation(executor) : null;
  }

  cleanupFailedEntryIfUnused(entry: DatabaseCoordinatorEntry): void {
    if (entry.state !== 'failed'
      || this.#entries.get(entry.id) !== entry
      || entry.leases > 0
      || entry.activeOperations > 0
      || entry.recoveryWaiters > 0
      || entry.lane.depth > 0
      || !this.#entryExecutorsSettled(entry)) return;
    this.#entries.delete(entry.id);
    entry.writer = null;
    entry.reader = null;
    this.#releaseSlot(entry.slot);
    entry.state = 'closed';
  }

  async retireBinding(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
    reason: DatabaseBindingRetirementReason,
  ): Promise<void> {
    if (executor !== entry.writer && executor !== entry.reader) return;
    if (entry.recovery) {
      await entry.recovery;
      return;
    }
    if (this.#state() !== 'started'
      || entry.state === 'closing'
      || entry.state === 'closed') return;

    const recovery = this.#retireBindingOnce(entry, error, reason);
    entry.recovery = recovery;
    try {
      await recovery;
    } finally {
      if (entry.recovery === recovery) entry.recovery = null;
    }
  }

  async closeEntry(
    entry: DatabaseCoordinatorEntry,
    reason: DatabaseCloseReason,
  ): Promise<void> {
    if (readEntryState(entry) === 'closed') return;
    if (entry.closeTask) return entry.closeTask;
    const task = this.#closeEntryOnce(entry, reason);
    entry.closeTask = task;
    try {
      await task;
    } finally {
      if (entry.closeTask === task) entry.closeTask = null;
    }
  }

  async #retireBindingOnce(
    entry: DatabaseCoordinatorEntry,
    error: DatabaseError,
    reason: DatabaseBindingRetirementReason,
  ): Promise<void> {
    entry.failure = safeCoordinatorError(error);
    entry.state = 'failed';
    entry.lane.rejectQueued(notReadyError());
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    for (const actor of actors) this.#hotDurabilitySupervisor.clear(actor);
    const closeFailures = await this.#closeExecutors(actors);

    if (closeFailures.length > 0
      && requiresHotCloseDurabilityProof(entry)
      && !allowsPeriodicRuntimeRecovery(entry, reason)) {
      this.#latchCloseFailure(entry);
      if (!this.#executorsSettled(actors)) {
        this.#watchSettlement(entry, actors, () => {
          this.#latchCloseFailure(entry);
        });
      }
      return;
    }

    if (this.#executorsSettled(actors)) {
      this.#finishBindingRetirement(entry, writer, reader);
      return;
    }
    entry.state = 'quarantined';
    this.#quarantinedSlots.add(entry.slot);
    this.#watchSettlement(
      entry,
      actors,
      () => this.#finishBindingRetirement(entry, writer, reader),
    );
  }

  #finishBindingRetirement(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    this.#quarantinedSlots.delete(entry.slot);

    if (this.#state() === 'started'
      && this.#entries.get(entry.id) === entry
      && entry.leases > 0) {
      this.#scheduleReplacementOpening(entry);
      return;
    }
    entry.state = 'failed';
    this.cleanupFailedEntryIfUnused(entry);
  }

  #scheduleReplacementOpening(entry: DatabaseCoordinatorEntry): void {
    if (this.#state() !== 'started'
      || this.#entries.get(entry.id) !== entry
      || entry.leases === 0
      || entry.state === 'closing'
      || entry.state === 'closed') {
      entry.state = this.#state() === 'started' ? 'failed' : 'closed';
      this.cleanupFailedEntryIfUnused(entry);
      return;
    }

    try {
      this.#refreshHotEntryFileIdentity(entry);
    } catch (caught) {
      const failure = safeCoordinatorError(caught);
      this.#syncPublication.invalidate(entry);
      entry.failure = failure;
      entry.state = 'failed';
      this.#emit({
        type: 'coordinator-failed',
        phase: 'open',
        error: failure,
      });
      return;
    }

    const plan = nextDatabaseRestartPlan(
      this.#restartPolicy,
      entry.restartRetryCount,
    );
    entry.restartRetryCount = plan.retryCount;
    entry.restartAbortController?.abort();
    const controller = new AbortController();
    entry.restartAbortController = controller;
    entry.state = 'opening';
    entry.failure = null;
    const opening = this.#openReplacementAfterDelay(
      entry,
      plan.retryCount,
      plan.delayMs,
      controller,
    );
    entry.opening = opening;
    void opening.catch(() => undefined);
  }

  async #openReplacementAfterDelay(
    entry: DatabaseCoordinatorEntry,
    retryCount: number,
    delayMs: number,
    controller: AbortController,
  ): Promise<void> {
    const allowed = await waitForDatabaseRestart(delayMs, controller.signal);
    if (entry.restartAbortController === controller) {
      entry.restartAbortController = null;
    }
    if (!allowed
      || this.#state() !== 'started'
      || this.#entries.get(entry.id) !== entry
      || entry.state !== 'opening'
      || entry.leases === 0) {
      if (this.#entries.get(entry.id) === entry
        && entry.state === 'opening'
        && entry.leases === 0) {
        entry.state = 'failed';
        this.cleanupFailedEntryIfUnused(entry);
      }
      return;
    }
    await this.openEntry(entry, retryCount);
  }

  #finishRecoveryOpenFailure(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    failure: DatabaseError,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    this.#quarantinedSlots.delete(entry.slot);

    if (entry.state === 'closing'
      || entry.state === 'closed'
      || this.#state() !== 'started'
      || this.#entries.get(entry.id) !== entry) return;
    if (isPermanentOpenFailure(failure)) {
      this.#finishOpenFailure(entry, null, null, failure);
      return;
    }
    if (failure.code === 'DATABASE_EXECUTOR_START_FAILED'
      && failure.retryable === false
      && failure.outcome === 'not-started') {
      this.#finishOpenFailure(entry, null, null, failure, false);
      return;
    }
    entry.failure = failure;
    entry.state = 'failed';
    if (entry.leases > 0) {
      this.#scheduleReplacementOpening(entry);
      return;
    }
    this.cleanupFailedEntryIfUnused(entry);
  }

  #refreshHotEntryFileIdentity(entry: DatabaseCoordinatorEntry): void {
    if (entry.placement.mode !== 'hot') return;
    this.#assertOwnedRootCurrent();
    const guard = openDatabaseFileIdentityGuard(entry.filePath, {
      access: 'readwrite',
    });
    try {
      const bindingIdentity = prepareDatabaseBindingIdentity({
        filePath: entry.filePath,
        fileIdentity: guard.proof,
        databaseRef: entry.databaseRef,
        realmName: this.#realm.name,
        initialize: false,
      });
      guard.assertCurrent();
      this.#assertOwnedRootCurrent();
      if (bindingIdentity.instanceId !== entry.bindingIdentity.instanceId) {
        throw new DatabaseError(
          'DATABASE_SCHEMA_MISMATCH',
          'Database file binding identity changed after actor settlement.',
          { retryable: false, outcome: 'not-started' },
        );
      }
      entry.fileIdentity = guard.proof;
    } finally {
      guard.release();
    }
  }

  async #closeEntryOnce(
    entry: DatabaseCoordinatorEntry,
    reason: DatabaseCloseReason,
  ): Promise<void> {
    if (entry.closeFailure) {
      entry.state = 'quarantined';
      this.#quarantinedSlots.add(entry.slot);
      throw entry.closeFailure;
    }
    entry.state = 'closing';
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    entry.lane.rejectQueued(closedError());
    try {
      await entry.opening;
    } catch {
      // Startup owns failure classification and actor cleanup.
    }
    if (readEntryState(entry) === 'closed') return;
    await entry.lane.idle();
    await this.#joinEntryRecovery(entry);
    if (readEntryState(entry) === 'closed') return;
    if (entry.closeFailure) {
      entry.state = 'quarantined';
      this.#quarantinedSlots.add(entry.slot);
      throw entry.closeFailure;
    }
    entry.state = 'closing';
    const startedAt = this.#now();
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    const failures = await this.#closeBoundActors(writer, reader);
    const actorsSettled = this.#executorsSettled(actors);
    if (failures.length > 0 && requiresHotCloseDurabilityProof(entry)) {
      const failure = this.#latchCloseFailure(entry);
      if (!actorsSettled) {
        this.#watchSettlement(entry, actors, () => {
          this.#latchCloseFailure(entry);
        });
      }
      throw failure;
    }
    if (!actorsSettled) {
      entry.state = 'quarantined';
      this.#quarantinedSlots.add(entry.slot);
      this.#watchSettlement(entry, actors, () => {
        if (!this.#finishEntryClosure(
          entry,
          writer,
          reader,
          reason,
          startedAt,
        )) {
          throw new DatabaseError(
            'DATABASE_EXECUTOR_FAILED',
            'Database actor identity changed during closure.',
            { retryable: false, outcome: 'unknown' },
          );
        }
      });
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor settlement is incomplete.',
        { retryable: false, outcome: 'unknown' },
      );
    }

    if (!this.#finishEntryClosure(entry, writer, reader, reason, startedAt)) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor identity changed during closure.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actors did not close cleanly.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  #finishEntryClosure(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    reason: DatabaseCloseReason,
    startedAt: number,
  ): boolean {
    if (entry.state === 'closed') return true;
    if (entry.writer !== writer || entry.reader !== reader) return false;
    this.#syncPublication.invalidate(entry);
    entry.writer = null;
    entry.reader = null;
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    entry.restartRetryCount = 0;
    entry.failure = null;
    entry.closeFailure = null;
    entry.state = 'closed';
    this.#quarantinedSlots.delete(entry.slot);
    if (this.#entries.get(entry.id) === entry) this.#entries.delete(entry.id);
    this.#releaseSlot(entry.slot);
    this.#emit({
      type: 'runtime-closed',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      slot: entry.slot,
      durationMs: elapsed(startedAt, this.#now()),
      reason,
    });
    if (reason !== 'shutdown') {
      this.#emit({
        type: 'runtime-evicted',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        reason,
      });
    }
    return true;
  }

  async #joinEntryRecovery(entry: DatabaseCoordinatorEntry): Promise<void> {
    while (entry.recovery) {
      const recovery = entry.recovery;
      try {
        await recovery;
      } finally {
        if (entry.recovery === recovery) entry.recovery = null;
      }
    }
  }

  #latchCloseFailure(entry: DatabaseCoordinatorEntry): DatabaseError {
    if (entry.closeFailure) return entry.closeFailure;
    const failure = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database actors did not close cleanly.',
      { retryable: false, outcome: 'unknown' },
    );
    this.#syncPublication.invalidate(entry);
    entry.failure = failure;
    entry.closeFailure = failure;
    entry.state = 'quarantined';
    this.#quarantinedSlots.add(entry.slot);
    return failure;
  }

  #finishOpenFailure(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    failure: DatabaseError,
    rememberPermanentFailure = true,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    this.#syncPublication.invalidate(entry);
    entry.writer = null;
    entry.reader = null;
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    this.#quarantinedSlots.delete(entry.slot);
    if (this.#entries.get(entry.id) === entry) this.#entries.delete(entry.id);
    this.#releaseSlot(entry.slot);

    if (this.#state() === 'started'
      && entry.state !== 'closing'
      && rememberPermanentFailure
      && isPermanentOpenFailure(failure)) {
      entry.state = 'quarantined';
      this.#rememberBlockedDatabase(entry, failure);
      return;
    }
    entry.state = this.#state() === 'started' ? 'failed' : 'closed';
  }

  #watchSettlement(
    entry: DatabaseCoordinatorEntry,
    actors: readonly DatabaseExecutor[],
    onSettled: () => void,
  ): void {
    if (entry.settlement || actors.length === 0) return;
    const task = Promise.all(actors.map((actor) => (
      Promise.resolve().then(() => actor.settled())
    )))
      .then(() => {
        if (!this.#executorsSettled(actors)) {
          throw new DatabaseError(
            'DATABASE_EXECUTOR_FAILED',
            'Database actor settlement proof is invalid.',
            { retryable: false, outcome: 'unknown' },
          );
        }
        onSettled();
      });
    entry.settlement = task;
    void task.catch((error) => this.#emit({
      type: 'coordinator-failed',
      phase: 'close',
      error: safeCoordinatorError(error),
    })).finally(() => {
      if (entry.settlement === task) entry.settlement = null;
    });
  }

  async #closeExecutors(
    executors: readonly DatabaseExecutor[],
  ): Promise<unknown[]> {
    const outcomes = await Promise.allSettled(
      executors.map((executor) => Promise.resolve().then(() => executor.close())),
    );
    return outcomes.flatMap((outcome) => (
      outcome.status === 'rejected' ? [outcome.reason] : []
    ));
  }

  async #closeBoundActors(
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
  ): Promise<unknown[]> {
    this.#hotDurabilitySupervisor.clear(reader);
    this.#hotDurabilitySupervisor.clear(writer);
    const failures: unknown[] = [];
    if (reader) failures.push(...await this.#closeExecutors([reader]));
    if (writer) failures.push(...await this.#closeExecutors([writer]));
    return failures;
  }

  #entryExecutorsSettled(entry: DatabaseCoordinatorEntry): boolean {
    return this.#executorsSettled(compactExecutors(
      entry.writer,
      entry.reader,
    ));
  }

  #executorsSettled(executors: readonly DatabaseExecutor[]): boolean {
    return executors.every((executor) => {
      try {
        return executor.diagnostics().settled;
      } catch {
        return false;
      }
    });
  }

  #requireExecutorGeneration(executor: DatabaseExecutor): number {
    const generation = this.#executorBinding.generation(executor);
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

function closedError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CLOSED',
    'Database coordinator is not accepting work.',
  );
}

function readEntryState(
  entry: DatabaseCoordinatorEntry,
): DatabaseCoordinatorEntry['state'] {
  return entry.state;
}

function notReadyError(): DatabaseError {
  return new DatabaseError(
    'DATABASE_NOT_READY',
    'Database actor binding is unavailable.',
  );
}

function requiresHotCloseDurabilityProof(
  entry: DatabaseCoordinatorEntry,
): boolean {
  return entry.placement.mode === 'hot'
    && entry.placement.durability !== 'on-write';
}

function allowsPeriodicRuntimeRecovery(
  entry: DatabaseCoordinatorEntry,
  reason: DatabaseBindingRetirementReason,
): boolean {
  if (entry.placement.mode !== 'hot'
    || entry.placement.durability !== 'periodic') return false;
  switch (reason) {
    case 'runtime-failure':
    case 'periodic-durability-failure':
      return true;
  }
}
