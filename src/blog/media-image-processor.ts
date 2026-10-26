/** Bounded raster work outside SQLite/Fabric writer lanes. Admission precedes buffering/decoding so concurrent uploads cannot allocate unlimited image heaps. */
import { AuthError } from '../auth/types';

type Waiter = { resolve(release: () => void): void; reject(error: unknown): void; dispose(): void };
/** One application owns this small CPU/native-memory pool; video/audio do not occupy it. */
export class BlogImageProcessor {
  private running = 0;
  private stopped = false;
  private waiting: Waiter[] = [];
  constructor(private readonly limits: { maxInput: number; maxPixels: number; maxOutput: number; concurrency?: number; queued?: number }) {}
  /** Load only after bounded admission; accepted bytes are raster-validated, oriented and stripped of source metadata. */
  async normalize(load: () => Promise<Uint8Array>, check: () => void, signal?: AbortSignal) {
    const release = await this.acquire(signal);
    try {
      check(); signal?.throwIfAborted(); const input = await load(); check(); signal?.throwIfAborted();
      if (input.byteLength < 1 || input.byteLength > this.limits.maxInput) throw invalid();
      let sharp: typeof import('sharp')['default'];
      try { sharp = (await import('sharp')).default; }
      catch { throw new AuthError('Blog image processing is unavailable. Verify the deployment native image payload.', 'BLOG_NOT_READY', 503); }
      try {
        const options = { limitInputPixels: this.limits.maxPixels, failOn: 'warning' as const, animated: false };
        const metadata = await sharp(input, options).metadata(); check(); signal?.throwIfAborted();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height
          || metadata.width * metadata.height > this.limits.maxPixels || (metadata.pages ?? 1) !== 1) throw invalid();
        const result = await sharp(input, options).timeout({ seconds: 10 }).rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
        check(); signal?.throwIfAborted();
        if (!result.info.width || !result.info.height || result.info.width * result.info.height > this.limits.maxPixels
          || result.data.byteLength > Math.min(this.limits.maxOutput, 32 * 1024 * 1024)) throw invalid();
        return { bytes: result.data, width: result.info.width, height: result.info.height };
      } catch (error) {
        if (error instanceof AuthError || signal?.aborted) throw error;
        // Native messages can contain image metadata or provider details.
        throw invalid();
      }
    } finally { release(); }
  }
  /** Already running native work drains under its deadline; queued bodies are never read during shutdown. */
  close() {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) { waiter.dispose(); waiter.reject(unavailable()); }
  }
  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.stopped) return Promise.reject(unavailable());
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.running < (this.limits.concurrency ?? 2)) { this.running++; return Promise.resolve(this.release()); }
    if (this.waiting.length >= (this.limits.queued ?? 8)) return Promise.reject(capacity());
    return new Promise((resolve, reject) => {
      const remove = (error: unknown) => { const index = this.waiting.indexOf(waiter); if (index < 0) return; this.waiting.splice(index, 1); waiter.dispose(); reject(error); };
      const aborted = () => remove(signal?.reason ?? capacity());
      const timer = setTimeout(() => remove(capacity()), 10000);
      const waiter: Waiter = { resolve, reject, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); } };
      this.waiting.push(waiter); signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = !this.stopped ? this.waiting.shift() : undefined;
      if (next) { next.dispose(); next.resolve(this.release()); }
      else this.running--;
    };
  }
}
function invalid() { return new AuthError('Choose a valid JPEG, PNG or WebP image within the configured limits.', 'BLOG_IMAGE_INVALID', 422); }
function capacity() { return new AuthError('Blog image processing capacity is temporarily exhausted.', 'BLOG_CAPACITY', 429); }
function unavailable() { return new AuthError('Blog image processing is unavailable.', 'BLOG_NOT_READY', 503); }
