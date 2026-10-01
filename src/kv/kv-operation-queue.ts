/**
 * kv-operation-queue.ts
 *
 * Provides failure-safe, key-scoped async operation ordering. This file owns
 * queue mechanics only; it does not know about KV mutations or persistence.
 */

/** Serialize operations that share a key while allowing other keys to run. */
export class KvOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /** Run an operation after earlier work for the same key has settled. */
  run<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key);
    const result = previous
      ? previous.then(operation)
      : callAsPromise(operation);

    let tail: Promise<void>;
    tail = result
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });

    this.tails.set(key, tail);
    return result;
  }

  /** Wait until every operation currently admitted to the queue settles. */
  async drain(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all([...this.tails.values()]);
    }
  }
}

function callAsPromise<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}
