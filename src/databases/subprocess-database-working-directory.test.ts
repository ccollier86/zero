import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { SubprocessDatabaseWorkingDirectory } from './subprocess-database-working-directory';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';

test('private launch directory is owned, reused, and released without deleting unknown content', async () => {
  const owner = new SubprocessDatabaseWorkingDirectory();
  const directory = owner.prepare();
  const file = `${directory}/synthetic.txt`;
  try {
    expect(owner.prepare()).toBe(directory);
    await Bun.write(file, 'synthetic-only');
    const failure = owner.release();
    expect(failure).toMatchObject({ code: 'DATABASE_EXECUTOR_FAILED',
      details: { phase: 'launch-directory-cleanup' } });
    expect(JSON.stringify(failure)).not.toContain(directory);
    expect(existsSync(file)).toBe(true);
    await unlink(file);
    expect(owner.release()).toBeNull();
    expect(existsSync(directory)).toBe(false);
    expect(owner.release()).toBeNull();
  } finally {
    if (existsSync(file)) await unlink(file);
    owner.release();
  }
});

test('failed isolated spawn retains safe startup classification and settles cleanup', async () => {
  const executor = new SubprocessDatabaseExecutor({
    command: ['/zero-nonexistent-synthetic-executable'], env: {}, role: 'writer', slot: 0,
  }, true);
  await expect(executor.start()).rejects.toMatchObject({ code: 'DATABASE_EXECUTOR_START_FAILED' });
  await executor.close();
  expect(executor.diagnostics()).toMatchObject({ settled: true, state: 'closed' });
});
