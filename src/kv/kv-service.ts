/**
 * kv-service.ts
 *
 * Provides the app-facing KV/cache service over the hot memory engine and
 * durable journal/checkpoint primitives. This file owns KV service lifecycle
 * and write ordering only; it does not register Elysia plugins or decide
 * app-factory storage composition.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { KvCheckpointStore } from './kv-checkpoint';
import {
  KV_ATOMIC_SET,
  type KvAtomicSetContext,
  type KvAtomicSetDecision,
} from './kv-atomic-update';
import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import { KvFileJournal, type KvJournalDurability } from './kv-journal';
import { KvCounterService } from './kv-counter-service';
import { KvLimiterService } from './kv-limiter-service';
import { KvMemoryEngine } from './kv-memory-engine';
import {
  applyKvMutationWithResult,
  KV_CHECKPOINT_PRUNE_KEY,
  type KvMutation,
} from './kv-mutation';
import { KvNamespace } from './kv-namespace';
import { KvOperationQueue } from './kv-operation-queue';
import { recoverKvMemoryEngine, type KvRecoveryCorruptRecordPolicy } from './kv-recovery';
import { KvSequencedOperationQueue } from './kv-sequenced-operation-queue';
import { assertKvKind, snapshotKvValue } from './kv-value';
import type {
  KvClock,
  KvCompareAndSetResult,
  KvMemoryEngineOptions,
  KvSetOptions,
  ZeroKvEntry,
} from './kv-types';

/** App-bound observability emitter used by KV lifecycle and persistence work. */
export type KvPlatformCodeEmitter = typeof emitPlatformCode;

/** Configures the platform KV/cache service. */
export interface KvServiceConfig {
  /** Base directory for journal and checkpoint files. Default: ./data/kv. */
  baseDir?: string;
  /** Journal durability policy. Default: everysec. */
  durability?: KvJournalDurability;
  /** Periodic journal fsync interval in milliseconds. Default: 1000. */
  fsyncMs?: number;
  /** Periodic checkpoint interval in milliseconds. Default: 30000. */
  checkpointIntervalMs?: number;
  /** Recovery policy for corrupt journal records. Default: fail. */
  corruptRecordPolicy?: KvRecoveryCorruptRecordPolicy;
  /** Clock used by the memory engine and persistence metadata. */
  clock?: KvClock;
  /** Optional prebuilt engine, mainly for tests. */
  engine?: KvMemoryEngine;
  /** Optional prebuilt journal, mainly for tests. */
  journal?: KvFileJournal;
  /** Optional prebuilt checkpoint store, mainly for tests. */
  checkpoint?: KvCheckpointStore;
  /** Memory-engine options. */
  memory?: Omit<KvMemoryEngineOptions, 'clock'>;
  /** Optional app-bound event emitter. Managed app composition supplies this automatically. */
  emitCode?: KvPlatformCodeEmitter;
}

/** Runtime status returned by `KvService.status()`. */
export interface KvServiceStatus {
  started: boolean;
  sequence: number;
  entries: number;
  approximateBytes: number;
}

interface AppliedKvMutation {
  sequence: number;
  result: unknown;
}

/** App-facing durable KV/cache service. */
export class KvService {
  readonly engine: KvMemoryEngine;
  readonly journal: KvFileJournal;
  readonly checkpointStore: KvCheckpointStore;
  readonly counters: KvCounterService;
  readonly limiter: KvLimiterService;

  private readonly clock: KvClock;
  private readonly fsyncMs: number;
  private readonly checkpointIntervalMs: number;
  private readonly corruptRecordPolicy: KvRecoveryCorruptRecordPolicy;
  private readonly defaultTtlMs: number | null | undefined;
  private readonly memoryOnly: boolean;
  private readonly emitCode: KvPlatformCodeEmitter;
  private readonly mutationOperations = new KvOperationQueue();
  private readonly evictionMutationOperations = new KvOperationQueue();
  private readonly commitOperations: KvSequencedOperationQueue;
  private readonly admittedMutations = new Set<Promise<void>>();
  private fsyncTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointPromise: Promise<void> | null = null;
  private backgroundFlushPromise: Promise<void> | null = null;
  private backgroundCheckpointPromise: Promise<void> | null = null;
  private startingPromise: Promise<void> | null = null;
  private stoppingPromise: Promise<void> | null = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private lifecycleIntent: 'started' | 'stopped' = 'stopped';
  private started = false;

