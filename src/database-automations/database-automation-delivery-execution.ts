/** Heartbeat and cancellation boundary for one claimed durable function. */

import type { ClaimedDatabaseAutomationDelivery } from './automation-outbox-contracts';
import type {
  DatabaseAutomationDeliverySource,
  DatabaseAutomationExecutionServiceLease,
  DatabaseAutomationExecutionServiceProvider,
} from './database-automation-delivery-contracts';
import type { DurableDatabaseFunctionDefinition } from './database-function';
import {
  databaseAutomationDeliveryLease,
} from './database-automation-delivery-lease';

export type DatabaseAutomationExecutionOutcome = Readonly<
  | {
      readonly status: 'settled';
      readonly claim: ClaimedDatabaseAutomationDelivery;
      readonly error: unknown | null;
      readonly cleanupFailed: boolean;
    }
  | {
      readonly status: 'lease-lost';
      readonly claim: ClaimedDatabaseAutomationDelivery;
      readonly cleanupFailed: boolean;
    }
  | {
      readonly status: 'abandoned';
      readonly reason: 'shutdown' | 'timeout';
      readonly claim: ClaimedDatabaseAutomationDelivery;
      readonly cleanupFailed: boolean;
    }
>;

export interface ExecuteDatabaseAutomationDeliveryOptions<TServices> {
  readonly source: DatabaseAutomationDeliverySource;
  readonly definition: DurableDatabaseFunctionDefinition<any, any, TServices>;
  readonly provider: DatabaseAutomationExecutionServiceProvider<TServices>;
  readonly claim: ClaimedDatabaseAutomationDelivery;
  readonly leaseMs: number;
  readonly renewIntervalMs: number;
  readonly timeoutMs: number;
  readonly shutdownSignal: AbortSignal;
  readonly now: () => number;
}

/**
 * Execute host work only after claim returns. Heartbeats are separate source
 * calls, so no database writer lane remains held while the handler awaits.
 */
export async function executeDatabaseAutomationDelivery<TServices>(
  options: ExecuteDatabaseAutomationDeliveryOptions<TServices>,
): Promise<DatabaseAutomationExecutionOutcome> {
  const controller = new AbortController();
  let claim = options.claim;
  let lease: DatabaseAutomationExecutionServiceLease<TServices> | null = null;
  let leaseClosed = false;
  let cleanupFailed = false;
  let timedOut = false;

  const closeLease = async (): Promise<void> => {
    if (!lease || leaseClosed) return;
    leaseClosed = true;
    try {
      await lease.close();
    } catch {
      cleanupFailed = true;
    }
  };
  const abortForShutdown = (): void => controller.abort('shutdown');
  options.shutdownSignal.addEventListener('abort', abortForShutdown, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
    void closeLease();
  }, options.timeoutMs);

  const task = Promise.resolve().then(async (): Promise<unknown> => {
    try {
      lease = await options.provider.create(claim, controller.signal);
      if (controller.signal.aborted) throw abortedExecution();
      lease.assertCurrentAuthority();
      const output = await options.definition.handler(Object.freeze({
        input: claim.input,
        invocation: Object.freeze({
          invocationId: claim.invocationId,
          functionIdentity: claim.functionIdentity,
          triggerIdentity: claim.triggerIdentity,
          table: claim.sourceTable,
          operation: claim.sourceOperation,
        }),
        zero: lease.zero,
        signal: controller.signal,
      }));
      lease.assertCurrentAuthority();
      return output;
    } finally {
      await closeLease();
    }
  }).then(
    () => ({ settled: true as const, error: null }),
    (error: unknown) => ({ settled: true as const, error }),
  );

  try {
    while (true) {
      const heartbeat = cancellableDelay(options.renewIntervalMs);
      const shutdown = cancellableAbort(controller.signal);
      const outcome = await Promise.race([
        task,
        heartbeat.promise.then(() => ({ settled: false as const })),
        shutdown.promise.then(() => ({ settled: false as const })),
      ]);
      heartbeat.cancel();
      shutdown.cancel();
      if (outcome.settled) {
        await closeLease();
        if (options.shutdownSignal.aborted || timedOut) {
          return Object.freeze({
            status: 'abandoned' as const,
            reason: timedOut ? 'timeout' as const : 'shutdown' as const,
            claim,
            cleanupFailed,
          });
        }
        return Object.freeze({
          status: 'settled' as const,
          claim,
          error: outcome.error,
          cleanupFailed,
        });
      }

      if (options.shutdownSignal.aborted || timedOut) {
        controller.abort(timedOut ? 'timeout' : 'shutdown');
        await closeLease();
        void task.then(() => undefined);
        return Object.freeze({
          status: 'abandoned' as const,
          reason: timedOut ? 'timeout' as const : 'shutdown' as const,
          claim,
          cleanupFailed,
        });
      }

      const renewed = await options.source.renew(
        databaseAutomationDeliveryLease(claim),
        options.now(),
        options.leaseMs,
      );
      if (!renewed) {
        controller.abort('lease-lost');
        await closeLease();
        void task.then(() => undefined);
        return Object.freeze({
          status: 'lease-lost' as const,
          claim,
          cleanupFailed,
        });
      }
      claim = renewed;
    }
  } finally {
    clearTimeout(timeout);
    options.shutdownSignal.removeEventListener('abort', abortForShutdown);
  }
}

function cancellableDelay(milliseconds: number): Readonly<{
  promise: Promise<void>;
  cancel(): void;
}> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  return Object.freeze({
    promise,
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  });
}

function cancellableAbort(signal: AbortSignal): Readonly<{
  promise: Promise<void>;
  cancel(): void;
}> {
  let listener: (() => void) | null = null;
  const promise = signal.aborted
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        listener = resolve;
        signal.addEventListener('abort', listener, { once: true });
      });
  return Object.freeze({
    promise,
    cancel(): void {
      if (listener) signal.removeEventListener('abort', listener);
      listener = null;
    },
  });
}

function abortedExecution(): Error {
  return new Error('Database automation execution was aborted before admission.');
}
