/** Pure shared-pool settlement checks. No files, databases, actors or providers are started. */
import { expect, test } from 'bun:test';
import { WorkPool } from '../workers/work-pool';
import { JobsError } from './error';
import { sourceGateMutation } from './source-gate';
import { DatabaseError } from '../databases/database-error';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('queued cancellation is known not-started and cannot invoke a writer', async () => {
  const pool = new WorkPool({ concurrency: 1 }), blocked = deferred(), entered = deferred(), controller = new AbortController();
  const reason = new JobsError('JOBS_AUTHORITY_RETIRED'); let writes = 0;
  const occupying = pool.run(async () => { entered.resolve(); await blocked.promise; });
  try {
    await entered.promise;
    const task = sourceGateMutation(pool, context => { context.markWriteAttempted(); writes++; }, { key: 'source', signal: controller.signal });
    controller.abort(reason);
    await expect(task).rejects.toBe(reason); expect(writes).toBe(0);
  } finally { blocked.resolve(); await occupying; await pool.close(); }
});

test('active cancellation before write admission remains known and prevents a later write attempt', async () => {
  const pool = new WorkPool({ concurrency: 1 }), entered = deferred(), blocked = deferred(), controller = new AbortController();
  const reason = new JobsError('JOBS_AUTHORITY_RETIRED'); let writes = 0;
  try {
    const task = sourceGateMutation(pool, async context => {
      entered.resolve(); await blocked.promise; context.markWriteAttempted(); writes++;
    }, { key: 'source', signal: controller.signal });
    await entered.promise; controller.abort(reason);
    await expect(task).rejects.toBe(reason); blocked.resolve(); await pool.close(); expect(writes).toBe(0);
  } finally { blocked.resolve(); await pool.close(); }
});

test('active cancellation during a writer is unknown even when its abort reason resembles a proven rejection', async () => {
  const pool = new WorkPool({ concurrency: 1 }), entered = deferred(), blocked = deferred(), controller = new AbortController();
  let committed = 0;
  try {
    const task = sourceGateMutation(pool, async context => {
      context.markWriteAttempted(); entered.resolve(); await blocked.promise; committed++;
    }, { key: 'source', signal: controller.signal });
    await entered.promise; controller.abort(new JobsError('JOBS_REVISION_CONFLICT', 'not-committed'));
    await expect(task).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
    blocked.resolve(); await pool.close(); expect(committed).toBe(1);
  } finally { blocked.resolve(); await pool.close(); }
});

test('a writer accepted before cancellation cannot be reported as a known rejection', async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController(); let committed = 0;
  try {
    const task = sourceGateMutation(pool, context => {
      context.markWriteAttempted(); committed++; controller.abort(new JobsError('JOBS_AUTHORITY_RETIRED')); return { accepted: true };
    }, { key: 'source', signal: controller.signal });
    await expect(task).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' }); expect(committed).toBe(1);
  } finally { await pool.close(); }
});

for (const outcome of ['not-started', 'not-committed'] as const) test('a completed writer rejection retains proven ' + outcome + ' outcome', async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController();
  const reason = new JobsError('JOBS_REVISION_CONFLICT', outcome);
  try {
    const task = sourceGateMutation(pool, context => { context.markWriteAttempted(); throw reason; }, { key: 'source', signal: controller.signal });
    await expect(task).rejects.toBe(reason); expect(reason.outcome).toBe(outcome);
  } finally { await pool.close(); }
});

test('an unclassified post-attempt exception cannot imply rollback', async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController();
  try {
    await expect(sourceGateMutation(pool, context => { context.markWriteAttempted(); throw new Error('synthetic lost response'); },
      { key: 'source', signal: controller.signal })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
  } finally { await pool.close(); }
});

test('the callback receives the actual pool signal and shutdown during a writer remains unknown', async () => {
  const pool = new WorkPool({ concurrency: 1 }), entered = deferred(), blocked = deferred(), controller = new AbortController();
  let observed: AbortSignal | undefined;
  try {
    const task = sourceGateMutation(pool, async context => {
      observed = context.signal; expect(observed).not.toBe(controller.signal); context.markWriteAttempted(); entered.resolve(); await blocked.promise;
    }, { key: 'source', signal: controller.signal });
    await entered.promise;
    const closing = pool.close();
    await expect(task).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(observed?.aborted).toBe(true); expect(controller.signal.aborted).toBe(false); blocked.resolve(); await closing;
  } finally { blocked.resolve(); await pool.close(); }
});

for (const outcome of ['not-started', 'not-committed'] as const) test('native DatabaseError preserves its proven ' + outcome + ' outcome', async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController();
  const reason = new DatabaseError('DATABASE_BACKPRESSURE', 'Synthetic known admission rejection.', { outcome });
  try {
    await expect(sourceGateMutation(pool, context => { context.markWriteAttempted(); throw reason; },
      { key: 'source', signal: controller.signal })).rejects.toBe(reason);
  } finally { await pool.close(); }
});

for (const outcome of [null, 'unknown'] as const) test('DatabaseError without proven non-acceptance remains unknown: ' + outcome, async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController();
  try {
    await expect(sourceGateMutation(pool, context => { context.markWriteAttempted(); throw new DatabaseError('DATABASE_EXECUTOR_FAILED', 'Synthetic missing settlement.', { outcome }); },
      { key: 'source', signal: controller.signal })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
  } finally { await pool.close(); }
});

test('a plain forged non-commit outcome never authorizes replay after writer admission', async () => {
  const pool = new WorkPool({ concurrency: 1 }), controller = new AbortController();
  try {
    await expect(sourceGateMutation(pool, context => { context.markWriteAttempted(); throw { code: 'DATABASE_BACKPRESSURE', outcome: 'not-committed' }; },
      { key: 'source', signal: controller.signal })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
  } finally { await pool.close(); }
});
