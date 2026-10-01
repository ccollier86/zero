import type { Elysia } from 'elysia';

interface StartHookContainer<T> {
  fn: (lifecycle: T) => unknown;
}

interface StartLifecycleApp {
  event: { start?: StartHookContainer<unknown>[] };
  onStart(handler: (lifecycle: unknown) => unknown): unknown;
}

export interface AppStartBarrier {
  /** Settles after every previously registered start hook has settled. */
  readonly ready: Promise<void>;
}

/**
 * Track the completion of all start hooks registered before this boundary.
 *
 * Elysia's Bun adapter invokes hooks in order but does not await their return
 * values. Wrapping the existing hooks lets the final hook establish one real
 * readiness promise without invoking any hook twice.
 */
export function installAppStartBarrier<T extends Elysia>(app: T): AppStartBarrier {
  const lifecycleApp = app as unknown as StartLifecycleApp;
  const tracked: Promise<void>[] = [];
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A request owns the eventual rejection through the workflow initializer;
  // attach a handler immediately so a fast hook failure is never unhandled.
  void ready.catch(() => undefined);

  for (const hook of lifecycleApp.event.start ?? []) {
    const original = hook.fn;
    hook.fn = (lifecycle) => {
      let result: unknown;
      try {
        result = original(lifecycle);
      } catch (error) {
        // Elysia's Bun adapter does not guard individual start hooks. Convert a
        // synchronous failure into a tracked rejection so it can continue to
        // the barrier/final cleanup hooks instead of leaving a live listener.
        result = Promise.reject(error);
      }
      const pending = Promise.resolve(result).then(() => undefined);
      tracked.push(pending);
      void pending.catch(() => undefined);
      return result;
    };
  }

  lifecycleApp.onStart(() => {
    void Promise.allSettled(tracked).then((settlements) => {
      const failures = settlements.flatMap((settlement) => (
        settlement.status === 'rejected' ? [settlement.reason] : []
      ));
      if (failures.length === 0) {
        resolveReady();
      } else if (failures.length === 1) {
        rejectReady(failures[0]);
      } else {
        rejectReady(new AggregateError(
          failures,
          'Application startup dependencies failed',
        ));
      }
    });
  });

  return { ready };
}
