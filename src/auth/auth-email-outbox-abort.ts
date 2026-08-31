import { EmailError } from '../email';

export async function waitForAuthEmailDelivery<T>(
  promise: Promise<T>, signal: AbortSignal
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); }
    );
  });
}

function abortError(signal: AbortSignal): EmailError {
  if (signal.reason === 'shutdown') {
    return new EmailError('Auth email delivery stopped', 'EMAIL_DELIVERY_ABORTED', 503);
  }
  if (signal.reason === 'lease_lost') {
    return new EmailError('Auth email delivery lease was lost', 'EMAIL_DELIVERY_LEASE_LOST', 503);
  }
  return new EmailError('Auth email delivery timed out', 'EMAIL_DELIVERY_TIMEOUT', 504);
}
