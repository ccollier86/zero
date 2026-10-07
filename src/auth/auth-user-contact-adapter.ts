/** Bounded trusted adapter calls. Aborts are advisory; the race fences late completion. */
import { AuthError } from './types';

export class AuthUserContactAdapterRequests {
  private readonly active = new Set<AbortController>();
  constructor(private readonly deadlineMs = 15_000) {}
  async run<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.active.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        aborted = () => reject(adapterUnavailable());
        controller.signal.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => controller.abort('timeout'), this.deadlineMs);
      });
      return await Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw adapterUnavailable();
        return call(controller.signal);
      }), deadline]);
    } catch { throw adapterUnavailable(); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      if (aborted) controller.signal.removeEventListener('abort', aborted);
      this.active.delete(controller);
    }
  }
  cancel(): void { for (const controller of this.active) controller.abort('shutdown'); }
}
export function adapterUnavailable(): AuthError {
  return new AuthError('Phone verification is temporarily unavailable', 'AUTH_CONTACT_ADAPTER_UNAVAILABLE', 503);
}
