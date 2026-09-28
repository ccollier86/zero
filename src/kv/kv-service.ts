/**
 * kv-service.ts
 *
 * Provides the app-facing KV/cache service over the hot memory engine and
 * durable journal/checkpoint primitives. This file owns KV service lifecycle
 * and write ordering only; it does not register Elysia plugins or decide
 * app-factory storage composition.
 */

import { KvCheckpointStore } from './kv-checkpoint';
import { systemKvClock } from './kv-clock';
import { KvError } from './kv-errors';
import { KvFileJournal, type KvJournalDurability } from './kv-journal';
import { KvCounterService } from './kv-counter-service';
import { KvLimiterService } from './kv-limiter-service';
import { KvMemoryEngine } from './kv-memory-engine';
import { applyKvMutation, type KvMutation } from './kv-mutation';
import { KvNamespace } from './kv-namespace';
import { recoverKvMemoryEngine, type KvRecoveryCorruptRecordPolicy } from './kv-recovery';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type {
  KvClock,
  KvCompareAndSetResult,
  KvMemoryEngineOptions,
  KvSetOptions,
  ZeroKvEntry,
} from './kv-types';

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
}

/** Runtime status returned by `KvService.status()`. */
export interface KvServiceStatus {
  started: boolean;
  sequence: number;
  entries: number;
  approximateBytes: number;
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
  private fsyncTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointPromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;

  /** Create a KV/cache service with memory, journal, and checkpoint stores. */
  constructor(config: KvServiceConfig = {}) {
    this.clock = config.clock ?? systemKvClock;
    this.memoryOnly = config.durability === 'memory';
    this.defaultTtlMs = config.memory?.defaultTtlMs;
    this.fsyncMs = normalizeInterval(config.fsyncMs ?? 1000, 'fsyncMs');
    this.checkpointIntervalMs = normalizeInterval(config.checkpointIntervalMs ?? 30_000, 'checkpointIntervalMs');
    this.corruptRecordPolicy = config.corruptRecordPolicy ?? 'fail';
    this.engine = config.engine ?? new KvMemoryEngine({ ...config.memory, clock: this.clock });
    this.journal = config.journal ?? new KvFileJournal({
      baseDir: config.baseDir,
      clock: this.clock,
      durability: config.durability,
    });
    this.checkpointStore = config.checkpoint ?? new KvCheckpointStore({
      baseDir: config.baseDir,
      clock: this.clock,
    });
    this.counters = new KvCounterService(this);
    this.limiter = new KvLimiterService(this, this.clock);
  }

