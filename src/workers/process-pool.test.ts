/** Real Bun subprocesses. Every pool is closed in finally, including failure, timeout and kill paths. */
import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { ProcessWorkPool } from './process-pool';
import { tasks, sumTask } from './test-support/worker-entry';
import { workerValue } from './worker-value';
import { defineWorkerTask } from './worker-task';
import { join } from 'node:path';
import { ownedWorkerFixture } from './test-support/owned-fixture';
import { existsSync } from 'node:fs';

const launch = { kind: 'source' as const, entrypoint: fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url)) };
// Routine tests use the public execution default. A 3 s whole-operation budget
// incorrectly timed out cold Linux/amd64 workers under architecture emulation;
// deadline-specific tests below still supply their own short explicit limits.
function pool(processes = 2) { return new ProcessWorkPool({ tasks, launch, processes }); }

test('registered tasks execute in another reusable process and return detached values', async () => {
  const owner = pool(1);
  try {
    const first = await owner.run('fixture.echo', { value: 1 }) as { input: { value: number }; pid: number };
    const second = await owner.run('fixture.echo', { value: 2 }) as { pid: number };
    expect(first.input).toEqual({ value: 1 }); expect(first.pid).not.toBe(process.pid); expect(second.pid).toBe(first.pid);
    expect(owner.status()).toMatchObject({ active: 0, queued: 0, processes: 1 });
  } finally { await owner.close(); }
  expect(owner.status()).toMatchObject({ state: 'closed', processes: 0 });
});

test('CPU work is off the parent event loop and independent processes overlap', async () => {
  const owner = pool(2);
  try {
    // Warm both slots before measuring the actual CPU boundary.
    await Promise.all([owner.run('fixture.echo', null), owner.run('fixture.echo', null)]);
    let parentTicked = false;
    const timer = setTimeout(() => { parentTicked = true; }, 5);
    try {
      const [a, b] = await Promise.all([owner.run('fixture.cpu', 100), owner.run('fixture.cpu', 100)]) as { pid: number; worked: boolean; startedAt: number; finishedAt: number }[];
      expect(parentTicked).toBe(true); expect(a!.pid).not.toBe(b!.pid); expect(a!.worked && b!.worked).toBe(true);
      expect(Math.max(a!.startedAt, b!.startedAt)).toBeLessThan(Math.min(a!.finishedAt, b!.finishedAt));
    } finally { clearTimeout(timer); }
  } finally { await owner.close(); }
});

test('children get only the explicit environment and never inherit parent secrets', async () => {
  const previous = process.env.ZERO_WORKER_SYNTHETIC_SECRET;
  process.env.ZERO_WORKER_SYNTHETIC_SECRET = 'parent-only-synthetic';
  const owner = new ProcessWorkPool({ tasks, launch, processes: 1, env: { ZERO_WORKER_SYNTHETIC_ALLOWED: 'allowed' } });
  try { expect(await owner.run('fixture.env', null)).toEqual({ inheritedSecret: false, allowedValue: true }); }
  finally {
    try { await owner.close(); }
    finally { if (previous === undefined) delete process.env.ZERO_WORKER_SYNTHETIC_SECRET; else process.env.ZERO_WORKER_SYNTHETIC_SECRET = previous; }
  }
});

test('mismatched task catalogs fail before handler execution; invalid input cannot start a child', async () => {
  const owner = new ProcessWorkPool({ tasks: [tasks[0]!], launch, processes: 1 });
  try {
    await expect(owner.run('fixture.echo', null)).rejects.toMatchObject({ code: 'WORKER_VERSION_MISMATCH', outcome: 'not-started' });
    expect(owner.status().processes).toBe(0);
  } finally { await owner.close(); }
  const fresh = pool(1);
  try {
    await expect(fresh.run('fixture.cpu', -1)).rejects.toBeDefined();
    expect(fresh.status().processes).toBe(0);
  } finally { await fresh.close(); }
});

test('handler errors are sanitized and process death is unknown, never an automatic duplicate retry', async () => {
  const owner = pool(1);
  try {
    const error = await owner.run('fixture.fail', null).catch(error => error);
    expect(error).toMatchObject({ code: 'WORKER_TASK_FAILED', outcome: 'unknown' });
    expect(String(error)).not.toContain('PRIVATE_SYNTHETIC_FAILURE_VALUE');
    await expect(owner.run('fixture.exit', null)).rejects.toMatchObject({ code: 'WORKER_PROCESS_FAILED', outcome: 'unknown' });
    const result = await owner.run('fixture.echo', 'after-death') as { input: string };
    expect(result.input).toBe('after-death');
  } finally { await owner.close(); }
});

