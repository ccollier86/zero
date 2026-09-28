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
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  validateDatabaseActorReplayPayload,
  type DatabaseActorRole,
  type DatabaseActorSQLiteConfig,
} from './database-actor-protocol';
import {
  DatabaseError,
  normalizeDatabaseError,
  type DatabaseErrorCode,
  type DatabaseErrorDetails,
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
  createDatabaseRef,
  normalizeDatabaseId,
  prepareDatabaseFile,
  type DatabaseId,
  type DatabaseRef,
} from './database-file';
import type { DatabaseObservability } from './database-observability';
import {
  acquireDatabaseRootOwnership,
  type DatabaseRootOwnershipGuard,
} from './database-root-ownership';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import {
  validateDatabaseOperation,
  type DatabaseCommitResult,
  type DatabaseOperation,
  type DatabaseReadResult,
  type DatabaseWriteOperation,
} from './database-operations';
import {
  validateDatabaseActorExecuteResult,
  validateDatabaseActorReplayResult,
} from './database-actor-result-validation';

const DEFAULT_MAX_DATABASES = 16;
const DEFAULT_MAX_BLOCKED_DATABASES = 1_024;
const DEFAULT_MAX_QUEUED_PER_DATABASE = 128;
const DEFAULT_MAX_QUEUED_TOTAL = 1_024;
const DEFAULT_QUEUE_TIMEOUT_MS = 15_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1_000;
const MAX_SWEEP_INTERVAL_MS = 30_000;

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
  readonly sqlite?: DatabaseActorSQLiteConfig;
  readonly maxDatabases?: number;
  /** Maximum remembered permanent-open failures. Oldest records are retried. */
  readonly maxBlockedDatabases?: number;
  /** Set false to route every read through the writer actor. Default: true. */
  readonly readers?: boolean;
  readonly maxQueuedPerDatabase?: number;
  readonly maxQueuedTotal?: number;
  readonly queueTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
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

export interface DatabaseCoordinatorLease extends AsyncDisposable {
  readonly databaseRef: DatabaseRef;
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
  readonly state: DatabaseCoordinatorEntryState;
  readonly slot: number;
  readonly leases: number;
  readonly activeOperations: number;
  readonly queueDepth: number;
  readonly writerGeneration: number | null;
  readonly readerGeneration: number | null;
  readonly lastUsedAt: number;
}

export interface DatabaseCoordinatorDiagnostics {
  readonly state: DatabaseCoordinatorState;
  readonly maxDatabases: number;
  readonly maxBlockedDatabases: number;
  readonly readersEnabled: boolean;
  readonly openDatabases: number;
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

interface DatabaseEntry {
  readonly id: DatabaseId;
  readonly databaseRef: DatabaseRef;
  readonly filePath: string;
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
  leases: number;
  activeOperations: number;
  recoveryWaiters: number;
  lastUsedAt: number;
}

type DatabaseCloseReason = 'requested' | 'idle' | 'capacity' | 'shutdown';

interface WriterLaneTask<T> {
  readonly execute: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: DatabaseError) => void;
  readonly queuedAt: number;
  readonly timeoutMs: number;
  readonly operationClass: 'query' | 'mutation' | 'replay';
  readonly chargedToGlobalQueue: boolean;
  readonly signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout> | null;
  abortListener: (() => void) | null;
  settled: boolean;
}

/** Bounded actor coordinator. It never exposes an actor, path, or raw handle. */
export class DatabaseCoordinator implements AsyncDisposable {
  readonly realm: DatabaseRealm;

