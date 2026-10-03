/** Admission, cancellation, and bounded shutdown handoff for upload lifetimes. */

import { StorageDomainError } from './storage-domain-error';

export class StorageUploadOperationTracker {
  private readonly active = new Map<Promise<unknown>, ActiveUpload>();
  private stopping = false;

  run<T>(operation: (context: StorageUploadOperationContext) => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(uploadUnavailable());
    const controller = new AbortController();
    const state: ActiveUpload = { controller, detached: false, handoffSafe: false };
    const execution = operation(Object.freeze({
      signal: controller.signal,
      isDetached: () => state.detached,
      setProviderHandoffSafe: (safe: boolean) => { state.handoffSafe = safe; },
    }));
    this.active.set(execution, state);
    void execution.finally(() => this.active.delete(execution)).catch(() => {});
    return execution;
  }

  /**
   * Reject new uploads, request cancellation, and wait a bounded interval.
   * A false result transfers cleanup to `whenDrained`; callers must not close
   * the adapter or blob coordinator before that continuation settles.
   */
  async stop(timeoutMs = 5_000): Promise<boolean> {
    this.stopping = true;
    for (const state of this.active.values()) {
      state.controller.abort(uploadUnavailable());
    }
    if (this.active.size === 0) return true;
    const drained = await Promise.race([
      this.whenDrained().then(() => true),
      Bun.sleep(timeoutMs).then(() => false),
    ]);
    if (!drained) {
      if (![...this.active.values()].every((state) => state.handoffSafe)) {
        await this.whenDrained();
        return true;
      }
      for (const state of this.active.values()) state.detached = true;
    }
    return drained;
  }

  /** Join every admitted lifetime, including an adapter that ignored abort. */
  async whenDrained(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active.keys()]);
    }
  }
}

export interface StorageUploadOperationContext {
  readonly signal: AbortSignal;
  /** True only after bounded shutdown returned ownership to the runtime. */
  isDetached(): boolean;
  /** Mark an adapter await whose durable publication can outlive the DB. */
  setProviderHandoffSafe(safe: boolean): void;
}

interface ActiveUpload {
  readonly controller: AbortController;
  detached: boolean;
  handoffSafe: boolean;
}

function uploadUnavailable(): StorageDomainError {
  return new StorageDomainError(
    'STORAGE_NOT_READY',
    'Storage is stopping and cannot accept another upload.',
    { retryable: true, outcome: 'not-started' },
  );
}