test('hard timeout terminates a noncooperative CPU generation and shutdown leaves no owned children', async () => {
  const owner = pool(1);
  try {
    await owner.run('fixture.echo', null);
    await expect(owner.run('fixture.hang', null, { executionTimeoutMs: 30 })).rejects.toMatchObject({ code: 'WORKER_EXECUTION_TIMEOUT', outcome: 'unknown' });
  } finally { await owner.close(); }
  expect(owner.status()).toMatchObject({ state: 'closed', active: 0, queued: 0, processes: 0 });
});

test('a parent-side rejected result after actual task execution is unknown, not a not-started input failure', async () => {
  const modified = tasks.map(task => task.name === 'fixture.echo' ? defineWorkerTask({ name: task.name, version: task.version,
    parseInput: value => value, parseOutput: () => { throw new Error('PRIVATE_PARENT_VALIDATOR_VALUE'); }, run: value => value }) : task);
  const owner = new ProcessWorkPool({ tasks: modified, launch, processes: 1 });
  try {
    const error = await owner.run('fixture.echo', null).catch(error => error);
    expect(error).toMatchObject({ code: 'WORKER_PROCESS_FAILED', outcome: 'unknown' });
    expect(String(error)).not.toContain('PRIVATE_PARENT_VALIDATOR_VALUE');
  } finally { await owner.close(); }
});

test('death while idle does not permanently consume the process slot and the next call admits a fresh generation', async () => {
  const owner = pool(1);
  try {
    const first = await owner.run('fixture.idle-exit', null) as { pid: number };
    await new Promise<void>(resolve => setTimeout(resolve, 80));
    const next = await owner.run('fixture.echo', null) as { pid: number };
    expect(next.pid).not.toBe(first.pid); expect(owner.status().processes).toBe(1);
  } finally { await owner.close(); }
});

test('death racing reuse is reconciled before dispatch without replaying a task or losing its authority fence', async () => {
  const owner = pool(1);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await owner.run('fixture.echo', null) as { pid: number };
      let checks = 0;
      const current = await owner.run('fixture.echo', { once: attempt }, {}, () => {
        if (checks++ === 0) process.kill(previous.pid, 'SIGKILL');
      }) as { pid: number; input: unknown };
      expect(current.pid).not.toBe(previous.pid);
      expect(current.input).toEqual({ once: attempt });
      expect(checks).toBeGreaterThanOrEqual(2);
      expect(owner.status()).toMatchObject({ processes: 1, active: 0, queued: 0 });
    }
  } finally { await owner.close(); }
});

test('simultaneous acquire/close rejects undispatched work and cannot create a child after shutdown', async () => {
  const owner = pool(2); const pending: Promise<unknown>[] = [];
  try {
    await Promise.all([owner.run('fixture.echo', null), owner.run('fixture.echo', null)]);
    for (let i = 0; i < 6; i++) pending.push(owner.run('fixture.cpu', 100));
    const results = Promise.allSettled(pending);
    await owner.close();
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(owner.status()).toMatchObject({ state: 'closed', processes: 0, active: 0, queued: 0 });
    await expect(owner.run('fixture.echo', null)).rejects.toMatchObject({ code: 'WORKER_NOT_READY', outcome: 'not-started' });
  } finally { await owner.close(); await Promise.allSettled(pending); }
});

test('a failed child startup is not-started and settles before owned launch state is removed', async () => {
  const fixture = await ownedWorkerFixture('failed-start');
  let owner: ProcessWorkPool | undefined, closed = false;
  try {
    owner = new ProcessWorkPool({ tasks, launch: { kind: 'source', entrypoint: join(fixture.root, 'missing-entry.ts') },
      processes: 1, startupTimeoutMs: 1000 });
    await expect(owner.run('fixture.echo', { synthetic: true })).rejects.toMatchObject({ code: 'WORKER_START_FAILED', outcome: 'not-started' });
    expect(owner.status()).toMatchObject({ processes: 0, active: 0 });
    await owner.close(); closed = true;
  } finally {
    if (owner && !closed) { await owner.close(); closed = true; }
    if (!owner || closed) await fixture.cleanup();
  }
});

test('a bounded delayed graceful shutdown is given realistic admission time and still proves process settlement', async () => {
  const owner = pool(1);
  try {
    await owner.run('fixture.slow-close', null);
    await owner.close();
    expect(owner.status()).toMatchObject({ state: 'closed', active: 0, queued: 0, processes: 0 });
  } finally { await owner.close(); }
});

