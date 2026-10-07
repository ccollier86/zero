/** Backpressured, cancellation-aware child output; post-exit pipes cannot hold the runner indefinitely. */

export interface TestSuiteOutputDrain {
  failure: Promise<never>;
  settle(): Promise<{ outputIncomplete: boolean; outputDiagnostics?: TestSuiteOutputDiagnostics; error?: string }>;
  cancel(): void;
}

/** Payload-free progress at a failed drain boundary; elapsed time is relative, not a wall-clock timestamp. */
export interface TestSuiteOutputChannelDiagnostic {
  bytesRead: number;
  chunksRead: number;
  eof: boolean;
  pending: 'read' | 'sink' | null;
  pendingForMs: number;
}
/** Keep stdout and stderr separate so a held pipe is distinguishable from a held output consumer. */
export type TestSuiteOutputDiagnostics = Record<'stdout' | 'stderr', TestSuiteOutputChannelDiagnostic>;

/** Consume only these admitted child's streams; cancel readers after a bounded one-second post-exit drain. */
export function drainTestSuiteOutput(
  streams: { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> },
  output?: (channel: 'stdout' | 'stderr', text: string) => void | Promise<void>,
): TestSuiteOutputDrain {
  const readers = [streams.stdout.getReader(), streams.stderr.getReader()];
  const progress = readers.map(() => ({ bytesRead: 0, chunksRead: 0, eof: false,
    pending: null as TestSuiteOutputChannelDiagnostic['pending'], pendingSince: 0 }));
  const diagnostics = (): TestSuiteOutputDiagnostics => {
    const snapshot = (index: number): TestSuiteOutputChannelDiagnostic => {
      const state = progress[index]!;
      return { bytesRead: state.bytesRead, chunksRead: state.chunksRead, eof: state.eof, pending: state.pending,
        pendingForMs: state.pending === null ? 0 : Math.max(0, Math.round(performance.now() - state.pendingSince)) };
    };
    return { stdout: snapshot(0), stderr: snapshot(1) };
  };
  let stopped = false, error: string | undefined;
  let stop!: () => void, reject!: (error: unknown) => void;
  const cancelled = new Promise<null>(resolve => { stop = () => resolve(null); });
  const failure = new Promise<never>((_resolve, fail) => { reject = fail; });
  void failure.catch(() => {});
  const cancel = () => {
    if (stopped) return;
    stopped = true; stop();
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  const pump = async (index: number, channel: 'stdout' | 'stderr') => {
    const reader = readers[index]!, state = progress[index]!, decoder = new TextDecoder();
    const write = async (text: string) => {
      state.pending = 'sink'; state.pendingSince = performance.now();
      await Promise.race([output?.(channel, text), cancelled]);
      state.pending = null;
    };
    try {
      while (!stopped) {
        state.pending = 'read'; state.pendingSince = performance.now();
        const chunk = await Promise.race([reader.read(), cancelled]);
        state.pending = null;
        if (!chunk) break;
        if (chunk.done) { state.eof = true; break; }
        state.bytesRead += chunk.value.byteLength; state.chunksRead++;
        const text = decoder.decode(chunk.value, { stream: true });
        if (text && !stopped) await write(text);
      }
      const tail = decoder.decode(); if (tail && !stopped) await write(tail);
    } catch (caught) {
      if (!stopped) { error ??= caught instanceof Error ? caught.message : 'Test output could not be drained.'; reject(caught); }
    } finally {
      state.pending = null;
      try { reader.releaseLock(); } catch { /* Cancellation can race an already-pending read. */ }
    }
  };
  const finished = Promise.all([pump(0, 'stdout'), pump(1, 'stderr')]);
  return {
    failure, cancel,
    async settle() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const drained = await Promise.race([finished.then(() => true),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
        // Capture before cancellation settles the pending read/sink; never include output text.
        const outputDiagnostics = drained ? undefined : diagnostics();
        if (!drained) cancel();
        return { outputIncomplete: !drained, ...(outputDiagnostics ? { outputDiagnostics } : {}), ...(error ? { error } : {}) };
      } finally { clearTimeout(timer); }
    },
  };
}
