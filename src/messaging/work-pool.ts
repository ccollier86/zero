/** Bounded concurrent I/O, not a serialized automation handler. No database lease is retained while waiting here. */
import { AuthError } from '../auth/types';
export class MessagingWorkPool {
  private closing = false;
  private readonly stop = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  private readonly waiting: { start(): void; cancel(): void }[] = [];
  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) throw new Error('Invalid messaging work-pool capacity.');
  }
  get size(): number { return this.active.size + this.waiting.length; }
  run<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closing || signal?.aborted) return Promise.reject(signal?.reason ?? unavailable());
    if (this.waiting.length >= 100) return Promise.reject(new AuthError('Messaging work-pool admission is exhausted.', 'MESSAGING_CAPACITY', 429));
    return new Promise<T>((resolve, reject) => {
      const remove = () => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); signal?.removeEventListener('abort', abort); };
      const abort = () => { remove(); reject(signal?.reason ?? unavailable()); };
      const entry = {
        cancel: abort,
        start: () => {
          remove(); if (this.closing || signal?.aborted) { reject(signal?.reason ?? unavailable()); return; }
          const combined = AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])]);
          const task = Promise.resolve().then(() => { combined.throwIfAborted(); return work(combined); });
          this.active.add(task);
          void task.then(resolve, reject).finally(() => { this.active.delete(task); this.pump(); });
        },
      };
      signal?.addEventListener('abort', abort, { once: true }); this.waiting.push(entry); this.pump();
    });
  }
  async close(): Promise<void> {
    this.closing = true; this.stop.abort(unavailable());
    for (const entry of [...this.waiting]) entry.cancel();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...this.active]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(unavailable()), 10000); })]); }
    finally { clearTimeout(timer); }
  }
  private pump(): void { while (!this.closing && this.active.size < this.capacity && this.waiting.length) this.waiting[0]!.start(); }
}
function unavailable() { return new AuthError('Messaging work-pool admission is closed.', 'MESSAGING_NOT_READY', 503); }
