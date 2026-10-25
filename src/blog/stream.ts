/** One buffered authorized projection; no raw author table feed or unlimited event history. */
import type { BlogService } from './service';
export function blogProjectionStream(
  service: BlogService,
  read: () => unknown,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let controller: ReadableStreamDefaultController<Uint8Array>,
    closed = false,
    dirty = true,
    queued = false;
  let detach: (() => void) | undefined,
    interval: ReturnType<typeof setInterval> | undefined,
    lifetime: ReturnType<typeof setTimeout> | undefined;
  const encode = new TextEncoder();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    detach?.();
    clearInterval(interval);
    clearTimeout(lifetime);
    signal.removeEventListener('abort', close);
  };
  const close = () => {
    if (!closed) {
      cleanup();
      controller.close();
    }
  };
  const pump = () => {
    queued = false;
    if (service.isClosed) {
      close();
      return;
    }
    if (closed || !dirty || (controller.desiredSize ?? 0) <= 0) return;
    dirty = false;
    try {
      const value = read();
      if (!signal.aborted)
        controller.enqueue(
          encode.encode(
            'event: snapshot\ndata: ' +
              JSON.stringify({ version: 1, value }) +
              '\n\n',
          ),
        );
      else close();
    } catch {
      close();
    }
  };
  const changed = () => {
    dirty = true;
    if (!queued && !closed) {
      queued = true;
      queueMicrotask(pump);
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
        if (signal.aborted) {
          close();
          return;
        }
        try {
          detach = service.subscribe(changed);
        } catch (error) {
          cleanup();
          controller.error(error);
          return;
        }
        signal.addEventListener('abort', close, { once: true });
        interval = setInterval(changed, 10000);
        interval.unref?.();
        lifetime = setTimeout(close, 20000);
        lifetime.unref?.();
        pump();
      },
      pull() {
        pump();
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 1 },
  );
}
