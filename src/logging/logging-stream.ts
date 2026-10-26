/** Backpressure-bounded authorized projection stream. Hints contain no evidence; each delivery performs a fresh fenced read. */
import type { LoggingChangePage, LoggingPage, LoggingStream } from './logging-contracts';
import type { LoggingRuntime } from './logging-runtime';

export function createLoggingProjectionStream(runtime: LoggingRuntime, stream: LoggingStream, first: LoggingPage,
  read: () => Promise<LoggingPage>, signal: AbortSignal,
  changes?: { afterOrdinal: number; read(after: number): Promise<LoggingChangePage> }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder(); let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false, dirty = true, running = false, initial: LoggingPage | null = first;
  let afterOrdinal = changes?.afterOrdinal ?? 0;
  let detach: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { if (closed) return; closed = true; detach?.(); clearInterval(heartbeat); clearTimeout(lifetime); signal.removeEventListener('abort', close); };
  const close = () => { if (closed) return; cleanup(); controller?.close(); };
  const pump = async () => {
    if (closed || running || !controller || (controller.desiredSize ?? 0) <= 0 || (!dirty && !initial)) return;
    running = true; dirty = false;
    try {
      let packet: unknown, event: string;
      if (initial) {
        packet = { version: 1, page: initial, ...(changes ? { afterOrdinal } : {}) }; event = 'snapshot'; initial = null; dirty = true;
      } else if (changes) {
        const page = await changes.read(afterOrdinal);
        afterOrdinal = page.throughOrdinal; dirty ||= page.hasMore;
        packet = { version: 1, changes: page }; event = 'changes';
      } else { packet = { version: 1, page: await read() }; event = 'snapshot'; }
      if (!closed && !signal.aborted) controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(packet) + '\n\n'));
    } catch {
      // Do not serialize auth/provider errors or release a stale page.
      if (!closed) { controller.enqueue(encoder.encode('event: end\ndata: {"version":1,"error":"LOGGING_SUBSCRIPTION_ENDED"}\n\n')); close(); }
    } finally { running = false; if (dirty && !closed && (controller?.desiredSize ?? 0) > 0) queueMicrotask(() => { void pump(); }); }
  };
  const changed = () => { dirty = true; void pump(); };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal.aborted) { close(); return; }
      try { detach = runtime.subscribe(stream, changed, close); }
      catch (error) { cleanup(); controller.error(error); return; }
      signal.addEventListener('abort', close, { once: true });
      // Lifetime forces a fresh HTTP credential admission even without writes.
      heartbeat = setInterval(changed, 10000); heartbeat.unref?.();
      lifetime = setTimeout(close, 20000); lifetime.unref?.();
      void pump();
    },
    pull() { void pump(); },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}
