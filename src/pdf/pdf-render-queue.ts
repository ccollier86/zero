/**
 * pdf-render-queue.ts
 *
 * Bounds concurrent PDF work and queued render pressure. This file owns queue
 * mechanics only; it does not know about Chromium, HTML, or storage.
 */

import { PdfError } from './pdf-error';

interface QueueWaiter {
  resolve: (release: () => void) => void;
  reject: (error: PdfError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Bounded asynchronous semaphore used by PdfService. */
export class PdfRenderQueue {
  private activeCount = 0;
  private readonly waiters: QueueWaiter[] = [];
  private closed = false;

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueue: number
  ) {}

  /** Number of renderer tasks currently holding a slot. */
  get active(): number {
    return this.activeCount;
  }

  /** Number of renderer tasks waiting for a slot. */
  get queued(): number {
    return this.waiters.length;
  }

  /** Run a task after acquiring a slot, always releasing it afterward. */
  async run<T>(task: (remainingMs: number) => Promise<T>, timeoutMs: number): Promise<T> {
    const startedAt = performance.now();
    const release = await this.acquire(timeoutMs);
    try {
      const remainingMs = Math.floor(timeoutMs - (performance.now() - startedAt));
      if (remainingMs <= 0) {
        throw new PdfError(
          'Timed out waiting for a PDF render slot.',
          'PDF_QUEUE_TIMEOUT',
          { timeoutMs }
        );
      }
      return await task(remainingMs);
    } finally {
      release();
    }
  }

  /** Reject queued work and prevent new acquisitions during app shutdown. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new PdfError('The PDF render queue is closed.', 'PDF_SERVICE_CLOSED');
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private acquire(waitTimeoutMs: number): Promise<() => void> {
    if (this.closed) {
      return Promise.reject(new PdfError('The PDF render queue is closed.', 'PDF_SERVICE_CLOSED'));
    }
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return Promise.resolve(this.createRelease());
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(new PdfError(
        'The PDF render queue is full.',
        'PDF_QUEUE_FULL',
        { maxQueue: this.maxQueue }
      ));
    }

    return new Promise((resolve, reject) => {
      const waiter: QueueWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new PdfError(
            'Timed out waiting for a PDF render slot.',
            'PDF_QUEUE_TIMEOUT',
            { timeoutMs: waitTimeoutMs }
          ));
        }, waitTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.closed) {
        this.activeCount = Math.max(0, this.activeCount - 1);
        return;
      }
      const next = this.waiters.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.createRelease());
        return;
      }
      this.activeCount = Math.max(0, this.activeCount - 1);
    };
  }
}
