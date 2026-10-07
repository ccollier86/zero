/** Own incremental test-CLI sinks; live emission uses the existing file budget, not the post-exit drain's one-second policy. */
import { MAX_FILE_TIMEOUT_MS } from './test-suite-options';
type ConsoleSink = {
  write(text: string): number | Promise<number>;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
  unref(): void;
};
type ConsoleChannel = 'stdout' | 'stderr';
const RETIRE_BOUND_MS = 1000;
type Phase = 'queue' | 'write' | 'flush' | 'close';
type Trigger = 'native-rejection' | 'output-retired' | 'live-budget' | 'retirement-budget';
export interface TestSuiteConsoleDiagnostics {
  queued: number;
  completed: number;
  active: { channel: ConsoleChannel; phase: Phase; elapsedMs: number } | null;
  fault: { phase: Phase; trigger: Trigger; nativeCode?: string } | null;
}

/** Internal CLI writer; close retires both owned sinks and preserves any write/flush/close failure. */
export interface TestSuiteConsoleWriter {
  write(channel: ConsoleChannel, text: string, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  diagnostics(): TestSuiteConsoleDiagnostics;
}

/** Use one FileSink per standard fd and one shared lane, including when both fds refer to a merged regular file. */
export function createTestSuiteConsoleWriter(
  sinks: Record<ConsoleChannel, ConsoleSink> = {
    stdout: Bun.stdout.writer(), stderr: Bun.stderr.writer(),
  },
  liveBudgetMs = MAX_FILE_TIMEOUT_MS,
): TestSuiteConsoleWriter {
  if (!Number.isSafeInteger(liveBudgetMs) || liveBudgetMs < 1 || liveBudgetMs > MAX_FILE_TIMEOUT_MS) throw new Error('Invalid bounded console live-output budget.');
  let accepting = true, fault: Error | undefined, closing: Promise<void> | undefined;
  let queued = 0, completed = 0, active: { channel: ConsoleChannel; phase: Phase; since: number } | null = null;
  let faultInfo: TestSuiteConsoleDiagnostics['fault'] = null, fail!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { fail = reject; }); void failed.catch(() => {});
  let lane: Promise<void> = Promise.resolve();
  const remember = (cause: unknown, trigger: Trigger, phase: Phase = active?.phase ?? 'queue') => {
    if (!fault) {
      fault = cause instanceof Error ? cause : new Error('Test console output failed.', { cause });
      const code = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'code')?.value : undefined;
      faultInfo = { phase, trigger, ...(['EPIPE', 'EBADF', 'EIO', 'ENOSPC', 'ENOMEM', 'EAGAIN', 'ENOENT', 'ETIMEDOUT'].includes(code) ? { nativeCode: code } : {}) };
      fail(fault);
    }
    return fault;
  };
  const assertWithinBoundary = (started: number, stage: string, budget: number, trigger: Trigger) => {
    if (performance.now() - started >= budget) {
      throw remember(new Error(`Test console ${stage} exceeded its I/O boundary.`), trigger);
    }
  };
  const bounded = async <T>(operation: Promise<T>, stage: string, budget = RETIRE_BOUND_MS): Promise<T> => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Test console ${stage} exceeded its one-second retirement boundary.`)), Math.max(0, budget));
      })]);
      // Timers cannot preempt synchronous native I/O; never acknowledge a late completion as success.
      assertWithinBoundary(started, stage, Math.max(0, budget), 'retirement-budget');
      return result;
    } catch (cause) { throw remember(cause, 'retirement-budget', 'close'); }
    finally { clearTimeout(timer); }
  };
  const assertHealthy = () => { if (fault) throw fault; };
  return {
    write(channel, text, signal) {
      if (!accepting) return Promise.reject(new Error('Test console output is closed.'));
      if (signal?.aborted) return Promise.reject(new Error('Test console output call was retired.'));
      const started = performance.now();
      let entered = false, retired = false, timer: ReturnType<typeof setTimeout> | undefined, rejectRetired!: (error: Error) => void;
      queued++;
      const cancellation = new Promise<never>((_resolve, reject) => { rejectRetired = reject; });
      const abort = () => {
        retired = true;
        const error = new Error('Test console output call was retired.');
        rejectRetired(entered ? remember(error, 'output-retired') : error);
      };
      signal?.addEventListener('abort', abort, { once: true });
      const operation = lane.then(async () => {
        queued--; if (retired) return;
        entered = true; active = { channel, phase: 'write', since: performance.now() };
        try {
          assertHealthy(); assertWithinBoundary(started, 'live output', liveBudgetMs, 'live-budget');
          await sinks[channel].write(text);
          assertHealthy(); assertWithinBoundary(started, 'live output', liveBudgetMs, 'live-budget');
          active.phase = 'flush';
          // Native short progress is buffered; flush, never resend a suffix.
          await sinks[channel].flush();
          assertHealthy(); assertWithinBoundary(started, 'live output', liveBudgetMs, 'live-budget'); completed++;
        } catch (cause) { throw remember(cause, 'native-rejection'); }
        finally { active = null; }
      });
      lane = operation.catch(() => {});
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { retired = true; reject(remember(new Error('Test console live output exceeded the file budget.'), 'live-budget')); }, liveBudgetMs);
      });
      return Promise.race([operation, failed, cancellation, timeout]).finally(() => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      });
    },
    diagnostics() {
      return { queued, completed, active: active ? { channel: active.channel, phase: active.phase,
        elapsedMs: Math.max(0, Math.round(performance.now() - active.since)) } : null, fault: faultInfo ? { ...faultInfo } : null };
    },
    close() {
      if (closing) return closing;
      accepting = false;
      closing = (async () => {
        const retiringAt = performance.now();
        try { if (!fault) await bounded(lane, 'queued output'); }
        catch (cause) { remember(cause, 'retirement-budget', 'close'); }
        try {
          const results = await bounded(Promise.allSettled(Object.values(sinks).map(sink =>
            Promise.resolve().then(() => sink.end()))), 'final close', RETIRE_BOUND_MS - (performance.now() - retiringAt));
          for (const result of results) if (result.status === 'rejected') remember(result.reason, 'native-rejection', 'close');
        } catch (cause) { remember(cause, 'retirement-budget', 'close'); }
        finally {
          // A stalled native sink must not keep the failed CLI alive after the bounded close.
          for (const sink of Object.values(sinks)) {
            try { sink.unref(); } catch (cause) { remember(cause, 'native-rejection', 'close'); }
          }
        }
        assertHealthy();
      })();
      return closing;
    },
  };
}
