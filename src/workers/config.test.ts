/** Pure managed configuration snapshots; no entry execution, directories or processes. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { defineWorkerTask } from './worker-task';
import { resolveWorkersConfig } from './config';
import { ProcessWorkPool } from './process-pool';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';

const task = defineWorkerTask({ name: 'config.synthetic', version: '1', parseInput: value => value,
  parseOutput: value => value, run: value => value });

test('managed worker config detaches argv/environment and freezes the registered catalog', () => {
  const prefix: [string, ...string[]] = [process.execPath, '--no-env-file', '/synthetic/worker-entry.ts'];
  const env = { SYNTHETIC_ALLOWED: 'original' }, tasks = [task];
  const resolved = resolveWorkersConfig({ tasks, launch: { kind: 'command-prefix', commandPrefix: prefix }, env },
    process.cwd(), resolveAuthBehaviorConfig({}));
  if (!resolved) throw new Error('Synthetic worker config was not resolved.');
  prefix[2] = '/synthetic/changed.ts'; env.SYNTHETIC_ALLOWED = 'changed'; tasks.length = 0;
  expect(resolved.launch).toMatchObject({ commandPrefix: [process.execPath, '--no-env-file', '/synthetic/worker-entry.ts'] });
  expect(resolved.env).toEqual({ SYNTHETIC_ALLOWED: 'original' }); expect(resolved.tasks).toHaveLength(1);
  expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.tasks)).toBe(true);
  if (resolved.launch.kind === 'command-prefix') expect(Object.isFrozen(resolved.launch.commandPrefix)).toBe(true);
});

test('mutable file URL internal slots cannot change a later managed launch', () => {
  const entrypoint = new URL('file:///synthetic/worker-entry.ts');
  const resolved = resolveWorkersConfig({ tasks: [task], launch: { kind: 'source', entrypoint } },
    process.cwd(), resolveAuthBehaviorConfig({}));
  if (!resolved) throw new Error('Synthetic worker config was not resolved.');
  entrypoint.pathname = '/synthetic/changed.ts';
  expect(resolved.launch).toMatchObject({ kind: 'source', entrypoint: '/synthetic/worker-entry.ts' });
});

test('scope concurrency/waiting budgets are admitted before resources open and cannot exceed physical/global bounds', () => {
  const launch = { kind: 'source' as const, entrypoint: '/synthetic/worker-entry.ts' };
  const auth = resolveAuthBehaviorConfig({});
  for (const policy of [{ maxQueued: 2, maxQueuedPerKey: 3 }, { maxQueuedPerKey: -1 }, { maxConcurrentPerKey: 3 }, { maxConcurrentPerKey: 0 }]) {
    expect(() => resolveWorkersConfig({ tasks: [task], launch, processes: 2, ...policy }, process.cwd(), auth)).toThrow();
  }
  expect(resolveWorkersConfig({ tasks: [task], launch, processes: 2, maxQueued: 20, maxQueuedPerKey: 4, maxConcurrentPerKey: 1 }, process.cwd(), auth)).toMatchObject({ maxQueuedPerKey: 4, maxConcurrentPerKey: 1 });
});

test('startup deadline bounds fail at configuration admission without allocating a worker', async () => {
  const launch = { kind: 'source' as const, entrypoint: '/synthetic/must-not-launch.ts' };
  const auth = resolveAuthBehaviorConfig({});
  const options = { tasks: [task], launch, processes: 1, shutdownGraceMs: 10 };
  for (const startupTimeoutMs of [MAX_RUNTIME_TIMER_INTERVAL_MS + 1, Number.MAX_SAFE_INTEGER, 0, NaN, Infinity]) {
    const invalid = { ...options, startupTimeoutMs };
    expect(() => new ProcessWorkPool(invalid)).toThrow(expect.objectContaining({ code: 'WORKER_CONFIG_INVALID', outcome: 'not-started' }));
    expect(() => resolveWorkersConfig(invalid, process.cwd(), auth)).toThrow(expect.objectContaining({ code: 'WORKER_CONFIG_INVALID', outcome: 'not-started' }));
  }
  const resolved = resolveWorkersConfig({ ...options, startupTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS }, process.cwd(), auth);
  if (!resolved) throw new Error('Synthetic worker config was not resolved.');
  const pool = new ProcessWorkPool(resolved);
  // Constructor/configuration admission never starts a process or a deadline.
  // The deliberately nonexistent entrypoint must remain completely unused.
  try { expect(pool.status()).toMatchObject({ state: 'open', active: 0, queued: 0, processes: 0 }); }
  finally { await pool.close(); }
});
