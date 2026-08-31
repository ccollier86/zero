interface SyncReconnectSchedulerInput {
  maximumAttempts: number;
  stopped: () => boolean;
  connect: () => void;
  error?: (message: string) => void;
}

/** Schedules reconnects with bounded exponential backoff and jitter. */
export class SyncReconnectScheduler {
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly input: SyncReconnectSchedulerInput) {}

  succeeded(): void {
    this.attempts = 0;
  }

  schedule(): void {
    if (this.input.stopped() || this.timer !== null) return;
    if (this.attempts >= this.input.maximumAttempts) {
      this.input.error?.(
        `Max reconnect attempts (${this.input.maximumAttempts}) exceeded`,
      );
      return;
    }
    const base = 1_000;
    const delay = Math.min(
      base * Math.pow(2, this.attempts) + Math.random() * base,
      30_000,
    );
    this.attempts += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.input.connect();
    }, delay);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.cancel();
    this.succeeded();
  }
}