  /** Create a KV/cache service with memory, journal, and checkpoint stores. */
  constructor(config: KvServiceConfig = {}) {
    this.clock = config.clock ?? systemKvClock;
    this.memoryOnly = config.durability === 'memory';
    this.emitCode = config.emitCode ?? emitPlatformCode;
    const evictionRecency = config.memory?.evictionRecency
      ?? (this.memoryOnly ? 'access' : 'mutation');
    if (!this.memoryOnly && evictionRecency === 'access') {
      throw new KvError(
        'KV_LIMIT_INVALID',
        'Durable KV requires mutation-based eviction recency so journal recovery is deterministic.'
      );
    }
    this.defaultTtlMs = config.memory?.defaultTtlMs;
    this.fsyncMs = normalizeInterval(config.fsyncMs ?? 1000, 'fsyncMs');
    this.checkpointIntervalMs = normalizeInterval(config.checkpointIntervalMs ?? 30_000, 'checkpointIntervalMs');
    this.corruptRecordPolicy = config.corruptRecordPolicy ?? 'fail';
    this.engine = config.engine ?? new KvMemoryEngine({
      ...config.memory,
      clock: this.clock,
      evictionRecency,
    });
    // Synchronous reads cannot durably record access order without turning the
    // hot lookup path into write IO. Durable services therefore evict by the
    // deterministic mutation order that their journal can reproduce. Pure
    // memory services retain access-based LRU behavior.
    this.engine.setReadRecencyAffectsEviction(evictionRecency === 'access');
    // Service reads stay non-destructive while a WAL-backed mutation may be
    // carrying an earlier TTL decision. KvService prunes only at idle points.
    this.engine.setReadPrunesExpired(false);
    this.journal = config.journal ?? new KvFileJournal({
      baseDir: config.baseDir,
      clock: this.clock,
      durability: config.durability,
    });
    this.checkpointStore = config.checkpoint ?? new KvCheckpointStore({
      baseDir: config.baseDir,
      clock: this.clock,
    });
    this.commitOperations = new KvSequencedOperationQueue(this.journal.currentSequence());
    this.counters = new KvCounterService(this);
    this.limiter = new KvLimiterService(this, this.clock);
  }

