/**
 * database-coordinator.ts
 *
 * App-local owner for bounded, actor-backed file databases. Trusted routing
 * resolves a logical database ID once and hands callers a capability; public
 * operations can never choose a path or override that binding.
 */

import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
} from './database-actor-protocol';
import {
  DatabaseError,
} from './database-error';
import {
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import {
  countZeroManagedDatabaseFiles,
  createDatabaseRef,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';
import type { DatabaseObservability } from './database-observability';
import {
  acquireDatabaseRootOwnership,
  type DatabaseRootOwnershipGuard,
} from './database-root-ownership';
import {
  probeDatabaseActorLiveness,
  type DatabaseActorLivenessBinding,
} from './database-actor-liveness';
import type { DatabaseRealm } from './database-realm';
import {
  type DatabaseCommitResult,
  type DatabaseReadResult,
} from './database-operations';
import {
  type DatabaseTenantSyncBinding,
  type DatabaseTenantSyncExecutionOptions,
  type DatabaseTenantSyncReplayResult,
  type DatabaseTenantSyncSnapshotPage,
} from './database-tenant-sync';
import {
  type DatabaseLogicalReceiptFingerprint,
  type DatabaseTrustedReceiptExecutionOptions,
  type DatabaseTrustedReceiptLookup,
  type DatabaseTrustedWriteExecutionOptions,
} from './database-trusted-writer';
import type { DatabaseWriterCommitValue } from './database-writer-engine';
import {
  type DatabaseAcquireOptions,
  type DatabaseCoordinatorDiagnostics,
  type DatabaseCoordinatorLease,
  type DatabaseCoordinatorOptions,
  type DatabaseCoordinatorState,
  type DatabaseExecutionOptions,
  type DatabaseTenantSyncAcquireOptions,
} from './database-coordinator-contract';
import {
  CoordinatorLease,
  CoordinatorTenantSyncBinding,
  type CoordinatorTenantSyncSnapshotStart,
} from './database-coordinator-capability';
import type {
  DatabaseIdentityProjectionPayload,
  DatabaseIdentityProjectionResult,
} from './database-identity-projection-actor';
import {
  type DatabaseCoordinatorEntry as DatabaseEntry,
  type DatabaseCoordinatorSyncBindingHandle,
} from './database-coordinator-entry';
import { AsyncCatalogGate } from './database-coordinator-catalog-gate';
import {
  coordinatorAggregateCloseDetails,
  elapsed,
  safeCoordinatorError,
} from './database-coordinator-errors';
import {
  placementPolicyCanSelectFile,
} from './database-coordinator-placement';
import {
  firstSetValue,
  normalizeCoordinatorDatabaseId,
} from './database-coordinator-runtime';
import { DatabaseCoordinatorTenantSyncRuntime } from './database-coordinator-tenant-sync-runtime';
import { DatabaseCoordinatorOperationRuntime } from './database-coordinator-operation-runtime';
import { DatabaseCoordinatorIdentityProjectionRuntime } from './database-coordinator-identity-projection-runtime';
import {
  normalizeDatabaseCoordinatorConfig,
} from './database-coordinator-config';
import { DatabaseCoordinatorSyncPublication } from './database-coordinator-sync-publication';
import { DatabaseCoordinatorEntryLifecycle } from './database-coordinator-entry-lifecycle';
import { DatabaseCoordinatorEntryFactory } from './database-coordinator-entry-factory';
import { createDatabaseCoordinatorDiagnostics } from './database-coordinator-diagnostics';
import { DatabaseCoordinatorAdmission } from './database-coordinator-admission';
import { DatabaseCoordinatorAuthority } from './database-coordinator-authority';

export type {
  DatabaseAcquireOptions,
  DatabaseCoordinatorDiagnostics,
  DatabaseCoordinatorEntryDiagnostics,
  DatabaseCoordinatorEntryState,
  DatabaseCoordinatorLease,
  DatabaseCoordinatorOptions,
  DatabaseCoordinatorState,
  DatabaseExecutionOptions,
  DatabaseExecutorFactory,
  DatabaseExecutorFactoryContext,
  DatabaseTenantSyncAcquireOptions,
} from './database-coordinator-contract';
export type { DatabaseCoordinatorRestartPolicy } from './database-restart-policy';

/** Bounded actor coordinator. It never exposes an actor, path, or raw handle. */
export class DatabaseCoordinator implements AsyncDisposable {
  readonly realm: DatabaseRealm;

  private readonly configuredRootDirectory: string;
  private rootDirectory: string;
  private readonly readersEnabled: boolean;
  private readonly maxDatabases: number;
  private readonly maxDatabaseFiles: number;
  private readonly maxBlockedDatabases: number;
  private readonly maxTenantSyncDatabases: number;
  private readonly maxTenantSyncBindingsPerDatabase: number;
  private readonly maxQueuedTotal: number;
  private readonly queueTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly restartCircuitFailureThreshold: number;
  private readonly idleTimeoutMs: number;
  private readonly sweepIntervalMs: number | false;
  private readonly observability: DatabaseObservability | null;
  private readonly now: () => number;
  private readonly operationCatalog;
  private readonly entries = new Map<DatabaseId, DatabaseEntry>();
  private readonly freeSlots = new Set<number>();
  private readonly quarantinedSlots = new Set<number>();
  private readonly catalogGate = new AsyncCatalogGate();
  private readonly syncPublication: DatabaseCoordinatorSyncPublication;
  private readonly entryLifecycle: DatabaseCoordinatorEntryLifecycle;
  private readonly entryFactory: DatabaseCoordinatorEntryFactory;
  private readonly admission: DatabaseCoordinatorAdmission;
  private readonly authority: DatabaseCoordinatorAuthority;
  private readonly operationRuntime: DatabaseCoordinatorOperationRuntime;
  private readonly identityProjectionRuntime: DatabaseCoordinatorIdentityProjectionRuntime;
  private readonly tenantSyncRuntime: DatabaseCoordinatorTenantSyncRuntime;
  private readonly blockedDatabases = new Map<DatabaseId, {
    readonly databaseRef: DatabaseRef;
    readonly failure: DatabaseError;
  }>();
  private state: DatabaseCoordinatorState = 'created';
  private rootOwnership: DatabaseRootOwnershipGuard | null = null;
  private actorLiveness: DatabaseActorLivenessBinding | null = null;
  private queuedOperations = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private closeTask: Promise<void> | null = null;

  constructor(options: DatabaseCoordinatorOptions) {
    const config = normalizeDatabaseCoordinatorConfig(options);
    this.configuredRootDirectory = config.rootDirectory;
    this.rootDirectory = config.rootDirectory;
    this.realm = config.realm;
    this.operationCatalog = config.operationCatalog;
    this.readersEnabled = config.readersEnabled;
    this.maxDatabases = config.maxDatabases;
    this.maxDatabaseFiles = config.maxDatabaseFiles;
    this.maxBlockedDatabases = config.maxBlockedDatabases;
    this.maxTenantSyncDatabases = config.maxTenantSyncDatabases;
    this.maxTenantSyncBindingsPerDatabase =
      config.maxTenantSyncBindingsPerDatabase;
    this.maxQueuedTotal = config.maxQueuedTotal;
    this.queueTimeoutMs = config.queueTimeoutMs;
    this.operationTimeoutMs = config.operationTimeoutMs;
    this.restartCircuitFailureThreshold =
      config.restartPolicy.circuitFailureThreshold;
    this.idleTimeoutMs = config.idleTimeoutMs;
    this.sweepIntervalMs = config.sweepIntervalMs;
    this.observability = config.observability;
    this.now = config.now;
    this.authority = new DatabaseCoordinatorAuthority({
      coordinator: config.authorityCommitCoordinator,
      required: config.requireCommitAuthority,
      emit: (event) => this.emit(event),
    });
    this.syncPublication = new DatabaseCoordinatorSyncPublication({
      authorityCommitCoordinator: config.authorityCommitCoordinator,
      requireCommitAuthority: config.requireCommitAuthority,
      assertStarted: () => this.assertStarted(),
      currentEntry: (id) => this.entries.get(id),
      emit: (event) => this.emit(event),
    });
    this.entryLifecycle = new DatabaseCoordinatorEntryLifecycle({
      realm: this.realm,
      sqlite: config.sqlite,
      readersEnabled: this.readersEnabled,
      operationTimeoutMs: this.operationTimeoutMs,
      createExecutor: config.createExecutor,
      restartPolicy: config.restartPolicy,
      observability: this.observability,
      now: this.now,
      entries: this.entries,
      quarantinedSlots: this.quarantinedSlots,
      state: () => this.state,
      actorLiveness: () => this.requireActorLiveness(),
      authorityCommitFence: config.actorAuthorityContext?.actorBinding() ?? null,
      assertOwnedRootCurrent: () => this.assertOwnedRootCurrent(),
      releaseSlot: (slot) => this.releaseSlot(slot),
      rememberBlockedDatabase: (entry, failure) => {
        this.rememberBlockedDatabase(entry, failure);
      },
      syncPublication: this.syncPublication,
      emit: (event) => this.emit(event),
    });
    this.entryFactory = new DatabaseCoordinatorEntryFactory({
      rootDirectory: () => this.rootDirectory,
      realmName: this.realm.name,
      placementPolicy: config.placementPolicy,
      maxDatabaseFiles: this.maxDatabaseFiles,
      maxQueuedPerDatabase: config.maxQueuedPerDatabase,
      maxQueuedTotal: this.maxQueuedTotal,
      now: this.now,
      observability: this.observability,
      assertOwnedRootCurrent: () => this.assertOwnedRootCurrent(),
      queuedOperations: () => this.queuedOperations,
      incrementQueuedOperations: () => { this.queuedOperations += 1; },
      decrementQueuedOperations: () => {
        this.queuedOperations = Math.max(0, this.queuedOperations - 1);
      },
      openEntry: (entry) => this.entryLifecycle.openEntry(entry),
      emit: (event) => this.emit(event),
    });
    this.admission = new DatabaseCoordinatorAdmission({
      maxDatabases: this.maxDatabases,
      maxTenantSyncDatabases: this.maxTenantSyncDatabases,
      maxTenantSyncBindingsPerDatabase:
        this.maxTenantSyncBindingsPerDatabase,
      entries: this.entries,
      emit: (event) => this.emit(event),
    });
    this.operationRuntime = new DatabaseCoordinatorOperationRuntime({
      operationCatalog: this.operationCatalog,
      queueTimeoutMs: this.queueTimeoutMs,
      operationTimeoutMs: this.operationTimeoutMs,
      maxQueuedPerDatabase: config.maxQueuedPerDatabase,
      maxQueuedTotal: this.maxQueuedTotal,
      now: this.now,
      authorityCommitCoordinator: config.authorityCommitCoordinator,
      requireCommitAuthority: config.requireCommitAuthority,
      captureAuthorityRevision: config.actorAuthorityContext
        ? () => config.actorAuthorityContext!.captureRevision()
        : null,
      assertStarted: () => this.assertStarted(),
      canAwaitOpening: (entry) => this.entryLifecycle.canAwaitOpening(entry),
      assertUsableEntry: (entry) => this.assertUsableEntry(entry),
      requireWriter: (entry) => this.entryLifecycle.requireWriter(entry),
      isTerminalFailure: (executor, error) => (
        this.entryLifecycle.isTerminalExecutorFailure(executor, error)
      ),
      retire: (entry, executor, error) => (
        this.entryLifecycle.retireBinding(
          entry,
          executor,
          error,
          'runtime-failure',
        )
      ),
      publishCommit: (entry, operation, result) => (
        this.syncPublication.publishCommit(entry, operation, result)
      ),
      holdAuthorityUntilSettlement: (lease, executor) => (
        this.authority.holdUntilSettlement(lease, executor)
      ),
      queuedOperations: () => this.queuedOperations,
      incrementQueuedOperations: () => { this.queuedOperations += 1; },
      decrementQueuedOperations: () => {
        this.queuedOperations = Math.max(0, this.queuedOperations - 1);
      },
      cleanupFailedEntryIfUnused: (entry) => (
        this.entryLifecycle.cleanupFailedEntryIfUnused(entry)
      ),
      emit: (event) => this.emit(event),
    });
    this.identityProjectionRuntime =
      new DatabaseCoordinatorIdentityProjectionRuntime({
        operationTimeoutMs: this.operationTimeoutMs,
        now: this.now,
        authorityCommitCoordinator: config.authorityCommitCoordinator,
        requireCommitAuthority: config.requireCommitAuthority,
        assertStarted: () => this.assertStarted(),
        canAwaitOpening: (entry) => this.entryLifecycle.canAwaitOpening(entry),
        awaitReplacementOpening: (entry, execution, operation, resume) => (
          this.operationRuntime.awaitReplacementOpening(
            entry,
            execution,
            operation,
            resume,
          )
        ),
        assertUsableEntry: (entry) => this.assertUsableEntry(entry),
        enqueueLane: (entry, operation, execution, run) => (
          this.operationRuntime.enqueueLane(entry, operation, execution, run)
        ),
        requireWriter: (entry) => this.entryLifecycle.requireWriter(entry),
        isTerminalFailure: (executor, error) => (
          this.entryLifecycle.isTerminalExecutorFailure(executor, error)
        ),
        retire: (entry, executor, error) => (
          this.entryLifecycle.retireBinding(
            entry,
            executor,
            error,
            'runtime-failure',
          )
        ),
        emit: (event) => this.emit(event),
      });
    this.tenantSyncRuntime = new DatabaseCoordinatorTenantSyncRuntime({
      operationCatalog: this.operationCatalog,
      operationTimeoutMs: this.operationTimeoutMs,
      now: this.now,
      assertStarted: () => this.assertStarted(),
      canAwaitOpening: (entry) => this.entryLifecycle.canAwaitOpening(entry),
      awaitReplacementOpening: (entry, execution, operation, resume) => (
        this.operationRuntime.awaitReplacementOpening(
          entry,
          execution,
          operation,
          resume,
        )
      ),
      assertUsableEntry: (entry) => this.assertUsableEntry(entry),
      isReadySessionGeneration: (entry, generation) => (
        this.state === 'started'
        && this.entries.get(entry.id) === entry
        && entry.state === 'ready'
        && entry.writer !== null
        && this.entryLifecycle.executorGeneration(entry.writer) === generation
        && entry.syncIdentity?.generation === generation
      ),
      enqueueLane: (entry, operation, execution, run) => (
        this.operationRuntime.enqueueLane(entry, operation, execution, run)
      ),
      requireWriter: (entry) => this.entryLifecycle.requireWriter(entry),
      requireIdentity: (entry, writer) => (
        this.syncPublication.requireIdentity(entry, writer)
      ),
      advanceSequence: (entry, sequence) => (
        this.syncPublication.advanceSequence(entry, sequence)
      ),
      isTerminalFailure: (executor, error) => (
        this.entryLifecycle.isTerminalExecutorFailure(executor, error)
      ),
      retire: (entry, executor, error) => (
        this.entryLifecycle.retireBinding(
          entry,
          executor,
          error,
          'runtime-failure',
        )
      ),
      emit: (event) => this.emit(event),
    });
    for (let slot = 0; slot < this.maxDatabases; slot += 1) {
      this.freeSlots.add(slot);
    }
    this.emit({
      type: 'coordinator-configured',
      writerLimit: this.maxDatabases,
      readerLimit: this.readersEnabled
        && placementPolicyCanSelectFile(config.placementPolicy)
        ? this.maxDatabases
        : 0,
      runtimeLimit: this.maxDatabases,
      fileLimit: this.maxDatabaseFiles,
      syncDatabaseLimit: this.maxTenantSyncDatabases,
      syncBindingLimit: this.maxTenantSyncBindingsPerDatabase,
      queueLimit: this.maxQueuedTotal,
    });
  }

  start(): void {
    if (this.state === 'started') return;
    if (this.state !== 'created') throw this.closedError();
    let ownership: DatabaseRootOwnershipGuard | null = null;
    try {
      ownership = acquireDatabaseRootOwnership(this.configuredRootDirectory);
      this.rootOwnership = ownership;
      // The ownership guard is the authority for path identity. Never resolve
      // the caller's relative or aliased path again after the lock is held.
      this.rootDirectory = ownership.rootDirectory;
      ownership.assertCurrent();
      try {
        this.actorLiveness = probeDatabaseActorLiveness(this.rootDirectory);
        ownership.assertCurrent();
        this.entryFactory.setManagedDatabaseFiles(
          countZeroManagedDatabaseFiles(this.rootDirectory),
        );
        ownership.assertCurrent();
      } catch (error) {
        if (error instanceof DatabaseError) throw error;
        throw new DatabaseError(
          'DATABASE_OPEN_FAILED',
          'Managed database files could not be counted.',
          { retryable: true, outcome: 'not-started' },
        );
      }
      this.state = 'started';
      if (this.sweepIntervalMs !== false) {
        this.idleTimer = setInterval(() => {
          // sweepIdle() emits its one aggregate failure signal before rejecting.
          void this.sweepIdle().catch(() => undefined);
        }, this.sweepIntervalMs);
        this.idleTimer.unref?.();
      }
    } catch (error) {
      if (!ownership) {
        const failure = safeCoordinatorError(error);
        this.emit({
          type: 'coordinator-failed',
          phase: 'start',
          error: failure,
        });
        throw failure;
      }
      try {
        ownership.release();
      } catch (cleanupError) {
        // A failed release may still own the OS lock. Keep the guard reachable
        // and latch the coordinator closed so close() can retry cleanup; never
        // advertise this root as available to another local coordinator.
        this.rootOwnership = ownership;
        this.rootDirectory = ownership.rootDirectory;
        this.state = 'close-failed';
        const failure = safeCoordinatorError(cleanupError);
        this.emit({
          type: 'coordinator-failed',
          phase: 'start',
          error: failure,
        });
        throw failure;
      }
      this.rootOwnership = null;
      this.actorLiveness = null;
      this.rootDirectory = this.configuredRootDirectory;
      this.state = 'created';
      const failure = safeCoordinatorError(error);
      this.emit({
        type: 'coordinator-failed',
        phase: 'start',
        error: failure,
      });
      throw failure;
    }
    this.emit({
      type: 'coordinator-started',
      writerCount: 0,
      readerCount: 0,
      runtimeCount: 0,
    });
  }

  /** Resolve a trusted logical ID into an unforgeable bound capability. */
  async acquire(
    input: string,
    options: DatabaseAcquireOptions = {},
  ): Promise<DatabaseCoordinatorLease> {
    const lease = await this.acquireCoordinatorLease(input, options, false, false);
    if (!lease) throw this.notReadyError();
    return lease;
  }

  /**
   * Acquire only an already-existing managed database. Missing targets return
   * null without reserving a new main file.
   *
   * @internal Framework target-state inspection path.
   */
  async acquireExisting(
    input: string,
    options: DatabaseAcquireOptions = {},
  ): Promise<DatabaseCoordinatorLease | null> {
    return await this.acquireCoordinatorLease(input, options, false, true);
  }

  private async acquireCoordinatorLease(
    input: string,
    options: DatabaseAcquireOptions,
    reserveTenantSyncBinding: boolean,
    existingOnly: boolean,
  ): Promise<CoordinatorLease | null> {
    this.assertStarted();
    const id = normalizeCoordinatorDatabaseId(input);
    const commitAuthority = this.authority.resolve(id, options);

    while (true) {
      const decision = await this.catalogGate.run(async (): Promise<
        | { readonly type: 'entry'; readonly entry: DatabaseEntry }
        | { readonly type: 'evict'; readonly entry: DatabaseEntry }
        | { readonly type: 'missing' }
      > => {
        this.assertStarted();
        const blocked = this.blockedDatabases.get(id);
        if (blocked) {
          // Refresh recency so the bounded failure cache evicts the least
          // recently consulted database when it reaches capacity.
          this.blockedDatabases.delete(id);
          this.blockedDatabases.set(id, blocked);
          throw this.blockedDatabaseError(blocked.failure);
        }

        let current = this.entries.get(id);
        if (current && (current.state === 'failed'
          || current.state === 'quarantined'
          || current.state === 'closing'
          || current.state === 'closed')) {
          throw this.blockedDatabaseError(current.failure);
        }
        if (reserveTenantSyncBinding) {
          this.admission.assertTenantSync(id, current ?? null);
        }
        if (!current) {
          if (existingOnly
            && !this.entryFactory.existingFileIsPresent(id)) {
            return { type: 'missing' };
          }
          const slot = firstSetValue(this.freeSlots);
          if (slot === null) {
            const candidate = this.admission.selectCapacityEviction();
            if (!candidate) {
              throw this.admission.capacityError(createDatabaseRef(id));
            }
            candidate.state = 'closing';
            return { type: 'evict', entry: candidate };
          }
          this.freeSlots.delete(slot);
          try {
            const created = existingOnly
              ? this.createExistingEntry(id, slot)
              : this.createEntry(id, slot);
            if (!created) {
              this.releaseSlot(slot);
              return { type: 'missing' };
            }
            current = created;
            this.entries.set(id, current);
          } catch (error) {
            this.releaseSlot(slot);
            throw safeCoordinatorError(error);
          }
        }
        if (reserveTenantSyncBinding) current.tenantSyncBindingSlots += 1;
        current.leases += 1;
        current.lastUsedAt = this.now();
        return { type: 'entry', entry: current };
      });

      if (decision.type === 'evict') {
        await this.entryLifecycle.closeEntry(decision.entry, 'capacity');
        continue;
      }
      if (decision.type === 'missing') return null;

      const { entry } = decision;
      try {
        await entry.opening;
        this.assertStarted();
        if (entry.state !== 'ready') throw this.notReadyError();
        return new CoordinatorLease(this, entry, commitAuthority);
      } catch (error) {
        if (reserveTenantSyncBinding) {
          this.syncPublication.cancelReservation(entry);
        }
        this.releaseEntry(entry);
        throw safeCoordinatorError(error);
      }
    }
  }

  /**
   * Acquire the persistent, trusted capability used by tenant-database Sync.
   * This deliberately remains separate from the public AsyncDatabaseClient.
   */
  async acquireTenantSync(
    input: string,
    options: DatabaseTenantSyncAcquireOptions = {},
  ): Promise<DatabaseTenantSyncBinding> {
    if (options.assertReadAuthority !== undefined
      && typeof options.assertReadAuthority !== 'function') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database tenant Sync read authority is invalid.',
      );
    }
    const lease = await this.acquireCoordinatorLease(input, options, true, false);
    if (!lease) throw this.notReadyError();
    const entry = lease.tenantSyncReservedEntry();
    try {
      lease.assertTenantSyncAuthority();
      return new CoordinatorTenantSyncBinding(
        this,
        entry,
        lease,
        options.assertReadAuthority ?? null,
      );
    } catch (error) {
      this.syncPublication.cancelReservation(entry);
      lease.release();
      throw safeCoordinatorError(error);
    }
  }

  /** Close one idle binding. Active capabilities and operations are preserved. */
  async evict(input: string): Promise<boolean> {
    this.assertStarted();
    const id = normalizeCoordinatorDatabaseId(input);
    const entry = await this.catalogGate.run(async () => {
      this.assertStarted();
      if (this.blockedDatabases.delete(id)) return null;
      const entry = this.entries.get(id);
      if (!entry) return undefined;
      if (!this.admission.isEvictable(entry)) {
        throw new DatabaseError(
          'DATABASE_CONFLICT',
          'Database binding is still in use.',
          {
            retryable: true,
            outcome: 'not-started',
            details: {
              activeOperations: entry.activeOperations,
              leases: entry.leases,
              queueDepth: entry.lane.depth,
            },
          },
        );
      }
      entry.state = 'closing';
      return entry;
    });
    if (entry === undefined) return false;
    if (entry === null) return true;
    await this.entryLifecycle.closeEntry(entry, 'requested');
    return true;
  }

  /** Evict every unused binding past its idle deadline. */
  async sweepIdle(now = this.now()): Promise<readonly DatabaseRef[]> {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database sweep time is invalid.');
    }
    if (this.state !== 'started') return Object.freeze([]);
    const candidates = await this.catalogGate.run(async () => {
      if (this.state !== 'started') return [];
      const selected: DatabaseEntry[] = [];
      for (const entry of [...this.entries.values()]
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)) {
        if (!this.admission.isEvictable(entry)
          || now - entry.lastUsedAt < this.idleTimeoutMs) continue;
        entry.state = 'closing';
        selected.push(entry);
      }
      return selected;
    });
    const outcomes = await Promise.allSettled(candidates.map(async (entry) => {
      await this.entryLifecycle.closeEntry(entry, 'idle');
      return entry.databaseRef;
    }));
    const evicted = outcomes.flatMap((outcome) => (
      outcome.status === 'fulfilled' ? [outcome.value] : []
    ));
    const failures = outcomes.flatMap((outcome) => (
      outcome.status === 'rejected' ? [outcome.reason] : []
    ));
    if (failures.length > 0) {
      const details = coordinatorAggregateCloseDetails({
        failures,
        remainingEntryCount: this.entries.size,
        quarantinedSlotCount: this.quarantinedSlots.size,
        availableSlotCount: this.freeSlots.size,
      });
      const error = new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'One or more idle database actors did not close cleanly.',
        { retryable: false, outcome: 'unknown', details },
      );
      this.emit({
        type: 'coordinator-failed',
        phase: 'close',
        ...details,
        error,
      });
      throw error;
    }
    return Object.freeze(evicted);
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    const task = this.closeOnce();
    this.closeTask = task;
    void task.catch(() => {
      if (this.closeTask === task) this.closeTask = null;
    });
    return task;
  }

  diagnostics(): DatabaseCoordinatorDiagnostics {
    return createDatabaseCoordinatorDiagnostics({
      state: this.state,
      maxDatabases: this.maxDatabases,
      maxDatabaseFiles: this.maxDatabaseFiles,
      maxBlockedDatabases: this.maxBlockedDatabases,
      maxTenantSyncDatabases: this.maxTenantSyncDatabases,
      maxTenantSyncBindingsPerDatabase:
        this.maxTenantSyncBindingsPerDatabase,
      readersEnabled: this.readersEnabled,
      databaseFiles: this.entryFactory.managedDatabaseFiles,
      queuedOperations: this.queuedOperations,
      heldAuthorityLeases: this.authority.heldLeases,
      restartCircuitFailureThreshold: this.restartCircuitFailureThreshold,
      executorGeneration: (executor) => (
        this.entryLifecycle.executorGeneration(executor)
      ),
      entries: this.entries,
      freeSlots: this.freeSlots,
      quarantinedSlots: this.quarantinedSlots,
      blockedDatabases: this.blockedDatabases,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Internal capability execution boundary. */
  execute(
    entry: DatabaseEntry,
    value: unknown,
    options: DatabaseExecutionOptions = {},
    commitAuthority: DatabaseCommitAuthority | null = null,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    return this.operationRuntime.execute(
      entry,
      value,
      options,
      commitAuthority,
    );
  }

  executeTrustedWrite(
    entry: DatabaseEntry,
    value: unknown,
    options: DatabaseTrustedWriteExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>> {
    return this.operationRuntime.executeTrustedWrite(
      entry,
      value,
      options,
      commitAuthority,
    );
  }

  executeIdentityProjection(
    entry: DatabaseEntry,
    input: Omit<DatabaseIdentityProjectionPayload, 'databaseRef'>,
    options: DatabaseExecutionOptions = {},
    commitAuthority: DatabaseCommitAuthority | null = null,
  ): Promise<DatabaseIdentityProjectionResult> {
    return this.identityProjectionRuntime.execute(
      entry,
      input,
      options,
      commitAuthority,
    );
  }

  findTrustedReceipt(
    entry: DatabaseEntry,
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    options: DatabaseTrustedReceiptExecutionOptions = {},
  ): Promise<DatabaseTrustedReceiptLookup> {
    return this.operationRuntime.findTrustedReceipt(
      entry,
      idempotencyKey,
      logicalReceiptFingerprint,
      options,
    );
  }

  replay(
    entry: DatabaseEntry,
    afterSeq: number,
    limit = DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    options: DatabaseExecutionOptions = {},
  ): Promise<DatabaseReadResult> {
    return this.operationRuntime.replay(entry, afterSeq, limit, options);
  }


  beginTenantSyncSnapshot(
    entry: DatabaseEntry,
    ownerToken: string,
    tables: readonly string[],
    options: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<CoordinatorTenantSyncSnapshotStart> {
    return this.tenantSyncRuntime.beginSnapshot(
      entry,
      ownerToken,
      tables,
      options,
    );
  }

  pageTenantSyncSnapshot(
    entry: DatabaseEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
      totalRows: number;
    }>,
    cursor: number,
    options: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<DatabaseTenantSyncSnapshotPage> {
    return this.tenantSyncRuntime.pageSnapshot(entry, session, cursor, options);
  }

  abortTenantSyncSnapshot(
    entry: DatabaseEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
    }>,
    options: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<void> {
    return this.tenantSyncRuntime.abortSnapshot(entry, session, options);
  }

  replayTenantSync(
    entry: DatabaseEntry,
    afterSeq: number,
    limit = DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    options: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<DatabaseTenantSyncReplayResult> {
    return this.tenantSyncRuntime.replay(entry, afterSeq, limit, options);
  }


  releaseEntry(entry: DatabaseEntry): void {
    if (entry.leases === 0) return;
    entry.leases -= 1;
    entry.lastUsedAt = this.now();
    if (entry.leases === 0
      && entry.state === 'opening'
      && entry.restartRetryCount > 0) {
      entry.restartAbortController?.abort();
      entry.restartAbortController = null;
      entry.state = 'failed';
    }
    this.entryLifecycle.cleanupFailedEntryIfUnused(entry);
  }

  cancelTenantSyncBindingReservation(entry: DatabaseEntry): void {
    this.syncPublication.cancelReservation(entry);
  }

  activateTenantSyncBinding(
    entry: DatabaseEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    this.syncPublication.activate(entry, binding);
  }

  releaseTenantSyncBinding(
    entry: DatabaseEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    this.syncPublication.release(entry, binding);
  }

  assertTenantSyncAuthority(
    entry: DatabaseEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ): undefined {
    return this.syncPublication.assertAuthority(entry, commitAuthority);
  }

  private createEntry(id: DatabaseId, slot: number): DatabaseEntry {
    return this.entryFactory.create(id, slot);
  }

  private createExistingEntry(
    id: DatabaseId,
    slot: number,
  ): DatabaseEntry | null {
    return this.entryFactory.createExisting(id, slot);
  }

  private assertUsableEntry(entry: DatabaseEntry): void {
    this.assertStarted();
    if (this.entries.get(entry.id) !== entry || entry.state !== 'ready') {
      throw this.notReadyError();
    }
  }

  private rememberBlockedDatabase(
    entry: DatabaseEntry,
    failure: DatabaseError,
  ): void {
    this.blockedDatabases.delete(entry.id);
    while (this.blockedDatabases.size >= this.maxBlockedDatabases) {
      const oldest = this.blockedDatabases.keys().next().value as
        | DatabaseId
        | undefined;
      if (oldest === undefined) break;
      this.blockedDatabases.delete(oldest);
    }
    this.blockedDatabases.set(entry.id, Object.freeze({
      databaseRef: entry.databaseRef,
      failure: safeCoordinatorError(failure),
    }));
  }

  private releaseSlot(slot: number): void {
    if (this.quarantinedSlots.has(slot)) return;
    this.freeSlots.add(slot);
  }

  private async closeOnce(): Promise<void> {
    if (this.state === 'closed') return;
    const startedAt = this.now();
    this.state = 'draining';
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.emit({
      type: 'coordinator-draining',
      reason: 'shutdown',
      activeCount: this.diagnostics().activeOperations,
      queueDepth: this.queuedOperations,
    });
    // Wait behind any catalog mutation which entered before draining, reserve
    // each binding for shutdown, then perform slow actor closure outside the
    // global gate.
    const closingEntries = await this.catalogGate.run(async () => {
      const closeError = this.closedError();
      const entries = [...this.entries.values()];
      for (const entry of entries) {
        entry.state = 'closing';
        entry.lane.rejectQueued(closeError);
      }
      return entries;
    });
    const failures: unknown[] = [];
    await Promise.all(closingEntries.map(async (entry) => {
      try {
        await this.entryLifecycle.closeEntry(entry, 'shutdown');
      } catch (error) {
        failures.push(error);
      }
    }));

    const shutdownIncomplete = failures.length > 0
      || this.quarantinedSlots.size > 0
      || this.entries.size > 0
      || this.freeSlots.size !== this.maxDatabases;
    if (shutdownIncomplete) {
      this.state = 'close-failed';
      const details = coordinatorAggregateCloseDetails({
        failures,
        remainingEntryCount: this.entries.size,
        quarantinedSlotCount: this.quarantinedSlots.size,
        availableSlotCount: this.freeSlots.size,
      });
      const error = new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database coordinator shutdown was incomplete.',
        { retryable: false, outcome: 'unknown', details },
      );
      this.emit({
        type: 'coordinator-failed',
        phase: 'shutdown',
        ...details,
        error,
      });
      throw error;
    }
    try {
      this.rootOwnership?.release();
      this.rootOwnership = null;
      this.actorLiveness = null;
    } catch (caught) {
      this.state = 'close-failed';
      const error = safeCoordinatorError(caught);
      this.emit({
        type: 'coordinator-failed',
        phase: 'shutdown',
        error,
      });
      throw error;
    }
    this.state = 'closed';
    this.blockedDatabases.clear();
    this.emit({
      type: 'coordinator-stopped',
      durationMs: elapsed(startedAt, this.now()),
    });
  }

  private assertStarted(): void {
    if (this.state !== 'started') throw this.closedError();
  }

  private assertOwnedRootCurrent(): void {
    const ownership = this.rootOwnership;
    if (!ownership) throw this.closedError();
    ownership.assertCurrent();
  }

  private requireActorLiveness(): DatabaseActorLivenessBinding {
    const binding = this.actorLiveness;
    if (!binding) throw this.closedError();
    return binding;
  }

  private closedError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_CLOSED',
      'Database coordinator is not accepting work.',
    );
  }

  private notReadyError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_NOT_READY',
      'Database actor binding is unavailable.',
    );
  }

  private blockedDatabaseError(failure: DatabaseError | null): DatabaseError {
    return new DatabaseError(
      'DATABASE_NOT_READY',
      'Database binding is unavailable.',
      {
        retryable: failure?.retryable ?? true,
        outcome: 'not-started',
        details: failure ? { failureCode: failure.code } : undefined,
      },
    );
  }

  private emit(event: Parameters<DatabaseObservability['emit']>[0]): void {
    try {
      this.observability?.emit(event);
    } catch {
      // Telemetry cannot change a database operation's outcome.
    }
  }
}
