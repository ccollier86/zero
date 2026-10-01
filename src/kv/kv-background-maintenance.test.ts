/**
 * kv-background-maintenance.test.ts
 *
 * Verifies that periodic KV persistence work is single-flight, observable on
 * failure, and able to make progress after a retryable checkpoint failure.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  configureObservability,
  getObservabilityRuntime,
  MemoryEventStore,
  OBS_CODES,
  type PlatformEvent,
} from '../observability';
import {
  KvCheckpointStore,
  KvFileJournal,
  KvService,
  type ZeroKvEntry,
} from './index';

const testRoot = join(process.cwd(), '.zero/kv-background-maintenance-tests');

describe('KvService background maintenance', () => {
  test('keeps periodic flush single-flight and reports one terminal timer failure', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const baseDir = join(testRoot, 'flush-failure');
    const events = new AwaitableEventStore();
    const failure = new Error('Intentional periodic flush failure.');
    const journal = new DelayedRejectOnceFlushJournal({
      baseDir,
      durability: 'everysec',
    }, failure);
    const service = new KvService({
      baseDir,
      durability: 'everysec',
      journal,
      fsyncMs: 1,
      checkpointIntervalMs: 60_000,
    });

    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });
    configureObservability({ console: false, store: events });

    try {
      await service.start();
      await journal.waitForFirstFlush();

      // Several independent timer turns must not enqueue more flushes while the
      // first one is still pending.
      await waitForTimerTurns(4);
      expect(journal.flushCalls).toBe(1);

      journal.rejectFirstFlush();
      const event = await events.waitForCode(OBS_CODES.KV_FLUSH_FAILED.code);

      expect(event.level).toBe('error');
      expect(event.error).toBe(failure);
      expect(event.metadata).toMatchObject({
        trigger: 'interval',
        intervalMs: 1,
        sequence: 0,
      });
      const legacyEvent = await events.waitForCode(
        OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      );
      expect(legacyEvent.error).toBe(failure);
      expect(legacyEvent.metadata).toMatchObject({
        operation: 'flush',
        trigger: 'interval',
      });

      // A journal flush failure is terminal for that journal instance. The
      // periodic timer must be retired instead of repeatedly logging it.
      await waitForTimerTurns(4);
      expect(journal.flushCalls).toBe(1);
      expect(events.query({ code: OBS_CODES.KV_FLUSH_FAILED.code }).count).toBe(1);
      expect(events.query({
        code: OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      }).count).toBe(1);
    } finally {
      journal.rejectFirstFlush();
      await service.stop().catch(() => undefined);
      configureObservability(previousObservability);
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('reports one delayed checkpoint failure, retries, and preserves service progress', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const baseDir = join(testRoot, 'checkpoint-retry');
    const events = new AwaitableEventStore();
    const failure = new Error('Intentional periodic checkpoint failure.');
    const checkpoint = new DelayedRejectOnceCheckpointStore({ baseDir }, failure);
    const service = new KvService({
      baseDir,
      durability: 'everysec',
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 1,
    });

    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });
    configureObservability({ console: false, store: events });

    try {
      await service.start();
      await checkpoint.waitForFirstWrite();

      // checkpoint() is already operation-single-flight. This also forces
      // several timer callbacks to occur before the shared rejection settles,
      // exposing duplicate catch/report handlers.
      await waitForTimerTurns(4);
      expect(checkpoint.writeCalls).toBe(1);

      checkpoint.rejectFirstWrite();
      const event = await events.waitForCode(OBS_CODES.KV_CHECKPOINT_FAILED.code);

      expect(event.level).toBe('error');
      expect(event.error).toBe(failure);
      expect(event.metadata).toMatchObject({
        trigger: 'interval',
        intervalMs: 1,
        sequence: 0,
      });
      const legacyEvent = await events.waitForCode(
        OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      );
      expect(legacyEvent.error).toBe(failure);
      expect(legacyEvent.metadata).toMatchObject({
        operation: 'checkpoint',
        trigger: 'interval',
      });

      await service.set('after-checkpoint-failure', 'ok');
      expect(service.get<string>('after-checkpoint-failure')).toBe('ok');

      await checkpoint.waitForRetry();
      expect(checkpoint.writeCalls).toBeGreaterThanOrEqual(2);
      expect(events.query({ code: OBS_CODES.KV_CHECKPOINT_FAILED.code }).count).toBe(1);
      expect(events.query({
        code: OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      }).count).toBe(1);
    } finally {
      checkpoint.rejectFirstWrite();
      await service.stop().catch(() => undefined);
      configureObservability(previousObservability);
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test('waits for in-flight background maintenance before stop resolves', async () => {
    const baseDir = join(testRoot, 'stop-drain');
    const checkpoint = new DelayedCheckpointStore({ baseDir });
    const service = new KvService({
      baseDir,
      durability: 'everysec',
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 1,
    });

    await rm(baseDir, { recursive: true, force: true });
    await mkdir(baseDir, { recursive: true });

    try {
      await service.start();
      await checkpoint.waitForWrite();

      let stopSettled = false;
      const stopping = service.stop().then(() => {
        stopSettled = true;
      });
      await drainMicrotasks();

      expect(stopSettled).toBe(false);
      checkpoint.releaseWrite();
      await stopping;
      expect(service.status().started).toBe(false);
    } finally {
      checkpoint.releaseWrite();
      await service.stop().catch(() => undefined);
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

class AwaitableEventStore extends MemoryEventStore {
  private readonly waiters = new Map<string, Set<(event: PlatformEvent) => void>>();

  override emit(event: PlatformEvent): void {
    super.emit(event);
    const waiters = this.waiters.get(event.code);
    if (!waiters) return;
    this.waiters.delete(event.code);
    for (const resolve of waiters) resolve(event);
  }

  waitForCode(code: string): Promise<PlatformEvent> {
    const existing = this.query({ code, limit: 1 }).events[0];
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiters = this.waiters.get(code) ?? new Set();
      waiters.add(resolve);
      this.waiters.set(code, waiters);
    });
  }
}

class DelayedRejectOnceFlushJournal extends KvFileJournal {
  flushCalls = 0;
  private readonly entered = deferred<void>();
  private readonly release = deferred<void>();

  constructor(config: ConstructorParameters<typeof KvFileJournal>[0], private readonly failure: Error) {
    super(config);
  }

  waitForFirstFlush(): Promise<void> {
    return this.entered.promise;
  }

  rejectFirstFlush(): void {
    this.release.resolve();
  }

  override async flush(): Promise<void> {
    this.flushCalls += 1;
    if (this.flushCalls === 1) {
      this.entered.resolve();
      await this.release.promise;
      throw this.failure;
    }
    await super.flush();
  }
}

class DelayedRejectOnceCheckpointStore extends KvCheckpointStore {
  writeCalls = 0;
  private readonly entered = deferred<void>();
  private readonly release = deferred<void>();
  private readonly retried = deferred<void>();

  constructor(config: ConstructorParameters<typeof KvCheckpointStore>[0], private readonly failure: Error) {
    super(config);
  }

  waitForFirstWrite(): Promise<void> {
    return this.entered.promise;
  }

  rejectFirstWrite(): void {
    this.release.resolve();
  }

  waitForRetry(): Promise<void> {
    return this.retried.promise;
  }

  override async write(entries: Iterable<ZeroKvEntry>, sequence: number) {
    this.writeCalls += 1;
    const call = this.writeCalls;
    if (call === 1) {
      this.entered.resolve();
      await this.release.promise;
      throw this.failure;
    }

    const result = await super.write(entries, sequence);
    if (call === 2) this.retried.resolve();
    return result;
  }
}

class DelayedCheckpointStore extends KvCheckpointStore {
  private readonly entered = deferred<void>();
  private readonly release = deferred<void>();

  waitForWrite(): Promise<void> {
    return this.entered.promise;
  }

  releaseWrite(): void {
    this.release.resolve();
  }

  override async write(entries: Iterable<ZeroKvEntry>, sequence: number) {
    this.entered.resolve();
    await this.release.promise;
    return super.write(entries, sequence);
  }
}

/** Wait for a fixed number of event-loop timer turns, not a wall-clock deadline. */
function waitForTimerTurns(turns: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = turns;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) return;
      clearInterval(timer);
      resolve();
    }, 1);
  });
}

async function drainMicrotasks(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}