  private readonly rootDirectory: string;
  private readonly createExecutor: DatabaseExecutorFactory;
  private readonly sqlite: DatabaseActorSQLiteConfig;
  private readonly readersEnabled: boolean;
  private readonly maxDatabases: number;
  private readonly maxBlockedDatabases: number;
  private readonly maxQueuedPerDatabase: number;
  private readonly maxQueuedTotal: number;
  private readonly queueTimeoutMs: number;
  private readonly operationTimeoutMs: number;
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
  private readonly blockedDatabases = new Map<DatabaseId, {
    readonly databaseRef: DatabaseRef;
    readonly failure: DatabaseError;
  }>();
  private state: DatabaseCoordinatorState = 'created';
  private rootOwnership: DatabaseRootOwnershipGuard | null = null;
  private queuedOperations = 0;
  private heldAuthorityLeases = 0;
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
    this.maxBlockedDatabases = positiveInteger(
      options.maxBlockedDatabases ?? DEFAULT_MAX_BLOCKED_DATABASES,
      'maxBlockedDatabases',
    );
    this.maxQueuedPerDatabase = positiveInteger(
      options.maxQueuedPerDatabase ?? DEFAULT_MAX_QUEUED_PER_DATABASE,
      'maxQueuedPerDatabase',
    );
    this.maxQueuedTotal = positiveInteger(
      options.maxQueuedTotal ?? DEFAULT_MAX_QUEUED_TOTAL,
      'maxQueuedTotal',
    );
    this.queueTimeoutMs = positiveInteger(
      options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
      'queueTimeoutMs',
    );
    this.operationTimeoutMs = positiveInteger(
      options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
      'operationTimeoutMs',
    );
    this.idleTimeoutMs = nonNegativeInteger(
      options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      'idleTimeoutMs',
    );
    this.sweepIntervalMs = options.sweepIntervalMs === false
      ? false
      : positiveInteger(
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
    this.rootDirectory = options.rootDirectory;
    this.realm = options.realm;
    this.operationCatalog = createDatabaseRealmOperationCatalog(options.realm);
    this.createExecutor = options.createExecutor;
    this.sqlite = detachSQLiteConfig(options.sqlite ?? {});
    this.readersEnabled = options.readers !== false;
    this.observability = options.observability ?? null;
    this.authorityCommitCoordinator = options.authorityCommitCoordinator ?? null;
    this.requireCommitAuthority = options.requireCommitAuthority ?? false;
    this.now = options.now ?? Date.now;
    for (let slot = 0; slot < this.maxDatabases; slot += 1) {
      this.freeSlots.add(slot);
    }
    this.emit({
      type: 'coordinator-configured',
      writerLimit: this.maxDatabases,
      readerLimit: this.readersEnabled ? this.maxDatabases : 0,
      runtimeLimit: this.maxDatabases,
      queueLimit: this.maxQueuedTotal,
    });
  }

