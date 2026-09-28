/**
 * kv-service.test.ts
 *
 * Verifies the KV service facade over memory, journal, checkpoint, counters,
 * namespaces, and limiter helpers. Elysia plugin wiring is covered separately.
 */

import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  configureObservability,
  getObservabilityRuntime,
  MemoryEventStore,
  OBS_CODES,
} from '../observability';
import { KvService, ManualKvClock } from './index';

const testRoot = join(process.cwd(), '.zero/kv-service-tests');

describe('KvService', () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  test('persists writes through checkpoint and journal replay', async () => {
    const dir = join(testRoot, 'persistent-service');
    const clock = new ManualKvClock(1000);
    const service = new KvService({ baseDir: dir, durability: 'always', clock });

    await service.start();
    await service.set('a', 1);
    await service.set('b', 2);
    await service.checkpoint();
    await service.set('c', 3);
    await service.delete('a');
    await service.increment('b', 3);
    await service.flush();

    const recovered = new KvService({ baseDir: dir, durability: 'always', clock });
    await recovered.start();

    expect(recovered.get('a')).toBeUndefined();
    expect(recovered.get<number>('b')).toBe(5);
    expect(recovered.get<number>('c')).toBe(3);
    expect(recovered.status().sequence).toBe(5);

    await recovered.set('d', 4);
    expect(recovered.getEntry('d')?.version).toBe(6);
    await recovered.stop();
  });

  test('supports namespaces and counters', async () => {
    const service = new KvService({ durability: 'memory' });
    await service.start();

    const auth = service.namespace('auth');
    await auth.set('session', 'ok');
    expect(service.get<string>('auth:session')).toBe('ok');
    expect(auth.get<string>('session')).toBe('ok');

    expect(await service.counters.increment('requests', 2)).toBe(2);
    expect(await service.counters.decrement('requests')).toBe(1);
    expect(service.counters.value('requests')).toBe(1);
    expect(await service.counters.reset('requests')).toBe(true);
    expect(service.counters.value('requests')).toBe(0);
  });

  test('supports fixed-window and token-bucket limiter helpers', async () => {
    const clock = new ManualKvClock(0);
    const service = new KvService({ durability: 'memory', clock });
    await service.start();

    const first = await service.limiter.fixedWindow('login:user:1', { limit: 2, windowMs: 1000 });
    const second = await service.limiter.fixedWindow('login:user:1', { limit: 2, windowMs: 1000 });
    const third = await service.limiter.fixedWindow('login:user:1', { limit: 2, windowMs: 1000 });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(1000);

    const bucketOne = await service.limiter.tokenBucket('api:user:1', {
      capacity: 2,
      refillPerSec: 1,
    });
    const bucketTwo = await service.limiter.tokenBucket('api:user:1', {
      capacity: 2,
      refillPerSec: 1,
      cost: 2,
    });

    expect(bucketOne.allowed).toBe(true);
    expect(bucketTwo.allowed).toBe(false);

    clock.advance(1000);
    const bucketThree = await service.limiter.tokenBucket('api:user:1', {
      capacity: 2,
      refillPerSec: 1,
    });
    expect(bucketThree.allowed).toBe(true);
  });

  test('getOrSet computes values only on cache misses', async () => {
    const service = new KvService({ durability: 'memory' });
    await service.start();
    let calls = 0;

    const first = await service.getOrSet('computed', () => {
      calls += 1;
      return 'value';
    });
    const second = await service.getOrSet('computed', () => {
      calls += 1;
      return 'next';
    });

    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(calls).toBe(1);
  });

  test('isolates memory durability from disk state and other instances', async () => {
    const dir = join(testRoot, 'memory-isolation');
    const durable = new KvService({ baseDir: dir, durability: 'always' });
    await durable.start();
    await durable.set('disk-only', 'persisted');
    await durable.stop();

    const first = new KvService({ baseDir: dir, durability: 'memory' });
    await first.start();
    expect(first.get('disk-only')).toBeUndefined();
    await first.set('memory-only', 'private');
    await first.stop();
    await first.start();
    expect(first.get<string>('memory-only')).toBe('private');
    await first.stop();

    const second = new KvService({ baseDir: dir, durability: 'memory' });
    await second.start();
    expect(second.get('disk-only')).toBeUndefined();
    expect(second.get('memory-only')).toBeUndefined();
    await second.stop();
  });

  test('memory durability never creates persistence files', async () => {
    const dir = join(testRoot, 'memory-no-files');
    const service = new KvService({
      baseDir: dir,
      durability: 'memory',
      checkpointIntervalMs: 1,
      fsyncMs: 1,
    });

    await service.start();
    await service.set('only-in-memory', true);
    await Bun.sleep(10);
    await service.flush();
    await service.checkpoint();
    await service.stop();

    await expect(access(dir)).rejects.toThrow();
  });

  test('becomes terminal while preserving a failed final flush', async () => {
    const dir = join(testRoot, 'failed-stop');
    const service = new KvService({ baseDir: dir, durability: 'always' });
    await service.start();
    await service.set('pending', 'value');
    const failure = new Error('forced final flush failure');
    let flushes = 0;
    service.flush = async () => {
      flushes += 1;
      throw failure;
    };

    await expect(service.stop()).rejects.toBe(failure);
    expect(service.status().started).toBeFalse();
    expect(flushes).toBe(1);

    await service.stop();
    expect(flushes).toBe(1);
  });

  test('observes periodic persistence failures without an unhandled rejection', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    const service = new KvService({
      baseDir: join(testRoot, 'background-failure'),
      durability: 'everysec',
      fsyncMs: 1,
      checkpointIntervalMs: 60_000,
    });
    const failure = new Error('forced periodic flush failure');
    let failFlush = true;
    service.flush = async () => {
      if (failFlush) throw failure;
    };

    try {
      await service.start();
      await waitFor(() => events.query({
        code: OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      }).events.length > 0);

      const [event] = events.query({
        code: OBS_CODES.KV_BACKGROUND_PERSIST_FAILED.code,
      }).events;
      expect(event?.metadata?.operation).toBe('flush');
      expect(event?.error).toBe(failure);
    } finally {
      failFlush = false;
      await service.stop();
      configureObservability(previousObservability);
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for KV background persistence event.');
    await Bun.sleep(5);
  }
}
