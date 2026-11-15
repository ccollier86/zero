/** Real Bun subprocesses. Every pool is closed in finally, including failure, timeout and kill paths. */
import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { ProcessWorkPool } from './process-pool';
import { tasks } from './test-support/worker-entry';
import { workerValue } from './worker-value';
import { defineWorkerTask } from './worker-task';

const launch = { kind: 'source' as const, entrypoint: fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url)) };
function pool(processes = 2) { return new ProcessWorkPool({ tasks, launch, processes, executionTimeoutMs: 3000 }); }

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

test('portable values reject getters, cycles, non-JSON atoms and oversized content without exposing it', () => {
  let reads = 0; const withGetter = Object.defineProperty({}, 'secret', { get() { reads++; return 'secret'; }, enumerable: true });
  expect(() => workerValue(withGetter)).toThrow(); expect(reads).toBe(0);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [cycle, undefined, NaN, Infinity, new Date(), 1n, 'x'.repeat(1024 * 1024 + 1)]) {
    expect(() => workerValue(value)).toThrow();
  }
  expect(workerValue({ safe: [null, true, -0, 1] })).toEqual({ safe: [null, true, 0, 1] });
});
