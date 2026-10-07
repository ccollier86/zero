/** Finite fresh-process scheduling and exact final accounting; every admitted file runs once, even after a failure. */
import { constants } from 'node:os'; // Portable signal exit codes; subprocess execution remains Bun-native.
import { runTestSuiteFile, testSuiteExitCode, type TestSuiteFileResult, type TestSuiteProcessOptions } from './test-suite-process';
import { DEFAULT_TEST_TIMEOUT_MS, MAX_FILE_TIMEOUT_MS, MAX_TEST_PROCESSES } from './test-suite-options';
import { isFrameworkInstalledConsumer } from './test-suite-resources';

export interface TestSuiteSummary {
  type: 'test-suite-summary';
  total: number;
  passed: number;
  failed: number;
  notRun: number;
  interrupted: string | null;
  exitCode: number;
  durationMs: number;
  results: TestSuiteFileResult[];
}
export type TestSuiteEvent = { type: 'test-suite-start'; total: number; concurrency: number; testTimeoutMs: number; fileTimeoutMs: number;
    frameworkInstalledConsumerConcurrency: 1 }
  | { type: 'test-file-start'; file: string; index: number; total: number }
  | ({ type: 'test-file-result'; index: number; total: number } & TestSuiteFileResult)
  | TestSuiteSummary;
export interface TestSuiteRunnerOptions {
  root: string;
  files: readonly string[];
  concurrency?: number;
  testTimeoutMs?: number;
  fileTimeoutMs?: number;
  signal?: AbortSignal;
  bunExecutable?: string;
  event?: (event: TestSuiteEvent) => void | Promise<void>;
  output?: TestSuiteProcessOptions['output'];
}

/** Bounded scheduler; root cancellation stops admission and retires only its own already-admitted child processes. */
export async function runTestSuite(options: TestSuiteRunnerOptions): Promise<TestSuiteSummary> {
  const started = performance.now(), files = [...options.files].sort();
  if (new Set(files).size !== files.length) throw new Error('Test-suite inventory contains duplicate files.');
  const concurrency = options.concurrency ?? MAX_TEST_PROCESSES;
  const testTimeoutMs = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const fileTimeoutMs = options.fileTimeoutMs ?? MAX_FILE_TIMEOUT_MS;
  for (const [name, value, maximum] of [['concurrency', concurrency, MAX_TEST_PROCESSES],
    ['test timeout', testTimeoutMs, DEFAULT_TEST_TIMEOUT_MS], ['file timeout', fileTimeoutMs, MAX_FILE_TIMEOUT_MS]] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid bounded ${name}.`);
  }
  const controller = new AbortController(), results: TestSuiteFileResult[] = Array(files.length);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const queued = files.map((_, index) => index), admissionWaiters = new Set<() => void>();
  let installedConsumerActive = false;
  const wakeAdmission = () => {
    for (const wake of admissionWaiters) wake();
    admissionWaiters.clear();
  };
  controller.signal.addEventListener('abort', wakeAdmission);
  const admit = async (): Promise<number | undefined> => {
    while (!controller.signal.aborted && queued.length) {
      // A blocked installed consumer must not hold up ordinary files behind it.
      // Selection and resource reservation occur synchronously before awaiting.
      const position = queued.findIndex(index => !installedConsumerActive || !isFrameworkInstalledConsumer(files[index]!));
      if (position >= 0) {
        const index = queued.splice(position, 1)[0]!;
        if (isFrameworkInstalledConsumer(files[index]!)) installedConsumerActive = true;
        return index;
      }
      await new Promise<void>(resolve => admissionWaiters.add(resolve));
    }
    return undefined;
  };
  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = await admit();
      if (index === undefined) return;
      const file = files[index]!;
      try {
        await options.event?.({ type: 'test-file-start', file, index, total: files.length });
        const result = await runTestSuiteFile({ root: options.root, file, testTimeoutMs, fileTimeoutMs,
          signal: controller.signal, bunExecutable: options.bunExecutable, output: options.output });
        results[index] = result;
        await options.event?.({ type: 'test-file-result', index, total: files.length, ...result });
      } finally {
        // The resource remains owned through process/descendant/output retirement.
        if (isFrameworkInstalledConsumer(file)) installedConsumerActive = false;
        wakeAdmission();
      }
    }
  };
  let workers: Promise<void>[] = [];
  try {
    await options.event?.({ type: 'test-suite-start', total: files.length, concurrency, testTimeoutMs, fileTimeoutMs,
      frameworkInstalledConsumerConcurrency: 1 });
    workers = Array.from({ length: Math.min(concurrency, files.length) }, worker);
    await Promise.all(workers);
  } catch (error) {
    controller.abort(error); await Promise.allSettled(workers); throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', wakeAdmission);
  }
  for (let index = 0; index < files.length; index++) {
    results[index] ??= { file: files[index]!, status: 'not-run', exitCode: null, signal: null, durationMs: 0 };
  }
  const interrupted = options.signal?.aborted
    ? options.signal.reason === 'SIGINT' || options.signal.reason === 'SIGTERM' ? options.signal.reason : 'aborted' : null;
  const firstFailure = results.find(result => result.status !== 'passed');
  const summary: TestSuiteSummary = { type: 'test-suite-summary', total: files.length,
    passed: results.filter(result => result.status === 'passed').length,
    failed: results.filter(result => result.status !== 'passed' && result.status !== 'not-run').length,
    notRun: results.filter(result => result.status === 'not-run').length, interrupted,
    exitCode: interrupted ? 128 + (constants.signals[interrupted as keyof typeof constants.signals] ?? 2)
      : firstFailure ? testSuiteExitCode(firstFailure) : 0,
    durationMs: Math.round(performance.now() - started), results };
  await options.event?.(summary); return summary;
}