test('portable values reject getters, cycles, non-JSON atoms and oversized content without exposing it', () => {
  let reads = 0; const withGetter = Object.defineProperty({}, 'secret', { get() { reads++; return 'secret'; }, enumerable: true });
  expect(() => workerValue(withGetter)).toThrow(); expect(reads).toBe(0);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [cycle, undefined, NaN, Infinity, new Date(), 1n, 'x'.repeat(1024 * 1024 + 1)]) {
    expect(() => workerValue(value)).toThrow();
  }
  expect(workerValue({ safe: [null, true, -0, 1] })).toEqual({ safe: [null, true, 0, 1] });
});

test('queued caller cancellation is not-started, sanitized and cannot interrupt the running task', async () => {
  const owner = pool(1), abort = new AbortController();
  const pending: Promise<unknown>[] = [];
  try {
    await owner.run('fixture.echo', null);
    const occupied = owner.run('fixture.cpu', 100); pending.push(occupied);
    const waiting = owner.run('fixture.echo', 'never-dispatched', { signal: abort.signal }); pending.push(waiting);
    const outcome = waiting.catch(error => error);
    abort.abort(new Error('PRIVATE_CANCELLATION_REASON'));
    const failure = await outcome;
    expect(failure).toMatchObject({ code: 'WORKER_CANCELLED', outcome: 'not-started' });
    expect(String(failure)).not.toContain('PRIVATE_CANCELLATION_REASON');
    await occupied;
    expect(await owner.run('fixture.echo', 'still-usable')).toMatchObject({ input: 'still-usable' });
  } finally { await owner.close(); await Promise.allSettled(pending); }
});

test('cancellation after a real child entered the handler is unknown and still settles its owned process', async () => {
  const fixture = await ownedWorkerFixture('cancel-entered'), owner = pool(1), abort = new AbortController();
  let pending: Promise<unknown> | undefined, closed = false;
  try {
    const marker = join(fixture.root, 'entered.txt');
    pending = owner.run('fixture.entered', { marker }, { signal: abort.signal });
    const outcome = pending.catch(error => error);
    const deadline = Date.now() + 10_000;
    while (!existsSync(marker)) {
      if (Date.now() >= deadline) throw new Error('Synthetic task entry was not observed.');
      await new Promise<void>(resolve => setTimeout(resolve, 2));
    }
    abort.abort(new Error('PRIVATE_RUNNING_CANCELLATION_REASON'));
    const failure = await outcome;
    expect(failure).toMatchObject({ code: 'WORKER_CANCELLED', outcome: 'unknown' });
    expect(String(failure)).not.toContain('PRIVATE_RUNNING_CANCELLATION_REASON');
    await owner.close(); closed = true;
    expect(owner.status()).toMatchObject({ state: 'closed', processes: 0, active: 0 });
  } finally {
    abort.abort(); if (!closed) { await owner.close(); closed = true; }
    await pending?.catch(() => {});
    if (closed) await fixture.cleanup();
  }
});

test('a burst after simultaneous idle-child exits replaces generations without oversubscribing capacity', async () => {
  const owner = pool(2);
  try {
    const original = await Promise.all([owner.run('fixture.idle-exit', null), owner.run('fixture.idle-exit', null)]) as { pid: number }[];
    await new Promise<void>(resolve => setTimeout(resolve, 80));
    const result = await Promise.all(Array.from({ length: 6 }, (_, i) => owner.run('fixture.echo', i))) as { pid: number; input: number }[];
    expect(result.map(value => value.input)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(result.map(value => value.pid)).size).toBeLessThanOrEqual(2);
    expect(result.every(value => !original.some(previous => previous.pid === value.pid))).toBe(true);
    expect(owner.status()).toMatchObject({ processes: 2, active: 0, queued: 0 });
  } finally { await owner.close(); }
});

test('typed task references preserve input/output contracts and reject substituted same-name policies before parsing', async () => {
  const owner = pool(1); let parsed = 0;
  const substitute = defineWorkerTask({ name: sumTask.name, version: sumTask.version, access: 'user',
    parseInput(value) { parsed++; return value; }, parseOutput: value => value, run: value => value });
  try {
    await expect(owner.run(substitute, [1, 2])).rejects.toMatchObject({ code: 'WORKER_TASK_INVALID', outcome: 'not-started' });
    expect(parsed).toBe(0); expect(owner.status().processes).toBe(0);
    const result: number = await owner.run(sumTask, [12, 25, 8]); expect(result).toBe(45);
  } finally { await owner.close(); }
});
