/** Persist payload-free CLI failure evidence independently of poisoned standard-fd sinks. Own only a unique temp directory. */
import { mkdtemp, rename, rm } from 'node:fs/promises'; // Bun has no equivalent directory/atomic-rename APIs.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestSuiteConsoleDiagnostics } from './test-suite-console-writer';

export interface TestSuiteFailureAccounting {
  total: number; started: number; completed: number; workersSettled: boolean;
}
export interface TestSuiteFailureReceipt {
  path: string;
  directory: string;
  persist(stage: 'main' | 'close' | 'cleanup', console: TestSuiteConsoleDiagnostics, accounting: TestSuiteFailureAccounting): Promise<void>;
  remove(): Promise<void>;
}

/** Advertise this owned path before execution; on failure retain only stage/counters/native errno, never raw causes or child text. */
export async function createTestSuiteFailureReceipt(
  createSink: (path: string) => { write(text: string): number | Promise<number>; flush(): number | Promise<number>; end(): number | Promise<number>; unref(): void }
    = path => Bun.file(path).writer(),
): Promise<TestSuiteFailureReceipt> {
  const directory = await mkdtemp(join(tmpdir(), 'zero-test-suite-failure-'));
  const path = join(directory, 'failure.json');
  const stages: { stage: 'main' | 'close' | 'cleanup'; console: TestSuiteConsoleDiagnostics; accounting: TestSuiteFailureAccounting }[] = [];
  let attempt = 0;
  return {
    path, directory,
    async persist(stage, console, accounting) {
      stages.push({ stage, console, accounting: { ...accounting } });
      const generation = ++attempt;
      const pending = join(directory, `failure-${generation}.pending`);
      const destination = generation === 1 ? path : join(directory, `failure-${generation}.json`);
      const started = performance.now();
      const assertWithinBoundary = () => {
        if (performance.now() - started >= 1000) throw new Error('Test-suite failure receipt could not be persisted boundedly.');
      };
      const sink = createSink(pending);
      let current = true, ended = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const operation = Promise.resolve().then(async () => {
        try {
          assertWithinBoundary();
          const snapshot = JSON.stringify({ type: 'test-suite-failure-receipt', pid: process.pid,
            attempt: generation, at: new Date().toISOString(), stages }, null, 2);
          await sink.write(snapshot);
          if (!current) return; assertWithinBoundary();
          await sink.flush(); if (!current) return; assertWithinBoundary();
          ended = true; await sink.end(); if (!current) return; assertWithinBoundary();
          // Each attempt owns a separate immutable destination. Even an in-flight
          // late rename cannot overwrite a newer receipt after a timeout.
          await rename(pending, destination);
          assertWithinBoundary();
        } finally {
          if (!ended) { try { await sink.end(); } catch { /* The failed attempt owns only its separate pending file. */ } }
        }
      });
      try {
        await Promise.race([operation, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Test-suite failure receipt could not be persisted boundedly.')),
            Math.max(0, 1000 - (performance.now() - started)));
        })]);
      } finally { current = false; clearTimeout(timer); sink.unref(); }
    },
    async remove() { await rm(directory, { recursive: true, force: true }); },
  };
}