  /** Recover the memory engine and start background flush/checkpoint loops. */
  start(): Promise<void> {
    if (this.lifecycleIntent === 'started') {
      if (this.startingPromise) return this.startingPromise;
      if (this.started) return Promise.resolve();
    }

    this.lifecycleIntent = 'started';
    const operation = this.enqueueLifecycle(() => this.performStart());
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (this.startingPromise === tracked) this.startingPromise = null;
    });
    this.startingPromise = tracked;
    return tracked;
  }

  private async performStart(): Promise<void> {
    if (this.started) return;
    try {
      if (!this.memoryOnly) {
        const recovery = await recoverKvMemoryEngine({
          engine: this.engine,
          checkpoint: this.checkpointStore,
          journal: this.journal,
          corruptRecordPolicy: this.corruptRecordPolicy,
        });
        if (recovery.recoveredTailRecords > 0) {
          this.emitCode(OBS_CODES.KV_JOURNAL_TAIL_RECOVERED, {
            metadata: { recoveredTailRecords: recovery.recoveredTailRecords },
          });
        }
        if (
          recovery.legacySequenceDiscontinuities > 0
          || recovery.legacyUndefinedValuesDropped > 0
        ) {
          this.emitCode(OBS_CODES.KV_LEGACY_PERSISTENCE_MIGRATED, {
            metadata: {
              legacySequenceDiscontinuities: recovery.legacySequenceDiscontinuities,
              legacyUndefinedValuesDropped: recovery.legacyUndefinedValuesDropped,
            },
          });
        }
        const corruptRecordsSkipped = Math.max(
          0,
          recovery.skippedRecords - recovery.recoveredTailRecords
        );
        if (corruptRecordsSkipped > 0 || recovery.skippedSequences > 0) {
          this.emitCode(OBS_CODES.KV_RECOVERY_RECORDS_SKIPPED, {
            metadata: {
              skippedRecords: corruptRecordsSkipped,
              skippedSequences: recovery.skippedSequences,
            },
          });
        }
      }
    } catch (error) {
      this.engine.clear();
      throw error;
    }
    this.commitOperations.reset(this.journal.currentSequence());
    this.started = true;
    if (!this.memoryOnly) this.startTimers();
  }

  /** Flush the journal and write a final checkpoint. */
  stop(): Promise<void> {
    if (this.lifecycleIntent === 'stopped') {
      if (this.stoppingPromise) return this.stoppingPromise;
      if (!this.started && !this.startingPromise) return Promise.resolve();
    }

    this.lifecycleIntent = 'stopped';
    this.stopTimers();
    const operation = this.enqueueLifecycle(() => this.performStop());
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (this.stoppingPromise === tracked) this.stoppingPromise = null;
    });
    this.stoppingPromise = tracked;
    return tracked;
  }

  /** Return a value when the key exists and has not expired. */
  get<T = unknown>(key: string): T | undefined {
    this.assertReadable();
    const value = this.engine.get<T>(key);
    this.pruneExpiredIfIdle();
    return value;
  }

  /** Return a cloned entry when the key exists and has not expired. */
  getEntry<T = unknown>(key: string): ZeroKvEntry<T> | null {
    this.assertReadable();
    const entry = this.engine.getEntry<T>(key);
    this.pruneExpiredIfIdle();
    return entry;
  }

  /** Return true when the key exists and has not expired. */
  has(key: string): boolean {
    this.assertReadable();
    const exists = this.engine.has(key);
    this.pruneExpiredIfIdle();
    return exists;
  }

  /** Persist a set mutation, then apply it to the memory engine. */
  set<T = unknown>(key: string, value: T, options: KvSetOptions = {}): Promise<ZeroKvEntry<T>> {
    let preparedValue: T;
    try {
      assertKvKind(options.kind);
      preparedValue = snapshotKvValue(value);
    } catch (error) {
      return Promise.reject(error);
    }
    const kind = options.kind;
    const ttlMs = options.ttlMs;
    return this.runKeyMutation(key, async (evaluatedAt) => {
      const applied = await this.appendAndApply({
        op: 'set',
        key,
        value: preparedValue,
        kind,
        expiresAt: this.resolveExpiresAt(ttlMs, null, evaluatedAt),
      }, evaluatedAt);
      const entry = applied.result as ZeroKvEntry<T> | null;
      if (!entry || typeof entry.version !== 'number') {
        throw new KvError('KV_RECOVERY_FAILED', 'KV set mutation did not produce an entry.', {
          key,
          sequence: applied.sequence,
        });
      }
      return entry;
    });
  }

  /** Persist many set mutations. */
  async setMany(entries: Iterable<readonly [string, unknown]>, options: KvSetOptions = {}): Promise<ZeroKvEntry[]> {
    const result: ZeroKvEntry[] = [];
    for (const [key, value] of entries) {
      result.push(await this.set(key, value, options));
    }
    return result;
  }

  /** Return a map of requested keys to existing values. */
  getMany<T = unknown>(keys: Iterable<string>): Map<string, T> {
    this.assertReadable();
    const values = this.engine.getMany<T>(keys);
    this.pruneExpiredIfIdle();
    return values;
  }

  /** Persist a delete mutation and return whether the key existed. */
  delete(key: string): Promise<boolean> {
    return this.runKeyMutation(key, async (evaluatedAt) => {
      const applied = await this.appendAndApply({ op: 'delete', key }, evaluatedAt);
      return applied.result === true;
    });
  }

  /** Persist many delete mutations and return the number removed. */
  async deleteMany(keys: Iterable<string>): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (await this.delete(key)) removed += 1;
    }
    return removed;
  }

  /** Persist an expiry mutation for an existing key. */
  expire(key: string, ttlMs: number): Promise<boolean> {
    return this.runKeyMutation(key, async (evaluatedAt) => {
      if (!this.engine.getEntryAt(key, evaluatedAt)) return false;
      const applied = await this.appendAndApply({
        op: 'expire',
        key,
        expiresAt: this.resolveRequiredExpiresAt(ttlMs, evaluatedAt),
      }, evaluatedAt);
      return applied.result === true;
    });
  }

  /** Persist a mutation that removes expiry from an existing key. */
  persist(key: string): Promise<boolean> {
    return this.runKeyMutation(key, async (evaluatedAt) => {
      if (!this.engine.getEntryAt(key, evaluatedAt)) return false;
      const applied = await this.appendAndApply(
        { op: 'expire', key, expiresAt: null },
        evaluatedAt
      );
      return applied.result === true;
    });
  }

  /** Replace a key only when the current version matches. */
  compareAndSet<T = unknown>(
    key: string,
    expectedVersion: number | null,
    value: T,
    options: KvSetOptions = {}
  ): Promise<KvCompareAndSetResult<T>> {
    const kind = options.kind;
    const ttlMs = options.ttlMs;
    return this.runKeyMutation(key, async (evaluatedAt) => {
      const current = this.engine.getEntryAt<T>(key, evaluatedAt);
      const currentVersion = current?.version ?? null;
      const currentValue = current?.value ?? null;
      if (currentVersion !== expectedVersion) {
        return {
          ok: false,
          value: currentValue,
          current: currentValue,
          version: currentVersion,
        };
      }

      assertKvKind(kind);
      const preparedValue = snapshotKvValue(value);

      const applied = await this.appendAndApply({
        op: 'set',
        key,
        value: preparedValue,
        kind,
        expiresAt: this.resolveExpiresAt(ttlMs, null, evaluatedAt),
      }, evaluatedAt);
      const next = applied.result as ZeroKvEntry<T>;
      return {
        ok: true,
        value: next.value,
        current: currentValue,
        version: next.version,
      };
    });
  }

  /** Return an existing value or compute, persist, and return a new one. */
  getOrSet<T>(key: string, loader: () => T | Promise<T>, options: KvSetOptions = {}): Promise<T> {
    if (this.stoppingPromise) return this.rejectStoppingMutation(key);
    if (!this.started) return this.rejectUnavailableMutation(key);
    const kind = options.kind;
    const ttlMs = options.ttlMs;
    const existing = this.get<T>(key);
    if (existing !== undefined) return Promise.resolve(existing);

    const operation = Promise.resolve()
      .then(loader)
      .then((value) => this.runAdmittedKeyMutation(key, async (evaluatedAt) => {
        const concurrent = this.engine.getEntryAt<T>(key, evaluatedAt);
        if (concurrent) return concurrent.value;
        assertKvKind(kind);
        const preparedValue = snapshotKvValue(value);
        const applied = await this.appendAndApply({
          op: 'set',
          key,
          value: preparedValue,
          kind,
          expiresAt: this.resolveExpiresAt(ttlMs, null, evaluatedAt),
        }, evaluatedAt);
        return (applied.result as ZeroKvEntry<T>).value;
      }));
    return this.trackAdmittedMutation(operation);
  }

  /** Increment a numeric counter and persist the mutation. */
  increment(key: string, delta = 1, options: { ttlMs?: number | null } = {}): Promise<number> {
    return this.runKeyMutation(key, async (evaluatedAt) => {
      if (!Number.isFinite(delta)) {
        throw new KvError('KV_VALUE_INVALID', 'KV increment mutation delta must be finite.', { key, delta });
      }
      const current = this.engine.getEntryAt<number>(key, evaluatedAt);
      if (current && typeof current.value !== 'number') {
        throw new KvError('KV_COUNTER_TYPE_MISMATCH', `KV key "${key}" does not hold a numeric counter.`, {
          key,
          kind: current.kind,
        });
      }
      const nextValue = (current?.value ?? 0) + delta;
      if (!Number.isFinite(nextValue)) {
        throw new KvError('KV_VALUE_INVALID', 'KV counter result must be a finite number.', {
          key,
          delta,
        });
      }

      const expiresAt = options.ttlMs === undefined
        ? current?.expiresAt ?? this.resolveExpiresAt(undefined, null, evaluatedAt)
        : this.resolveExpiresAt(options.ttlMs, null, evaluatedAt);
      const applied = await this.appendAndApply({
        op: 'increment',
        key,
        delta,
        result: nextValue,
        expiresAt,
      }, evaluatedAt);
      if (typeof applied.result !== 'number') {
        throw new KvError('KV_COUNTER_TYPE_MISMATCH', 'KV increment mutation did not produce a numeric value.', {
          key,
          sequence: applied.sequence,
        });
      }
      return applied.result;
    });
  }

  /** Decrement a numeric counter and persist the mutation. */
  async decrement(key: string, delta = 1, options: { ttlMs?: number | null } = {}): Promise<number> {
    return this.increment(key, -delta, options);
  }

  /** Create a key-prefix namespace wrapper over this service. */
  namespace(prefix: string): KvNamespace {
    return new KvNamespace(this, prefix);
  }

  /** Flush the journal according to its durability policy. */
  async flush(): Promise<void> {
    await this.journal.flush();
  }

  /** Write a checkpoint covering all currently live entries. */
  checkpoint(): Promise<void> {
    if (this.stoppingPromise) {
      return Promise.reject(new KvError(
        'KV_SERVICE_STOPPING',
        'KV checkpoints are closed while the service is stopping.'
      ));
    }
    if (!this.started && this.startingPromise) {
      return this.startingPromise.then(() => this.checkpoint());
    }
    if (!this.started) {
      return Promise.reject(new KvError(
        'KV_SERVICE_NOT_RUNNING',
        'KV checkpoints require a running service. Await start() before checkpointing.'
      ));
    }
    return this.runCheckpoint();
  }

  private runCheckpoint(): Promise<void> {
    if (this.memoryOnly) return Promise.resolve();
    if (this.checkpointPromise) return this.checkpointPromise;

    const operation = Promise.resolve().then(async () => {
      await this.mutationOperations.drain();
      await this.commitOperations.drain();
      const checkpointAt = this.clock.now();
      // Cleanup is itself journaled before changing memory. The checkpoint can
      // then fail at any filesystem stage without making live state disagree
      // with WAL recovery, and default unbounded services do not retain expired
      // keys forever across periodic snapshots.
      if (this.engine.expiredEntryCountAt(checkpointAt) > 0) {
        await this.appendAndApply(
          {
            op: 'delete',
            key: KV_CHECKPOINT_PRUNE_KEY,
            maintenance: 'prune',
            pruneAt: checkpointAt,
          },
          checkpointAt
        );
      }
      const entries = this.engine.entries({ pruneExpired: false });
      const sequence = this.commitOperations.completedSequence();
      if (sequence !== this.journal.currentSequence()) {
        throw new KvError('KV_RECOVERY_FAILED', 'KV checkpoint cannot cover unapplied journal mutations.', {
          appliedSequence: sequence,
          journalSequence: this.journal.currentSequence(),
        });
      }
      await this.checkpointStore.write(entries, sequence, checkpointAt);
    });

    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (this.checkpointPromise === tracked) this.checkpointPromise = null;
    });
    this.checkpointPromise = tracked;
    return tracked;
  }

  /** Return service status for tests, diagnostics, and future doctor checks. */
  status(): KvServiceStatus {
    this.pruneExpiredIfIdle();
    const stats = this.engine.stats({ pruneExpired: false });
    return {
      started: this.started,
      sequence: this.journal.currentSequence(),
      entries: stats.entries,
      approximateBytes: stats.approximateBytes,
    };
  }

  /** @internal Compound helpers use this symbol to share normal mutation ordering. */
  [KV_ATOMIC_SET]<TState, TResult>(
    key: string,
    update: (
      current: TState | undefined,
      context: KvAtomicSetContext
    ) => KvAtomicSetDecision<TState, TResult>
  ): Promise<TResult> {
    return this.runKeyMutation(key, async (evaluatedAt) => {
      const current = this.engine.getEntryAt<TState>(key, evaluatedAt)?.value;
      const decision = update(current, {
        evaluatedAt,
        get: <T = unknown>(otherKey: string) =>
          this.engine.getEntryAt<T>(otherKey, evaluatedAt)?.value,
      });
      const options = decision.options ?? {};
      await this.appendAndApply({
        op: 'set',
        key,
        value: decision.value,
        kind: options.kind,
        expiresAt: decision.expiresAt === undefined
          ? this.resolveExpiresAt(options.ttlMs, null, evaluatedAt)
          : decision.expiresAt,
      }, evaluatedAt);
      return decision.result;
    });
  }

  private async appendAndApply(
    mutation: KvMutation,
    evaluatedAt: number
  ): Promise<AppliedKvMutation> {
    const commitFailure = this.commitOperations.failure();
    if (commitFailure !== null) {
      throw new KvError('KV_RECOVERY_FAILED', 'KV mutations are unavailable after an apply failure.', {
        cause: commitFailure instanceof Error ? commitFailure.message : String(commitFailure),
      });
    }
    const preparedMutation = this.markImmediateExpiry(mutation, evaluatedAt);
    const releaseCapacity = this.reserveMutationCapacity(preparedMutation, evaluatedAt);
    try {
      const record = await this.journal.append(preparedMutation);
      return this.commitOperations.run(record.sequence, () => {
        const result = applyKvMutationWithResult(this.engine, record.mutation, {
          sequence: record.sequence,
          timestamp: record.timestamp,
        });
        return {
          sequence: record.sequence,
          result,
        };
      });
    } finally {
      releaseCapacity();
    }
  }

  private markImmediateExpiry(mutation: KvMutation, evaluatedAt: number): KvMutation {
    const pruneAt = mutation.pruneAt ?? (
      this.engine.requiresSerializedCapacityMutations() ? evaluatedAt : undefined
    );
    if (
      mutation.op !== 'delete'
      && mutation.expiresAt !== undefined
      && mutation.expiresAt !== null
      && mutation.expiresAt <= evaluatedAt
    ) {
      return { ...mutation, tombstone: true, evaluatedAt, pruneAt };
    }
    return { ...mutation, evaluatedAt, pruneAt };
  }

  private reserveMutationCapacity(mutation: KvMutation, evaluatedAt: number): () => void {
    if (
      (mutation.op === 'set' || mutation.op === 'increment')
      && mutation.tombstone
    ) {
      return () => undefined;
    }
    if (mutation.op === 'set') {
      return this.engine.reserveStoreCapacity(mutation.key, mutation.value, evaluatedAt);
    }
    if (mutation.op !== 'increment') return () => undefined;

    const current = this.engine.getEntryAt<number>(mutation.key, evaluatedAt);
    if (current && typeof current.value !== 'number') {
      throw new KvError('KV_COUNTER_TYPE_MISMATCH', `KV key "${mutation.key}" does not hold a numeric counter.`, {
        key: mutation.key,
        kind: current.kind,
      });
    }
    return this.engine.reserveStoreCapacity(
      mutation.key,
      mutation.result ?? (current?.value ?? 0) + mutation.delta,
      evaluatedAt
    );
  }

  private runKeyMutation<T>(
    key: string,
    operation: (evaluatedAt: number) => T | Promise<T>
  ): Promise<T> {
    if (this.stoppingPromise) return this.rejectStoppingMutation(key);
    if (!this.started) return this.rejectUnavailableMutation(key);

    this.pruneExpiredIfIdle();
    return this.trackAdmittedMutation(this.runAdmittedKeyMutation(key, operation));
  }

  private assertReadable(): void {
    if (this.started || !this.startingPromise) return;
    throw new KvError(
      'KV_SERVICE_NOT_RUNNING',
      'KV reads are unavailable while startup recovery is still running. Await start() before reading.'
    );
  }

  private trackAdmittedMutation<T>(result: Promise<T>): Promise<T> {
    let settled!: Promise<void>;
    const tracked = result.finally(() => {
      this.admittedMutations.delete(settled);
      this.pruneExpiredIfIdle();
    });
    settled = tracked.then(
      () => undefined,
      () => undefined
    );
    this.admittedMutations.add(settled);
    return tracked;
  }

  private pruneExpiredIfIdle(): void {
    if (!this.memoryOnly || !this.started || this.admittedMutations.size > 0) return;
    this.engine.pruneExpired();
  }

  private rejectStoppingMutation<T>(key: string): Promise<T> {
    return Promise.reject(new KvError(
      'KV_SERVICE_STOPPING',
      'KV mutations are closed while the service is stopping.',
      { key }
    ));
  }

  private rejectUnavailableMutation<T>(key: string): Promise<T> {
    return Promise.reject(new KvError(
      'KV_SERVICE_NOT_RUNNING',
      'KV mutations require a running service. Await start() before writing.',
      { key }
    ));
  }

  private runAdmittedKeyMutation<T>(
    key: string,
    operation: (evaluatedAt: number) => T | Promise<T>
  ): Promise<T> {
    const checkpoint = this.checkpointPromise;
    if (checkpoint) {
      return checkpoint.then(
        () => this.runAdmittedKeyMutation(key, operation),
        () => this.runAdmittedKeyMutation(key, operation)
      );
    }
    return this.mutationOperations.run(key, () => {
      const commitFailure = this.commitOperations.failure();
      if (commitFailure !== null) {
        throw new KvError('KV_RECOVERY_FAILED', 'KV mutations are unavailable after an apply failure.', {
          key,
          cause: commitFailure instanceof Error ? commitFailure.message : String(commitFailure),
        });
      }
      const execute = () => operation(this.clock.now());
      if (this.engine.requiresSerializedCapacityMutations()) {
        return this.evictionMutationOperations.run('bounded-capacity', execute);
      }
      return execute();
    });
  }

  private async performStop(): Promise<void> {
    if (!this.started) return;
    // A stop requested during startup may run after performStart creates the
    // timers, so clear them again at the serialized transition boundary.
    this.stopTimers();
    try {
      await this.drainAdmittedMutations();
      await this.drainBackgroundMaintenance();
      const activeCheckpoint = this.checkpointPromise;
      if (activeCheckpoint) await Promise.allSettled([activeCheckpoint]);
      if (!this.memoryOnly) await this.flush();
      if (this.shouldCheckpointOnStop()) {
        await this.runCheckpoint();
      }
    } finally {
      this.started = false;
    }
  }

  private enqueueLifecycle(operation: () => void | Promise<void>): Promise<void> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async drainAdmittedMutations(): Promise<void> {
    while (this.admittedMutations.size > 0) {
      await Promise.all([...this.admittedMutations]);
    }
    await this.mutationOperations.drain();
    await this.commitOperations.drain();
  }

  private async drainBackgroundMaintenance(): Promise<void> {
    const pending = [this.backgroundFlushPromise, this.backgroundCheckpointPromise]
      .filter((operation): operation is Promise<void> => operation !== null);
    if (pending.length > 0) await Promise.allSettled(pending);
  }

  private resolveExpiresAt(
    ttlMs: number | null | undefined,
    fallback: number | null,
    evaluatedAt: number
  ): number | null | undefined {
    if (ttlMs === undefined) {
      if (typeof this.defaultTtlMs === 'number') return evaluatedAt + this.defaultTtlMs;
      if (this.defaultTtlMs === null) return null;
      return fallback;
    }
    if (ttlMs === null) return null;
    return this.resolveRequiredExpiresAt(ttlMs, evaluatedAt);
  }

  private resolveRequiredExpiresAt(ttlMs: number, evaluatedAt: number): number {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new KvError('KV_TTL_INVALID', 'KV ttlMs must be a finite positive number or zero.', { ttlMs });
    }
    return evaluatedAt + ttlMs;
  }

  private startTimers(): void {
    this.stopTimers();
    const fsyncTimer = setInterval(() => {
      this.runBackgroundFlush(fsyncTimer);
    }, this.fsyncMs);
    this.fsyncTimer = fsyncTimer;
    this.fsyncTimer.unref?.();

    const checkpointTimer = setInterval(() => {
      this.runBackgroundCheckpoint(checkpointTimer);
    }, this.checkpointIntervalMs);
    this.checkpointTimer = checkpointTimer;
    this.checkpointTimer.unref?.();
  }

  private runBackgroundFlush(timer: ReturnType<typeof setInterval>): void {
    if (this.backgroundFlushPromise) return;
    const operation = this.flush();
    this.backgroundFlushPromise = operation;
    void operation.then(
      () => {
        if (this.backgroundFlushPromise === operation) this.backgroundFlushPromise = null;
      },
      (error: unknown) => {
        if (this.backgroundFlushPromise === operation) this.backgroundFlushPromise = null;
        if (this.fsyncTimer === timer) {
          clearInterval(timer);
          this.fsyncTimer = null;
        }
        const metadata = {
          trigger: 'interval',
          intervalMs: this.fsyncMs,
          sequence: this.journal.currentSequence(),
        } as const;
        this.emitCode(OBS_CODES.KV_FLUSH_FAILED, {
          error,
          metadata,
        });
        this.emitCode(OBS_CODES.KV_BACKGROUND_PERSIST_FAILED, {
          error,
          metadata: { ...metadata, operation: 'flush' },
        });
      }
    );
  }

  private runBackgroundCheckpoint(timer: ReturnType<typeof setInterval>): void {
    if (this.backgroundCheckpointPromise || this.checkpointPromise) return;
    const operation = this.checkpoint();
    this.backgroundCheckpointPromise = operation;
    void operation.then(
      () => {
        if (this.backgroundCheckpointPromise === operation) this.backgroundCheckpointPromise = null;
      },
      (error: unknown) => {
        if (this.backgroundCheckpointPromise === operation) this.backgroundCheckpointPromise = null;
        const metadata = {
          trigger: 'interval',
          intervalMs: this.checkpointIntervalMs,
          sequence: this.journal.currentSequence(),
        } as const;
        this.emitCode(OBS_CODES.KV_CHECKPOINT_FAILED, {
          error,
          metadata,
        });
        this.emitCode(OBS_CODES.KV_BACKGROUND_PERSIST_FAILED, {
          error,
          metadata: { ...metadata, operation: 'checkpoint' },
        });
      }
    );
  }

  private stopTimers(): void {
    if (this.fsyncTimer) clearInterval(this.fsyncTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    this.fsyncTimer = null;
    this.checkpointTimer = null;
  }

  private shouldCheckpointOnStop(): boolean {
    return !this.memoryOnly
      && (this.journal.currentSequence() > 0 || this.engine.storedEntryCount() > 0);
  }
}

function normalizeInterval(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KvError('KV_LIMIT_INVALID', `KV ${label} must be a positive integer.`, { value });
  }
  return value;
}