  start(): void {
    if (this.state === 'started') return;
    if (this.state !== 'created') throw this.closedError();
    const ownership = acquireDatabaseRootOwnership(this.rootDirectory);
    try {
      this.rootOwnership = ownership;
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
      this.rootOwnership = null;
      this.state = 'created';
      try { ownership.release(); } catch { /* Preserve startup failure. */ }
      throw safeCoordinatorError(error);
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
        this.releaseEntry(entry);
        throw safeCoordinatorError(error);
      }
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
        state: entry.state,
        slot: entry.slot,
        leases: entry.leases,
        activeOperations: entry.activeOperations,
        queueDepth: entry.lane.depth + entry.recoveryWaiters,
        writerGeneration: entry.writer?.diagnostics().generation ?? null,
        readerGeneration: entry.reader?.diagnostics().generation ?? null,
        lastUsedAt: entry.lastUsedAt,
      }))
      .sort((left, right) => left.databaseRef.localeCompare(right.databaseRef));
    return Object.freeze({
      state: this.state,
      maxDatabases: this.maxDatabases,
      maxBlockedDatabases: this.maxBlockedDatabases,
      readersEnabled: this.readersEnabled,
      openDatabases: databases.filter((entry) => entry.state === 'ready').length,
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
    this.assertStarted();
    let operation: DatabaseOperation;
    try {
      operation = validateDatabaseOperation(value, this.operationCatalog);
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        options,
        operationClass(operation),
        () => this.execute(entry, operation, options, commitAuthority),
      );
    }
    this.assertUsableEntry(entry);
    if (isWriteOperation(operation)) {
      return this.enqueueWriterOperation(
        entry,
        operation,
        options,
        commitAuthority,
      );
    }
    if (operation.consistency?.mode === 'strong'
      || !entry.reader) {
      return this.enqueueWriterOperation(entry, operation, options, null);
    }
    return this.trackOperation(entry, async () => {
      try {
        return await this.executeOnActor(entry, entry.reader!, operation, options);
      } catch (error) {
        const normalized = safeCoordinatorError(error);
        if (operation.consistency?.mode === 'read-your-writes'
          && normalized.code === 'DATABASE_TRANSACTION_STALE') {
          return entry.lane.enqueue(
            () => this.executeOnActor(
              entry,
              this.requireWriter(entry),
              operation,
              options,
            ),
            {
              signal: options.signal,
              timeoutMs: queueTimeout(options, this.queueTimeoutMs),
              operationClass: 'query',
            },
          );
        }
        throw normalized;
      }
    });
  }

  replay(
    entry: DatabaseEntry,
    afterSeq: number,
    limit = DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    options: DatabaseExecutionOptions = {},
  ): Promise<DatabaseReadResult> {
    this.assertStarted();
    let payload: ReturnType<typeof validateDatabaseActorReplayPayload>;
    try {
      payload = validateDatabaseActorReplayPayload({
        databaseRef: entry.databaseRef,
        afterSeq,
        limit,
      });
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        options,
        'replay',
        () => this.replay(entry, payload.afterSeq, payload.limit, options),
      );
    }
    this.assertUsableEntry(entry);
    return this.enqueueLane(
      entry,
      'replay',
      options,
      async () => {
        const writer = this.requireWriter(entry);
        const startedAt = this.now();
        try {
          const result = await writer.execute({
            operation: DATABASE_ACTOR_OPERATIONS.replay,
            kind: 'read',
            payload: payload as unknown as DatabaseExecutorValue,
          }, { timeoutMs: operationTimeout(options, this.operationTimeoutMs) });
          return validateDatabaseActorReplayResult(result, payload);
        } catch (caught) {
          const error = safeCoordinatorError(caught);
          this.emit({
            type: 'replay-failed',
            databaseRef: entry.databaseRef,
            role: 'writer',
            slot: entry.slot,
            generation: writer.diagnostics().generation,
            sequenceStart: payload.afterSeq,
            sequenceEnd: payload.afterSeq,
            durationMs: elapsed(startedAt, this.now()),
            error,
          });
          if (this.isTerminalExecutorFailure(writer, error)) {
            await this.retireBinding(entry, writer, error);
          }
          throw error;
        }
      },
    );
  }

  releaseEntry(entry: DatabaseEntry): void {
    if (entry.leases === 0) return;
    entry.leases -= 1;
    entry.lastUsedAt = this.now();
    this.cleanupFailedEntryIfUnused(entry);
  }

  private createEntry(id: DatabaseId, slot: number): DatabaseEntry {
    let prepared;
    try {
      prepared = prepareDatabaseFile(this.rootDirectory, id);
    } catch {
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Database file could not be prepared.',
      );
    }
    const databaseRef = createDatabaseRef(id);
    const entry = {
      id,
      databaseRef,
      filePath: prepared.path,
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
      leases: 0,
      activeOperations: 0,
      recoveryWaiters: 0,
      lastUsedAt: this.now(),
    };
    entry.lane = new DatabaseWriterLane({
      databaseRef,
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

  private async openEntry(entry: DatabaseEntry): Promise<void> {
    const startedAt = this.now();
    try {
      const payload = validateDatabaseActorBindPayload({
        databaseRef: entry.databaseRef,
        filePath: entry.filePath,
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

      if (this.readersEnabled) {
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
      entry.failure = null;
      entry.state = 'ready';
      this.emit({
        type: 'runtime-opened',
        databaseRef: entry.databaseRef,
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
      if (actors.every((actor) => actor.diagnostics().settled)) {
        this.finishOpenFailure(entry, writer, reader, originalError);
      } else {
        entry.state = 'quarantined';
        this.quarantinedSlots.add(entry.slot);
        this.watchSettlement(
          entry,
          actors,
          () => this.finishOpenFailure(entry, writer, reader, originalError),
        );
      }
      this.emit({
        type: 'runtime-open-failed',
        databaseRef: entry.databaseRef,
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
    const diagnostics = executor.diagnostics();
    const generationKey = `${role}:${entry.slot}`;
    const previousGeneration = this.lastGenerationBySlot.get(generationKey) ?? 0;
    if (diagnostics.slot !== entry.slot
      || !Number.isSafeInteger(diagnostics.generation)
      || diagnostics.generation <= previousGeneration) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor identity was stale or did not match its assigned slot.',
      );
    }
    this.lastGenerationBySlot.set(generationKey, diagnostics.generation);
    return executor;
  }

  private assertBindingResult(
    entry: DatabaseEntry,
    role: DatabaseActorRole,
    result: ReturnType<typeof validateDatabaseActorBindResult>,
  ): void {
    if (result.databaseRef !== entry.databaseRef
      || result.role !== role
      || result.realmFingerprint !== this.realm.fingerprint
      || result.schemaChecksum !== this.realm.schemaChecksum) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database actor binding did not match its assigned realm.',
      );
    }
  }

  private enqueueWriterOperation(
    entry: DatabaseEntry,
    operation: DatabaseOperation,
    options: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    const run = () => this.executeWriterAtHead(
      entry,
      operation,
      options,
      commitAuthority,
    );
    return this.enqueueLane(entry, operationClass(operation), options, run);
  }

  private async executeWriterAtHead(
    entry: DatabaseEntry,
    operation: DatabaseOperation,
    options: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    if (!isWriteOperation(operation) || !commitAuthority) {
      if (isWriteOperation(operation) && this.requireCommitAuthority) {
        throw authorityUnavailable();
      }
      return this.executeOnActor(
        entry,
        this.requireWriter(entry),
        operation,
        options,
      );
    }

    const authorityCoordinator = this.authorityCommitCoordinator;
    if (!authorityCoordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit authority coordinator is unavailable.',
      );
    }
    const authorityLease = await authorityCoordinator.acquireShared({
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: queueTimeout(options, this.queueTimeoutMs),
    });
    let transferred = false;
    try {
      // The binding may have been retired and reopened while this operation
      // waited behind an exclusive authority mutation. Resolve the current
      // generation only after the gate is held.
      const writer = this.requireWriter(entry);
      assertDatabaseCommitAuthorityCurrent(
        commitAuthority,
        authorityCoordinator,
        entry.databaseRef,
      );
      try {
        return await this.executeOnActor(entry, writer, operation, options);
      } catch (error) {
        const normalized = safeCoordinatorError(error);
        if (normalized.outcome === 'unknown'
          && !writer.diagnostics().settled) {
          transferred = true;
          this.holdAuthorityUntilSettlement(authorityLease, writer);
        }
        throw normalized;
      }
    } finally {
      if (!transferred) authorityLease.release();
    }
  }

  private async executeOnActor(
    entry: DatabaseEntry,
    executor: DatabaseExecutor,
    operation: DatabaseOperation,
    options: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    const kind = isWriteOperation(operation) ? 'write' : 'read';
    const startedAt = this.now();
    try {
      const value = await executor.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind,
        payload: {
          databaseRef: entry.databaseRef,
          operation,
        } as unknown as DatabaseExecutorValue,
      }, { timeoutMs: operationTimeout(options, this.operationTimeoutMs) });
      return validateDatabaseActorExecuteResult(
        value,
        operation,
        this.operationCatalog,
      );
    } catch (caught) {
      const error = safeCoordinatorError(caught);
      this.emit({
        type: error.outcome === 'unknown'
          ? 'operation-outcome-unknown'
          : 'operation-failed',
        databaseRef: entry.databaseRef,
        role: executor === entry.writer ? 'writer' : 'reader',
        slot: entry.slot,
        generation: executor.diagnostics().generation,
        operation: operationClass(operation),
        durationMs: elapsed(startedAt, this.now()),
        error,
      });
      if ((kind === 'write' && error.outcome === 'unknown')
        || this.isTerminalExecutorFailure(executor, error)) {
        await this.retireBinding(entry, executor, error);
      }
      throw error;
    }
  }

  private enqueueLane<T>(
    entry: DatabaseEntry,
    operation: 'query' | 'mutation' | 'replay',
    options: DatabaseExecutionOptions,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.trackOperation(entry, () => entry.lane.enqueue(
      execute,
      {
        signal: options.signal,
        timeoutMs: queueTimeout(options, this.queueTimeoutMs),
        operationClass: operation,
      },
    ));
  }

  private async trackOperation<T>(
    entry: DatabaseEntry,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertUsableEntry(entry);
    entry.activeOperations += 1;
    entry.lastUsedAt = this.now();
    try {
      return await operation();
    } finally {
      entry.activeOperations -= 1;
      entry.lastUsedAt = this.now();
      this.cleanupFailedEntryIfUnused(entry);
    }
  }

  private awaitReplacementOpening<T>(
    entry: DatabaseEntry,
    options: DatabaseExecutionOptions,
    operation: 'query' | 'mutation' | 'replay',
    resume: () => Promise<T>,
  ): Promise<T> {
    let timeoutMs: number;
    try {
      timeoutMs = queueTimeout(options, this.queueTimeoutMs);
    } catch (error) {
      return Promise.reject(safeCoordinatorError(error));
    }
    if (options.signal?.aborted) return Promise.reject(queueCancelled());

    if (entry.recoveryWaiters >= this.maxQueuedPerDatabase
      || this.queuedOperations >= this.maxQueuedTotal) {
      this.emit({
        type: 'queue-saturated',
        databaseRef: entry.databaseRef,
        operation,
        queueDepth: entry.recoveryWaiters,
        queueLimit: this.maxQueuedPerDatabase,
      });
      return Promise.reject(new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database recovery queue capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            queueDepth: entry.recoveryWaiters,
            queueLimit: this.maxQueuedPerDatabase,
          },
        },
      ));
    }

    const opening = entry.opening;
    const queuedAt = this.now();
    entry.recoveryWaiters += 1;
    this.queuedOperations += 1;
    entry.lastUsedAt = queuedAt;

    const waiting = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abortListener: (() => void) | null = null;

      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        timer = null;
        if (options.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
        }
        abortListener = null;
        entry.recoveryWaiters = Math.max(0, entry.recoveryWaiters - 1);
        this.queuedOperations = Math.max(0, this.queuedOperations - 1);
        entry.lastUsedAt = this.now();
        this.cleanupFailedEntryIfUnused(entry);
        if (error === undefined) resolve();
        else reject(safeCoordinatorError(error));
      };

      timer = setTimeout(() => {
        const durationMs = elapsed(queuedAt, this.now());
        this.emit({
          type: 'queue-timeout',
          databaseRef: entry.databaseRef,
          operation,
          queueDepth: Math.max(0, entry.recoveryWaiters - 1),
          durationMs,
        });
        finish(new DatabaseError(
          'DATABASE_QUEUE_TIMEOUT',
          'Database operation expired while waiting for binding recovery.',
          {
            retryable: true,
            outcome: 'not-started',
            details: {
              durationMs,
              queueDepth: Math.max(0, entry.recoveryWaiters - 1),
            },
          },
        ));
      }, timeoutMs);
      if (options.signal) {
        abortListener = () => finish(queueCancelled());
        options.signal.addEventListener('abort', abortListener, { once: true });
        // Cover an abort which raced listener registration.
        if (options.signal.aborted) finish(queueCancelled());
      }
      void opening.then(
        () => finish(),
        (error) => finish(error),
      );
    });
    return waiting.then(resume);
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
  ): Promise<void> {
    if (executor !== entry.writer && executor !== entry.reader) return;
    if (entry.recovery) {
      await entry.recovery;
      return;
    }

    const recovery = this.retireBindingOnce(entry, error);
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
  ): Promise<void> {
    entry.failure = safeCoordinatorError(error);
    entry.state = 'failed';
    entry.lane.rejectQueued(this.notReadyError());
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    await this.closeExecutors(actors);

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
      entry.state = 'opening';
      entry.failure = null;
      entry.opening = this.openEntry(entry);
      void entry.opening.catch(() => undefined);
      return;
    }

    entry.state = 'failed';
    this.cleanupFailedEntryIfUnused(entry);
  }

  private requireWriter(entry: DatabaseEntry): DatabaseExecutor {
    if (!entry.writer || entry.state !== 'ready') throw this.notReadyError();
    return entry.writer;
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
    entry.state = 'closing';
    entry.lane.rejectQueued(this.closedError());
    try {
      await entry.opening;
    } catch {
      // The startup path owns its failure classification and actor cleanup.
    }
    if (readEntryState(entry) === 'closed') return;
    await entry.lane.idle();
    const startedAt = this.now();
    const writer = entry.writer;
    const reader = entry.reader;
    const actors = compactExecutors(writer, reader);
    const failures = await this.closeBoundActors(writer, reader);
    if (!actors.every((actor) => actor.diagnostics().settled)) {
      entry.state = 'quarantined';
      this.quarantinedSlots.add(entry.slot);
      this.watchSettlement(
        entry,
        actors,
        () => this.finishEntryClosure(
          entry,
          writer,
          reader,
          reason,
          startedAt,
        ),
      );
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor settlement is incomplete.',
        { retryable: false, outcome: 'unknown' },
      );
    }

    this.finishEntryClosure(entry, writer, reader, reason, startedAt);
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
  ): void {
    if (entry.state === 'closed'
      || entry.writer !== writer
      || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    entry.failure = null;
    entry.state = 'closed';
    this.quarantinedSlots.delete(entry.slot);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    this.releaseSlot(entry.slot);
    this.emit({
      type: 'runtime-closed',
      databaseRef: entry.databaseRef,
      slot: entry.slot,
      durationMs: elapsed(startedAt, this.now()),
      reason,
    });
    if (reason !== 'shutdown') {
      this.emit({
        type: 'runtime-evicted',
        databaseRef: entry.databaseRef,
        slot: entry.slot,
        reason,
      });
    }
  }

  private finishOpenFailure(
    entry: DatabaseEntry,
    writer: DatabaseExecutor | null,
    reader: DatabaseExecutor | null,
    failure: DatabaseError,
  ): void {
    if (entry.writer !== writer || entry.reader !== reader) return;
    entry.writer = null;
    entry.reader = null;
    this.quarantinedSlots.delete(entry.slot);
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    this.releaseSlot(entry.slot);

    if (this.state === 'started'
      && entry.state !== 'closing'
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

    if (failures.length > 0 || this.quarantinedSlots.size > 0) {
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

class CoordinatorLease implements DatabaseCoordinatorLease {
  #active = true;
  readonly #coordinator: DatabaseCoordinator;
  readonly #entry: DatabaseEntry;
  readonly #commitAuthority: DatabaseCommitAuthority | null;

  constructor(
    coordinator: DatabaseCoordinator,
    entry: DatabaseEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ) {
    this.#coordinator = coordinator;
    this.#entry = entry;
    this.#commitAuthority = commitAuthority;
  }

  get databaseRef(): DatabaseRef { return this.#entry.databaseRef; }
  get released(): boolean { return !this.#active; }

  execute(
    operation: unknown,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    this.assertActive();
    return this.#coordinator.execute(
      this.#entry,
      operation,
      options,
      this.#commitAuthority,
    );
  }

  replay(
    afterSeq: number,
    limit?: number,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult> {
    this.assertActive();
    return this.#coordinator.replay(this.#entry, afterSeq, limit, options);
  }

  release(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#coordinator.releaseEntry(this.#entry);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.release();
  }

  private assertActive(): void {
    if (!this.#active) {
      throw new DatabaseError('DATABASE_CLOSED', 'Database capability was released.');
    }
  }
}

interface DatabaseWriterLaneOptions {
  readonly databaseRef: DatabaseRef;
  readonly maxQueued: number;
  readonly now: () => number;
  readonly onQueued: () => boolean;
  readonly onDequeued: () => void;
  readonly observability: DatabaseObservability | null;
}

class DatabaseWriterLane {
  private readonly queue: WriterLaneTask<any>[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private active = false;

  constructor(private readonly options: DatabaseWriterLaneOptions) {}

  get depth(): number { return this.queue.length + (this.active ? 1 : 0); }

  enqueue<T>(
    execute: () => Promise<T>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
      readonly operationClass: 'query' | 'mutation' | 'replay';
    },
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(queueCancelled());
    }
    const willWait = this.active || this.queue.length > 0;
    if (willWait
      && (this.queue.length >= this.options.maxQueued
        || !this.options.onQueued())) {
      this.emit({
        type: 'queue-saturated',
        databaseRef: this.options.databaseRef,
        operation: options.operationClass,
        queueDepth: this.queue.length,
        queueLimit: this.options.maxQueued,
      });
      return Promise.reject(new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database writer queue capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            queueDepth: this.queue.length,
            queueLimit: this.options.maxQueued,
          },
        },
      ));
    }

    const promise = new Promise<T>((resolve, reject) => {
      const task: WriterLaneTask<T> = {
        execute,
        resolve,
        reject,
        queuedAt: this.options.now(),
        timeoutMs: options.timeoutMs,
        operationClass: options.operationClass,
        chargedToGlobalQueue: willWait,
        ...(options.signal ? { signal: options.signal } : {}),
        timer: null,
        abortListener: null,
        settled: false,
      };
      if (willWait) task.timer = setTimeout(() => this.expire(task), options.timeoutMs);
      if (willWait && options.signal) {
        task.abortListener = () => this.cancel(task);
        options.signal.addEventListener('abort', task.abortListener, { once: true });
      }
      this.queue.push(task);
    });
    this.pump();
    return promise;
  }

  rejectQueued(error: DatabaseError): void {
    for (const task of [...this.queue]) this.rejectTask(task, error);
    this.resolveIdleIfNeeded();
  }

  idle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private pump(): void {
    if (this.active) return;
    let task = this.queue.shift();
    while (task?.settled) task = this.queue.shift();
    if (!task) {
      this.resolveIdleIfNeeded();
      return;
    }
    if (task.chargedToGlobalQueue) this.options.onDequeued();
    this.detachWaitHooks(task);
    this.active = true;
    void Promise.resolve().then(task.execute).then(
      (value) => {
        if (!task!.settled) {
          task!.settled = true;
          task!.resolve(value);
        }
      },
      (caught) => {
        if (!task!.settled) {
          task!.settled = true;
          task!.reject(safeCoordinatorError(caught));
        }
      },
    ).finally(() => {
      this.active = false;
      this.pump();
    });
  }

  private expire(task: WriterLaneTask<any>): void {
    if (!this.removeQueued(task)) return;
    const durationMs = elapsed(task.queuedAt, this.options.now());
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(new DatabaseError(
      'DATABASE_QUEUE_TIMEOUT',
      'Database operation expired in the writer queue.',
      {
        retryable: true,
        outcome: 'not-started',
        details: { durationMs, queueDepth: this.queue.length },
      },
    ));
    this.emit({
      type: 'queue-timeout',
      databaseRef: this.options.databaseRef,
      operation: task.operationClass,
      queueDepth: this.queue.length,
      durationMs,
    });
    this.resolveIdleIfNeeded();
  }

  private cancel(task: WriterLaneTask<any>): void {
    if (!this.removeQueued(task)) return;
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(queueCancelled());
    this.resolveIdleIfNeeded();
  }

  private rejectTask(task: WriterLaneTask<any>, error: DatabaseError): void {
    if (!this.removeQueued(task)) return;
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(error);
  }

  private removeQueued(task: WriterLaneTask<any>): boolean {
    if (task.settled) return false;
    const index = this.queue.indexOf(task);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    if (task.chargedToGlobalQueue) this.options.onDequeued();
    return true;
  }

  private detachWaitHooks(task: WriterLaneTask<any>): void {
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    if (task.signal && task.abortListener) {
      task.signal.removeEventListener('abort', task.abortListener);
    }
    task.abortListener = null;
  }

  private resolveIdleIfNeeded(): void {
    if (this.active || this.queue.length > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private emit(event: Parameters<DatabaseObservability['emit']>[0]): void {
    try {
      this.options.observability?.emit(event);
    } catch {
      // Telemetry cannot change queue behavior.
    }
  }
}

class AsyncCatalogGate {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function detachSQLiteConfig(value: DatabaseActorSQLiteConfig): DatabaseActorSQLiteConfig {
  const bufferPool = value.bufferPool && typeof value.bufferPool === 'object'
    ? Object.freeze({ ...value.bufferPool })
    : value.bufferPool;
  return Object.freeze({
    ...value,
    ...(bufferPool === undefined ? {} : { bufferPool }),
  });
}

function isWriteOperation(
  operation: DatabaseOperation,
): operation is DatabaseWriteOperation {
  return operation.type === 'mutate'
    || operation.type === 'batch'
    || operation.type === 'command';
}

function operationClass(
  operation: DatabaseOperation,
): 'query' | 'mutation' {
  return isWriteOperation(operation) ? 'mutation' : 'query';
}

function queueTimeout(
  options: DatabaseExecutionOptions,
  fallback: number,
): number {
  return positiveInteger(options.queueTimeoutMs ?? fallback, 'queueTimeoutMs');
}

function operationTimeout(
  options: DatabaseExecutionOptions,
  fallback: number,
): number {
  return positiveInteger(
    options.operationTimeoutMs ?? fallback,
    'operationTimeoutMs',
  );
}

function queueCancelled(): DatabaseError {
  return new DatabaseError(
    'DATABASE_QUEUE_TIMEOUT',
    'Database operation was cancelled before execution.',
    { retryable: true, outcome: 'not-started' },
  );
}

function authorityUnavailable(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database commit authority is unavailable.',
    { retryable: false, outcome: 'not-started' },
  );
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must be a positive safe integer.`,
    );
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must be a non-negative safe integer.`,
    );
  }
  return value as number;
}

function firstSetValue(values: ReadonlySet<number>): number | null {
  for (const value of values) return value;
  return null;
}

function normalizeCoordinatorDatabaseId(input: string): DatabaseId {
  try {
    return normalizeDatabaseId(input);
  } catch {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database identifier is invalid.',
    );
  }
}

function compactExecutors(
  writer: DatabaseExecutor | null,
  reader: DatabaseExecutor | null,
): DatabaseExecutor[] {
  return [writer, reader].filter(
    (value): value is DatabaseExecutor => value !== null,
  );
}

function readEntryState(entry: DatabaseEntry): DatabaseCoordinatorEntryState {
  return entry.state;
}

function isPermanentOpenFailure(error: DatabaseError): boolean {
  return error.code === 'DATABASE_CONFIG_INVALID'
    || error.code === 'DATABASE_MIGRATION_FAILED'
    || error.code === 'DATABASE_SCHEMA_MISMATCH'
    || error.code === 'DATABASE_PROTOCOL_ERROR'
    || error.code === 'DATABASE_OPERATION_UNSUPPORTED';
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.min(MAX_SWEEP_INTERVAL_MS * 20_160, endedAt - startedAt));
}

