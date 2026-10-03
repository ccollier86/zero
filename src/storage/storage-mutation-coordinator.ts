/**
 * storage-mutation-coordinator.ts
 *
 * Provides instance-local, keyed serialization for async Storage mutations.
 * SQLite remains the durable atomicity boundary; this coordinator prevents
 * adapter awaits for overlapping paths/blobs from racing in one service.
 */

interface StorageMutationLease {
  readonly release: () => void;
}

/** Serialize async work by one or more sorted keys without a global lock. */
export class StorageMutationCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  /** Run `operation` after acquiring every distinct non-empty key. */
  async run<T>(
    inputKeys: readonly (string | null | undefined)[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const keys = [...new Set(inputKeys.filter(
      (key): key is string => typeof key === 'string' && key.length > 0,
    ))].sort();
    const leases: StorageMutationLease[] = [];
    try {
      for (const key of keys) leases.push(await this.acquire(key));
      return await operation();
    } finally {
      for (const lease of leases.reverse()) lease.release();
    }
  }

  private async acquire(key: string): Promise<StorageMutationLease> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const tail = previous.catch(() => {}).then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => {});

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        releaseGate();
        if (this.tails.get(key) === tail) {
          void tail.finally(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
          });
        }
      },
    };
  }
}
