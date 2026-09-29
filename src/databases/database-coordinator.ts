/**
 * database-coordinator.ts
 *
 * App-local owner for bounded, actor-backed file databases. Trusted routing
 * resolves a logical database ID once and hands callers a capability; public
 * operations can never choose a path or override that binding.
 */

import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
  DATABASE_ACTOR_OPERATIONS,
  normalizeDatabaseActorSQLiteConfig,
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  type DatabaseActorPlacementConfig,
  type DatabaseActorRole,
  type DatabaseActorSQLiteConfig,
} from './database-actor-protocol';
import {
  DatabaseError,
} from './database-error';
import {
  AuthorityCommitCoordinator,
  type AuthorityCommitLease,
} from './authority-commit-coordinator';
import {
  assertDatabaseCommitAuthorityCurrent,
  isDatabaseCommitAuthority,
  isDatabaseCommitAuthorityFor,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type {
  DatabaseExecutor,
  DatabaseExecutorValue,
} from './database-executor';
import {
  countZeroManagedDatabaseFiles,
  createDatabaseRef,
  prepareDatabaseFileWithCreationAdmission,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';
import type { DatabaseObservability } from './database-observability';
import {
  DATABASE_FILE_PLACEMENT_POLICY,
  type DatabasePlacementPolicy,
} from './database-placement';
import {
  acquireDatabaseRootOwnership,
  type DatabaseRootOwnershipGuard,
} from './database-root-ownership';
import {
  probeDatabaseActorLiveness,
  type DatabaseActorLivenessBinding,
} from './database-actor-liveness';
import {
  prepareDatabaseBindingIdentity,
  type DatabaseBindingIdentity,
} from './database-binding-identity';
import {
  openDatabaseFileIdentityGuard,
  sameDatabaseFileIdentity,
} from './database-file-identity';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import {
  createDatabaseSequenceToken,
  type DatabaseCommitResult,
  type DatabaseReadResult,
  type DatabaseWriteOperation,
} from './database-operations';
import {
  type DatabaseTenantSyncBinding,
  type DatabaseTenantSyncExecutionOptions,
  type DatabaseTenantSyncReplayResult,
  type DatabaseTenantSyncSnapshotPage,
  type DatabaseTenantSyncWakeup,
} from './database-tenant-sync';
import {
  type DatabaseLogicalReceiptFingerprint,
  type DatabaseTrustedReceiptExecutionOptions,
  type DatabaseTrustedReceiptLookup,
  type DatabaseTrustedWriteExecutionOptions,
} from './database-trusted-writer';
import type { DatabaseWriterCommitValue } from './database-writer-engine';
import { DATABASE_COORDINATOR_MAX_DATABASES } from './database-capacity';
import {
  type DatabaseAcquireOptions,
  type DatabaseCoordinatorDiagnostics,
  type DatabaseCoordinatorEntryDiagnostics,
  type DatabaseCoordinatorEntryState,
  type DatabaseCoordinatorLease,
  type DatabaseCoordinatorOptions,
  type DatabaseCoordinatorState,
  type DatabaseExecutionOptions,
  type DatabaseExecutorFactory,
  type DatabaseTenantSyncAcquireOptions,
} from './database-coordinator-contract';
import {
  CoordinatorLease,
  CoordinatorTenantSyncBinding,
  type CoordinatorTenantSyncSnapshotStart,
} from './database-coordinator-capability';
import {
  type DatabaseCoordinatorEntry as DatabaseEntry,
  type DatabaseCoordinatorSyncBindingHandle,
  type DatabaseTenantSyncIdentity,
} from './database-coordinator-entry';
import { AsyncCatalogGate } from './database-coordinator-catalog-gate';
import {
  authorityUnavailable,
  elapsed,
  isPermanentOpenFailure,
  safeCoordinatorError,
} from './database-coordinator-errors';
import {
  normalizeCoordinatorPlacementPolicy as normalizePlacementPolicy,
  placementPolicyCanSelectFile,
  resolveCoordinatorEntryPlacement as resolveEntryPlacement,
  sameCoordinatorActorPlacement as sameActorPlacement,
} from './database-coordinator-placement';
import {
  boundedTimerInterval,
  compactExecutors,
  firstSetValue,
  nonNegativeInteger,
  normalizeCoordinatorDatabaseId,
  observablePositiveInteger,
  positiveInteger,
} from './database-coordinator-runtime';
import { DatabaseWriterLane } from './database-writer-lane';
import { DatabaseHotDurabilitySupervisor } from './database-hot-durability-supervisor';
import { DatabaseCoordinatorTenantSyncRuntime } from './database-coordinator-tenant-sync-runtime';
import { DatabaseCoordinatorOperationRuntime } from './database-coordinator-operation-runtime';
import {
  nextDatabaseRestartPlan,
  normalizeDatabaseCoordinatorRestartPolicy,
  waitForDatabaseRestart,
  type NormalizedDatabaseCoordinatorRestartPolicy,
} from './database-restart-policy';

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

const DEFAULT_MAX_DATABASES = 16;
const DEFAULT_MAX_DATABASE_FILES = 10_000;
const DEFAULT_MAX_BLOCKED_DATABASES = 1_024;
const DEFAULT_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE = 64;
const DEFAULT_MAX_QUEUED_PER_DATABASE = 128;
const DEFAULT_MAX_QUEUED_TOTAL = 1_024;
const DEFAULT_QUEUE_TIMEOUT_MS = 15_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1_000;
const MAX_SWEEP_INTERVAL_MS = 30_000;

type DatabaseBindingRetirementReason =
  | 'runtime-failure'
  | 'periodic-durability-failure';

type DatabaseCloseReason = 'requested' | 'idle' | 'capacity' | 'shutdown';

/** Bounded actor coordinator. It never exposes an actor, path, or raw handle. */
export class DatabaseCoordinator implements AsyncDisposable {
  readonly realm: DatabaseRealm;

  private readonly configuredRootDirectory: string;
  private rootDirectory: string;
  private readonly createExecutor: DatabaseExecutorFactory;
  private readonly placementPolicy: DatabasePlacementPolicy;
  private readonly sqlite: DatabaseActorSQLiteConfig;
  private readonly readersEnabled: boolean;
  private readonly maxDatabases: number;
  private readonly maxDatabaseFiles: number;
  private readonly maxBlockedDatabases: number;
  private readonly maxTenantSyncDatabases: number;
  private readonly maxTenantSyncBindingsPerDatabase: number;
  private readonly maxQueuedPerDatabase: number;
  private readonly maxQueuedTotal: number;
  private readonly queueTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly restartPolicy: NormalizedDatabaseCoordinatorRestartPolicy;
  private readonly idleTimeoutMs: number;
  private readonly sweepIntervalMs: number | false;
  private readonly observability: DatabaseObservability | null;
  private readonly authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  private readonly requireCommitAuthority: boolean;
  private readonly now: () => number;
  private readonly operationCatalog;
  private readonly entries = new Map<DatabaseId, DatabaseEntry>();
  private readonly freeSlots = new Set<number>();
  private readonly quarantinedSlots = new Set<number>();
  private readonly catalogGate = new AsyncCatalogGate();
  private readonly lastGenerationBySlot = new Map<string, number>();
  private readonly hotDurabilitySupervisor: DatabaseHotDurabilitySupervisor;
  private readonly operationRuntime: DatabaseCoordinatorOperationRuntime;
  private readonly tenantSyncRuntime: DatabaseCoordinatorTenantSyncRuntime;
  private readonly blockedDatabases = new Map<DatabaseId, {
    readonly databaseRef: DatabaseRef;
    readonly failure: DatabaseError;
  }>();
  private state: DatabaseCoordinatorState = 'created';
  private rootOwnership: DatabaseRootOwnershipGuard | null = null;
  private actorLiveness: DatabaseActorLivenessBinding | null = null;
  private queuedOperations = 0;
  private heldAuthorityLeases = 0;
  private managedDatabaseFiles = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private closeTask: Promise<void> | null = null;

  constructor(options: DatabaseCoordinatorOptions) {
    if (!options || typeof options !== 'object') {
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database coordinator options are required.');
    }
    if (typeof options.rootDirectory !== 'string' || options.rootDirectory.length === 0) {
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database root directory is required.');
    }
    if (typeof options.createExecutor !== 'function') {
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database executor factory is required.');
    }
    this.maxDatabases = positiveInteger(
      options.maxDatabases ?? DEFAULT_MAX_DATABASES,
      'maxDatabases',
    );
    if (this.maxDatabases > DATABASE_COORDINATOR_MAX_DATABASES) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        `maxDatabases must not exceed ${DATABASE_COORDINATOR_MAX_DATABASES}.`,
      );
    }
    this.maxDatabaseFiles = observablePositiveInteger(
      options.maxDatabaseFiles ?? DEFAULT_MAX_DATABASE_FILES,
      'maxDatabaseFiles',
    );
    this.maxBlockedDatabases = observablePositiveInteger(
      options.maxBlockedDatabases ?? DEFAULT_MAX_BLOCKED_DATABASES,
      'maxBlockedDatabases',
    );
    this.maxTenantSyncDatabases = nonNegativeInteger(
      options.maxTenantSyncDatabases
        ?? (this.maxDatabases === 1 ? 1 : this.maxDatabases - 1),
      'maxTenantSyncDatabases',
    );
    if (this.maxTenantSyncDatabases > this.maxDatabases) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'maxTenantSyncDatabases must not exceed maxDatabases.',
      );
    }
    this.maxTenantSyncBindingsPerDatabase = observablePositiveInteger(
      options.maxTenantSyncBindingsPerDatabase
        ?? DEFAULT_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE,
      'maxTenantSyncBindingsPerDatabase',
    );
    this.maxQueuedPerDatabase = observablePositiveInteger(
      options.maxQueuedPerDatabase ?? DEFAULT_MAX_QUEUED_PER_DATABASE,
      'maxQueuedPerDatabase',
    );
    this.maxQueuedTotal = observablePositiveInteger(
      options.maxQueuedTotal ?? DEFAULT_MAX_QUEUED_TOTAL,
      'maxQueuedTotal',
    );
    this.queueTimeoutMs = boundedTimerInterval(
      options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
      'queueTimeoutMs',
    );
    this.operationTimeoutMs = boundedTimerInterval(
      options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
      'operationTimeoutMs',
    );
    this.restartPolicy = normalizeDatabaseCoordinatorRestartPolicy(
      options.restart,
    );
    this.idleTimeoutMs = nonNegativeInteger(
      options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      'idleTimeoutMs',
    );
    this.sweepIntervalMs = options.sweepIntervalMs === false
      ? false
      : boundedTimerInterval(
        options.sweepIntervalMs
          ?? Math.min(
            MAX_SWEEP_INTERVAL_MS,
            Math.max(MIN_SWEEP_INTERVAL_MS, Math.ceil(this.idleTimeoutMs / 2)),
          ),
        'sweepIntervalMs',
      );
    if (options.now !== undefined && typeof options.now !== 'function') {
      throw new DatabaseError('DATABASE_CONFIG_INVALID', 'Database clock must be a function.');
    }
    if (options.requireCommitAuthority !== undefined
      && typeof options.requireCommitAuthority !== 'boolean') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit-authority policy must be a boolean.',
      );
    }
    if (options.authorityCommitCoordinator !== undefined
      && !(options.authorityCommitCoordinator instanceof AuthorityCommitCoordinator)) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database authority commit coordinator is invalid.',
      );
    }
    if (options.requireCommitAuthority === true
      && !options.authorityCommitCoordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Required database commit authority needs an authority coordinator.',
      );
    }
    if (options.readers !== undefined && typeof options.readers !== 'boolean') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database readers policy must be a boolean.',
      );
    }
    this.configuredRootDirectory = options.rootDirectory;
    this.rootDirectory = options.rootDirectory;
    this.realm = options.realm;
    this.operationCatalog = createDatabaseRealmOperationCatalog(options.realm);
    this.createExecutor = options.createExecutor;
    this.placementPolicy = normalizePlacementPolicy(
      options.placement === undefined
        ? DATABASE_FILE_PLACEMENT_POLICY
        : options.placement,
    );
    try {
      this.sqlite = normalizeDatabaseActorSQLiteConfig(options.sqlite ?? {});
    } catch {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database actor SQLite configuration is invalid.',
      );
    }
    this.readersEnabled = options.readers !== false;
    this.observability = options.observability ?? null;
    this.authorityCommitCoordinator = options.authorityCommitCoordinator ?? null;
    this.requireCommitAuthority = options.requireCommitAuthority ?? false;
    this.now = options.now ?? Date.now;
    this.hotDurabilitySupervisor = new DatabaseHotDurabilitySupervisor({
      now: this.now,
      observability: this.observability,
      isObservedEntryCurrent: (entry, executor, role) => (
        (entry.state === 'ready' || entry.state === 'opening')
        && this.entries.get(entry.id) === entry
        && (role === 'writer' ? entry.writer : entry.reader) === executor
      ),
      isReadyWriterCurrent: (entry, executor) => (
        this.state === 'started'
        && entry.state === 'ready'
        && this.entries.get(entry.id) === entry
        && entry.writer === executor
      ),
      onFatal: (entry, executor, error) => {
        void this.retireBinding(
          entry,
          executor,
          error,
          'periodic-durability-failure',
        ).catch((caught) => {
          this.emit({
            type: 'coordinator-failed',
            phase: 'close',
            error: safeCoordinatorError(caught),
          });
        });
      },
    });
    this.operationRuntime = new DatabaseCoordinatorOperationRuntime({
      operationCatalog: this.operationCatalog,
      queueTimeoutMs: this.queueTimeoutMs,
      operationTimeoutMs: this.operationTimeoutMs,
      maxQueuedPerDatabase: this.maxQueuedPerDatabase,
      maxQueuedTotal: this.maxQueuedTotal,
      now: this.now,
      authorityCommitCoordinator: this.authorityCommitCoordinator,
      requireCommitAuthority: this.requireCommitAuthority,
      assertStarted: () => this.assertStarted(),
      canAwaitOpening: (entry) => this.canAwaitOpening(entry),
      assertUsableEntry: (entry) => this.assertUsableEntry(entry),
      requireWriter: (entry) => this.requireWriter(entry),
      isTerminalFailure: (executor, error) => (
        this.isTerminalExecutorFailure(executor, error)
      ),
      retire: (entry, executor, error) => (
        this.retireBinding(entry, executor, error, 'runtime-failure')
      ),
      publishCommit: (entry, operation, result) => (
        this.publishTenantSyncCommit(entry, operation, result)
      ),
      holdAuthorityUntilSettlement: (lease, executor) => (
        this.holdAuthorityUntilSettlement(lease, executor)
      ),
      queuedOperations: () => this.queuedOperations,
      incrementQueuedOperations: () => { this.queuedOperations += 1; },
      decrementQueuedOperations: () => {
        this.queuedOperations = Math.max(0, this.queuedOperations - 1);
      },
      cleanupFailedEntryIfUnused: (entry) => (
        this.cleanupFailedEntryIfUnused(entry)
      ),
      emit: (event) => this.emit(event),
    });
    this.tenantSyncRuntime = new DatabaseCoordinatorTenantSyncRuntime({
      operationCatalog: this.operationCatalog,
      operationTimeoutMs: this.operationTimeoutMs,
      now: this.now,
      assertStarted: () => this.assertStarted(),
      canAwaitOpening: (entry) => this.canAwaitOpening(entry),
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
        && entry.writer.diagnostics().generation === generation
        && entry.syncIdentity?.generation === generation
      ),
      enqueueLane: (entry, operation, execution, run) => (
        this.operationRuntime.enqueueLane(entry, operation, execution, run)
      ),
      requireWriter: (entry) => this.requireWriter(entry),
      requireIdentity: (entry, writer) => (
        this.requireTenantSyncIdentity(entry, writer)
      ),
      advanceSequence: (entry, sequence) => (
        this.advanceTenantSyncSequence(entry, sequence)
      ),
      isTerminalFailure: (executor, error) => (
        this.isTerminalExecutorFailure(executor, error)
      ),
      retire: (entry, executor, error) => (
        this.retireBinding(entry, executor, error, 'runtime-failure')
      ),
      emit: (event) => this.emit(event),
    });
    for (let slot = 0; slot < this.maxDatabases; slot += 1) {
      this.freeSlots.add(slot);
    }
    this.emit({
      type: 'coordinator-configured',
      writerLimit: this.maxDatabases,
      readerLimit: this.readersEnabled && placementPolicyCanSelectFile(this.placementPolicy)
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
        this.managedDatabaseFiles = countZeroManagedDatabaseFiles(
          this.rootDirectory,
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
          void this.sweepIdle().catch((error) => this.emit({
            type: 'coordinator-failed',
            phase: 'close',
            error,
          }));
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
    return await this.acquireCoordinatorLease(input, options, false);
  }

  private async acquireCoordinatorLease(
    input: string,
    options: DatabaseAcquireOptions,
    reserveTenantSyncBinding: boolean,
  ): Promise<CoordinatorLease> {
    this.assertStarted();
    const id = normalizeCoordinatorDatabaseId(input);
    const commitAuthority = this.resolveCommitAuthority(id, options);

    while (true) {
      const decision = await this.catalogGate.run(async (): Promise<
        | { readonly type: 'entry'; readonly entry: DatabaseEntry }
        | { readonly type: 'evict'; readonly entry: DatabaseEntry }
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
          this.assertTenantSyncAdmission(id, current ?? null);
        }
        if (!current) {
          const slot = firstSetValue(this.freeSlots);
          if (slot === null) {
            const candidate = this.selectCapacityEviction();
            if (!candidate) throw this.capacityError();
            candidate.state = 'closing';
            return { type: 'evict', entry: candidate };
          }
          this.freeSlots.delete(slot);
          try {
            current = this.createEntry(id, slot);
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
        await this.closeEntry(decision.entry, 'capacity');
        continue;
      }

      const { entry } = decision;
      try {
        await entry.opening;
        this.assertStarted();
        if (entry.state !== 'ready') throw this.notReadyError();
        return new CoordinatorLease(this, entry, commitAuthority);
      } catch (error) {
        if (reserveTenantSyncBinding) {
          this.cancelTenantSyncBindingReservation(entry);
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
    const lease = await this.acquireCoordinatorLease(input, options, true);
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
      this.cancelTenantSyncBindingReservation(entry);
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
      if (!this.isEvictable(entry)) {
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
    await this.closeEntry(entry, 'requested');
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
        if (!this.isEvictable(entry)
          || now - entry.lastUsedAt < this.idleTimeoutMs) continue;
        entry.state = 'closing';
        selected.push(entry);
      }
      return selected;
    });
    const outcomes = await Promise.allSettled(candidates.map(async (entry) => {
      await this.closeEntry(entry, 'idle');
      return entry.databaseRef;
    }));
    const evicted = outcomes.flatMap((outcome) => (
      outcome.status === 'fulfilled' ? [outcome.value] : []
    ));
    if (outcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'One or more idle database actors did not close cleanly.',
        { retryable: false, outcome: 'unknown' },
      );
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
    const databases = [...this.entries.values()]
      .map((entry): DatabaseCoordinatorEntryDiagnostics => Object.freeze({
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        state: entry.state,
        slot: entry.slot,
        leases: entry.leases,
        tenantSyncBindings: entry.tenantSyncBindingSlots,
        activeOperations: entry.activeOperations,
        queueDepth: entry.lane.depth + entry.recoveryWaiters,
        writerGeneration: entry.writer?.diagnostics().generation ?? null,
        readerGeneration: entry.reader?.diagnostics().generation ?? null,
        restartRetryCount: entry.restartRetryCount,
        restartCircuitOpen: entry.restartRetryCount
          >= this.restartPolicy.circuitFailureThreshold,
        lastUsedAt: entry.lastUsedAt,
      }))
      .sort((left, right) => left.databaseRef.localeCompare(right.databaseRef));
    return Object.freeze({
      state: this.state,
      maxDatabases: this.maxDatabases,
      maxDatabaseFiles: this.maxDatabaseFiles,
      maxBlockedDatabases: this.maxBlockedDatabases,
      maxTenantSyncDatabases: this.maxTenantSyncDatabases,
      maxTenantSyncBindingsPerDatabase:
        this.maxTenantSyncBindingsPerDatabase,
      readersEnabled: this.readersEnabled,
      fileDatabases: databases.filter((entry) => entry.placement === 'file').length,
      hotDatabases: databases.filter((entry) => entry.placement === 'hot').length,
      openDatabases: databases.filter((entry) => entry.state === 'ready').length,
      databaseFiles: this.managedDatabaseFiles,
      tenantSyncDatabases: databases.filter(
        (entry) => entry.tenantSyncBindings > 0,
      ).length,
      tenantSyncBindings: databases.reduce(
        (sum, entry) => sum + entry.tenantSyncBindings,
        0,
      ),
      queuedOperations: this.queuedOperations,
      activeOperations: databases.reduce(
        (sum, entry) => sum + entry.activeOperations,
        0,
      ),
      availableSlots: this.freeSlots.size,
      quarantinedSlots: this.quarantinedSlots.size,
      heldAuthorityLeases: this.heldAuthorityLeases,
      blockedDatabases: Object.freeze(
        [...this.blockedDatabases.values()]
          .map((blocked) => Object.freeze({
            databaseRef: blocked.databaseRef,
            failureCode: blocked.failure.code,
          }))
          .sort((left, right) => left.databaseRef.localeCompare(right.databaseRef)),
      ),
      databases: Object.freeze(databases),
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
    this.cleanupFailedEntryIfUnused(entry);
  }

  cancelTenantSyncBindingReservation(entry: DatabaseEntry): void {
    if (entry.tenantSyncBindingSlots <= entry.syncBindings.size) return;
    entry.tenantSyncBindingSlots -= 1;
  }

  activateTenantSyncBinding(
    entry: DatabaseEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    if (entry.tenantSyncBindingSlots <= entry.syncBindings.size
      || entry.syncBindings.has(binding)) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database tenant Sync reservation is invalid.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    entry.syncBindings.add(binding);
  }

  releaseTenantSyncBinding(
    entry: DatabaseEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    if (!entry.syncBindings.delete(binding)) return;
    if (entry.tenantSyncBindingSlots > 0) entry.tenantSyncBindingSlots -= 1;
  }

  assertTenantSyncAuthority(
    entry: DatabaseEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ): undefined {
    this.assertStarted();
    if (this.entries.get(entry.id) !== entry) throw authorityUnavailable();
    if (!commitAuthority) {
      if (this.requireCommitAuthority) throw authorityUnavailable();
      return undefined;
    }
    const coordinator = this.authorityCommitCoordinator;
    if (!coordinator) throw authorityUnavailable();
    assertDatabaseCommitAuthorityCurrent(
      commitAuthority,
      coordinator,
      entry.databaseRef,
    );
    return undefined;
  }

  private createEntry(id: DatabaseId, slot: number): DatabaseEntry {
    const databaseRef = createDatabaseRef(id);
    const placement = resolveEntryPlacement(this.placementPolicy, databaseRef);
    let prepared;
    try {
      this.assertOwnedRootCurrent();
      prepared = prepareDatabaseFileWithCreationAdmission(
        this.rootDirectory,
        id,
        () => this.assertDatabaseFileAdmission(databaseRef, placement),
      );
      this.assertOwnedRootCurrent();
      if (prepared.created) this.managedDatabaseFiles += 1;
      const bindingIdentity = prepareDatabaseBindingIdentity({
        filePath: prepared.path,
        fileIdentity: prepared.identity,
        databaseRef,
        realmName: this.realm.name,
        initialize: prepared.created,
      });
      this.assertOwnedRootCurrent();
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
      state: 'opening' as DatabaseCoordinatorEntryState,
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
      lastUsedAt: this.now(),
      syncIdentity: null,
      tenantSyncBindingSlots: 0,
      syncBindings: new Set<DatabaseCoordinatorSyncBindingHandle>(),
    };
    entry.lane = new DatabaseWriterLane({
      databaseRef,
      placement: placement.mode,
      maxQueued: this.maxQueuedPerDatabase,
      now: this.now,
      onQueued: () => {
        if (this.queuedOperations >= this.maxQueuedTotal) return false;
        this.queuedOperations += 1;
        return true;
      },
      onDequeued: () => {
        this.queuedOperations = Math.max(0, this.queuedOperations - 1);
      },
      observability: this.observability,
    });
    entry.opening = this.openEntry(entry);
    // Avoid process-global unhandled rejection if every concurrent acquirer is
    // cancelled before observing the shared startup promise.
    void entry.opening.catch(() => undefined);
    return entry;
  }

  private assertDatabaseFileAdmission(
    databaseRef: DatabaseRef,
    placement: DatabaseActorPlacementConfig,
  ): void {
    if (this.managedDatabaseFiles < this.maxDatabaseFiles) return;
    this.emit({
      type: 'capacity-exhausted',
      databaseRef,
      placement: placement.mode,
      capacityType: 'files',
      capacityLimit: this.maxDatabaseFiles,
    });
    throw new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'Database file capacity is exhausted.',
      {
        retryable: false,
        outcome: 'not-started',
        details: {
          capacityType: 'files',
          capacityLimit: this.maxDatabaseFiles,
        },
      },
    );
  }

  private assertTenantSyncAdmission(
    id: DatabaseId,
    entry: DatabaseEntry | null,
  ): void {
    const databaseRef = entry?.databaseRef ?? createDatabaseRef(id);
    const bindingCount = entry?.tenantSyncBindingSlots ?? 0;
    if (bindingCount >= this.maxTenantSyncBindingsPerDatabase) {
      this.emit({
        type: 'queue-saturated',
        databaseRef,
        ...(entry ? { placement: entry.placement.mode } : {}),
        operation: 'sync',
        queueDepth: bindingCount,
        queueLimit: this.maxTenantSyncBindingsPerDatabase,
      });
      throw new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database tenant Sync binding capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            maxTenantSyncBindingsPerDatabase:
              this.maxTenantSyncBindingsPerDatabase,
          },
        },
      );
    }

    // An already-reserved database consumes no additional actor slot and is
    // therefore admitted even when the distinct-database ceiling is full.
    if (bindingCount > 0) return;
    const distinctDatabases = [...this.entries.values()].filter(
      (candidate) => candidate.tenantSyncBindingSlots > 0,
    ).length;
    if (distinctDatabases < this.maxTenantSyncDatabases) return;
    this.emit({
      type: 'queue-saturated',
      databaseRef,
      ...(entry ? { placement: entry.placement.mode } : {}),
      operation: 'sync',
      queueDepth: distinctDatabases,
      queueLimit: this.maxTenantSyncDatabases,
    });
    throw new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database tenant Sync database capacity is exhausted.',
      {
        retryable: true,
        outcome: 'not-started',
        details: { maxTenantSyncDatabases: this.maxTenantSyncDatabases },
      },
    );
  }

  private async openEntry(
    entry: DatabaseEntry,
    restartRetryCount = 0,
  ): Promise<void> {
    const startedAt = this.now();
    const previousSyncIdentity = entry.syncIdentity;
    try {
      const payload = validateDatabaseActorBindPayload({
        databaseRef: entry.databaseRef,
        filePath: entry.filePath,
        fileIdentity: entry.fileIdentity,
        instanceId: entry.bindingIdentity.instanceId,
        actorLiveness: this.requireActorLiveness(),
        placement: entry.placement,
        realmFingerprint: this.realm.fingerprint,
        sqlite: this.sqlite,
      });
      entry.writer = this.makeExecutor(entry, 'writer');
      await entry.writer.start();
      const writerResult = validateDatabaseActorBindResult(
        await entry.writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.bindWriter,
          kind: 'write',
          payload: payload as unknown as DatabaseExecutorValue,
        }, { timeoutMs: this.operationTimeoutMs }),
      );
      this.assertBindingResult(entry, 'writer', writerResult);

      if (this.readersEnabled && entry.placement.mode === 'file') {
        entry.reader = this.makeExecutor(entry, 'reader');
        await entry.reader.start();
        const readerResult = validateDatabaseActorBindResult(
          await entry.reader.execute({
            operation: DATABASE_ACTOR_OPERATIONS.bindReader,
            kind: 'read',
            payload: payload as unknown as DatabaseExecutorValue,
          }, { timeoutMs: this.operationTimeoutMs }),
        );
        this.assertBindingResult(entry, 'reader', readerResult);
      }
      if (this.state !== 'started' || entry.state !== 'opening') {
        throw this.closedError();
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
        generation: entry.writer.diagnostics().generation,
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
      this.watchUnexpectedExecutorSettlement(entry, entry.writer, 'writer');
      if (entry.reader) {
        this.watchUnexpectedExecutorSettlement(entry, entry.reader, 'reader');
      }
      if (previousSyncIdentity
        && (previousSyncIdentity.syncEpoch !== nextSyncIdentity.syncEpoch
          || previousSyncIdentity.generation !== nextSyncIdentity.generation)) {
        this.publishTenantSyncReset(entry, nextSyncIdentity);
      }
      if (restartRetryCount > 0) {
        this.emitExecutorRestarted(
          entry,
          entry.writer,
          'writer',
          restartRetryCount,
        );
        if (entry.reader) {
          this.emitExecutorRestarted(
            entry,
            entry.reader,
            'reader',
            restartRetryCount,
          );
        }
      }
      this.emit({
        type: 'runtime-opened',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        durationMs: elapsed(startedAt, this.now()),
      });
    } catch (caught) {
      const originalError = safeCoordinatorError(caught);
      const writer = entry.writer;
      const reader = entry.reader;
      const actors = compactExecutors(writer, reader);
      entry.failure = originalError;
      if (entry.state !== 'closing') entry.state = 'failed';
      const cleanupFailures = await this.closeBoundActors(writer, reader);
      const error = cleanupFailures.length === 0
        ? originalError
        : new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database actor startup failed and cleanup was incomplete.',
          { retryable: false, outcome: 'unknown' },
        );
      entry.failure = error;
      const finishFailure = restartRetryCount > 0
        ? () => this.finishRecoveryOpenFailure(
            entry,
            writer,
            reader,
            originalError,
          )
        : () => this.finishOpenFailure(
            entry,
            writer,
            reader,
            originalError,
          );
      if (actors.every((actor) => actor.diagnostics().settled)) {
        finishFailure();
      } else {
        entry.state = 'quarantined';
        this.quarantinedSlots.add(entry.slot);
        this.watchSettlement(
          entry,
          actors,
          finishFailure,
        );
      }
      this.emit({
        type: 'runtime-open-failed',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        durationMs: elapsed(startedAt, this.now()),
        error,
      });
      throw error;
    }
  }

  private makeExecutor(
    entry: DatabaseEntry,
    role: DatabaseActorRole,
  ): DatabaseExecutor {
    let executor: DatabaseExecutor;
    try {
      executor = this.createExecutor(Object.freeze({ role, slot: entry.slot }));
    } catch {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor factory failed.',
      );
    }
    if (!executor
      || typeof executor.start !== 'function'
      || typeof executor.execute !== 'function'
      || typeof executor.close !== 'function'
      || typeof executor.settled !== 'function'
      || typeof executor.diagnostics !== 'function') {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor factory returned an invalid executor.',
      );
    }
    // From this point onward the lifecycle-capable executor belongs to this
    // entry, even when its claimed identity is invalid. Startup cleanup must
    // prove its exact settlement before the slot can be reused.
    if (role === 'writer') entry.writer = executor;
    else entry.reader = executor;
    const requiresEventListener = role === 'writer'
      && entry.placement.mode === 'hot'
      && entry.placement.durability === 'periodic';
    if (requiresEventListener
      && typeof executor.setEventListener !== 'function') {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Periodic hot database executors require an event boundary.',
      );
    }
    if (executor.setEventListener !== undefined) {
      if (typeof executor.setEventListener !== 'function') {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_START_FAILED',
          'Database executor event boundary is invalid.',
        );
      }
      executor.setEventListener((event) => {
        try {
          this.hotDurabilitySupervisor.observe(entry, executor, role, event);
        } catch {
          // An executor lifecycle callback must remain synchronous/non-throwing.
        }
      });
    }
    const diagnostics = executor.diagnostics();
    const generationKey = `${role}:${entry.slot}`;
    const previousGeneration = this.lastGenerationBySlot.get(generationKey) ?? 0;
    if (diagnostics.slot !== entry.slot
      || !Number.isSafeInteger(diagnostics.generation)
      || diagnostics.generation <= previousGeneration) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor identity was stale or did not match its assigned slot.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    this.lastGenerationBySlot.set(generationKey, diagnostics.generation);
    return executor;
  }


  private watchUnexpectedExecutorSettlement(
    entry: DatabaseEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
  ): void {
    void executor.settled().then(() => {
      if (this.state !== 'started'
        || entry.state !== 'ready'
        || this.entries.get(entry.id) !== entry
        || (role === 'writer' ? entry.writer : entry.reader) !== executor) return;
      this.hotDurabilitySupervisor.clear(executor);
      const diagnostics = executor.diagnostics();
      const error = new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database executor settled unexpectedly.',
        { retryable: false, outcome: 'unknown' },
      );
      this.emit({
        type: 'executor-failed',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role,
        slot: entry.slot,
        generation: diagnostics.generation,
        phase: 'execute',
        error,
      });
      void this.retireBinding(
        entry,
        executor,
        error,
        'runtime-failure',
      ).catch((caught) => {
        this.emit({
          type: 'coordinator-failed',
          phase: 'close',
          error: safeCoordinatorError(caught),
        });
      });
    }, (caught) => {
      this.emit({
        type: 'coordinator-failed',
        phase: 'close',
        error: safeCoordinatorError(caught),
      });
    });
  }

  private assertBindingResult(
    entry: DatabaseEntry,
    role: DatabaseActorRole,
    result: ReturnType<typeof validateDatabaseActorBindResult>,
  ): void {
    if (result.databaseRef !== entry.databaseRef
      || result.role !== role
      || !sameDatabaseFileIdentity(result.fileIdentity, entry.fileIdentity)
      || result.instanceId !== entry.bindingIdentity.instanceId
      || !sameActorPlacement(result.placement, entry.placement)
      || result.realmFingerprint !== this.realm.fingerprint
      || result.schemaChecksum !== this.realm.schemaChecksum) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database actor binding did not match its assigned realm.',
      );
    }
  }


  private cleanupFailedEntryIfUnused(entry: DatabaseEntry): void {
    if (entry.state !== 'failed'
      || this.entries.get(entry.id) !== entry
      || entry.leases > 0
      || entry.activeOperations > 0
      || entry.recoveryWaiters > 0
      || entry.lane.depth > 0
      || !this.entryExecutorsSettled(entry)) return;
    this.entries.delete(entry.id);
    entry.writer = null;
    entry.reader = null;
    this.releaseSlot(entry.slot);
    entry.state = 'closed';
  }

  private isTerminalExecutorFailure(
    executor: DatabaseExecutor,
    error: DatabaseError,
  ): boolean {
    const state = executor.diagnostics().state;
    return error.code === 'DATABASE_PROTOCOL_ERROR'
      || state === 'failed'
      || state === 'quarantined'
      || state === 'closed';
  }

  private async retireBinding(
    entry: DatabaseEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
    reason: DatabaseBindingRetirementReason,
  ): Promise<void> {
    if (executor !== entry.writer && executor !== entry.reader) return;
    if (entry.recovery) {
      await entry.recovery;
      return;
    }
    // Once any close path owns the entry, it is the sole actor-lifecycle
    // authority. Starting a second retirement here could race the close path's
    // executor snapshot and leave a newer identity mapped after shutdown.
    if (this.state !== 'started'
      || entry.state === 'closing'
      || entry.state === 'closed') return;

    const recovery = this.retireBindingOnce(
      entry,
      error,
      reason,
    );
    entry.recovery = recovery;
    try {
      // Executor close has bounded escalation. Exact settlement may continue
      // in the background while this slot remains quarantined.
      await recovery;
    } finally {
      if (entry.recovery === recovery) entry.recovery = null;
    }
  }

  private async retireBindingOnce(
    entry: DatabaseEntry,
    error: DatabaseError,
    reason: DatabaseBindingRetirementReason,
  ): Promise<void> {
    entry.failure = safeCoordinatorError(error);
    entry.state = 'failed';
    entry.lane.rejectQueued(this.notReadyError());
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    for (const actor of actors) {
      this.hotDurabilitySupervisor.clear(actor);
    }
    const closeFailures = await this.closeExecutors(actors);

    if (closeFailures.length > 0
      && requiresHotCloseDurabilityProof(entry)
      && !allowsPeriodicRuntimeRecovery(entry, reason)) {
      this.latchCloseFailure(entry);
      if (!actors.every((actor) => actor.diagnostics().settled)) {
        this.watchSettlement(entry, actors, () => {
          this.latchCloseFailure(entry);
        });
      }
      return;
    }

    if (actors.every((actor) => actor.diagnostics().settled)) {
      this.finishBindingRetirement(entry, writer, reader);
      return;
    }

    entry.state = 'quarantined';
    this.quarantinedSlots.add(entry.slot);
    this.watchSettlement(
      entry,
      actors,
      () => this.finishBindingRetirement(entry, writer, reader),
    );
  }

  private finishBindingRetirement(
    entry: DatabaseEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    this.quarantinedSlots.delete(entry.slot);

    if (this.state === 'started'
      && this.entries.get(entry.id) === entry
      && entry.leases > 0) {
      this.scheduleReplacementOpening(entry);
      return;
    }

    entry.state = 'failed';
    this.cleanupFailedEntryIfUnused(entry);
  }

  private scheduleReplacementOpening(entry: DatabaseEntry): void {
    if (this.state !== 'started'
      || this.entries.get(entry.id) !== entry
      || entry.leases === 0
      || entry.state === 'closing'
      || entry.state === 'closed') {
      entry.state = this.state === 'started' ? 'failed' : 'closed';
      this.cleanupFailedEntryIfUnused(entry);
      return;
    }

    try {
      this.refreshHotEntryFileIdentity(entry);
    } catch (caught) {
      const failure = safeCoordinatorError(caught);
      this.invalidateTenantSyncBindings(entry);
      entry.failure = failure;
      entry.state = 'failed';
      this.emit({
        type: 'coordinator-failed',
        phase: 'open',
        error: failure,
      });
      return;
    }

    const plan = nextDatabaseRestartPlan(
      this.restartPolicy,
      entry.restartRetryCount,
    );
    entry.restartRetryCount = plan.retryCount;
    entry.restartAbortController?.abort();
    const controller = new AbortController();
    entry.restartAbortController = controller;
    entry.state = 'opening';
    entry.failure = null;
    const opening = this.openReplacementAfterDelay(
      entry,
      plan.retryCount,
      plan.delayMs,
      controller,
    );
    entry.opening = opening;
    void opening.catch(() => undefined);
  }

  private async openReplacementAfterDelay(
    entry: DatabaseEntry,
    retryCount: number,
    delayMs: number,
    controller: AbortController,
  ): Promise<void> {
    const allowed = await waitForDatabaseRestart(delayMs, controller.signal);
    if (entry.restartAbortController === controller) {
      entry.restartAbortController = null;
    }
    if (!allowed
      || this.state !== 'started'
      || this.entries.get(entry.id) !== entry
      || entry.state !== 'opening'
      || entry.leases === 0) {
      if (this.entries.get(entry.id) === entry
        && entry.state === 'opening'
        && entry.leases === 0) {
        entry.state = 'failed';
        this.cleanupFailedEntryIfUnused(entry);
      }
      return;
    }
    await this.openEntry(entry, retryCount);
  }

  private finishRecoveryOpenFailure(
    entry: DatabaseEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    failure: DatabaseError,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    this.quarantinedSlots.delete(entry.slot);

    if (entry.state === 'closing'
      || entry.state === 'closed'
      || this.state !== 'started'
      || this.entries.get(entry.id) !== entry) return;
    if (isPermanentOpenFailure(failure)) {
      this.finishOpenFailure(entry, null, null, failure);
      return;
    }
    if (failure.code === 'DATABASE_EXECUTOR_START_FAILED'
      && failure.retryable === false
      && failure.outcome === 'not-started') {
      this.finishOpenFailure(entry, null, null, failure, false);
      return;
    }
    entry.failure = failure;
    entry.state = 'failed';
    if (entry.leases > 0) {
      this.scheduleReplacementOpening(entry);
      return;
    }
    this.cleanupFailedEntryIfUnused(entry);
  }

  private emitExecutorRestarted(
    entry: DatabaseEntry,
    executor: DatabaseExecutor,
    role: DatabaseActorRole,
    retryCount: number,
  ): void {
    this.emit({
      type: 'executor-restarted',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role,
      slot: entry.slot,
      generation: executor.diagnostics().generation,
      reason: 'failure',
      retryCount,
    });
  }

  /**
   * Hot snapshots replace the main-file inode atomically. Refresh only the
   * physical proof after every old actor has settled; the durable logical
   * database reference and instance ID must remain unchanged.
   */
  private refreshHotEntryFileIdentity(entry: DatabaseEntry): void {
    if (entry.placement.mode !== 'hot') return;
    this.assertOwnedRootCurrent();
    const guard = openDatabaseFileIdentityGuard(entry.filePath, {
      access: 'readwrite',
    });
    try {
      const bindingIdentity = prepareDatabaseBindingIdentity({
        filePath: entry.filePath,
        fileIdentity: guard.proof,
        databaseRef: entry.databaseRef,
        realmName: this.realm.name,
        initialize: false,
      });
      guard.assertCurrent();
      this.assertOwnedRootCurrent();
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

  private requireWriter(entry: DatabaseEntry): DatabaseExecutor {
    if (!entry.writer || entry.state !== 'ready') throw this.notReadyError();
    return entry.writer;
  }

  private requireTenantSyncIdentity(
    entry: DatabaseEntry,
    writer: DatabaseExecutor,
  ): DatabaseTenantSyncIdentity {
    const identity = entry.syncIdentity;
    if (!identity
      || entry.writer !== writer
      || identity.generation !== writer.diagnostics().generation) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database tenant Sync binding is unavailable.',
        { retryable: true, outcome: 'not-started' },
      );
    }
    return identity;
  }

  private advanceTenantSyncSequence(
    entry: DatabaseEntry,
    sequence: number,
  ): void {
    const identity = entry.syncIdentity;
    if (!identity || sequence <= identity.sequence) return;
    entry.syncIdentity = Object.freeze({
      ...identity,
      sequence,
    });
  }

  private publishTenantSyncCommit(
    entry: DatabaseEntry,
    operation: DatabaseWriteOperation,
    result: DatabaseCommitResult,
  ): void {
    if (result.replayed) return;
    const identity = entry.syncIdentity;
    const writer = entry.writer;
    if (!identity || !writer || entry.state !== 'ready'
      || writer.diagnostics().generation !== identity.generation) return;
    const throughSeq = result.sequence.seq;
    if (throughSeq <= identity.sequence) return;
    const afterSeq = identity.sequence;
    entry.syncIdentity = Object.freeze({ ...identity, sequence: throughSeq });
    const wakeup: DatabaseTenantSyncWakeup = Object.freeze({
      type: 'changes',
      databaseRef: entry.databaseRef,
      syncEpoch: identity.syncEpoch,
      generation: identity.generation,
      afterSeq,
      throughSeq,
      idempotencyKey: operation.idempotencyKey,
    });
    for (const binding of [...entry.syncBindings]) binding.notify(wakeup);
    if (entry.syncBindings.size > 0) {
      this.emit({
        type: 'change-wakeup',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: 'writer',
        slot: entry.slot,
        generation: identity.generation,
        sequenceStart: afterSeq + 1,
        sequenceEnd: throughSeq,
      });
    }
  }

  private publishTenantSyncReset(
    entry: DatabaseEntry,
    identity: DatabaseTenantSyncIdentity,
  ): void {
    const wakeup: DatabaseTenantSyncWakeup = Object.freeze({
      type: 'reset',
      databaseRef: entry.databaseRef,
      syncEpoch: identity.syncEpoch,
      generation: identity.generation,
      sequence: createDatabaseSequenceToken(identity.sequence),
    });
    for (const binding of [...entry.syncBindings]) binding.notify(wakeup);
  }

  private canAwaitOpening(entry: DatabaseEntry): boolean {
    return this.state === 'started'
      && this.entries.get(entry.id) === entry
      && entry.state === 'opening';
  }

  private resolveCommitAuthority(
    id: DatabaseId,
    options: DatabaseAcquireOptions,
  ): DatabaseCommitAuthority | null {
    if (!options || typeof options !== 'object') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database acquisition options are invalid.',
      );
    }
    const authority = options.commitAuthority;
    if (authority === undefined) {
      if (this.requireCommitAuthority) throw authorityUnavailable();
      return null;
    }
    if (!this.authorityCommitCoordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit authority is not configured.',
      );
    }
    if (!isDatabaseCommitAuthority(authority)
      || !isDatabaseCommitAuthorityFor(
        authority,
        this.authorityCommitCoordinator,
        createDatabaseRef(id),
      )) {
      throw authorityUnavailable();
    }
    return authority;
  }

  private holdAuthorityUntilSettlement(
    lease: AuthorityCommitLease,
    executor: DatabaseExecutor,
  ): void {
    this.heldAuthorityLeases += 1;
    void executor.settled().then(() => {
      try {
        lease.release();
        this.heldAuthorityLeases = Math.max(0, this.heldAuthorityLeases - 1);
      } catch (error) {
        this.emit({
          type: 'coordinator-failed',
          phase: 'commit',
          error: safeCoordinatorError(error),
        });
      }
    }, (error) => {
      // A rejected settlement proof cannot safely release commit authority.
      this.emit({
        type: 'coordinator-failed',
        phase: 'commit',
        error: safeCoordinatorError(error),
      });
    });
  }

  private assertUsableEntry(entry: DatabaseEntry): void {
    this.assertStarted();
    if (this.entries.get(entry.id) !== entry || entry.state !== 'ready') {
      throw this.notReadyError();
    }
  }

  private selectCapacityEviction(): DatabaseEntry | null {
    return [...this.entries.values()]
      .filter((entry) => this.isEvictable(entry))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0] ?? null;
  }

  private isEvictable(entry: DatabaseEntry): boolean {
    return entry.state === 'ready'
      && entry.leases === 0
      && entry.activeOperations === 0
      && entry.recoveryWaiters === 0
      && entry.lane.depth === 0;
  }

  private async closeEntry(
    entry: DatabaseEntry,
    reason: DatabaseCloseReason,
  ): Promise<void> {
    if (readEntryState(entry) === 'closed') return;
    if (entry.closeTask) return entry.closeTask;
    const task = this.closeEntryOnce(entry, reason);
    entry.closeTask = task;
    try {
      await task;
    } finally {
      if (entry.closeTask === task) entry.closeTask = null;
    }
  }

  private async closeEntryOnce(
    entry: DatabaseEntry,
    reason: DatabaseCloseReason,
  ): Promise<void> {
    if (entry.closeFailure) {
      entry.state = 'quarantined';
      this.quarantinedSlots.add(entry.slot);
      throw entry.closeFailure;
    }
    entry.state = 'closing';
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    entry.lane.rejectQueued(this.closedError());
    try {
      await entry.opening;
    } catch {
      // The startup path owns its failure classification and actor cleanup.
    }
    if (readEntryState(entry) === 'closed') return;
    await entry.lane.idle();
    // Runtime retirement intentionally executes outside the writer lane. Join
    // it before taking the actor identity used for final closure. Otherwise a
    // retirement can clear that identity between this snapshot and
    // finishEntryClosure(), causing shutdown to silently retain the mapped
    // entry and its tenant-Sync lease.
    await this.joinEntryRecovery(entry);
    if (readEntryState(entry) === 'closed') return;
    if (entry.closeFailure) {
      entry.state = 'quarantined';
      this.quarantinedSlots.add(entry.slot);
      throw entry.closeFailure;
    }
    entry.state = 'closing';
    const startedAt = this.now();
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    const failures = await this.closeBoundActors(writer, reader);
    const actorsSettled = actors.every((actor) => actor.diagnostics().settled);
    if (failures.length > 0 && requiresHotCloseDurabilityProof(entry)) {
      // Actor settlement proves process termination, not that a final hot
      // snapshot became durable. Keep the logical database and its pool slot
      // quarantined so a later close/reopen cannot silently serve stale data.
      const failure = this.latchCloseFailure(entry);
      if (!actorsSettled) {
        this.watchSettlement(entry, actors, () => {
          this.latchCloseFailure(entry);
        });
      }
      throw failure;
    }
    if (!actorsSettled) {
      entry.state = 'quarantined';
      this.quarantinedSlots.add(entry.slot);
      this.watchSettlement(
        entry,
        actors,
        () => {
          if (!this.finishEntryClosure(
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
        },
      );
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor settlement is incomplete.',
        { retryable: false, outcome: 'unknown' },
      );
    }

    if (!this.finishEntryClosure(entry, writer, reader, reason, startedAt)) {
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

  private finishEntryClosure(
    entry: DatabaseEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    reason: DatabaseCloseReason,
    startedAt: number,
  ): boolean {
    if (entry.state === 'closed') return true;
    if (entry.writer !== writer || entry.reader !== reader) return false;
    this.invalidateTenantSyncBindings(entry);
    entry.writer = null;
    entry.reader = null;
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    entry.restartRetryCount = 0;
    entry.failure = null;
    entry.closeFailure = null;
    entry.state = 'closed';
    this.quarantinedSlots.delete(entry.slot);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    this.releaseSlot(entry.slot);
    this.emit({
      type: 'runtime-closed',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      slot: entry.slot,
      durationMs: elapsed(startedAt, this.now()),
      reason,
    });
    if (reason !== 'shutdown') {
      this.emit({
        type: 'runtime-evicted',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        slot: entry.slot,
        reason,
      });
    }
    return true;
  }

  private async joinEntryRecovery(entry: DatabaseEntry): Promise<void> {
    while (entry.recovery) {
      const recovery = entry.recovery;
      try {
        await recovery;
      } finally {
        // retireBinding normally clears this reference in its own finally.
        // Clearing the same fulfilled/rejected task here also makes shutdown
        // robust to promise-reaction ordering between the two waiters.
        if (entry.recovery === recovery) entry.recovery = null;
      }
    }
  }

  private latchCloseFailure(entry: DatabaseEntry): DatabaseError {
    if (entry.closeFailure) return entry.closeFailure;
    const failure = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database actors did not close cleanly.',
      { retryable: false, outcome: 'unknown' },
    );
    this.invalidateTenantSyncBindings(entry);
    entry.failure = failure;
    entry.closeFailure = failure;
    entry.state = 'quarantined';
    this.quarantinedSlots.add(entry.slot);
    return failure;
  }

  private finishOpenFailure(
    entry: DatabaseEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    failure: DatabaseError,
    rememberPermanentFailure = true,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    this.invalidateTenantSyncBindings(entry);
    entry.writer = null;
    entry.reader = null;
    entry.restartAbortController?.abort();
    entry.restartAbortController = null;
    this.quarantinedSlots.delete(entry.slot);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    this.releaseSlot(entry.slot);

    if (this.state === 'started'
      && entry.state !== 'closing'
      && rememberPermanentFailure
      && isPermanentOpenFailure(failure)) {
      entry.state = 'quarantined';
      this.rememberBlockedDatabase(entry, failure);
      return;
    }
    entry.state = this.state === 'started' ? 'failed' : 'closed';
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

  private invalidateTenantSyncBindings(entry: DatabaseEntry): void {
    for (const binding of [...entry.syncBindings]) {
      binding.coordinatorClosed();
    }
    entry.syncBindings.clear();
  }

  private watchSettlement(
    entry: DatabaseEntry,
    actors: readonly DatabaseExecutor[],
    onSettled: () => void,
  ): void {
    if (entry.settlement || actors.length === 0) return;
    const task = Promise.all(actors.map((actor) => actor.settled()))
      .then(() => {
        if (!actors.every((actor) => actor.diagnostics().settled)) {
          throw new DatabaseError(
            'DATABASE_EXECUTOR_FAILED',
            'Database actor settlement proof is invalid.',
            { retryable: false, outcome: 'unknown' },
          );
        }
        onSettled();
      });
    entry.settlement = task;
    void task.catch((error) => this.emit({
      type: 'coordinator-failed',
      phase: 'close',
      error: safeCoordinatorError(error),
    })).finally(() => {
      if (entry.settlement === task) entry.settlement = null;
    });
  }

  private async closeExecutors(
    executors: readonly DatabaseExecutor[],
  ): Promise<unknown[]> {
    const outcomes = await Promise.allSettled(
      executors.map((executor) => Promise.resolve().then(() => executor.close())),
    );
    return outcomes.flatMap((outcome) => (
      outcome.status === 'rejected' ? [outcome.reason] : []
    ));
  }

  /** Graceful bindings release readonly snapshots before the writer handle. */
  private async closeBoundActors(
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
  ): Promise<unknown[]> {
    this.hotDurabilitySupervisor.clear(reader);
    this.hotDurabilitySupervisor.clear(writer);
    const failures: unknown[] = [];
    if (reader) failures.push(...await this.closeExecutors([reader]));
    if (writer) failures.push(...await this.closeExecutors([writer]));
    return failures;
  }

  private entryExecutorsSettled(entry: DatabaseEntry): boolean {
    return [entry.reader, entry.writer].every(
      (executor) => !executor || executor.diagnostics().settled,
    );
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
        await this.closeEntry(entry, 'shutdown');
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
      const error = new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database coordinator shutdown was incomplete.',
        { retryable: false, outcome: 'unknown' },
      );
      this.emit({
        type: 'coordinator-failed',
        phase: 'shutdown',
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

  private capacityError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database actor capacity is exhausted.',
      {
        retryable: true,
        outcome: 'not-started',
        details: { maxDatabases: this.maxDatabases },
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



function readEntryState(entry: DatabaseEntry): DatabaseCoordinatorEntryState {
  return entry.state;
}

function requiresHotCloseDurabilityProof(entry: DatabaseEntry): boolean {
  return entry.placement.mode === 'hot'
    && entry.placement.durability !== 'on-write';
}

function allowsPeriodicRuntimeRecovery(
  entry: DatabaseEntry,
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
