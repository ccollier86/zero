import type { PendingMutation } from '../types';

interface SyncAckMonitorInput {
  timeoutMs: number;
  pending: () => PendingMutation[];
  timeout: (mutation: PendingMutation) => void;
}

/** Rejects optimistic mutations that never receive a server acknowledgement. */
export class SyncAckMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly input: SyncAckMonitorInput) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const mutation of this.input.pending()) {
        if (now - mutation.sentAt > this.input.timeoutMs) {
          this.input.timeout(mutation);
        }
      }
    }, 2_000);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
