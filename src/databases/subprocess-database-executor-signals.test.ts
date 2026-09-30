import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIGNAL_PARENT_PATH = fileURLToPath(new URL(
  './test-fixtures/database-executor-signal-parent.ts',
  import.meta.url,
));

describe('SubprocessDatabaseExecutor signal isolation', () => {
  test.skipIf(process.platform === 'win32').each([
    'SIGINT',
    'SIGTERM',
  ] as const)(
    'lets the app supervisor drain an actor after a terminal process-group %s',
    async (signal) => {
      const directory = mkdtempSync(join(
        tmpdir(),
        'zero-executor-signal-isolation-',
      ));
      const readyPath = join(directory, 'ready');
      const resultPath = join(directory, 'result.json');
      const supervisor = Bun.spawn({
        cmd: [process.execPath, SIGNAL_PARENT_PATH, readyPath, resultPath],
        detached: true,
        env: {},
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const stderrText = new Response(supervisor.stderr).text();

      try {
        if (!await waitForFile(readyPath, supervisor, 5_000)) {
          throw new Error('Signal supervisor did not become ready.');
        }
        process.kill(-supervisor.pid, signal);
        if (!await waitForFile(resultPath, supervisor, 5_000)) {
          throw new Error('Signal supervisor did not report a result.');
        }
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));

        expect(result).toMatchObject({
          ok: true,
          diagnostics: {
            state: 'closed',
            disconnectObserved: true,
            exitObserved: true,
            settled: true,
            exitCode: 0,
            signalCode: null,
            lastFailureCode: null,
          },
        });
        expect(await supervisor.exited).toBe(0);
      } catch (cause) {
        if (supervisor.exitCode === null) supervisor.kill('SIGKILL');
        await supervisor.exited.catch(() => undefined);
        const stderr = await stderrText;
        throw new Error([
          cause instanceof Error ? cause.message : String(cause),
          stderr.trim(),
        ].filter(Boolean).join('\n'));
      } finally {
        if (supervisor.exitCode === null) supervisor.kill('SIGKILL');
        await supervisor.exited.catch(() => undefined);
        await stderrText.catch(() => '');
        rmSync(directory, { recursive: true, force: true });
      }
    },
    10_000,
  );
});

async function waitForFile(
  path: string,
  child: Bun.Subprocess<'ignore', 'ignore', 'pipe'>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)
    && child.exitCode === null
    && Date.now() < deadline) {
    await Bun.sleep(5);
  }
  return existsSync(path);
}
