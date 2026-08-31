/** Composes caller cancellation with a bounded authorization timeout. */

export function createAuthorizationSignal(
  source: AbortSignal | undefined,
  timeoutMs: number,
): NativeOperationSignal {
  return createOperationSignal(source, timeoutMs, 'Authorization timed out.');
}

export interface NativeOperationSignal {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  dispose: () => void;
}

export function createOperationSignal(
  source: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage = 'Native authentication request timed out.',
): NativeOperationSignal {
  const controller = new AbortController();
  const abort = () => controller.abort(source?.reason);
  if (source?.aborted) abort();
  else source?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose: () => {
      clearTimeout(timeout);
      source?.removeEventListener('abort', abort);
    },
  };
}

/** Bound promises even when a platform adapter ignores the supplied signal. */
export function raceWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(succeed, fail);
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw abortReason(signal);
}

export async function settleWithin(tasks: Promise<unknown>[], timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  await Promise.race([Promise.allSettled(tasks).then(() => undefined), timeout]);
  if (timer) clearTimeout(timer);
}

export function invokeAsync<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Native authentication cancelled.');
}
