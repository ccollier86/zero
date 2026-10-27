/** Coalesced authorized snapshots, not raw row broadcasts. One buffered packet and one in-flight scoped read per subscriber. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { MessagingRuntime } from './runtime';
import type { MessagingSubscription } from './commit-hints';
export function messagingProjectionStream(runtime: MessagingRuntime, scope: ServiceDataScope, read: () => Promise<unknown>, signal: AbortSignal, filter: MessagingSubscription): ReadableStream<Uint8Array> {
  let controller!: ReadableStreamDefaultController<Uint8Array>, closed = false, reading = false, dirty = true, previous = '';
  let remove: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, interval: ReturnType<typeof setInterval> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { if (closed) return; closed = true; remove?.(); clearTimeout(timer); clearInterval(interval); clearTimeout(lifetime); signal.removeEventListener('abort', close); };
  const close = () => { if (!closed) { cleanup(); controller.close(); } };
  const changed = () => { dirty = true; if (!timer && !closed) timer = setTimeout(() => { timer = undefined; void pump(); }, 50); };
  const pump = async () => {
    if (closed || reading || !dirty || (controller.desiredSize ?? 0) <= 0) return;
    reading = true; dirty = false;
    try {
      const packet = JSON.stringify({ version: 1, value: await read() });
      if (!closed && !signal.aborted && packet !== previous) { controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + packet + '\n\n')); previous = packet; }
    } catch {
      if (!closed && !signal.aborted) controller.enqueue(new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n'));
      close();
    } finally { reading = false; if (dirty && !closed) changed(); }
  };
  return new ReadableStream<Uint8Array>({
    start(value) { controller = value; if (signal.aborted) return close();
      try { remove = runtime.subscribe(scope, changed, filter); } catch (error) { cleanup(); controller.error(error); return; }
      signal.addEventListener('abort', close, { once: true }); interval = setInterval(changed, 10000); interval.unref?.(); lifetime = setTimeout(close, 20000); lifetime.unref?.(); void pump(); },
    pull() { void pump(); }, cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}
