/**
 * ai-bounded-byte-stream.ts
 *
 * Wraps byte streams with deterministic size limits and lifecycle callbacks.
 * This module owns stream resource cleanup only; it does not resolve providers,
 * emit platform events directly, or interpret file metadata.
 */

import { AIError } from './ai-errors';

/** Terminal hooks used by upload/download services to settle telemetry once. */
export interface AIBoundedByteStreamHooks {
  /** Whether chunks originate from caller input or an external provider. */
  origin?: 'request' | 'provider';
  abortSignal?: AbortSignal;
  close?(): void;
  cancel?(): void;
  error?(error: AIError): void;
}

/** A bounded stream plus an escape hatch for cancelling an abandoned source. */
export interface AIBoundedByteStream {
  stream: ReadableStream<Uint8Array>;
  cancel(reason?: unknown): Promise<void>;
  bytesRead(): number;
}

/**
 * Wrap a byte stream and reject it as soon as the cumulative limit is crossed.
 *
 * The wrapper owns the source reader. All close, cancel, error, and explicit
 * cleanup paths release that reader exactly once.
 */
export function createAIBoundedByteStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  hooks: AIBoundedByteStreamHooks = {}
): AIBoundedByteStream {
  const reader = source.getReader();
  let totalBytes = 0;
  let terminal = false;
  let readerReleased = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const removeAbortListener = (): void => {
    hooks.abortSignal?.removeEventListener('abort', abortFromSignal);
  };

  const releaseReader = (): void => {
    if (readerReleased) return;
    readerReleased = true;
    try {
      reader.releaseLock();
    } catch {
      // A pending read owns the lock until its promise settles.
    }
  };

  const settleClose = (): void => {
    if (terminal) return;
    terminal = true;
    removeAbortListener();
    releaseReader();
    hooks.close?.();
  };

  const settleCancel = (): void => {
    if (terminal) return;
    terminal = true;
    removeAbortListener();
    releaseReader();
    hooks.cancel?.();
  };

  const settleError = (error: AIError): AIError => {
    if (!terminal) {
      terminal = true;
      removeAbortListener();
      releaseReader();
      hooks.error?.(error);
    }
    return error;
  };

  const cancelReader = async (reason?: unknown): Promise<void> => {
    if (terminal) return;
    try {
      await reader.cancel(reason);
    } finally {
      settleCancel();
    }
  };

  const abortFromSignal = (): void => {
    if (terminal) return;
    const error = new AIError('The AI file transfer was aborted.', 'AI_REQUEST_ABORTED', 499);
    const cancellation = reader.cancel(error).catch(() => undefined);
    try {
      streamController?.error(error);
    } catch {
      // A concurrent stream terminal state won the race.
    }
    settleError(error);
    void cancellation;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (terminal) return;
        if (chunk.done) {
          controller.close();
          settleClose();
          return;
        }
        if (!(chunk.value instanceof Uint8Array)) {
          const error = invalidStream(
            'AI file stream emitted a non-byte chunk.',
            hooks.origin
          );
          await reader.cancel(error).catch(() => undefined);
          throw error;
        }
        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxBytes) {
          const error = new AIError(
            'AI file transfer exceeds the configured byte limit.',
            'AI_REQUEST_LIMIT_EXCEEDED',
            413
          );
          await reader.cancel(error).catch(() => undefined);
          throw error;
        }
        // Producers may reuse or mutate buffers immediately after enqueue.
        controller.enqueue(new Uint8Array(chunk.value));
      } catch (error) {
        throw settleError(normalizeStreamError(error, hooks.origin));
      }
    },
    async cancel(reason) {
      await cancelReader(reason);
    },
  });

  if (hooks.abortSignal?.aborted) queueMicrotask(abortFromSignal);
  else hooks.abortSignal?.addEventListener('abort', abortFromSignal, { once: true });

  return {
    stream,
    cancel: cancelReader,
    bytesRead: () => totalBytes,
  };
}

function normalizeStreamError(
  error: unknown,
  origin: 'request' | 'provider' = 'provider'
): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new AIError('The AI file transfer was aborted.', 'AI_REQUEST_ABORTED', 499);
  }
  return invalidStream('AI file stream failed.', origin);
}

function invalidStream(
  message: string,
  origin: 'request' | 'provider' = 'provider'
): AIError {
  return origin === 'request'
    ? new AIError(message, 'AI_REQUEST_INVALID', 400)
    : new AIError(message, 'AI_PROVIDER_RESPONSE_INVALID', 502);
}
