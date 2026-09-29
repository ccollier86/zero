/**
 * Per-socket admission and ordering for inbound Sync frames.
 *
 * Bun may invoke an async WebSocket message handler again before the previous
 * invocation settles. This queue establishes one FIFO ahead of authentication
 * and routing while bounding the closures and decoded payloads retained for a
 * slow socket.
 */

export const SYNC_INGRESS_MAX_PENDING_MESSAGES = 32 as const;
export const SYNC_INGRESS_MAX_PENDING_BYTES = 4_194_304 as const;

const encoder = new TextEncoder();

export interface SyncIngressFence {
  /** False after overload, socket close, or plugin teardown. */
  readonly active: boolean;
}

export type SyncIngressAdmission =
  | Readonly<{ accepted: false; reason: 'disposed' | 'capacity' | 'invalid-size' }>
  | Readonly<{ accepted: true; completion: Promise<void> }>;

/** A bounded, disposable FIFO owned by exactly one transport socket. */
export class SyncSocketIngressQueue {
  #tail: Promise<void> = Promise.resolve();
  #pendingMessages = 0;
  #pendingBytes = 0;
  #disposed = false;

  get active(): boolean {
    return !this.#disposed;
  }

  get pendingMessages(): number {
    return this.#pendingMessages;
  }

  get pendingBytes(): number {
    return this.#pendingBytes;
  }

  admit(
    encodedBytes: number,
    handler: (fence: SyncIngressFence) => void | Promise<void>,
  ): SyncIngressAdmission {
    if (this.#disposed) return { accepted: false, reason: 'disposed' };
    if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 0) {
      return { accepted: false, reason: 'invalid-size' };
    }
    if (this.#pendingMessages >= SYNC_INGRESS_MAX_PENDING_MESSAGES
      || encodedBytes > SYNC_INGRESS_MAX_PENDING_BYTES - this.#pendingBytes) {
      this.dispose();
      return { accepted: false, reason: 'capacity' };
    }

    this.#pendingMessages += 1;
    this.#pendingBytes += encodedBytes;
    const queue = this;
    const fence: SyncIngressFence = {
      get active() { return !queue.#disposed; },
    };
    const run = this.#tail.then(async () => {
      if (!fence.active) return;
      await handler(fence);
    });
    const settled = run.finally(() => {
      this.#pendingMessages -= 1;
      this.#pendingBytes -= encodedBytes;
    });
    // A rejected handler must not poison later FIFO admission. Its own caller
    // still receives the rejection through `completion`.
    this.#tail = settled.catch(() => undefined);
    return { accepted: true, completion: settled };
  }

  /** Fence queued work. The currently running handler observes `active=false`. */
  dispose(): void {
    this.#disposed = true;
  }
}

/** Estimate retained wire bytes after Elysia's optional JSON decoding. */
export function syncIngressEncodedBytes(message: unknown): number | null {
  if (typeof message === 'string') return encoder.encode(message).byteLength;
  if (message instanceof ArrayBuffer) return message.byteLength;
  if (ArrayBuffer.isView(message)) return message.byteLength;
  if (!message || typeof message !== 'object') return null;
  try {
    const serialized = JSON.stringify(message);
    return typeof serialized === 'string'
      ? encoder.encode(serialized).byteLength
      : null;
  } catch {
    return null;
  }
}