  /** Recover the memory engine and start background flush/checkpoint loops. */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    const starting = this.startInternal();
    this.startPromise = starting;
    try {
      await starting;
    } finally {
      if (this.startPromise === starting) this.startPromise = null;
    }
  }

  /** Flush the journal and write a final checkpoint. */
  async stop(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // Failed recovery owns no timers and leaves started false.
      }
    }
    if (!this.started) return;
    this.stopTimers();
    try {
      if (this.shouldPersistOnStop()) {
        await this.flush();
        await this.checkpoint();
      }
    } finally {
      // A failed final persistence attempt must still leave this instance in
      // a terminal state. The failure is propagated to the caller, while a
      // later stop remains idempotent and cannot race filesystem teardown.
      this.started = false;
    }
  }

  /** Return a value when the key exists and has not expired. */
  get<T = unknown>(key: string): T | undefined {
    return this.engine.get<T>(key);
  }

  /** Return a cloned entry when the key exists and has not expired. */
  getEntry<T = unknown>(key: string): ZeroKvEntry<T> | null {
    return this.engine.getEntry<T>(key);
  }

  /** Return true when the key exists and has not expired. */
  has(key: string): boolean {
    return this.engine.has(key);
  }

  /** Persist a set mutation, then apply it to the memory engine. */
  async set<T = unknown>(key: string, value: T, options: KvSetOptions = {}): Promise<ZeroKvEntry<T>> {
    const record = await this.appendAndApply({
      op: 'set',
      key,
      value,
      kind: options.kind,
      expiresAt: this.resolveExpiresAt(options.ttlMs, null),
    });
    const entry = this.engine.getEntry<T>(key);
    if (!entry) {
      throw new KvError('KV_RECOVERY_FAILED', 'KV set mutation did not produce an entry.', {
        key,
        sequence: record.sequence,
      });
    }
    return entry;
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
    return this.engine.getMany<T>(keys);
  }

  /** Persist a delete mutation and return whether the key existed. */
  async delete(key: string): Promise<boolean> {
    const existed = this.engine.has(key);
    await this.appendAndApply({ op: 'delete', key });
    return existed;
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
  async expire(key: string, ttlMs: number): Promise<boolean> {
    if (!this.engine.has(key)) return false;
    await this.appendAndApply({
      op: 'expire',
      key,
      expiresAt: this.resolveRequiredExpiresAt(ttlMs),
    });
    return true;
  }

  /** Persist a mutation that removes expiry from an existing key. */
  async persist(key: string): Promise<boolean> {
    if (!this.engine.has(key)) return false;
    await this.appendAndApply({ op: 'expire', key, expiresAt: null });
    return true;
  }

  /** Replace a key only when the current version matches. */
  async compareAndSet<T = unknown>(
    key: string,
    expectedVersion: number | null,
    value: T,
    options: KvSetOptions = {}
  ): Promise<KvCompareAndSetResult<T>> {
    const current = this.engine.getEntry<T>(key);
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

    const next = await this.set(key, value, options);
    return {
      ok: true,
      value: next.value,
      current: currentValue,
      version: next.version,
    };
  }

  /** Return an existing value or compute, persist, and return a new one. */
  async getOrSet<T>(key: string, loader: () => T | Promise<T>, options: KvSetOptions = {}): Promise<T> {
    const existing = this.get<T>(key);
    if (existing !== undefined) return existing;

    const value = await loader();
    await this.set(key, value, options);
    return value;
  }

  /** Increment a numeric counter and persist the mutation. */
  async increment(key: string, delta = 1, options: { ttlMs?: number | null } = {}): Promise<number> {
    const record = await this.appendAndApply({
      op: 'increment',
      key,
      delta,
      expiresAt: options.ttlMs === undefined ? undefined : this.resolveExpiresAt(options.ttlMs, null),
    });
    const value = this.engine.get<number>(key);
    if (typeof value !== 'number') {
      throw new KvError('KV_COUNTER_TYPE_MISMATCH', 'KV increment mutation did not produce a numeric value.', {
        key,
        sequence: record.sequence,
      });
    }
    return value;
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
  async checkpoint(): Promise<void> {
    if (this.memoryOnly) return;
    if (this.checkpointPromise) {
      await this.checkpointPromise;
      return;
    }

    this.checkpointPromise = this.checkpointStore
      .write(this.engine.entries(), this.journal.currentSequence())
      .then(() => undefined)
      .finally(() => {
        this.checkpointPromise = null;
      });
    await this.checkpointPromise;
  }

  /** Return service status for tests, diagnostics, and future doctor checks. */
  status(): KvServiceStatus {
    const stats = this.engine.stats();
    return {
      started: this.started,
      sequence: this.journal.currentSequence(),
      entries: stats.entries,
      approximateBytes: stats.approximateBytes,
    };
  }

  private async appendAndApply(mutation: KvMutation) {
    const record = await this.journal.append(mutation);
    applyKvMutation(this.engine, record.mutation, {
      sequence: record.sequence,
      timestamp: record.timestamp,
    });
    return record;
  }

  private async startInternal(): Promise<void> {
    if (!this.memoryOnly) {
      await recoverKvMemoryEngine({
        engine: this.engine,
        checkpoint: this.checkpointStore,
        journal: this.journal,
        corruptRecordPolicy: this.corruptRecordPolicy,
      });
    }
    this.started = true;
    if (!this.memoryOnly) this.startTimers();
  }

  private resolveExpiresAt(ttlMs: number | null | undefined, fallback: number | null): number | null | undefined {
    if (ttlMs === undefined) {
      if (typeof this.defaultTtlMs === 'number') return this.clock.now() + this.defaultTtlMs;
      if (this.defaultTtlMs === null) return null;
      return fallback;
    }
    if (ttlMs === null) return null;
    return this.resolveRequiredExpiresAt(ttlMs);
  }

  private resolveRequiredExpiresAt(ttlMs: number): number {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new KvError('KV_TTL_INVALID', 'KV ttlMs must be a finite positive number or zero.', { ttlMs });
    }
    return this.clock.now() + ttlMs;
  }

  private startTimers(): void {
    this.stopTimers();
    this.fsyncTimer = setInterval(() => {
      this.runBackgroundPersistence('flush', () => this.flush());
    }, this.fsyncMs);
    this.checkpointTimer = setInterval(() => {
      this.runBackgroundPersistence('checkpoint', () => this.checkpoint());
    }, this.checkpointIntervalMs);
    this.fsyncTimer.unref?.();
    this.checkpointTimer.unref?.();
  }

  private stopTimers(): void {
    if (this.fsyncTimer) clearInterval(this.fsyncTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    this.fsyncTimer = null;
    this.checkpointTimer = null;
  }

  private shouldPersistOnStop(): boolean {
    return !this.memoryOnly && (this.journal.currentSequence() > 0 || this.engine.stats().entries > 0);
  }

  private runBackgroundPersistence(
    operation: 'flush' | 'checkpoint',
    persist: () => Promise<void>,
  ): void {
    void persist().catch((error) => {
      emitPlatformCode(OBS_CODES.KV_BACKGROUND_PERSIST_FAILED, {
        error,
        metadata: { operation },
      });
    });
  }
}

function normalizeInterval(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KvError('KV_LIMIT_INVALID', `KV ${label} must be a positive integer.`, { value });
  }
  return value;
}
