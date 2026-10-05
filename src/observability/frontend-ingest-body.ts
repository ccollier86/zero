/**
 * Checks frontend-report byte limits before Elysia's media parser allocates a
 * parsed body. This module owns bounded stream inspection only; the plugin owns
 * rejection responses/events and Elysia retains media parsing and validation.
 */

/** Inspect a cloned stream while preserving the original for Elysia parsing. */
export async function enforceFrontendPayloadBytes(
  request: Request,
  maxBytes: number,
  rejected: (observedBytes: number) => void,
): Promise<void> {
  const reject = (observedBytes: number): never => {
    rejected(observedBytes);
    void request.body?.cancel().catch(() => undefined);
    throw new Error('Payload too large');
  };

  const declaredBytes = Number(request.headers.get('content-length'));
  if (declaredBytes > maxBytes) reject(declaredBytes);
  const reader = request.clone().body?.getReader();
  if (!reader) return;
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        reject(bytes);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
