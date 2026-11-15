/** SSE is only a transport for admitted native projections. One latest page, bounded lifetime, no fabricated row events. */
import type { JobPageOptions, JobSchedulePage, ScopedJobs } from './contracts';
export function jobScheduleStream(jobs: ScopedJobs, query: JobPageOptions, signal: AbortSignal): ReadableStream<Uint8Array> {
  let controller: ReadableStreamDefaultController<Uint8Array>, closed = false;
  let latest: { readonly value: JobSchedulePage; readonly invalidated: boolean } | null = null;
  let remove: (() => void) | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { if (closed) return; closed = true; remove?.(); clearTimeout(lifetime); signal.removeEventListener('abort', close); latest = null; };
  const close = () => { if (!closed) { cleanup(); controller.close(); } };
  const flush = () => {
    if (closed || !latest || (controller.desiredSize ?? 0) <= 0) return;
    const frame = latest; latest = null; controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, ...frame }) + '\n\n'));
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal.aborted) { close(); return; }
      signal.addEventListener('abort', close, { once: true });
      try {
        remove = jobs.schedules.watch((page, update) => {
          if (closed) return;
          // Backpressure retains one latest page, plus the fact that any of its
          // coalesced updates followed a real committed change.
          latest = { value: page, invalidated: latest?.invalidated === true || update?.invalidated === true }; flush();
        }, { query, signal,
          onError() {
            if (closed) return;
            // Retire any buffered stale page before reporting read denial.
            latest = null; controller.enqueue(new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n')); close();
          } });
      } catch (error) { cleanup(); controller.error(error); return; }
      lifetime = setTimeout(close, 20_000); lifetime.unref?.();
    },
    pull() { flush(); }, cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}
