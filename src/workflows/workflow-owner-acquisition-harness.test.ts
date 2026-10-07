/** Protocol/lifecycle failures must never turn into successful ownership results. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { acquireWorkflowOwnersSimultaneously } from './test-support/workflow-owner-acquisition';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';

test('ownership subprocess harness rejects premature or failed exit without a fallback', async () => {
  await withChild(`process.exitCode = 7; process.disconnect?.();`, async childEntrypoint => {
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { childEntrypoint, timeoutMs: 5000 })).rejects.toThrow('failed before clean disposed-result exit');
  });
});

test('ownership subprocess harness rejects a result before SQLite disposal acknowledgement', async () => {
  await withChild(`
    const ownerId = Bun.argv[3];
    process.on('message', () => process.send({ type: 'result', disposed: false, outcome: { ok: true, ownerId } }));
    process.send({ type: 'ready', ownerId });
  `, async childEntrypoint => {
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { childEntrypoint, timeoutMs: 5000 })).rejects.toThrow('ready/start/disposed-result protocol');
  });
});

test('ownership subprocess harness times out and joins both children before returning', async () => {
  await withChild(`
    process.on('message', () => {});
    process.send({ type: 'ready', ownerId: Bun.argv[3] });
  `, async childEntrypoint => {
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { childEntrypoint, timeoutMs: 400 })).rejects.toThrow('timed out');
  });
});

test('ownership subprocess harness does not accept a valid result followed by protocol failure', async () => {
  await withChild(`
    const ownerId = Bun.argv[3];
    process.on('message', () => {
      process.send({ type: 'result', disposed: true, outcome: { ok: true, ownerId } });
      process.send({ type: 'result', disposed: true, outcome: { ok: true, ownerId } }, () => process.disconnect());
    });
    process.send({ type: 'ready', ownerId });
  `, async childEntrypoint => {
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { childEntrypoint, timeoutMs: 5000 })).rejects.toThrow('ready/start/disposed-result protocol');
  });
});

test('ownership subprocess harness escalates and reaps children that ignore SIGTERM', async () => {
  await withChild(`
    const ownerId = Bun.argv[3];
    process.on('SIGTERM', () => { void Bun.write(new URL('./ignored-' + ownerId, import.meta.url), 'ignored'); });
    process.on('message', () => {});
    process.send({ type: 'ready', ownerId });
  `, async childEntrypoint => {
    const started = Date.now();
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { childEntrypoint, timeoutMs: 1000 })).rejects.toThrow('timed out');
    expect(await Bun.file(join(dirname(childEntrypoint), 'ignored-a')).exists()).toBe(true);
    expect(await Bun.file(join(dirname(childEntrypoint), 'ignored-b')).exists()).toBe(true);
    expect(Date.now() - started).toBeLessThan(6000);
  });
}, 10_000);

test('ownership subprocess harness rejects invalid deadlines before launching children', async () => {
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 60_001]) {
    await expect(acquireWorkflowOwnersSimultaneously('/unused-synthetic-database', ['a', 'b'],
      { timeoutMs, childEntrypoint: '/must-not-launch-missing-child.ts' })).rejects.toThrow('timeoutMs must be an integer');
  }
});

async function withChild(source: string, run: (childEntrypoint: string) => Promise<void>): Promise<void> {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'workflow-owner-failure-'));
  const childEntrypoint = join(root, 'child.ts');
  try {
    await Bun.write(childEntrypoint, source);
    await run(childEntrypoint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
