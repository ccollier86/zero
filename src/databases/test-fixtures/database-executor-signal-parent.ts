/** Test-only supervisor used to exercise terminal process-group shutdown. */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SubprocessDatabaseExecutor } from '../subprocess-database-executor';

const readyPath = process.argv[2];
const resultPath = process.argv[3];
const childPath = fileURLToPath(new URL(
  './database-executor-child.ts',
  import.meta.url,
));

if (!readyPath || !resultPath) {
  process.exitCode = 64;
} else {
  const shutdownSignal = new Promise<void>((resolve) => {
    const finish = (): void => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
  });
  const executor = new SubprocessDatabaseExecutor({
    command: [process.execPath, childPath, 'normal'],
    env: { ZERO_EXECUTOR_SIGNAL_TEST: '1' },
    role: 'database-executor-signal-test',
    slot: 0,
    startupTimeoutMs: 2_000,
    operationTimeoutMs: 2_000,
    shutdownAckTimeoutMs: 2_000,
    shutdownExitTimeoutMs: 2_000,
    sigtermTimeoutMs: 1_000,
    sigkillTimeoutMs: 1_000,
  });

  try {
    await executor.start();
    writeFileSync(readyPath, 'ready', { flag: 'wx' });
    await shutdownSignal;
    // Let a wrongly inherited process-group signal settle before cooperative
    // close. Without actor detachment this makes the regression deterministic
    // instead of depending on parent/child signal-delivery scheduling.
    await Bun.sleep(25);
    await executor.close();
    const diagnostics = executor.diagnostics();
    writeFileSync(resultPath, JSON.stringify({
      ok: diagnostics.lastFailureCode === null,
      diagnostics,
    }), { flag: 'wx' });
    if (diagnostics.lastFailureCode !== null) process.exitCode = 70;
  } catch (error) {
    writeFileSync(resultPath, JSON.stringify({
      ok: false,
      code: error && typeof error === 'object' && 'code' in error
        ? error.code
        : 'UNKNOWN',
      diagnostics: executor.diagnostics(),
    }), { flag: 'wx' });
    process.exitCode = 70;
  }
}
