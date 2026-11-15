/** Pure synthetic activities; every test settles owned work and closes its pool. No files or providers. */
import { expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { currentLoggingAttribution, runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { WorkPool, DEFAULT_WORK_POOL_CAPACITY } from './work-pool';

function gate() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function turn() { await new Promise<void>(resolve => setTimeout(resolve, 0)); }

for (const outcome of ['fulfilled', 'rejected', 'cancelled'] as const) {
  test(`callbacks keep their submitting async context across ${outcome} refill and queued cancellation`, async () => {
    const local = new AsyncLocalStorage<string>(), pool = new WorkPool({ concurrency: 1 });
    const hold = gate(), entered = gate(), runningAbort = new AbortController(), waitingAbort = new AbortController();
    const pending: Promise<unknown>[] = [];
    let cancelledEntered = false;
    const read = async () => { const before = local.getStore() ?? null; await Promise.resolve(); return [before, local.getStore() ?? null]; };
    try {
      const first = local.run('first', () => pool.run(async () => {
        entered.release(); expect(await read()).toEqual(['first', 'first']); await hold.promise;
        expect(await read()).toEqual(['first', 'first']);
        if (outcome === 'rejected') throw new Error('Synthetic first-task rejection.');
        return 'first';
      }, { signal: runningAbort.signal }));
      const firstOutcome = first.then(value => ({ value }), error => ({ error })); pending.push(firstOutcome);
      await entered.promise;
      const cancelled = local.run('cancelled', () => pool.run(() => { cancelledEntered = true; }, { signal: waitingAbort.signal }));
      const cancelledOutcome = cancelled.catch(error => error); pending.push(cancelledOutcome);
      const second = local.run('second', () => pool.run(read)); pending.push(second);
      const background = pool.run(read); pending.push(background);
      local.run('foreign-cancellation', () => waitingAbort.abort(new Error('Synthetic queued cancellation.')));
      expect(await cancelledOutcome).toMatchObject({ message: 'Synthetic queued cancellation.' });
      expect(cancelledEntered).toBe(false);
      if (outcome === 'cancelled') {
        local.run('foreign-cancellation', () => runningAbort.abort(new Error('Synthetic active cancellation.')));
        expect(await firstOutcome).toMatchObject({ error: { message: 'Synthetic active cancellation.' } });
        expect(pool.status()).toMatchObject({ active: 1, queued: 2 });
      }
      local.run('foreign-release', () => hold.release());
      expect(await second).toEqual(['second', 'second']);
      expect(await background).toEqual([null, null]);
      if (outcome === 'fulfilled') expect(await firstOutcome).toEqual({ value: 'first' });
      if (outcome === 'rejected') expect(await firstOutcome).toMatchObject({ error: { message: 'Synthetic first-task rejection.' } });
      expect(pool.status()).toMatchObject({ active: 0, queued: 0 });
    } finally { hold.release(); await local.run('foreign-close', () => pool.close()); await Promise.allSettled(pending); }
  });
}

test('a queued callback\'s thenable is assimilated in its submitting async context', async () => {
  const local = new AsyncLocalStorage<string>(), pool = new WorkPool({ concurrency: 1 }), hold = gate();
  const first = local.run('previous-owner', () => pool.run(() => hold.promise));
  const second = local.run('thenable-owner', () => pool.run(() => {
    const callbackOwner = local.getStore();
    return { then(resolve: (value: [string | undefined, string | undefined]) => void) {
      resolve([callbackOwner, local.getStore()]);
    } } as PromiseLike<[string | undefined, string | undefined]>;
  }));
  const outcomes = Promise.allSettled([first, second]);
  try {
    expect(pool.status()).toMatchObject({ active: 1, queued: 1 }); hold.release();
    expect(await second).toEqual(['thenable-owner', 'thenable-owner']); await first;
  } finally { hold.release(); await pool.close(); await outcomes; }
});

test('close cancels queued callbacks without changing a running callback\'s submitting async context', async () => {
  const local = new AsyncLocalStorage<string>(), pool = new WorkPool({ concurrency: 1 });
  const hold = gate(), entered = gate(); let queuedEntered = false;
  const running = local.run('running-owner', () => pool.run(async signal => {
    entered.release(); expect(local.getStore()).toBe('running-owner'); await hold.promise;
    expect(local.getStore()).toBe('running-owner'); expect(signal.aborted).toBe(true);
  }));
  const waiting = local.run('queued-owner', () => pool.run(() => { queuedEntered = true; }));
  const outcomes = Promise.allSettled([running, waiting]);
  let closing: Promise<void> | undefined;
  try {
    await entered.promise; closing = local.run('closing-owner', () => pool.close());
    expect(pool.status()).toMatchObject({ state: 'closing', active: 1, queued: 0 });
    expect(queuedEntered).toBe(false); hold.release(); await closing;
    expect((await outcomes).map(value => value.status)).toEqual(['rejected', 'rejected']);
    expect(pool.status()).toMatchObject({ state: 'closed', active: 0, queued: 0 });
  } finally { hold.release(); await closing; await pool.close(); await outcomes; }
});

test('queued background work cannot borrow a retired audit frame, while its own retired frame still fails closed', async () => {
  const owner = {}, pool = new WorkPool({ concurrency: 1 }), hold = gate();
  const pending: Promise<unknown>[] = [];
  try {
    await runWithLoggingAttribution(owner, loggingContext(null), () => {}, () => {
      // This callback deliberately waits beyond its caller's audit lifetime but
      // performs no attributed work. Its completion must not lend that lifetime.
      pending.push(pool.run(() => hold.promise));
    });
    const background = pool.run(async () => { await Promise.resolve(); return currentLoggingAttribution(owner); }); pending.push(background);
    let retiredOutcome!: Promise<unknown>;
    await runWithLoggingAttribution(owner, loggingContext(null), () => {}, () => {
      retiredOutcome = pool.run(() => currentLoggingAttribution(owner)).catch(error => error); pending.push(retiredOutcome);
    });
    const activeContext = { ...loggingContext(null), requestId: 'synthetic-active-request' };
    const active = runWithLoggingAttribution(owner, activeContext, () => {}, () => pool.run(async () => {
      expect(currentLoggingAttribution(owner)).toBe(activeContext); await Promise.resolve(); return currentLoggingAttribution(owner);
    })); pending.push(active);
    expect(pool.status()).toMatchObject({ active: 1, queued: 3 }); hold.release();
    expect(await background).toBeNull();
    expect(await retiredOutcome).toMatchObject({ message: 'Logging attribution lifetime is closed.' });
    expect(await active).toBe(activeContext);
    expect(pool.status()).toMatchObject({ active: 0, queued: 0 });
  } finally { hold.release(); await pool.close(); await Promise.allSettled(pending); }
});

test('max is finite, configuration is strict and maxQueued zero still admits immediate execution', async () => {
  const pool = new WorkPool(), immediate = new WorkPool({ concurrency: 1, maxQueued: 0 });
  const hold = gate();
  try {
    expect(pool.capacity).toBe(DEFAULT_WORK_POOL_CAPACITY);
    for (const options of [{ concurrency: 0 }, { concurrency: Infinity }, { concurrency: 3, maxConcurrency: 2 },
      { maxQueued: -1 }, { queueTimeoutMs: 0 }, { executionTimeoutMs: NaN }, { surprise: true }]) {
      expect(() => new WorkPool(options as never)).toThrow();
    }
    const work = immediate.run(async () => { await hold.promise; return 1; });
    await expect(immediate.run(() => 2)).rejects.toMatchObject({ code: 'WORKER_CAPACITY', outcome: 'not-started' });
    hold.release(); expect(await work).toBe(1);
  } finally { hold.release(); await Promise.all([pool.close(), immediate.close()]); }
});

test('independent calls progress concurrently without waiting for the slowest activity', async () => {
  const pool = new WorkPool({ concurrency: 2 }), a = gate(), b = gate();
  const entered: string[] = [];
  try {
    const first = pool.run(async () => { entered.push('a'); await a.promise; return 'a'; });
    const second = pool.run(async () => { entered.push('b'); await b.promise; return 'b'; });
    const third = pool.run(() => { entered.push('c'); return 'c'; });
    await turn(); expect(entered).toEqual(['a', 'b']);
    b.release(); expect(await second).toBe('b'); expect(await third).toBe('c');
    expect(pool.status().active).toBe(1); a.release(); expect(await first).toBe('a');
  } finally { a.release(); b.release(); await pool.close(); }
});

test('queued keys rotate fairly and a saturated key does not strand available slots', async () => {
  const pool = new WorkPool({ concurrency: 2, maxConcurrentPerKey: 1 }), a = gate(), b = gate();
  const entered: string[] = [];
  try {
    const first = pool.run(async () => { entered.push('a1'); await a.promise; }, { key: 'a' });
    const a2 = pool.run(() => { entered.push('a2'); }, { key: 'a' });
    const a3 = pool.run(() => { entered.push('a3'); }, { key: 'a' });
    const b1 = pool.run(async () => { entered.push('b1'); await b.promise; }, { key: 'b' });
    const c1 = pool.run(() => { entered.push('c1'); }, { key: 'c' });
    await turn(); expect(entered).toEqual(['a1', 'b1']);
    b.release(); await b1; await c1; expect(entered).toEqual(['a1', 'b1', 'c1']);
    a.release(); await Promise.all([first, a2, a3]);
    expect(entered).toEqual(['a1', 'b1', 'c1', 'a2', 'a3']);
    expect(pool.status()).toMatchObject({ active: 0, queued: 0, waitingKeys: 0 });
  } finally { a.release(); b.release(); await pool.close(); }
});

test('queued cancellation never runs its callback and does not affect another caller', async () => {
  const pool = new WorkPool({ concurrency: 1 }), hold = gate(), abort = new AbortController();
  let entered = false;
  try {
    const running = pool.run(async () => { await hold.promise; return 1; });
    const waiting = pool.run(() => { entered = true; }, { signal: abort.signal });
    const failure = waiting.catch(error => error);
    abort.abort(new Error('synthetic cancel')); expect(await failure).toMatchObject({ message: 'synthetic cancel' });
    expect(entered).toBe(false); expect(pool.size).toBe(1);
    hold.release(); expect(await running).toBe(1);
  } finally { hold.release(); await pool.close(); }
});

test('running cancellation rejects the caller but retains the physical slot until uncooperative work finishes', async () => {
  const pool = new WorkPool({ concurrency: 1 }), hold = gate(), abort = new AbortController();
  let nextEntered = false;
  try {
    const running = pool.run(async () => { await hold.promise; return 1; }, { signal: abort.signal });
    const next = pool.run(() => { nextEntered = true; return 2; });
    const failure = running.catch(error => error);
    await turn(); abort.abort(new Error('synthetic cancel')); expect(await failure).toMatchObject({ message: 'synthetic cancel' }); await turn();
    expect(pool.status()).toMatchObject({ active: 1, queued: 1 }); expect(nextEntered).toBe(false);
    hold.release(); expect(await next).toBe(2);
  } finally { hold.release(); await pool.close(); }
});

test('queue and execution deadlines have different outcomes and timed-out work cannot oversubscribe a pool', async () => {
  const pool = new WorkPool({ concurrency: 1 }), hold = gate();
  let queuedEntered = false;
  try {
    const running = pool.run(async () => { await hold.promise; }, { executionTimeoutMs: 20 });
    const runFailure = running.catch(error => error);
    const queued = pool.run(() => { queuedEntered = true; }, { queueTimeoutMs: 5 });
    await expect(queued).rejects.toMatchObject({ code: 'WORKER_QUEUE_TIMEOUT', outcome: 'not-started' });
    expect(await runFailure).toMatchObject({ code: 'WORKER_EXECUTION_TIMEOUT', outcome: 'unknown' });
    expect(queuedEntered).toBe(false); expect(pool.status().active).toBe(1);
    hold.release(); await turn(); expect(pool.size).toBe(0);
  } finally { hold.release(); await pool.close(); }
});

test('throws, rejections and thenables release their slots without detached unhandled rejections', async () => {
  const pool = new WorkPool({ concurrency: 1 });
  try {
    await expect(pool.run(() => { throw new Error('synthetic sync'); })).rejects.toThrow('synthetic sync');
    await expect(pool.run(() => Promise.reject(new Error('synthetic async')))).rejects.toThrow('synthetic async');
    expect(await pool.run(() => ({ then(resolve: (value: number) => void) { resolve(7); } }) as PromiseLike<number>)).toBe(7);
    expect(pool.size).toBe(0);
  } finally { await pool.close(); }
});

test('close is idempotent, aborts cooperative work, clears queued callbacks and retires admission', async () => {
  const pool = new WorkPool({ concurrency: 1 });
  let queuedEntered = false;
  const running = pool.run(signal => new Promise<void>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const waiting = pool.run(() => { queuedEntered = true; });
  const outcomes = Promise.allSettled([running, waiting]);
  try {
    await turn(); const closed = pool.close(); expect(pool.close()).toBe(closed); await closed;
    expect((await outcomes).map(value => value.status)).toEqual(['rejected', 'rejected']);
    expect(queuedEntered).toBe(false); expect(pool.status()).toMatchObject({ state: 'closed', active: 0, queued: 0 });
    await expect(pool.run(() => 1)).rejects.toMatchObject({ code: 'WORKER_NOT_READY' });
  } finally { await pool.close(); }
});

test('shutdown timeout reports unknown and retains occupancy rather than pretending the callback exited', async () => {
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 5 }), hold = gate();
  const running = pool.run(() => hold.promise); const outcome = Promise.allSettled([running]);
  try {
    await turn(); await expect(pool.close()).rejects.toMatchObject({ code: 'WORKER_DRAIN_TIMEOUT', outcome: 'unknown' });
    expect(pool.status()).toMatchObject({ state: 'closing', active: 1 });
  } finally { hold.release(); await outcome; await turn(); }
  expect(pool.status()).toMatchObject({ state: 'closed', active: 0 });
});

test('pre-aborted and invalid requests create no pool entries', async () => {
  const pool = new WorkPool(), abort = new AbortController(); abort.abort(new Error('pre-cancelled'));
  try {
    await expect(pool.run(() => 1, { signal: abort.signal })).rejects.toThrow('pre-cancelled');
    await expect(pool.run(() => 1, { key: '' })).rejects.toMatchObject({ code: 'WORKER_CONFIG_INVALID' });
    expect(pool.size).toBe(0);
  } finally { await pool.close(); }
});

test('configuration and per-call options reject accessors without executing authored getters', async () => {
  let reads = 0;
  const options = Object.defineProperty({}, 'concurrency', { enumerable: true, get() { reads++; return 1; } });
  expect(() => new WorkPool(options)).toThrow();
  const pool = new WorkPool();
  try {
    const request = Object.defineProperty({}, 'key', { enumerable: true, get() { reads++; return 'secret'; } });
    await expect(pool.run(() => 1, request)).rejects.toMatchObject({ code: 'WORKER_CONFIG_INVALID' });
    expect(reads).toBe(0); expect(pool.size).toBe(0);
  } finally { await pool.close(); }
});

test('a saturated key cannot strand spare execution capacity behind a full waiting queue', async () => {
  const pool = new WorkPool({ concurrency: 2, maxConcurrentPerKey: 1, maxQueued: 1 }), hold = gate();
  const pending: Promise<unknown>[] = [];
  try {
    pending.push(pool.run(() => hold.promise, { key: 'busy' }));
    pending.push(pool.run(() => 2, { key: 'busy' }));
    expect(pool.status()).toMatchObject({ active: 1, queued: 1 });
    expect(await pool.run(() => 3, { key: 'independent' })).toBe(3);
    expect(pool.status()).toMatchObject({ active: 1, queued: 1 });
    hold.release(); await Promise.all(pending);
  } finally { hold.release(); await pool.close(); await Promise.allSettled(pending); }
});

test('per-key waiting limits leave headroom for other admitted scopes without changing max execution concurrency', async () => {
  const pool = new WorkPool({ concurrency: 2, maxQueued: 4, maxQueuedPerKey: 1 }), hold = gate();
  const pending: Promise<unknown>[] = [];
  try {
    pending.push(pool.run(() => hold.promise, { key: 'a' }), pool.run(() => hold.promise, { key: 'a' }));
    pending.push(pool.run(() => 1, { key: 'a' }));
    await expect(pool.run(() => 2, { key: 'a' })).rejects.toMatchObject({ code: 'WORKER_CAPACITY', outcome: 'not-started' });
    const other = pool.run(() => 3, { key: 'b' }); pending.push(other);
    expect(pool.status()).toMatchObject({ capacity: 2, active: 2, queued: 2, waitingKeys: 2 });
    hold.release(); expect(await other).toBe(3); await Promise.all(pending);
  } finally { hold.release(); await pool.close(); await Promise.allSettled(pending); }
});
