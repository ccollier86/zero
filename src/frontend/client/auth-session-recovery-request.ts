/** Bounded admission/network/body reads for session restoration and logout. */

export const AUTH_SESSION_RECOVERY_REQUEST_TIMEOUT_MS = 15_000;

export class AuthSessionRecoveryRequest {
  private readonly controller = new AbortController();

  constructor(private readonly timeoutMs = AUTH_SESSION_RECOVERY_REQUEST_TIMEOUT_MS) {}

  get signal(): AbortSignal { return this.controller.signal; }

  cancel(): void {
    this.controller.abort(new DOMException('Session recovery was cancelled', 'AbortError'));
  }

  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.execute((signal) => operation(signal));
  }

  /** @internal Hand an accepted credential commit to the bounded local lifecycle owner. */
  runCredentialExchange<T>(operation: (signal: AbortSignal, finishNetwork: () => void) => Promise<T>): Promise<T> {
    return this.execute(operation);
  }

  /** Bound only queue admission; the admitted operation owns its own reads. */
  waitForAdmission<T>(operation: (admit: () => void) => Promise<T>): Promise<T> {
    return this.execute((signal, clearDeadline) => operation(() => {
      if (signal.aborted) throw signal.reason;
      clearDeadline();
    }));
  }

  private async execute<T>(
    operation: (signal: AbortSignal, clearDeadline: () => void) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let rejectCancellation!: (reason: unknown) => void;
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const cancel = () => {
      const reason = this.signal.reason ?? new DOMException('Session recovery was cancelled', 'AbortError');
      controller.abort(reason);
      rejectCancellation(reason);
    };
    if (this.signal.aborted) cancel();
    else this.signal.addEventListener('abort', cancel, { once: true });
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = globalThis.setTimeout(() => {
        const error = new DOMException('Session recovery request timed out', 'TimeoutError');
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });
    const clearDeadline = () => {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      timeout = undefined;
    };
    try {
      const request = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return operation(controller.signal, clearDeadline);
      });
      const value = await Promise.race([request, cancellation, deadline]);
      if (controller.signal.aborted) throw controller.signal.reason;
      return value;
    } finally {
      clearDeadline();
      this.signal.removeEventListener('abort', cancel);
    }
  }

  request(url: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> {
    return this.run(async (signal) => {
      const response = await fetch(url, { ...init, signal, cache: 'no-store' });
      if (signal.aborted) throw signal.reason;
      const body: unknown = response.ok ? await response.json() : undefined;
      if (signal.aborted) throw signal.reason;
      return { response, body };
    });
  }
}
