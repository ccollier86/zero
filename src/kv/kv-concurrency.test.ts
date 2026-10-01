/**
 * kv-concurrency.test.ts
 *
 * Verifies that service-level KV mutations are linearizable per key while
 * unrelated keys remain independent. The controllable journals deliberately
 * suspend appends so these tests exercise overlap deterministically instead of
 * relying on filesystem or promise scheduling accidents.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  applyKvMutation,
  KvCheckpointStore,
  KvError,
  KvFileJournal,
  KvMemoryEngine,
  KvService,
  ManualKvClock,
  recoverKvMemoryEngine,
  type KvCompareAndSetResult,
  type KvClock,
  type KvJournalDurability,
  type KvJournalReadResult,
  type KvJournalRecord,
  type KvMutation,
  type ZeroKvEntry,
} from './index';

const DURABILITY_MODES = ['memory', 'everysec', 'always'] as const satisfies readonly KvJournalDurability[];
const CONCURRENT_CALLS = 100;
const TEST_TIMEOUT_MS = 30_000;

let testRoot = '';

beforeAll(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'zero-kv-concurrency-'));
});

afterAll(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
});

describe('KV concurrent mutation contracts', () => {
  for (const durability of DURABILITY_MODES) {
    describe(durability, () => {
      test('admits exactly the configured capacity for every limiter shape', async () => {
        const clock = new ManualKvClock(10_000);
        const { service, journal } = await createControlledService(
          `${durability}-limiters`,
          durability,
          clock
        );

        try {
          const fixed = await runBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, () =>
                service.limiter.fixedWindow('fixed', { limit: 10, windowMs: 60_000 })
              )
            )
          );
          const token = await runBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, () =>
                service.limiter.tokenBucket('token', { capacity: 10, refillPerSec: 1 })
              )
            )
          );
          const sliding = await runBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, () =>
                service.limiter.slidingWindow('sliding', { limit: 10, windowMs: 60_000 })
              )
            )
          );

          expect(countAllowed(fixed)).toBe(10);
          expect(countAllowed(token)).toBe(10);
          expect(countAllowed(sliding)).toBe(10);
        } finally {
          journal.release();
          await service.stop();
        }
      }, TEST_TIMEOUT_MS);

      test('allows exactly one absent-key and existing-version CAS winner', async () => {
        const clock = new ManualKvClock(20_000);
        const { service, journal } = await createControlledService(
          `${durability}-cas`,
          durability,
          clock
        );

        try {
          const absent = await runBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, (_, value) =>
                service.compareAndSet('absent', null, value)
              )
            )
          );
          assertSingleCasWinner(service, 'absent', absent, null);

          const seed = await service.set('existing', 'seed');
          const existing = await runBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, (_, index) =>
                service.compareAndSet('existing', seed.version, `replacement-${index}`)
              )
            )
          );
          assertSingleCasWinner(service, 'existing', existing, 'seed');
        } finally {
          journal.release();
          await service.stop();
        }
      }, TEST_TIMEOUT_MS);

      test('returns each increment and set mutation result rather than a later value', async () => {
        const clock = new ManualKvClock(30_000);
        const directory = testDirectory(`${durability}-results`);
        const journal = new PostAppendBlockingJournal({ baseDir: directory, durability, clock });
        const service = new KvService({
          baseDir: directory,
          durability,
          clock,
          journal,
          fsyncMs: 60_000,
          checkpointIntervalMs: 60_000,
        });
        let stopped = false;

        await service.start();
        try {
          const increments = await runPostAppendBlockedBatch(journal, () =>
            Promise.all(
              Array.from({ length: CONCURRENT_CALLS }, () => service.increment('counter'))
            )
          );
          expect([...increments].sort((left, right) => left - right)).toEqual(integerRange(1, 100));
          expect(service.get<number>('counter')).toBe(100);

          const inputs = integerRange(0, 99);
          const sets = await runPostAppendBlockedBatch(journal, () =>
            Promise.all(inputs.map((value) => service.set('set-result', value)))
          );
          const recordsByValue = await setRecordVersionsByValue(journal, 'set-result');

          expect(new Set(sets.map((entry) => entry.version)).size).toBe(CONCURRENT_CALLS);
          for (const [index, entry] of sets.entries()) {
            const input = inputs[index]!;
            expect(entry.value).toBe(input);
            expect(recordsByValue.has(input)).toBe(true);
            expect(entry.version).toBe(recordsByValue.get(input)!);
          }

          await service.stop();
          stopped = true;

          if (durability !== 'memory') {
            const recovered = new KvService({
              baseDir: directory,
              durability,
              clock,
              fsyncMs: 60_000,
              checkpointIntervalMs: 60_000,
            });
            await recovered.start();
            try {
              expect(recovered.get<number>('counter')).toBe(100);
              expect(recovered.getEntry('set-result')).not.toBeNull();
            } finally {
              await recovered.stop();
            }
          }
        } finally {
          journal.releasePostAppend();
          if (!stopped) await service.stop();
        }
      }, TEST_TIMEOUT_MS);
    });
  }

  test('supports non-default limiter costs and token refill under overlap', async () => {
    const clock = new ManualKvClock(40_000);
    const { service, journal } = await createControlledService('weighted-limiters', 'memory', clock);

    try {
      const fixed = await runBlockedBatch(journal, () =>
        Promise.all(
          Array.from({ length: CONCURRENT_CALLS }, () =>
            service.limiter.fixedWindow('weighted-fixed', { limit: 10, windowMs: 60_000, cost: 2 })
          )
        )
      );
      const token = await runBlockedBatch(journal, () =>
        Promise.all(
          Array.from({ length: CONCURRENT_CALLS }, () =>
            service.limiter.tokenBucket('weighted-token', {
              capacity: 10,
              refillPerSec: 1,
              cost: 2,
            })
          )
        )
      );
      const sliding = await runBlockedBatch(journal, () =>
        Promise.all(
          Array.from({ length: CONCURRENT_CALLS }, () =>
            service.limiter.slidingWindow('weighted-sliding', {
              limit: 10,
              windowMs: 60_000,
              cost: 2,
            })
          )
        )
      );

      expect(countAllowed(fixed)).toBe(5);
      expect(countAllowed(token)).toBe(5);
      expect(countAllowed(sliding)).toBe(5);

      clock.advance(4_000);
      const refilled = await runBlockedBatch(journal, () =>
        Promise.all(
          Array.from({ length: 10 }, () =>
            service.limiter.tokenBucket('weighted-token', {
              capacity: 10,
              refillPerSec: 1,
              cost: 2,
            })
          )
        )
      );
      expect(countAllowed(refilled)).toBe(2);
    } finally {
      journal.release();
      await service.stop();
    }
  });

  test('does not reopen limiter capacity when the wall clock moves backward', async () => {
    const clock = new ManualKvClock(70_000);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();

    try {
      const fixedOptions = { limit: 2, windowMs: 60_000 };
      const tokenOptions = { capacity: 2, refillPerSec: 1 };
      const slidingOptions = { limit: 2, windowMs: 60_000 };

      expect((await service.limiter.fixedWindow('rollback-fixed', fixedOptions)).allowed).toBe(true);
      expect((await service.limiter.fixedWindow('rollback-fixed', fixedOptions)).allowed).toBe(true);
      expect((await service.limiter.tokenBucket('rollback-token', tokenOptions)).allowed).toBe(true);
      expect((await service.limiter.tokenBucket('rollback-token', tokenOptions)).allowed).toBe(true);
      expect((await service.limiter.slidingWindow('rollback-sliding', slidingOptions)).allowed).toBe(true);
      expect((await service.limiter.slidingWindow('rollback-sliding', slidingOptions)).allowed).toBe(true);

      clock.set(-1_000_000);
      const fixedDuringRollback = await service.limiter.fixedWindow('rollback-fixed', fixedOptions);
      const tokenDuringRollback = await service.limiter.tokenBucket('rollback-token', tokenOptions);
      const slidingDuringRollback = await service.limiter.slidingWindow('rollback-sliding', slidingOptions);
      expect(fixedDuringRollback.allowed).toBe(false);
      expect(tokenDuringRollback.allowed).toBe(false);
      expect(slidingDuringRollback.allowed).toBe(false);
      expect(fixedDuringRollback.resetAt).toBe(120_000);
      expect(slidingDuringRollback.resetAt).toBe(120_000);

      clock.set(70_000);
      expect((await service.limiter.fixedWindow('rollback-fixed', fixedOptions)).allowed).toBe(false);
      expect((await service.limiter.tokenBucket('rollback-token', tokenOptions)).allowed).toBe(false);
      expect((await service.limiter.slidingWindow('rollback-sliding', slidingOptions)).allowed).toBe(false);
    } finally {
      await service.stop();
    }
  });

  test('rejects invalid token-bucket TTLs without weakening the bucket', async () => {
    const clock = new ManualKvClock(70_000);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();

    try {
      for (const ttlMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(service.limiter.tokenBucket('invalid-ttl', {
          capacity: 1,
          refillPerSec: 1,
          ttlMs,
        })).rejects.toMatchObject({ code: 'KV_TTL_INVALID' });
      }
      expect(service.status().sequence).toBe(0);

      const first = await service.limiter.tokenBucket('invalid-ttl', {
        capacity: 1,
        refillPerSec: 1,
      });
      const second = await service.limiter.tokenBucket('invalid-ttl', {
        capacity: 1,
        refillPerSec: 1,
      });
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
    } finally {
      await service.stop();
    }
  });

  test('carries the active legacy fixed-window count into the atomic state', async () => {
    const clock = new ManualKvClock(70_000);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();

    try {
      await service.increment('limiter:fixed:legacy-migration:60000', 2, { ttlMs: 120_000 });
      const result = await service.limiter.fixedWindow('legacy-migration', {
        limit: 2,
        windowMs: 60_000,
      });
      expect(result).toMatchObject({
        allowed: false,
        remaining: 0,
        resetAt: 120_000,
        value: 3,
      });
    } finally {
      await service.stop();
    }
  });

  test('keeps counter wrapper decrement results distinct under concurrency', async () => {
    const directory = testDirectory('counter-wrapper');
    const clock = new ManualKvClock(50_000);
    const journal = new PostAppendBlockingJournal({ baseDir: directory, durability: 'memory', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'memory',
      clock,
      journal,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    try {
      await service.set('counter-wrapper', 100, { kind: 'counter' });
      const decrements = await runPostAppendBlockedBatch(journal, () =>
        Promise.all(
          Array.from({ length: CONCURRENT_CALLS }, () =>
            service.counters.decrement('counter-wrapper')
          )
        )
      );

      expect([...decrements].sort((left, right) => left - right)).toEqual(integerRange(0, 99));
      expect(service.counters.value('counter-wrapper')).toBe(0);
    } finally {
      journal.releasePostAppend();
      await service.stop();
    }
  });

  test('rejects counter overflow before WAL acceptance and keeps the key usable', async () => {
    const directory = testDirectory('counter-overflow');
    const clock = new ManualKvClock(55_000);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    await service.set('overflow-counter', Number.MAX_VALUE, { kind: 'counter' });
    await expect(service.increment('overflow-counter', Number.MAX_VALUE)).rejects.toMatchObject({
      code: 'KV_VALUE_INVALID',
    });
    expect(service.status().sequence).toBe(1);
    expect(service.get<number>('overflow-counter')).toBe(Number.MAX_VALUE);
    expect(await service.increment('overflow-counter', -Number.MAX_VALUE)).toBe(0);
    expect(service.status().sequence).toBe(2);
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<number>('overflow-counter')).toBe(0);
      expect(recovered.status().sequence).toBe(2);
    } finally {
      await recovered.stop();
    }
  });

  test('records counter results and inherited default expiry for deterministic recovery', async () => {
    const directory = testDirectory('counter-result-expiry');
    const clock = new ManualKvClock(56_000);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { defaultTtlMs: 100 },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    expect(await service.increment('default-ttl-counter', 4)).toBe(4);
    clock.advance(50);
    expect(await service.increment('default-ttl-counter', 6)).toBe(10);
    expect(service.getEntry('default-ttl-counter')?.expiresAt).toBe(56_100);

    const mutations: KvMutation[] = [];
    for await (const record of service.journal.readRecords()) {
      if (record.ok && record.record.mutation.key === 'default-ttl-counter') {
        mutations.push(record.record.mutation);
      }
    }
    expect(mutations).toEqual([
      {
        op: 'increment',
        key: 'default-ttl-counter',
        delta: 4,
        result: 4,
        expiresAt: 56_100,
        evaluatedAt: 56_000,
      },
      {
        op: 'increment',
        key: 'default-ttl-counter',
        delta: 6,
        result: 10,
        expiresAt: 56_100,
        evaluatedAt: 56_050,
      },
    ]);
    await service.stop();

    clock.set(56_150);
    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { defaultTtlMs: 100 },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get('default-ttl-counter')).toBeUndefined();
    } finally {
      await recovered.stop();
    }
  });

  test('serializes CAS with set, delete, increment, expire, and persist mutations', async () => {
    const clock = new ManualKvClock(60_000);
    const { service, journal } = await createControlledService('cas-races', 'memory', clock);

    try {
      const setSeed = await service.set('cas-set', 'seed');
      const setRace = await raceCasWithMutation(
        journal,
        () => service.set('cas-set', 'ordinary'),
        () => service.compareAndSet('cas-set', setSeed.version, 'cas')
      );
      const setFinal = requireEntry(service.getEntry<string>('cas-set'), 'cas-set');
      expect(setFinal.value).toBe('ordinary');
      if (setRace.cas.ok) {
        expect(setRace.cas.current).toBe('seed');
        expect(setRace.cas.version).not.toBe(setFinal.version);
      } else {
        expect(setRace.cas.current).toBe('ordinary');
        expect(setRace.cas.value).toBe('ordinary');
        expect(setRace.cas.version).toBe(setFinal.version);
      }

      const deleteSeed = await service.set('cas-delete', 'seed');
      const deleteRace = await raceCasWithMutation(
        journal,
        () => service.delete('cas-delete'),
        () => service.compareAndSet('cas-delete', deleteSeed.version, 'cas')
      );
      expect(service.getEntry('cas-delete')).toBeNull();
      if (deleteRace.cas.ok) {
        expect(deleteRace.cas.current).toBe('seed');
      } else {
        expect(deleteRace.cas.current).toBeNull();
        expect(deleteRace.cas.value).toBeNull();
        expect(deleteRace.cas.version).toBeNull();
      }

      const incrementSeed = await service.set('cas-increment', 0, { kind: 'counter' });
      const incrementRace = await raceCasWithMutation(
        journal,
        () => service.increment('cas-increment'),
        () => service.compareAndSet('cas-increment', incrementSeed.version, 50, { kind: 'counter' })
      );
      const incrementFinal = requireEntry(service.getEntry<number>('cas-increment'), 'cas-increment');
      if (incrementRace.cas.ok) {
        expect(incrementFinal.value).toBe(51);
        expect(incrementFinal.version).toBeGreaterThan(incrementRace.cas.version!);
      } else {
        expect(incrementFinal.value).toBe(1);
        expect(incrementRace.cas.current).toBe(1);
        expect(incrementRace.cas.value).toBe(1);
        expect(incrementRace.cas.version).toBe(incrementFinal.version);
      }

      const expireSeed = await service.set('cas-expire', 'seed');
      const expireRace = await raceCasWithMutation(
        journal,
        () => service.expire('cas-expire', 500),
        () => service.compareAndSet('cas-expire', expireSeed.version, 'cas')
      );
      const expireFinal = requireEntry(service.getEntry<string>('cas-expire'), 'cas-expire');
      expect(expireFinal.expiresAt).toBe(clock.now() + 500);
      if (expireRace.cas.ok) {
        expect(expireFinal.value).toBe('cas');
        expect(expireFinal.version).toBeGreaterThan(expireRace.cas.version!);
      } else {
        expect(expireFinal.value).toBe('seed');
        expect(expireRace.cas.current).toBe('seed');
        expect(expireRace.cas.version).toBe(expireFinal.version);
      }

      const persistSeed = await service.set('cas-persist', 'seed', { ttlMs: 500 });
      const persistRace = await raceCasWithMutation(
        journal,
        () => service.persist('cas-persist'),
        () => service.compareAndSet('cas-persist', persistSeed.version, 'cas')
      );
      const persistFinal = requireEntry(service.getEntry<string>('cas-persist'), 'cas-persist');
      expect(persistFinal.expiresAt).toBeNull();
      if (persistRace.cas.ok) {
        expect(persistFinal.value).toBe('cas');
        expect(persistFinal.version).toBeGreaterThan(persistRace.cas.version!);
      } else {
        expect(persistFinal.value).toBe('seed');
        expect(persistRace.cas.current).toBe('seed');
        expect(persistRace.cas.version).toBe(persistFinal.version);
      }
    } finally {
      journal.release();
      await service.stop();
    }
  });

  test('serializes bounded eviction with in-flight conditional decisions', async () => {
    const directory = testDirectory('bounded-eviction-conditional-boundary');
    const clock = new ManualKvClock(48_000);
    const journal = new PostAppendBlockingJournal({
      baseDir: directory,
      durability: 'always',
      clock,
    });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      memory: { maxEntries: 1 },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    const seed = await service.set('conditional', 'old');

    journal.blockAfterAppend((mutation) => mutation.key === 'conditional');
    const conditional = service.compareAndSet('conditional', seed.version, 'new');
    await journal.waitForPostAppendBlock();
    let competingSettled = false;
    const competing = service.set('competing', 'wins-last').finally(() => {
      competingSettled = true;
    });
    await Promise.resolve();
    expect(competingSettled).toBe(false);

    journal.releasePostAppend();
    expect((await conditional).ok).toBe(true);
    await competing;
    expect(service.get('conditional')).toBeUndefined();
    expect(service.get<string>('competing')).toBe('wins-last');
    await service.stop();
  });

  test('treats the exact TTL boundary as absent during CAS', async () => {
    const clock = new ManualKvClock(70_000);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();

    try {
      const beforeBoundary = await service.set('before-boundary', 'seed', { ttlMs: 100 });
      clock.advance(99);
      const replaced = await service.compareAndSet('before-boundary', beforeBoundary.version, 'replacement');
      expect(replaced.ok).toBe(true);

      const atBoundary = await service.set('at-boundary', 'seed', { ttlMs: 100 });
      clock.advance(100);
      const expired = await service.compareAndSet('at-boundary', atBoundary.version, 'replacement');
      expect(expired).toEqual({ ok: false, value: null, current: null, version: null });
      expect(service.getEntry('at-boundary')).toBeNull();
    } finally {
      await service.stop();
    }
  });

  test('keeps delayed TTL persistence decisions identical across live apply and recovery', async () => {
    const directory = testDirectory('delayed-ttl-decisions');
    const clock = new ManualKvClock(90);
    const journal = new PostAppendBlockingJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('persist-after-delay', 'persisted', { ttlMs: 10 });
    await service.set('extend-after-delay', 'extended', { ttlMs: 10 });

    journal.blockAfterAppend((mutation) => mutation.key === 'persist-after-delay');
    const persisting = service.persist('persist-after-delay');
    await journal.waitForPostAppendBlock();
    clock.set(110);
    journal.releasePostAppend();
    expect(await persisting).toBe(true);
    expect(service.get<string>('persist-after-delay')).toBe('persisted');
    expect(service.getEntry('persist-after-delay')?.expiresAt).toBeNull();

    clock.set(90);
    journal.blockAfterAppend((mutation) => mutation.key === 'extend-after-delay');
    const extending = service.expire('extend-after-delay', 110);
    await journal.waitForPostAppendBlock();
    clock.set(150);
    journal.releasePostAppend();
    expect(await extending).toBe(true);
    expect(service.get<string>('extend-after-delay')).toBe('extended');
    expect(service.getEntry('extend-after-delay')?.expiresAt).toBe(200);
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<string>('persist-after-delay')).toBe('persisted');
      expect(recovered.get<string>('extend-after-delay')).toBe('extended');
      expect(recovered.getEntry('extend-after-delay')?.expiresAt).toBe(200);
    } finally {
      await recovered.stop();
    }
  });

  test('immediate expiry replaces prior state without resurrecting it during recovery', async () => {
    const directory = testDirectory('immediate-expiry-recovery');
    const clock = new ManualKvClock(75_000);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    let recovered: KvService | null = null;
    try {
      await service.set('expired-set', 'old-set');
      const expiredSet = await service.set('expired-set', 'replacement', { ttlMs: 0 });
      expect(expiredSet.value).toBe('replacement');
      expect(expiredSet.expiresAt).toBe(clock.now());
      expect(service.get('expired-set')).toBeUndefined();

      await service.set('expired-expire', 'old-expire');
      expect(await service.expire('expired-expire', 0)).toBe(true);
      expect(service.get('expired-expire')).toBeUndefined();

      await service.set('expired-increment', 5, { kind: 'counter' });
      expect(await service.increment('expired-increment', 1, { ttlMs: 0 })).toBe(6);
      expect(service.get('expired-increment')).toBeUndefined();
      await service.flush();

      recovered = new KvService({
        baseDir: directory,
        durability: 'always',
        clock,
        fsyncMs: 60_000,
        checkpointIntervalMs: 60_000,
      });
      await recovered.start();
      expect(recovered.get('expired-set')).toBeUndefined();
      expect(recovered.get('expired-expire')).toBeUndefined();
      expect(recovered.get('expired-increment')).toBeUndefined();
    } finally {
      await recovered?.stop();
      await service.stop();
    }
  });

  test('does not serialize independent keys behind a blocked key', async () => {
    const { service, journal } = await createControlledService(
      'independent-keys',
      'memory',
      new ManualKvClock(80_000)
    );
    journal.block((mutation) => mutation.key === 'slow');
    const slow = service.set('slow', 'slow-value');
    await journal.waitForBlockedAppend();

    let fastSettled = false;
    const fast = service.set('fast', 'fast-value').then((entry) => {
      fastSettled = true;
      return entry;
    });
    await drainMicrotasks();
    const progressedIndependently = fastSettled;

    journal.release();
    const [slowEntry, fastEntry] = await Promise.all([slow, fast]);
    try {
      expect(progressedIndependently).toBe(true);
      expect(slowEntry.value).toBe('slow-value');
      expect(fastEntry.value).toBe('fast-value');
    } finally {
      await service.stop();
    }
  });

  test('releases a failed key queue so later writes progress and recover', async () => {
    const directory = testDirectory('rejection-progress');
    const clock = new ManualKvClock(90_000);
    const journal = new RejectOnceKvJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    const outcomes = await Promise.allSettled([
      service.set('recover-after-rejection', 'rejected'),
      service.set('recover-after-rejection', 'accepted'),
    ]);
    expect(outcomes[0]?.status).toBe('rejected');
    expect(outcomes[1]?.status).toBe('fulfilled');
    expect(service.get<string>('recover-after-rejection')).toBe('accepted');

    await service.set('recover-after-rejection', 'later');
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<string>('recover-after-rejection')).toBe('later');
    } finally {
      await recovered.stop();
    }
  });

  test('rejects an unserializable value without faulting later durable writes', async () => {
    const directory = testDirectory('serialization-rejection-progress');
    const clock = new ManualKvClock(95_000);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    const rejected = await service.set('unserializable', 1n).then(
      () => null,
      (error: unknown) => error
    );
    expect(rejected).toBeInstanceOf(KvError);
    expect((rejected as KvError).code).toBe('KV_VALUE_INVALID');
    expect(service.get('unserializable')).toBeUndefined();

    await service.set('after-serialization-rejection', 'accepted');
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<string>('after-serialization-rejection')).toBe('accepted');
    } finally {
      await recovered.stop();
    }
  });

  test('rejects lossy durable values and isolates acknowledged object snapshots', async () => {
    const directory = testDirectory('value-snapshot-isolation');
    const clock = new ManualKvClock(95_500);
    const journal = new ControllableKvJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    await expect(service.set('non-finite', Number.NaN)).rejects.toMatchObject({
      code: 'KV_VALUE_INVALID',
    });
    await expect(service.set('date', new Date(0))).rejects.toMatchObject({
      code: 'KV_VALUE_INVALID',
    });
    const sparseWithExtra = [1, ,] as unknown[];
    (sparseWithExtra as unknown as Record<string, unknown>).extra = 2;
    await expect(service.set('sparse-array', sparseWithExtra)).rejects.toMatchObject({
      code: 'KV_VALUE_INVALID',
    });
    await expect(service.set('bad-kind', 'value', { kind: 'bogus' as never }))
      .rejects.toMatchObject({ code: 'KV_VALUE_INVALID' });

    const input = { nested: { value: 1 } };
    journal.block((mutation) => mutation.key === 'snapshot');
    const writing = service.set('snapshot', input);
    await journal.waitForBlockedAppend();
    input.nested.value = 2;
    journal.release();

    const written = await writing;
    expect(written.value).toEqual({ nested: { value: 1 } });
    written.value.nested.value = 3;
    const firstRead = service.get<{ nested: { value: number } }>('snapshot');
    expect(firstRead).toEqual({ nested: { value: 1 } });
    firstRead!.nested.value = 4;
    expect(service.get<{ nested: { value: number } }>('snapshot'))
      .toEqual({ nested: { value: 1 } });
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<{ nested: { value: number } }>('snapshot'))
        .toEqual({ nested: { value: 1 } });
    } finally {
      await recovered.stop();
    }
  });

  test('rejects bounded no-eviction writes before WAL acceptance', async () => {
    const directory = testDirectory('preflight-memory-limit');
    const clock = new ManualKvClock(96_000);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    const competing = await Promise.allSettled([
      service.set('bounded-a', 'a'),
      service.set('bounded-b', 'b'),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = competing.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      code: 'KV_EVICTION_REQUIRED',
    });
    expect(service.status().sequence).toBe(1);

    const immediatelyExpired = await service.set('bounded-expired', 'transient', { ttlMs: 0 });
    expect(immediatelyExpired.value).toBe('transient');
    expect(service.get('bounded-expired')).toBeUndefined();
    expect(await service.increment('bounded-expired-counter', 1, { ttlMs: 0 })).toBe(1);
    expect(service.get('bounded-expired-counter')).toBeUndefined();
    expect(service.status().sequence).toBe(3);
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(Number(recovered.has('bounded-a')) + Number(recovered.has('bounded-b'))).toBe(1);
      expect(recovered.status().sequence).toBe(3);
    } finally {
      await recovered.stop();
    }
  });

  test('keeps reserved replacement capacity after its previous value expires', async () => {
    const directory = testDirectory('replacement-capacity-reservation');
    const clock = new ManualKvClock(96_500);
    const journal = new PostAppendBlockingJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    try {
      await service.set('reserved-a', 'expiring', { ttlMs: 100 });
      journal.blockAfterAppend((mutation) => mutation.key === 'reserved-a');
      const replacing = service.set('reserved-a', 'replacement');
      await journal.waitForPostAppendBlock();

      clock.advance(100);
      expect(service.get('reserved-a')).toBeUndefined();
      const competing = service.set('must-not-enter-wal', 'b');
      expect(service.status().sequence).toBe(2);

      journal.releasePostAppend();
      expect((await replacing).value).toBe('replacement');
      await expect(competing).rejects.toMatchObject({
        code: 'KV_EVICTION_REQUIRED',
      });
      expect(service.status().sequence).toBe(2);
      expect(service.get<string>('reserved-a')).toBe('replacement');
      expect(service.get('must-not-enter-wal')).toBeUndefined();
    } finally {
      journal.releasePostAppend();
      await service.stop();
    }

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get<string>('reserved-a')).toBe('replacement');
      expect(recovered.get('must-not-enter-wal')).toBeUndefined();
      expect(recovered.status().sequence).toBe(2);
    } finally {
      await recovered.stop();
    }
  });

  test('keeps immediate-expiry mutations as tombstones across clock rollback', async () => {
    const directory = testDirectory('immediate-expiry-clock-rollback');
    const clock = new ManualKvClock(96_750);
    const journal = new ControllableKvJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    try {
      await service.set('capacity-owner', 'kept');
      journal.block((mutation) => mutation.key === 'expired-during-rollback');
      const expiring = service.set('expired-during-rollback', 'transient', { ttlMs: 0 });
      await journal.waitForBlockedAppend();
      clock.set(0);
      journal.release();

      expect((await expiring).value).toBe('transient');
      expect(service.get('expired-during-rollback')).toBeUndefined();
      expect(service.get<string>('capacity-owner')).toBe('kept');
      expect((await service.set('capacity-owner', 'still-usable')).value).toBe('still-usable');
      expect(service.status().sequence).toBe(3);
    } finally {
      journal.release();
      await service.stop();
    }

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    try {
      expect(recovered.get('expired-during-rollback')).toBeUndefined();
      expect(recovered.get<string>('capacity-owner')).toBe('still-usable');
      expect(recovered.status().sequence).toBe(3);
    } finally {
      await recovered.stop();
    }
  });

  test('records preflight time before a queued journal append and replays the same capacity decision', async () => {
    const directory = testDirectory('queued-append-clock-rollback');
    const clock = new ManualKvClock(0);
    const journal = new InQueueBlockingJournal({ baseDir: directory, durability: 'always', clock });
    const memory = { maxEntries: 1, eviction: 'none' as const };
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      memory,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('expired-a', 'old', { ttlMs: 50 });

    clock.set(100);
    journal.blockInside((mutation) => mutation.key === 'journal-blocker');
    const blocking = service.delete('journal-blocker');
    await journal.waitForInsideBlock();
    const writing = service.set('replacement-b', 'new');
    expect(service.get('expired-a')).toBeUndefined();

    clock.set(0);
    journal.releaseInside();
    await Promise.all([blocking, writing]);
    expect(service.get<string>('replacement-b')).toBe('new');
    expect(service.status().sequence).toBe(3);

    const recovered = new KvMemoryEngine({ clock, ...memory });
    await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: directory, clock }),
      journal: new KvFileJournal({ baseDir: directory, durability: 'always', clock }),
    });
    expect(recovered.get('expired-a')).toBeUndefined();
    expect(recovered.get<string>('replacement-b')).toBe('new');

    await service.stop();
  });

  test('uses one captured timestamp for decisions, TTL, capacity, and WAL apply', async () => {
    const directory = testDirectory('single-evaluation-timestamp');
    const clock = new ScriptedKvClock(0);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1, eviction: 'none' },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    const seed = await service.set('typed', { old: true }, { ttlMs: 50 });

    clock.script(49, 51, 51);
    await expect(service.increment('typed')).rejects.toMatchObject({
      code: 'KV_COUNTER_TYPE_MISMATCH',
    });
    expect(clock.scriptedCalls()).toBe(1);
    expect(clock.remainingScriptedValues()).toBe(2);
    expect(service.status().sequence).toBe(1);

    clock.script(51, 49, 49);
    const lostCas = await service.compareAndSet('typed', seed.version, 'replacement');
    expect(lostCas).toEqual({ ok: false, value: null, current: null, version: null });
    expect(clock.scriptedCalls()).toBe(1);
    expect(service.status().sequence).toBe(1);

    clock.setFallback(0);
    clock.clearScript();
    expect(service.get<{ old: boolean }>('typed')).toEqual({ old: true });

    clock.script(51, 0, 0);
    expect(await service.increment('typed')).toBe(1);
    expect(clock.scriptedCalls()).toBe(1);
    expect(service.status().sequence).toBe(2);

    clock.setFallback(51);
    clock.clearScript();
    const recovered = new KvMemoryEngine({
      clock,
      maxEntries: 1,
      eviction: 'none',
      evictionRecency: 'mutation',
    });
    await recoverKvMemoryEngine({
      engine: recovered,
      checkpoint: new KvCheckpointStore({ baseDir: directory, clock }),
      journal: new KvFileJournal({ baseDir: directory, durability: 'always', clock }),
    });
    expect(recovered.get<number>('typed')).toBe(1);
    await service.stop();
  });

  test('uses the service mutation timestamp for limiter decisions', async () => {
    const directory = testDirectory('single-limiter-timestamp');
    const clock = new ScriptedKvClock(100);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    clock.script(100, 10_000);
    const result = await service.limiter.tokenBucket('one-clock', {
      capacity: 10,
      refillPerSec: 1,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(clock.scriptedCalls()).toBe(1);
    expect(clock.remainingScriptedValues()).toBe(1);
    clock.clearScript();
    await service.stop();
  });

  test('preserves low-level mutation results and no-op validation behavior', async () => {
    const service = new KvService({ durability: 'memory' });
    const lowLevelValue = { compatible: true };
    const lowLevelResult = applyKvMutation(
      service.engine,
      { op: 'set', key: 'low-level', value: lowLevelValue },
      { sequence: 1, timestamp: 97_000 }
    );
    expect(lowLevelResult).toEqual(lowLevelValue);

    await service.start();
    try {
      const seed = await service.set('validation-noop', 'existing');
      const lostCas = await service.compareAndSet(
        'validation-noop',
        seed.version + 1,
        BigInt(1),
        { kind: 'invalid' as never }
      );
      expect(lostCas).toMatchObject({ ok: false, value: 'existing', version: seed.version });
      const cached = await service.getOrSet<unknown>(
        'validation-noop',
        () => BigInt(2),
        { kind: 'invalid' as never }
      );
      expect(cached).toBe('existing');
    } finally {
      await service.stop();
    }
  });

  test('coalesces concurrent startup recovery instead of replaying the journal twice', async () => {
    const directory = testDirectory('concurrent-start');
    const clock = new ManualKvClock(97_000);
    const journal = new KvFileJournal({ baseDir: directory, durability: 'always', clock });
    for (let index = 0; index < 20; index += 1) {
      await journal.append({ op: 'increment', key: 'replayed-counter', delta: 1 });
    }

    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    const firstStart = service.start();
    const secondStart = service.start();
    expect(secondStart).toBe(firstStart);
    await Promise.all([firstStart, secondStart]);
    try {
      expect(service.get<number>('replayed-counter')).toBe(20);
      expect(service.status().sequence).toBe(20);
    } finally {
      await service.stop();
    }
  });

  test('blocks reads and checkpoints until startup recovery is complete', async () => {
    const directory = testDirectory('startup-recovery-gate');
    const clock = new ManualKvClock(97_500);
    const seedJournal = new KvFileJournal({ baseDir: directory, durability: 'always', clock });
    await seedJournal.append({ op: 'set', key: 'a', value: 1 });
    await seedJournal.append({ op: 'set', key: 'b', value: 2 });

    const journal = new RecoveryBlockingJournal({
      baseDir: directory,
      durability: 'always',
      clock,
      initialSequence: 2,
    });
    const checkpoint = new RecordingCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });

    journal.blockAfterFirstRecord();
    const starting = service.start();
    await journal.waitForRecoveryBlock();
    expect(() => service.get('a')).toThrow(KvError);
    const checkpointing = service.checkpoint();
    await drainMicrotasks();
    expect(checkpoint.writeCalls).toBe(0);

    journal.releaseRecovery();
    await Promise.all([starting, checkpointing]);
    expect(service.get<number>('a')).toBe(1);
    expect(service.get<number>('b')).toBe(2);
    expect(checkpoint.writeCalls).toBe(1);
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    expect(recovered.get<number>('a')).toBe(1);
    expect(recovered.get<number>('b')).toBe(2);
    await recovered.stop();
  });

  test('allows reads while an already-running service receives a redundant start', async () => {
    const service = new KvService({ durability: 'memory' });
    await service.start();
    await service.set('ready', true);
    const redundantStart = service.start();
    expect(service.get<boolean>('ready')).toBe(true);
    await redundantStart;
    await service.stop();
  });

  test('waits for an in-flight start before stopping the service', async () => {
    const directory = testDirectory('stop-during-start');
    const clock = new ManualKvClock(98_000);
    const checkpoint = new ReadBlockingCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });

    checkpoint.blockRead();
    const starting = service.start();
    await checkpoint.waitForBlockedRead();
    let stopSettled = false;
    const stopping = service.stop().then(() => {
      stopSettled = true;
    });
    await drainMicrotasks();
    expect(stopSettled).toBe(false);

    checkpoint.releaseRead();
    await Promise.all([starting, stopping]);
    expect(service.status().started).toBe(false);
    const timers = service as unknown as {
      fsyncTimer: ReturnType<typeof setInterval> | null;
      checkpointTimer: ReturnType<typeof setInterval> | null;
    };
    expect(timers.fsyncTimer).toBeNull();
    expect(timers.checkpointTimer).toBeNull();
  });

  test('honors the last lifecycle request when start is queued behind stop', async () => {
    const { service, journal } = await createControlledService(
      'stop-start-stop-order',
      'memory',
      new ManualKvClock(98_500)
    );
    journal.block();
    const write = service.set('lifecycle-blocker', 'value');
    await journal.waitForBlockedAppend();

    const firstStop = service.stop();
    const queuedStart = service.start();
    const finalStop = service.stop();
    journal.release();
    await Promise.all([write, firstStop, queuedStart, finalStop]);

    expect(service.status().started).toBe(false);
  });

  test('preserves call-order lifecycle intent across overlapping start and stop requests', async () => {
    const initiallyStopped = new KvService({ durability: 'memory' });
    const firstStart = initiallyStopped.start();
    const middleStop = initiallyStopped.stop();
    const finalStart = initiallyStopped.start();
    await Promise.all([firstStart, middleStop, finalStart]);
    expect(initiallyStopped.status().started).toBe(true);
    await initiallyStopped.stop();

    const alreadyRunning = new KvService({ durability: 'memory' });
    await alreadyRunning.start();
    const redundantStart = alreadyRunning.start();
    const stopping = alreadyRunning.stop();
    await expect(alreadyRunning.set('late-write', true)).rejects.toMatchObject({
      code: 'KV_SERVICE_STOPPING',
    });
    const restarting = alreadyRunning.start();
    await Promise.all([redundantStart, stopping, restarting]);
    expect(alreadyRunning.status().started).toBe(true);
    expect(alreadyRunning.get('late-write')).toBeUndefined();
    await alreadyRunning.stop();
  });

  test('restarts a durable service queued behind stop without checkpoint deadlock', async () => {
    const directory = testDirectory('durable-stop-start-order');
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('survives-restart', true);

    const stopping = service.stop();
    const restarting = service.start();
    await Promise.all([stopping, restarting]);
    expect(service.status().started).toBe(true);
    expect(service.get<boolean>('survives-restart')).toBe(true);
    await service.stop();
  });

  test('keeps getOrSet loaders outside key and checkpoint queues', async () => {
    const directory = testDirectory('get-or-set-loader');
    const clock = new ManualKvClock(99_000);
    const checkpoint = new RecordingCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    const loaderStarted = deferred<void>();
    const releaseLoader = deferred<void>();
    const loaded = service.getOrSet('loader-result', async () => {
      loaderStarted.resolve();
      await releaseLoader.promise;
      await service.set('loader-side-effect', 'written');
      return 'loaded';
    });
    await loaderStarted.promise;

    const checkpointing = service.checkpoint();
    await drainMicrotasks();
    expect(checkpoint.writeCalls).toBe(1);
    releaseLoader.resolve();
    await checkpointing;
    expect(await loaded).toBe('loaded');
    expect(service.get<string>('loader-side-effect')).toBe('written');

    const nestedSameKey = await service.getOrSet('nested-key', async () => {
      await service.set('nested-key', 'nested-write');
      return 'loader-value';
    });
    expect(nestedSameKey).toBe('nested-write');
    await service.stop();
  });

  test('drains an admitted getOrSet loader and rejects writes while stopped', async () => {
    const service = new KvService({ durability: 'memory' });
    await expect(service.set('before-start', true)).rejects.toMatchObject({
      code: 'KV_SERVICE_NOT_RUNNING',
    });
    await service.start();

    const loaderStarted = deferred<void>();
    const releaseLoader = deferred<void>();
    const loaded = service.getOrSet('drained-loader', async () => {
      loaderStarted.resolve();
      await releaseLoader.promise;
      return 'committed-before-stop';
    });
    await loaderStarted.promise;

    let stopSettled = false;
    const stopping = service.stop().then(() => {
      stopSettled = true;
    });
    await drainMicrotasks();
    expect(stopSettled).toBe(false);
    releaseLoader.resolve();

    expect(await loaded).toBe('committed-before-stop');
    await stopping;
    expect(service.get<string>('drained-loader')).toBe('committed-before-stop');
    await expect(service.set('after-stop', true)).rejects.toMatchObject({
      code: 'KV_SERVICE_NOT_RUNNING',
    });
  });

  test('fails closed when final checkpoint persistence rejects', async () => {
    const directory = testDirectory('failed-stop-checkpoint');
    const clock = new ManualKvClock(99_500);
    const checkpoint = new RejectOnceCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('before-failed-stop', 'durable');

    await expect(service.stop()).rejects.toMatchObject({ code: 'KV_PERSISTENCE_FAILED' });
    expect(service.status().started).toBe(false);
    await expect(service.set('after-failed-stop', 'must-not-write')).rejects.toMatchObject({
      code: 'KV_SERVICE_NOT_RUNNING',
    });

    await service.start();
    expect(service.get<string>('before-failed-stop')).toBe('durable');
    await service.stop();
  });

  test('stop drains admitted mutations and rejects mutations submitted after shutdown begins', async () => {
    const { service, journal } = await createControlledService(
      'stop-drain',
      'memory',
      new ManualKvClock(100_000)
    );
    journal.block();
    const write = service.set('during-stop', 'value');
    await journal.waitForBlockedAppend();

    let stopSettled = false;
    const stopping = service.stop().then(() => {
      stopSettled = true;
    });
    const rejectedAfterStop = service.set('after-stop', 'must-not-commit').then(
      () => null,
      (error: unknown) => error
    );
    await drainMicrotasks();
    const stoppedBeforeMutation = stopSettled;

    journal.release();
    const [, , rejection] = await Promise.all([write, stopping, rejectedAfterStop]);
    expect(stoppedBeforeMutation).toBe(false);
    expect(service.get<string>('during-stop')).toBe('value');
    expect(rejection).toBeInstanceOf(KvError);
    expect((rejection as KvError).code).toBe('KV_SERVICE_STOPPING');
    expect(service.get('after-stop')).toBeUndefined();
  });

  test('rejects checkpoints admitted after shutdown begins', async () => {
    const directory = testDirectory('checkpoint-after-stop');
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    const stopping = service.stop();
    await expect(service.checkpoint()).rejects.toMatchObject({
      code: 'KV_SERVICE_STOPPING',
    });
    await stopping;
  });

  test('checkpoint never covers a journal sequence before its mutation is applied', async () => {
    const directory = testDirectory('checkpoint-ordering');
    const clock = new ManualKvClock(110_000);
    const journal = new PostAppendBlockingJournal({ baseDir: directory, durability: 'always', clock });
    const checkpoint = new RecordingCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();

    journal.blockAfterAppend((mutation) => mutation.key === 'checkpoint-race');
    const write = service.set('checkpoint-race', 'durable-value');
    await journal.waitForPostAppendBlock();

    const checkpointPromise = service.checkpoint();
    const checkpointStartedBeforeApply = checkpoint.writeCalls > 0;
    journal.releasePostAppend();
    await Promise.all([write, checkpointPromise]);

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    const recoveredValue = recovered.get('checkpoint-race');
    await recovered.stop();
    await service.stop();

    expect(checkpointStartedBeforeApply).toBe(false);
    expect(recoveredValue).toBe('durable-value');
  });

  test('keeps reads and status from deleting state needed by a pending TTL mutation', async () => {
    const directory = testDirectory('pending-ttl-read');
    const clock = new ManualKvClock(0);
    const journal = new ControllableKvJournal({ baseDir: directory, durability: 'always', clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      journal,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('session', 'alive', { ttlMs: 100 });

    clock.set(50);
    journal.block((mutation) => mutation.key === 'session');
    const persisting = service.persist('session');
    await journal.waitForBlockedAppend();
    clock.set(150);
    expect(service.get('session')).toBeUndefined();
    expect(service.status().entries).toBe(0);

    journal.release();
    expect(await persisting).toBe(true);
    expect(service.get<string>('session')).toBe('alive');
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    expect(recovered.get<string>('session')).toBe('alive');
    await recovered.stop();
  });

  test('keeps durable read-time expiry logical across clock rollback and restart', async () => {
    const directory = testDirectory('durable-logical-expiry');
    const clock = new ManualKvClock(0);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('rollback-value', { old: true }, { ttlMs: 10 });

    clock.set(20);
    expect(service.get('rollback-value')).toBeUndefined();
    expect(service.status().entries).toBe(0);
    clock.set(5);
    await expect(service.increment('rollback-value')).rejects.toMatchObject({
      code: 'KV_COUNTER_TYPE_MISMATCH',
    });
    expect(service.get<{ old: boolean }>('rollback-value')).toEqual({ old: true });
    await service.stop();

    const recovered = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await recovered.start();
    expect(recovered.get<{ old: boolean }>('rollback-value')).toEqual({ old: true });
    await recovered.stop();
  });

  test('journals TTL cleanup before a checkpoint failure can expose it', async () => {
    const directory = testDirectory('failed-checkpoint-expiry');
    const clock = new ManualKvClock(0);
    const checkpoint = new RejectOnceCheckpointStore({ baseDir: directory, clock });
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      checkpoint,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('checkpoint-expiry', { old: true }, { ttlMs: 10 });
    clock.set(20);
    await expect(service.checkpoint()).rejects.toMatchObject({ code: 'KV_PERSISTENCE_FAILED' });
    clock.set(5);
    expect(service.get('checkpoint-expiry')).toBeUndefined();

    const crashRecovered = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: crashRecovered,
      checkpoint: new KvCheckpointStore({ baseDir: directory, clock }),
      journal: new KvFileJournal({ baseDir: directory, durability: 'always', clock }),
    });
    expect(crashRecovered.get('checkpoint-expiry')).toBeUndefined();
    await service.stop();
  });

  test('returns logical delete results at the exact TTL boundary', async () => {
    const clock = new ManualKvClock(0);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();
    await service.set('expired-delete', true, { ttlMs: 10 });
    clock.set(10);
    expect(await service.delete('expired-delete')).toBe(false);
    expect(service.get('expired-delete')).toBeUndefined();
    await service.stop();
  });

  test('reclaims expired memory-service entries at safe idle boundaries', async () => {
    const clock = new ManualKvClock(0);
    const service = new KvService({
      durability: 'memory',
      clock,
      memory: { maxEntries: 1 },
    });
    await service.start();
    for (let index = 0; index < 1000; index += 1) {
      await service.set(`expired:${index}`, index, { ttlMs: 1 });
      clock.advance(2);
    }
    expect(service.status().entries).toBe(0);
    expect(service.engine.stats({ pruneExpired: false }).expiredEntries).toBe(1000);
    expect(service.engine.stats({ pruneExpired: false }).evictedEntries).toBe(0);
    await service.stop();
  });

  test('journals periodic cleanup for default durable TTL state', async () => {
    const directory = testDirectory('durable-default-ttl-cleanup');
    const clock = new ManualKvClock(0);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    for (let index = 0; index < 200; index += 1) {
      await service.set(`expired:${index}`, index, { ttlMs: 1 });
      clock.advance(2);
    }
    expect(service.status().entries).toBe(0);
    expect(service.engine.storedEntryCount()).toBe(200);

    await service.checkpoint();
    expect(service.engine.storedEntryCount()).toBe(0);
    expect(service.status().sequence).toBe(201);

    const crashRecovered = new KvMemoryEngine({ clock });
    await recoverKvMemoryEngine({
      engine: crashRecovered,
      checkpoint: new KvCheckpointStore({ baseDir: directory, clock }),
      journal: new KvFileJournal({ baseDir: directory, durability: 'always', clock }),
    });
    expect(crashRecovered.storedEntryCount()).toBe(0);
    await service.stop();
  });

  test('keeps physical TTL state bounded during bounded durable workloads', async () => {
    const directory = testDirectory('durable-bounded-ttl-cleanup');
    const clock = new ManualKvClock(0);
    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 1 },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    for (let index = 0; index < 200; index += 1) {
      await service.set(`bounded-expired:${index}`, index, { ttlMs: 1 });
      clock.advance(2);
      expect(service.engine.storedEntryCount()).toBeLessThanOrEqual(1);
    }
    expect(service.status().entries).toBe(0);
    await service.stop();
  });

  test('uses explicit deterministic mutation recency for durable bounded eviction', async () => {
    const directory = testDirectory('durable-mutation-recency');
    const clock = new ManualKvClock(120_000);
    expect(() => new KvService({
      baseDir: directory,
      durability: 'always',
      memory: { maxEntries: 2, evictionRecency: 'access' },
    })).toThrow(KvError);

    const service = new KvService({
      baseDir: directory,
      durability: 'always',
      clock,
      memory: { maxEntries: 2 },
      fsyncMs: 60_000,
      checkpointIntervalMs: 60_000,
    });
    await service.start();
    await service.set('a', 1);
    await service.set('b', 2);
    expect(service.get<number>('a')).toBe(1);
    await service.set('c', 3);
    expect(service.get('a')).toBeUndefined();
    expect(service.get<number>('b')).toBe(2);
    expect(service.get<number>('c')).toBe(3);

    const crashRecovered = new KvMemoryEngine({
      clock,
      maxEntries: 2,
      evictionRecency: 'mutation',
    });
    await recoverKvMemoryEngine({
      engine: crashRecovered,
      checkpoint: new KvCheckpointStore({ baseDir: directory, clock }),
      journal: new KvFileJournal({ baseDir: directory, durability: 'always', clock }),
    });
    expect(crashRecovered.get('a')).toBeUndefined();
    expect(crashRecovered.get<number>('b')).toBe(2);
    expect(crashRecovered.get<number>('c')).toBe(3);
    await service.stop();
  });
});

class ControllableKvJournal extends KvFileJournal {
  private gate: Deferred<void> | null = null;
  private entered: Deferred<void> | null = null;
  private matcher: (mutation: KvMutation) => boolean = () => true;

  block(matcher: (mutation: KvMutation) => boolean = () => true): void {
    if (this.gate) throw new Error('A journal append barrier is already active.');
    this.gate = deferred<void>();
    this.entered = deferred<void>();
    this.matcher = matcher;
  }

  async waitForBlockedAppend(): Promise<void> {
    if (!this.entered) throw new Error('No journal append barrier is active.');
    await this.entered.promise;
  }

  release(): void {
    this.gate?.resolve();
    this.gate = null;
    this.entered = null;
    this.matcher = () => true;
  }

  override async append(mutation: KvMutation) {
    const gate = this.gate;
    if (gate && this.matcher(mutation)) {
      this.entered?.resolve();
      await gate.promise;
    }
    return super.append(mutation);
  }
}

class RejectOnceKvJournal extends KvFileJournal {
  private rejected = false;

  override async append(mutation: KvMutation) {
    if (!this.rejected && mutation.key === 'recover-after-rejection') {
      this.rejected = true;
      throw new Error('Intentional journal rejection for queue recovery coverage.');
    }
    return super.append(mutation);
  }
}

class PostAppendBlockingJournal extends KvFileJournal {
  private gate: Deferred<void> | null = null;
  private entered: Deferred<void> | null = null;
  private matcher: (mutation: KvMutation) => boolean = () => true;

  blockAfterAppend(matcher: (mutation: KvMutation) => boolean = () => true): void {
    if (this.gate) throw new Error('A post-append journal barrier is already active.');
    this.gate = deferred<void>();
    this.entered = deferred<void>();
    this.matcher = matcher;
  }

  async waitForPostAppendBlock(): Promise<void> {
    if (!this.entered) throw new Error('No post-append journal barrier is active.');
    await this.entered.promise;
  }

  releasePostAppend(): void {
    this.gate?.resolve();
    this.gate = null;
    this.entered = null;
    this.matcher = () => true;
  }

  override async append(mutation: KvMutation) {
    const record = await super.append(mutation);
    const gate = this.gate;
    if (gate && this.matcher(mutation)) {
      this.entered?.resolve();
      await gate.promise;
    }
    return record;
  }
}

class InQueueBlockingJournal extends KvFileJournal {
  private gate: Deferred<void> | null = null;
  private entered: Deferred<void> | null = null;
  private matcher: (mutation: KvMutation) => boolean = () => true;

  blockInside(matcher: (mutation: KvMutation) => boolean = () => true): void {
    this.gate = deferred<void>();
    this.entered = deferred<void>();
    this.matcher = matcher;
  }

  async waitForInsideBlock(): Promise<void> {
    if (!this.entered) throw new Error('No in-queue journal barrier is active.');
    await this.entered.promise;
  }

  releaseInside(): void {
    this.gate?.resolve();
    this.gate = null;
    this.entered = null;
    this.matcher = () => true;
  }

  protected override async appendRecord(
    mutation: KvMutation,
    timestamp: number
  ): Promise<KvJournalRecord> {
    const gate = this.gate;
    if (gate && this.matcher(mutation)) {
      this.entered?.resolve();
      await gate.promise;
    }
    return super.appendRecord(mutation, timestamp);
  }
}

class RecoveryBlockingJournal extends KvFileJournal {
  private gate: Deferred<void> | null = null;
  private entered: Deferred<void> | null = null;

  blockAfterFirstRecord(): void {
    this.gate = deferred<void>();
    this.entered = deferred<void>();
  }

  async waitForRecoveryBlock(): Promise<void> {
    if (!this.entered) throw new Error('No recovery barrier is active.');
    await this.entered.promise;
  }

  releaseRecovery(): void {
    this.gate?.resolve();
    this.gate = null;
    this.entered = null;
  }

  override async *readRecords(): AsyncGenerator<KvJournalReadResult> {
    let validRecords = 0;
    for await (const result of super.readRecords()) {
      yield result;
      if (!result.ok) continue;
      validRecords += 1;
      if (validRecords !== 1 || !this.gate) continue;
      this.entered?.resolve();
      await this.gate.promise;
    }
  }
}

class RecordingCheckpointStore extends KvCheckpointStore {
  writeCalls = 0;

  override async write(entries: Iterable<ZeroKvEntry>, sequence: number) {
    this.writeCalls += 1;
    return super.write(entries, sequence);
  }
}

class ReadBlockingCheckpointStore extends KvCheckpointStore {
  private gate: Deferred<void> | null = null;
  private entered: Deferred<void> | null = null;

  blockRead(): void {
    this.gate = deferred<void>();
    this.entered = deferred<void>();
  }

  async waitForBlockedRead(): Promise<void> {
    if (!this.entered) throw new Error('No checkpoint read barrier is active.');
    await this.entered.promise;
  }

  releaseRead(): void {
    this.gate?.resolve();
    this.gate = null;
    this.entered = null;
  }

  override async read() {
    this.entered?.resolve();
    await this.gate?.promise;
    return super.read();
  }
}

class RejectOnceCheckpointStore extends KvCheckpointStore {
  private shouldReject = true;

  override async write(entries: Iterable<ZeroKvEntry>, sequence: number) {
    if (this.shouldReject) {
      this.shouldReject = false;
      throw new KvError('KV_PERSISTENCE_FAILED', 'Intentional checkpoint rejection.');
    }
    return super.write(entries, sequence);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
}

class ScriptedKvClock implements KvClock {
  private scripted: number[] = [];
  private calls = 0;

  constructor(private fallback: number) {}

  now(): number {
    this.calls += 1;
    return this.scripted.shift() ?? this.fallback;
  }

  script(...values: number[]): void {
    this.scripted = [...values];
    this.calls = 0;
  }

  clearScript(): void {
    this.scripted = [];
    this.calls = 0;
  }

  setFallback(value: number): void {
    this.fallback = value;
  }

  scriptedCalls(): number {
    return this.calls;
  }

  remainingScriptedValues(): number {
    return this.scripted.length;
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}

async function createControlledService(
  name: string,
  durability: KvJournalDurability,
  clock: ManualKvClock
): Promise<{ service: KvService; journal: ControllableKvJournal }> {
  const directory = testDirectory(name);
  const journal = new ControllableKvJournal({ baseDir: directory, durability, clock });
  const service = new KvService({
    baseDir: directory,
    durability,
    clock,
    journal,
    fsyncMs: 60_000,
    checkpointIntervalMs: 60_000,
  });
  await service.start();
  return { service, journal };
}

async function runBlockedBatch<T>(journal: ControllableKvJournal, operation: () => Promise<T>): Promise<T> {
  journal.block();
  const result = operation();
  await journal.waitForBlockedAppend();
  await drainMicrotasks();
  journal.release();
  return result;
}

async function runPostAppendBlockedBatch<T>(
  journal: PostAppendBlockingJournal,
  operation: () => Promise<T>
): Promise<T> {
  journal.blockAfterAppend();
  const result = operation();
  await journal.waitForPostAppendBlock();
  await drainMicrotasks();
  journal.releasePostAppend();
  return result;
}

async function raceCasWithMutation<T>(
  journal: ControllableKvJournal,
  mutation: () => Promise<T>,
  compareAndSet: () => Promise<KvCompareAndSetResult>
): Promise<{ mutation: T; cas: KvCompareAndSetResult }> {
  journal.block();
  const mutationPromise = mutation();
  await journal.waitForBlockedAppend();
  const casPromise = compareAndSet();
  await drainMicrotasks();
  journal.release();
  const [mutationResult, cas] = await Promise.all([mutationPromise, casPromise]);
  return { mutation: mutationResult, cas };
}

function assertSingleCasWinner<T>(
  service: KvService,
  key: string,
  results: KvCompareAndSetResult<T>[],
  expectedPreviousValue: T | null
): void {
  const winners = results.filter((result) => result.ok);
  const losers = results.filter((result) => !result.ok);

  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(CONCURRENT_CALLS - 1);
  const final = requireEntry(service.getEntry<T>(key), key);
  const winner = winners[0]!;
  expect(winner.current).toEqual(expectedPreviousValue);
  expect(winner.value).toEqual(final.value);
  expect(winner.version).toBe(final.version);

  for (const loser of losers) {
    expect(loser.current).toEqual(final.value);
    expect(loser.value).toEqual(final.value);
    expect(loser.version).toBe(final.version);
  }
}

function requireEntry<T>(entry: ZeroKvEntry<T> | null, key: string): ZeroKvEntry<T> {
  if (!entry) throw new Error(`Expected KV entry "${key}" to exist.`);
  return entry;
}

async function setRecordVersionsByValue(
  journal: KvFileJournal,
  key: string
): Promise<Map<number, number>> {
  const versions = new Map<number, number>();
  for await (const result of journal.readRecords()) {
    if (!result.ok) continue;
    const mutation = result.record.mutation;
    if (mutation.op === 'set' && mutation.key === key && typeof mutation.value === 'number') {
      versions.set(mutation.value, result.record.sequence);
    }
  }
  return versions;
}

function countAllowed(results: Array<{ allowed: boolean }>): number {
  return results.filter((result) => result.allowed).length;
}

function integerRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

async function drainMicrotasks(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function testDirectory(name: string): string {
  return join(testRoot, name);
}
