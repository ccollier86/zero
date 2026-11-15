/** One bounded coalesced page subscription; hints never grant read authority and observer failures never change commits. */
import type { JobSchedulePage } from './contracts';
export function watchJobSchedules(options: {
  prepare(): Promise<{ read(): Promise<JobSchedulePage>; subscribe(changed: () => void): () => void }>;
  listener(page: JobSchedulePage): void;
  signal: AbortSignal;
  onError?(error: unknown): void;
}): () => void {
  let closed = false, reading = false, dirty = true, remove: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, check: ReturnType<typeof setInterval> | undefined;
  let read: (() => Promise<JobSchedulePage>) | undefined, previous = '';
  const close = () => { if (closed) return; closed = true; remove?.(); clearTimeout(timer); clearInterval(check); options.signal.removeEventListener('abort', close); };
  const fail = (error: unknown) => { if (closed) return; close(); try { options.onError?.(error); } catch { /* Observer only. */ } };
  const pump = async () => {
    if (closed || reading || !dirty || !read) return;
    reading = true; dirty = false;
    try {
      const value = await read(), fingerprint = JSON.stringify(value);
      if (!closed && !options.signal.aborted && previous !== fingerprint) { previous = fingerprint; options.listener(value); }
    } catch (error) { fail(error); }
    finally { reading = false; if (dirty && !closed) changed(); }
  };
  const changed = () => { dirty = true; if (!closed && !timer) timer = setTimeout(() => { timer = undefined; void pump(); }, 50); };
  if (options.signal.aborted) { closed = true; return close; }
  options.signal.addEventListener('abort', close, { once: true });
  void options.prepare().then(prepared => {
    if (closed || options.signal.aborted) return;
    // Subscribe before the first read so a concurrent accepted control is not lost.
    read = prepared.read; remove = prepared.subscribe(changed);
    check = setInterval(changed, 10_000); check.unref?.(); void pump();
  }).catch(fail);
  return close;
}
