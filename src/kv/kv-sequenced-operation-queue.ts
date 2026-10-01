/**
 * kv-sequenced-operation-queue.ts
 *
 * Commits async operations in an externally assigned sequence. This keeps
 * in-memory mutation order aligned with durable journal replay order without
 * serializing the work that happens before a sequence is assigned.
 */

import { KvError } from './kv-errors';

interface PendingOperation {
  operation: () => unknown | Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Run submitted operations in contiguous ascending sequence order. */
export class KvSequencedOperationQueue {
  private readonly pending = new Map<number, PendingOperation>();
  private readonly drainWaiters = new Set<() => void>();
  private nextSequence: number;
  private failureReason: unknown = null;
  private failed = false;
  private running = false;

  constructor(completedSequence = 0) {
    assertCompletedSequence(completedSequence);
    this.nextSequence = completedSequence + 1;
  }

  /** Reset the next expected sequence after startup recovery. */
  reset(completedSequence: number): void {
    assertCompletedSequence(completedSequence);
    if (this.running || this.pending.size > 0) {
      throw new KvError('KV_RECOVERY_FAILED', 'KV commit sequence cannot reset while mutations are pending.', {
        completedSequence,
      });
    }
    this.nextSequence = completedSequence + 1;
    this.failureReason = null;
    this.failed = false;
  }

  /** Submit an operation and resolve it only after all earlier sequences. */
  run<T>(sequence: number, operation: () => T | Promise<T>): Promise<T> {
    if (this.failed) return Promise.reject(this.failureReason);
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence < this.nextSequence || this.pending.has(sequence)) {
      return Promise.reject(new KvError('KV_RECOVERY_FAILED', 'KV commit sequence is invalid or duplicated.', {
        sequence,
        nextSequence: this.nextSequence,
      }));
    }

    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(sequence, {
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.runNext();
    return result;
  }

  /** Wait until all submitted operations settle. */
  async drain(): Promise<void> {
    if (!this.running && this.pending.size === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  /** Return the highest sequence whose operation has finished. */
  completedSequence(): number {
    return this.nextSequence - 1;
  }

  /** Return the operation failure that stopped ordered commits, when present. */
  failure(): unknown | null {
    return this.failed ? this.failureReason : null;
  }

  private runNext(): void {
    if (this.running) return;
    const pending = this.pending.get(this.nextSequence);
    if (!pending) {
      if (this.pending.size === 0) this.resolveDrainWaiters();
      return;
    }

    this.running = true;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(pending.operation());
    } catch (error) {
      result = Promise.reject(error);
    }

    void result.then(
      (value) => {
        pending.resolve(value);
        this.pending.delete(this.nextSequence);
        this.nextSequence += 1;
        this.running = false;
        this.runNext();
      },
      (error) => {
        pending.reject(error);
        this.pending.delete(this.nextSequence);
        this.failureReason = error ?? new KvError(
          'KV_RECOVERY_FAILED',
          'KV ordered commit failed without an error value.'
        );
        this.failed = true;
        this.running = false;
        const blockedError = new KvError(
          'KV_RECOVERY_FAILED',
          'KV ordered commits stopped after a mutation failed to apply.',
          { cause: error instanceof Error ? error.message : String(error) }
        );
        for (const blocked of this.pending.values()) blocked.reject(blockedError);
        this.pending.clear();
        this.resolveDrainWaiters();
      }
    );
  }

  private resolveDrainWaiters(): void {
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

function assertCompletedSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new KvError('KV_RECOVERY_FAILED', 'KV completed sequence must be a non-negative safe integer.', {
      sequence,
    });
  }
}
