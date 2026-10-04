import { mutationCancelledError } from './data-table-mutation-types';

/** Reject promptly on lifecycle abort even when app code has not consumed its signal. */
export function awaitDataTableMutation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(mutationCancelledError());
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(mutationCancelledError());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener('abort', cancel);
        reject(cause);
      },
    );
  });
}
