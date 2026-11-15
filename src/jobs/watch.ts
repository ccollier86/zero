/** One bounded coalesced page subscription; hints never grant read authority and observer failures never change commits. */
import type { JobSchedulePage, JobWatchUpdate } from './contracts';
export function watchJobSchedules(options: {
  prepare(): Promise<{ read(): Promise<JobSchedulePage>; subscribe(changed: () => void): () => void }>;
  listener(page: JobSchedulePage, update?: JobWatchUpdate): void;
  signal: AbortSignal;
  onError?(error: unknown): void;
}): () => void {
  let closed = false, reading = false, dirty = true, invalidated = false, remove: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, check: ReturnType<typeof setInterval> | undefined;
  let read: (() => Promise<JobSchedulePage>) | undefined, previous = '';
  const close = () => { if (closed) return; closed = true; remove?.(); clearTimeout(timer); clearInterval(check); options.signal.removeEventListener('abort', close); };
  const fail = (error: unknown) => { if (closed) return; close(); try { options.onError?.(error); } catch { /* Observer only. */ } };
  const pump = async () => {
    if (closed || reading || !dirty || !read) return;
    reading = true; dirty = false;
    // A hint arriving during this read owns a separate follow-up read. Do not
    // clear it or claim that this earlier snapshot already observed the commit.
    const committedChange = invalidated; invalidated = false;
    try {
      const value = await read(), fingerprint = JSON.stringify(value);
      if (!closed && !options.signal.aborted && (previous !== fingerprint || committedChange)) {
        previous = fingerprint; options.listener(value, Object.freeze({ invalidated: committedChange }));
      }
    } catch (error) { fail(error); }
    finally { reading = false; if (dirty && !closed) schedule(); }
  };
  const schedule = () => { if (!closed && !timer) timer = setTimeout(() => { timer = undefined; void pump(); }, 50); };
  const changed = () => { dirty = true; invalidated = true; schedule(); };
  const recheck = () => { dirty = true; schedule(); };
  if (options.signal.aborted) { closed = true; return close; }
  options.signal.addEventListener('abort', close, { once: true });
  void options.prepare().then(prepared => {
    if (closed || options.signal.aborted) return;
    // Subscribe before the first read so a concurrent accepted control is not lost.
    read = prepared.read; remove = prepared.subscribe(changed);
    // Periodic authority checks may withdraw access, but never fabricate a
    // committed-change invalidation for an unchanged authorized projection.
    check = setInterval(recheck, 10_000); check.unref?.(); void pump();
  }).catch(fail);
  return close;
}
