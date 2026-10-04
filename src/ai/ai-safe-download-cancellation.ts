import { AIError } from './ai-errors';
import {
  remoteAIAssetDownloadAborted,
  remoteAIAssetDownloadTimedOut,
} from './ai-safe-download-errors';

/** Create an abort scope with an optional stable Zero timeout error. */
export function createAISafeDownloadScope(
  signals: readonly (AbortSignal | undefined)[],
  timeoutMs?: number,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const timeoutController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      timeoutController.abort(remoteAIAssetDownloadTimedOut());
    } else {
      timer = setTimeout(
        () => timeoutController.abort(remoteAIAssetDownloadTimedOut()),
        timeoutMs,
      );
    }
  }
  const combined = combineAISafeDownloadAbortSignals(...signals, timeoutController.signal);
  return {
    signal: combined.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      combined.dispose();
    },
  };
}

export async function awaitAISafeDownloadAbortable<T>(
  operation: PromiseLike<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return operation;
  throwIfAISafeDownloadAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(aiSafeDownloadAbortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export function combineAISafeDownloadAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => active.forEach((signal) => signal.removeEventListener('abort', abort)),
  };
}

export function throwIfAISafeDownloadAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw aiSafeDownloadAbortReason(signal);
}

export function aiSafeDownloadAbortReason(signal?: AbortSignal | null): AIError {
  if (signal?.reason instanceof AIError) return signal.reason;
  return remoteAIAssetDownloadAborted();
}

export function isAISafeDownloadAbort(
  error: unknown,
  signal?: AbortSignal | null,
): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}
