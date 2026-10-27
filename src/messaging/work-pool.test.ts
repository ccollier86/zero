/** Real deferred activities prove concurrency, bounded admission, per-caller cancellation and shutdown without database/provider mocks. */
import { expect, test } from 'bun:test';
import { MessagingWorkPool } from './work-pool';
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('independent calls enter concurrently, a third advances when any slot finishes, and one slow call is not a global lane', async () => {
  const pool = new MessagingWorkPool(2), first = deferred(), second = deferred(), entered: string[] = [];
  try {
    const a = pool.run(async () => { entered.push('a'); await first.promise; return 'a'; });
    const b = pool.run(async () => { entered.push('b'); await second.promise; return 'b'; });
    const c = pool.run(async () => { entered.push('c'); return 'c'; });
    await Promise.resolve(); expect(entered).toEqual(['a', 'b']); expect(pool.size).toBe(3);
    second.release(); expect(await b).toBe('b'); expect(await c).toBe('c'); expect(entered).toEqual(['a', 'b', 'c']);
    first.release(); expect(await a).toBe('a');
  } finally { first.release(); second.release(); await pool.close(); }
});

test('cancelling a queued caller cannot cancel another running call and a closed pool admits no continuation', async () => {
  const pool = new MessagingWorkPool(1), gate = deferred(), cancellation = new AbortController(); let queuedEntered = false;
  const running = pool.run(async () => { await gate.promise; return true; });
  const queued = pool.run(async () => { queuedEntered = true; return false; }, cancellation.signal);
  cancellation.abort(new Error('Synthetic queued cancellation'));
  await expect(queued).rejects.toThrow('Synthetic queued cancellation'); expect(queuedEntered).toBe(false);
  gate.release(); expect(await running).toBe(true); await pool.close();
  await expect(pool.run(async () => true)).rejects.toMatchObject({ code: 'MESSAGING_NOT_READY' });
});

test('shutdown interrupts owned cooperative work and rejects bounded waiters without allowing their callbacks to start', async () => {
  const pool = new MessagingWorkPool(1); let pendingEntered = false;
  const active = pool.run(async signal => { await new Promise<void>((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); });
  const pending = pool.run(async () => { pendingEntered = true; });
  const outcomes = Promise.allSettled([active, pending]); await Promise.resolve(); await pool.close();
  expect((await outcomes).map(value => value.status)).toEqual(['rejected', 'rejected']); expect(pendingEntered).toBe(false); expect(pool.size).toBe(0);
});
