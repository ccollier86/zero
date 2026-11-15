/** Pure synthetic activities; every test settles owned work and closes its pool. No files or providers. */
import { expect, test } from 'bun:test';
import { WorkPool, DEFAULT_WORK_POOL_CAPACITY } from './work-pool';

function gate() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function turn() { await new Promise<void>(resolve => setTimeout(resolve, 0)); }

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
