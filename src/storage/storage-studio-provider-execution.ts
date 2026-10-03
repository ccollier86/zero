/** Bounded provider execution with durable-job lease renewal and cooperative abort. */

import type { StorageStudioJobRecord } from './storage-studio-job-store';

export type StorageStudioProviderExecutionOutcome =
  | 'completed'
  | 'stopping'
  | 'lease-lost'
  | 'timed-out';

interface ActiveProviderCall {
  readonly controller: AbortController;
  reason: Exclude<StorageStudioProviderExecutionOutcome, 'completed'> | null;
}

export interface StorageStudioProviderExecutionOptions {
  readonly renew: (job: StorageStudioJobRecord) => boolean;
  readonly renewEveryMs: number;
  readonly timeoutMs: number;
}

/** Owns only provider call timing, cancellation, and lease heartbeats. */
export class StorageStudioProviderExecution {
  private readonly active = new Set<ActiveProviderCall>();
  private stopping = false;

  constructor(private readonly options: StorageStudioProviderExecutionOptions) {}

  async run(
    job: StorageStudioJobRecord,
    invoke: (signal: AbortSignal) => void | Promise<void>,
  ): Promise<StorageStudioProviderExecutionOutcome> {
    if (this.stopping) return 'stopping';
    const active: ActiveProviderCall = {
      controller: new AbortController(),
      reason: null,
    };
    this.active.add(active);
    const renewal = setInterval(() => {
      if (active.reason !== null) return;
      try {
        if (this.options.renew(job)) return;
      } catch {
        // Renewal uncertainty is a lost lease, never permission to continue.
      }
      active.reason = 'lease-lost';
      active.controller.abort();
    }, this.options.renewEveryMs);
    renewal.unref?.();
    try {
      const provider = Promise.resolve(invoke(active.controller.signal));
      return await waitForProvider(provider, active, this.options.timeoutMs);
    } finally {
      clearInterval(renewal);
      this.active.delete(active);
    }
  }

  /** Abort active calls; run() waits for provider cancellation acknowledgement. */
  stop(): void {
    this.stopping = true;
    for (const active of this.active) {
      if (active.reason === null) active.reason = 'stopping';
      active.controller.abort();
    }
  }
}

function waitForProvider(
  provider: Promise<void>,
  active: ActiveProviderCall,
  timeoutMs: number,
): Promise<StorageStudioProviderExecutionOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: StorageStudioProviderExecutionOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(outcome);
    };
    const timeout = setTimeout(() => {
      if (active.reason === null) active.reason = 'timed-out';
      active.controller.abort();
      finish('timed-out');
    }, timeoutMs);
    timeout.unref?.();
    void provider.then(
      () => finish(active.reason ?? 'completed'),
      (error) => {
        if (active.reason !== null) finish(active.reason);
        else {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      },
    );
  });
}
