/** Synthetic promises only. No files, fixtures, timers beyond bounded pool tests,
 * providers or generated output; release bodies and join their pools in finally.
 */
import { expect, test } from 'bun:test';
import { WorkPool } from './work-pool';

function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release() { release(); } };
}
async function pending(task: Promise<void>) {
  let settled = false; void task.then(() => { settled = true; }, () => { settled = true; });
  await Bun.sleep(3); expect(settled).toBe(false);
}

test('physical join requires retired intake and an idle close remains idempotent', async () => {
  const pool = new WorkPool();
  try {
    await expect(pool.drainPhysical()).rejects.toMatchObject({ code: 'WORKER_NOT_READY' });
    expect(pool.status().state).toBe('open');
    await pool.close(); await pool.drainPhysical(); await pool.drainPhysical();
    expect(pool.status()).toMatchObject({ state: 'closed', active: 0, queued: 0 });
  } finally { await pool.close(); await pool.drainPhysical(); }
});

for (const rejects of [false, true]) test(`physical join outlives cancelled callers and rejected shutdown grace; late body ${rejects ? 'rejects' : 'fulfills'}`, async () => {
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 5 }), body = latch(), entered = latch(), abort = new AbortController();
  let queuedStarted = false, bodySettled = false;
  const running = pool.run(async () => {
    entered.release(); await body.promise; bodySettled = true;
    if (rejects) throw new Error('Synthetic late callback failure.');
  }, { signal: abort.signal });
  const queued = pool.run(() => { queuedStarted = true; });
  const outcomes = Promise.allSettled([running, queued]);
  try {
    await entered.promise; abort.abort(new Error('Synthetic caller cancellation.'));
    await expect(running).rejects.toThrow('Synthetic caller cancellation.');
    await expect(pool.close()).rejects.toMatchObject({ code: 'WORKER_DRAIN_TIMEOUT', outcome: 'unknown' });
    await outcomes; expect(queuedStarted).toBe(false); expect(bodySettled).toBe(false);
    const joined = pool.drainPhysical(); await pending(joined);
    expect(pool.status()).toMatchObject({ state: 'closing', active: 1, queued: 0 });
    body.release(); await joined;
    expect(bodySettled).toBe(true); expect(pool.status()).toMatchObject({ state: 'closed', active: 0, queued: 0 });
    await pool.close(); await pool.drainPhysical();
  } finally { body.release(); await outcomes; try { await pool.close(); } finally { await pool.drainPhysical(); } }
});

test('physical join consumes raw callback rejection after an execution deadline without starting queued work during shutdown', async () => {
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 5 }), body = latch(), entered = latch();
  let queuedStarted = false;
  const running = pool.run(async () => { entered.release(); await body.promise; throw new Error('Synthetic retired body.'); }, { executionTimeoutMs: 5 });
  const outcomes = Promise.allSettled([running, pool.run(() => { queuedStarted = true; })]);
  try {
    await entered.promise;
    await expect(running).rejects.toMatchObject({ code: 'WORKER_EXECUTION_TIMEOUT', outcome: 'unknown' });
    await expect(pool.close()).rejects.toMatchObject({ code: 'WORKER_DRAIN_TIMEOUT' });
    const joined = pool.drainPhysical(); await pending(joined);
    body.release(); await joined; await outcomes;
    expect(queuedStarted).toBe(false); expect(pool.status().active).toBe(0);
  } finally { body.release(); await outcomes; try { await pool.close(); } finally { await pool.drainPhysical(); } }
});
