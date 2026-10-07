/** Own the test CLI's incremental Bun standard-fd sinks. Serialize complete records and bound I/O; do not change test/output-drain policy. */
type ConsoleSink = {
  write(text: string): number | Promise<number>;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
  unref(): void;
};
type ConsoleChannel = 'stdout' | 'stderr';
const IO_BOUND_MS = 1000;

/** Internal CLI writer; close retires both owned sinks and preserves any write/flush/close failure. */
export interface TestSuiteConsoleWriter {
  write(channel: ConsoleChannel, text: string): Promise<void>;
  close(): Promise<void>;
}

/** Use one FileSink per standard fd and one shared lane, including when both fds refer to a merged regular file. */
export function createTestSuiteConsoleWriter(
  sinks: Record<ConsoleChannel, ConsoleSink> = {
    stdout: Bun.stdout.writer(), stderr: Bun.stderr.writer(),
  },
): TestSuiteConsoleWriter {
  let accepting = true, fault: Error | undefined, closing: Promise<void> | undefined;
  let lane: Promise<void> = Promise.resolve();
  const remember = (cause: unknown) => {
    fault ??= cause instanceof Error ? cause : new Error('Test console output failed.', { cause });
    return fault;
  };
  const assertWithinBoundary = (started: number, stage: string) => {
    if (performance.now() - started >= IO_BOUND_MS) {
      throw remember(new Error(`Test console ${stage} exceeded its one-second I/O boundary.`));
    }
  };
  const bounded = async <T>(operation: Promise<T>, stage: string): Promise<T> => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Test console ${stage} exceeded its one-second I/O boundary.`)), IO_BOUND_MS);
      })]);
      // Timers cannot preempt synchronous native I/O; never acknowledge a late completion as success.
      assertWithinBoundary(started, stage);
      return result;
    } catch (cause) { throw remember(cause); }
    finally { clearTimeout(timer); }
  };
  const assertHealthy = () => { if (fault) throw fault; };
  return {
    write(channel, text) {
      if (!accepting) return Promise.reject(new Error('Test console output is closed.'));
      const started = performance.now();
      const operation = lane.then(async () => {
        // A timed-out queued call must never write later after its caller has retired.
        assertHealthy();
        assertWithinBoundary(started, 'write/flush');
        await sinks[channel].write(text);
        assertHealthy(); assertWithinBoundary(started, 'write/flush');
        // FileSink retains unwritten bytes. Its count can be short native progress,
        // not a whole-record acknowledgment; flushing, not resending a suffix, completes the record.
        await sinks[channel].flush();
      });
      const result = bounded(operation, 'write/flush');
      lane = result.catch(remember).then(() => {});
      return result;
    },
    close() {
      if (closing) return closing;
      accepting = false;
      closing = (async () => {
        try { await bounded(lane, 'queued output'); }
        catch (cause) { remember(cause); }
        try {
          const results = await bounded(Promise.allSettled(Object.values(sinks).map(sink =>
            Promise.resolve().then(() => sink.end()))), 'final close');
          for (const result of results) if (result.status === 'rejected') remember(result.reason);
        } catch (cause) { remember(cause); }
        finally {
          // A stalled native sink must not keep the failed CLI alive after the bounded close.
          for (const sink of Object.values(sinks)) {
            try { sink.unref(); } catch (cause) { remember(cause); }
          }
        }
        assertHealthy();
      })();
      return closing;
    },
  };
}