const SAFE_COORDINATOR_MESSAGES = Object.freeze({
  DATABASE_CONFIG_INVALID: 'Database configuration is invalid.',
  DATABASE_DISABLED: 'Database support is disabled.',
  DATABASE_NOT_READY: 'Database binding is unavailable.',
  DATABASE_CLOSED: 'Database coordinator is not accepting work.',
  DATABASE_BACKPRESSURE: 'Database capacity is exhausted.',
  DATABASE_QUEUE_TIMEOUT: 'Database operation expired before execution.',
  DATABASE_OPERATION_TIMEOUT: 'Database operation timed out.',
  DATABASE_EXECUTOR_START_FAILED: 'Database executor could not start.',
  DATABASE_EXECUTOR_FAILED: 'Database executor failed.',
  DATABASE_PROTOCOL_ERROR: 'Invalid database executor response.',
  DATABASE_OPEN_FAILED: 'Database could not be opened.',
  DATABASE_MIGRATION_FAILED: 'Database migration failed.',
  DATABASE_SCHEMA_MISMATCH: 'Database schema does not match its realm.',
  DATABASE_AUTHORITY_CHANGED: 'Database authority changed.',
  DATABASE_CONFLICT: 'Database operation conflicts with current state.',
  DATABASE_HISTORY_GAP: 'Database change history is unavailable.',
  DATABASE_PAYLOAD_INVALID: 'Database operation payload is invalid.',
  DATABASE_PAYLOAD_LIMIT: 'Database operation payload exceeds its limit.',
  DATABASE_RESULT_LIMIT: 'Database operation result exceeds its limit.',
  DATABASE_OPERATION_UNSUPPORTED: 'Database operation is unsupported.',
  DATABASE_TRANSACTION_EXPIRED: 'Database transaction expired.',
  DATABASE_TRANSACTION_STALE: 'Database snapshot is behind the required sequence.',
  DATABASE_OUTCOME_UNKNOWN: 'Database operation outcome is unknown.',
} satisfies Record<DatabaseErrorCode, string>);

const SAFE_COORDINATOR_DETAIL_KEYS = new Set([
  'activeOperations',
  'durationMs',
  'generation',
  'maxDatabases',
  'maxInFlight',
  'queueDepth',
  'queueLimit',
  'slot',
]);

/**
 * Strip executor causes, arbitrary messages, and unrecognized detail strings
 * before a failure crosses the coordinator capability boundary.
 */
function safeCoordinatorError(value: unknown): DatabaseError {
  const source = normalizeDatabaseError(value);
  const details: Record<string, number | boolean | null> = {};
  for (const [key, detail] of Object.entries(source.details)) {
    if (!SAFE_COORDINATOR_DETAIL_KEYS.has(key)
      || (typeof detail !== 'number'
        && typeof detail !== 'boolean'
        && detail !== null)) continue;
    details[key] = detail;
  }
  return new DatabaseError(
    source.code,
    SAFE_COORDINATOR_MESSAGES[source.code],
    {
      retryable: source.retryable,
      outcome: source.outcome,
      details: details as DatabaseErrorDetails,
    },
  );
}
