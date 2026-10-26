/** Coalesced authorized publishing projections. One bounded snapshot is buffered; Fabric commits are hints, never raw row payloads. */
import type { BlogContentRuntime } from './content-runtime';
import type { BlogService } from './service';

/** Limits work to one re-read at a time and collapses bursts; authorization is checked on every read and reconnect. */
export function blogContentProjectionStream(runtime: BlogContentRuntime, authors: BlogService, read: () => Promise<unknown>, signal: AbortSignal): ReadableStream<Uint8Array> {
  let controller!: ReadableStreamDefaultController<Uint8Array>, closed = false, dirty = true, reading = false;
  let removeContent: (() => void) | undefined, removeAuthors: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, check: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (closed) return; closed = true;
    removeContent?.(); removeAuthors?.(); clearTimeout(timer); clearInterval(check); clearTimeout(lifetime);
    signal.removeEventListener('abort', close);
  };
  let previous = '';
  const close = () => { if (!closed) { cleanup(); controller.close(); } };
  const pump = async () => {
    if (closed || reading || !dirty || (controller.desiredSize ?? 0) <= 0) return;
    dirty = false; reading = true;
    try {
      const value = await read();
      const packet = JSON.stringify({ version: 1, value });
      if (!closed && !signal.aborted) { if (packet !== previous) { controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + packet + '\n\n')); previous = packet; } }
      else close();
    } catch {
      // Normal expiry and a rejected authorized re-read are different states.
      // An invalidation packet makes the client mask its retained projection
      // immediately instead of waiting for the next connection to fail.
      if (!closed && !signal.aborted) controller.enqueue(new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n'));
      close();
    }
    finally { reading = false; if (dirty && !closed) changed(); }
  };
  const changed = () => {
    dirty = true;
    if (!timer && !closed) timer = setTimeout(() => { timer = undefined; void pump(); }, 50);
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal.aborted) return close();
      try { removeContent = runtime.subscribe(changed); removeAuthors = authors.subscribe(changed); }
      catch (error) { cleanup(); controller.error(error); return; }
      signal.addEventListener('abort', close, { once: true });
      check = setInterval(changed, 10000); check.unref?.();
      lifetime = setTimeout(close, 20000); lifetime.unref?.();
      void pump();
    },
    pull() { void pump(); }, cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}
