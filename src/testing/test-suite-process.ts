/** One fresh Bun test process, bounded output draining and owned-child termination; no retries or worker reuse. */
import { resolve } from 'node:path';
import { constants } from 'node:os'; // Bun exposes no equivalent portable signal-number table.
import { captureTestSuiteProcessGroup } from './test-suite-process-group';
import { drainTestSuiteOutput, type TestSuiteOutputDiagnostics } from './test-suite-output';

export type TestSuiteFileStatus = 'passed' | 'failed' | 'signal' | 'timeout' | 'cancelled' | 'spawn-error' | 'leaked-processes' | 'not-run';
export interface TestSuiteFileResult {
  file: string;
  status: TestSuiteFileStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  error?: string;
  leakedDescendants?: boolean;
  cleanupIncomplete?: boolean;
  outputIncomplete?: boolean;
  outputDiagnostics?: TestSuiteOutputDiagnostics;
  cleanupError?: string;
}
export interface TestSuiteProcessOptions {
  root: string;
  file: string;
  testTimeoutMs: number;
  fileTimeoutMs: number;
  signal: AbortSignal;
  bunExecutable?: string;
  output?: (file: string, channel: 'stdout' | 'stderr', text: string, signal?: AbortSignal) => void | Promise<void>;
}

/** Preserve conventional exit status for root interruption, native child signals and nonzero test exits. */
export function testSuiteExitCode(result: TestSuiteFileResult): number {
  if (result.status === 'passed') return 0;
  if (result.status === 'timeout') return 124;
  if (result.signal) return 128 + (constants.signals[result.signal as keyof typeof constants.signals] ?? 1);
  return result.exitCode && result.exitCode > 0 && result.exitCode < 256 ? result.exitCode : 1;
}

/** Run exactly this file in its own group; no-orphans is an additional parent-death fence, not the sole cleanup mechanism. */
export async function runTestSuiteFile(options: TestSuiteProcessOptions): Promise<TestSuiteFileResult> {
  const started = performance.now();
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('The fresh-process test runner currently requires macOS or Linux.');
  if (options.signal.aborted) return { file: options.file, status: 'cancelled', exitCode: null, signal: null, durationMs: 0 };
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    child = Bun.spawn([options.bunExecutable ?? process.execPath, '--no-env-file', '--no-orphans', 'test',
      '--timeout', String(options.testTimeoutMs),
      // Scanner tests nonempty relative file/directory paths; '/' cannot match either.
      '--path-ignore-patterns=/', resolve(options.root, options.file)], {
      cwd: options.root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: true,
    });
  } catch (error) {
    return { file: options.file, status: 'spawn-error', exitCode: null, signal: null,
      durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Could not spawn Bun.' };
  }
  const group = captureTestSuiteProcessGroup(child);
  let timedOut = false, cancelled = false, cleanupError: string | undefined, escalation: ReturnType<typeof setTimeout> | undefined;
  const signal = (value: 'SIGTERM' | 'SIGKILL') => {
    try { group.signal(value); }
    catch (error) {
      cleanupError ??= error instanceof Error ? error.message : 'Owned process-group signal failed.';
      // Only the exact admitted leader is a permissible fallback; do not search for other groups.
      if (child.exitCode === null) { try { child.kill(value); } catch { /* Retain the explicit cleanup failure. */ } }
    }
  };
  const terminate = () => {
    signal('SIGTERM');
    escalation ??= setTimeout(() => {
      signal('SIGKILL');
    }, 1_000);
  };
  const abort = () => { cancelled = true; terminate(); };
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  const deadline = setTimeout(() => { timedOut = true; terminate(); }, options.fileTimeoutMs);
  const output = drainTestSuiteOutput(child, (channel, text, outputSignal) => options.output?.(options.file, channel, text, outputSignal));
  const exited = child.exited.then(async exitCode => {
    const cleanup = await group.retireAfterExit();
    return { exitCode, ...cleanup };
  });
  try {
    const result = await Promise.race([exited, output.failure]);
    const drained = await output.settle();
    return { file: options.file, status: cancelled ? 'cancelled' : timedOut ? 'timeout'
      : child.signalCode ? 'signal' : result.leakedDescendants ? 'leaked-processes'
      : drained.outputIncomplete || drained.error || cleanupError || result.cleanupError ? 'failed' : result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode, signal: child.signalCode, durationMs: Math.round(performance.now() - started),
      ...(result.leakedDescendants ? { leakedDescendants: true, cleanupIncomplete: result.cleanupIncomplete } : {}),
      ...(drained.outputIncomplete ? { outputIncomplete: true } : {}), ...(drained.error ? { error: drained.error } : {}),
      ...(drained.outputDiagnostics ? { outputDiagnostics: drained.outputDiagnostics } : {}),
      ...(cleanupError || result.cleanupError ? { cleanupError: cleanupError ?? result.cleanupError } : {}) };
  } catch (error) {
    terminate(); const cleanup = await exited; const drained = await output.settle();
    return { file: options.file, status: 'failed', exitCode: child.exitCode, signal: child.signalCode,
      durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Test output could not be drained.',
      ...(drained.outputIncomplete ? { outputIncomplete: true } : {}),
      ...(drained.outputDiagnostics ? { outputDiagnostics: drained.outputDiagnostics } : {}),
      ...(cleanup.leakedDescendants ? { leakedDescendants: true, cleanupIncomplete: cleanup.cleanupIncomplete } : {}),
      ...(cleanupError || cleanup.cleanupError ? { cleanupError: cleanupError ?? cleanup.cleanupError } : {}) };
  } finally {
    output.cancel();
    clearTimeout(deadline); clearTimeout(escalation);
    options.signal.removeEventListener('abort', abort);
  }
}
