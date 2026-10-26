/** Per-client bounded private-image reads. Browser previews cannot enqueue unbounded authenticated blobs or retain stale scopes. */
export function createBlogPreviewAdmission() {
  let running = 0;
  const waiting: { signal: AbortSignal; resolve(): void; reject(error: unknown): void; abort(): void }[] = [];
  const release = () => {
    running--;
    while (waiting.length && running < 4) {
      const next = waiting.shift()!; next.signal.removeEventListener('abort', next.abort);
      if (next.signal.aborted) { next.reject(next.signal.reason); continue; }
      running++; next.resolve();
    }
  };
  return async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    if (running < 4) running++;
    else {
      if (waiting.length >= 32) throw new Error('Private image preview capacity is exhausted.');
      await new Promise<void>((resolve, reject) => {
        const entry = { signal, resolve, reject, abort: () => { const index = waiting.indexOf(entry); if (index !== -1) waiting.splice(index, 1); reject(signal.reason); } };
        waiting.push(entry); signal.addEventListener('abort', entry.abort, { once: true });
        if (signal.aborted) entry.abort();
      });
    }
    try { signal.throwIfAborted(); return await work(); } finally { release(); }
  };
}
