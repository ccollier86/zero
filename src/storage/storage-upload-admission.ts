/**
 * storage-upload-admission.ts
 *
 * Defines the engine-facing lease used to reserve concurrent upload capacity.
 * Storage Studio owns durable reservation persistence; StorageService owns
 * staging and invokes this narrow contract.
 */

export interface StorageUploadLease {
  /** Reconcile the reservation with the staged byte count. */
  adjust(bytes: number): void;
  /** Extend a live reservation while a streaming body is making progress. */
  heartbeat(): void;
  /** Revalidate the exact durable reservation inside metadata commit. */
  assertCurrent(): void;
  /** Mark a successfully published upload. */
  commit(): void;
  /** Release capacity after a rejected or failed upload. */
  release(): void;
}

export interface StorageUploadAdmission {
  /** Reserve capacity before adapter I/O begins. Null means no configured cap. */
  begin(driveId: string, declaredBytes?: number): StorageUploadLease | null;
  /** Enforce a logical object-count delta inside the caller's transaction. */
  assertObjectCapacity(driveId: string, additionalObjects: number): void;
}

/** Add throttled lease heartbeats without buffering the upload body. */
export function withStorageUploadHeartbeat(
  source: ReadableStream<Uint8Array>,
  lease: StorageUploadLease | null,
): ReadableStream<Uint8Array> {
  if (!lease) return source;
  const reader = source.getReader();
  let lastHeartbeat = Date.now();
  const heartbeatIntervalMs = 30_000;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const now = Date.now();
      if (now - lastHeartbeat >= heartbeatIntervalMs) {
        lease.heartbeat();
        lastHeartbeat = now;
      }
      const result = await reader.read();
      if (result.done) {
        controller.close();
        reader.releaseLock();
        return;
      }
      if (result.value) controller.enqueue(result.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

/** Keep a reservation alive across all adapter work, including stalled reads. */
export async function runWithStorageUploadHeartbeat<T>(
  lease: StorageUploadLease | null,
  operation: () => Promise<T>,
  intervalMs = 30_000,
  signal?: AbortSignal,
): Promise<T> {
  if (!lease) return operation();
  let heartbeatFailure: unknown = null;
  const heartbeat = () => {
    if (heartbeatFailure !== null) return;
    try {
      lease.heartbeat();
    } catch (error) {
      heartbeatFailure = error;
    }
  };
  const timer = setInterval(heartbeat, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  const stopHeartbeat = () => clearInterval(timer);
  signal?.addEventListener('abort', stopHeartbeat, { once: true });
  try {
    const value = await operation();
    if (!signal?.aborted) heartbeat();
    if (heartbeatFailure !== null) throw heartbeatFailure;
    return value;
  } finally {
    clearInterval(timer);
    signal?.removeEventListener('abort', stopHeartbeat);
  }
}
