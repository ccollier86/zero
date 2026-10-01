import { OBS_CODES, emitPlatformCode } from '../../observability';

interface StoppableApp {
  stop(closeActiveConnections?: boolean): unknown;
}

export interface AppStopHook<T = unknown> {
  fn: (lifecycle: T) => unknown;
}

interface StopLifecycleApp extends StoppableApp {
  event?: { stop?: AppStopHook[] };
  server?: unknown | null;
}

export interface AppStopBarrierOptions {
  /** App-owned cleanup that must precede plugin hooks after the listener closes. */
  beforeHooks?: () => void | Promise<void>;
  /** Captured hooks that must run before the remaining plugin hooks. */
  firstHooks?: readonly AppStopHook[];
  /** Captured hooks that must run after every remaining plugin hook. */
  lastHooks?: readonly AppStopHook[];
}

const nativeStoppedApps = new WeakSet<object>();

/** Whether the stop barrier closed (or never opened) the native listener. */
export function hasCompletedNativeAppStop(app: StoppableApp): boolean {
  return nativeStoppedApps.has(app);
}

/** Snapshot the currently composed Elysia stop hooks by container identity. */
export function getAppStopHooks(app: StopLifecycleApp): readonly AppStopHook[] {
  return [...(app.event?.stop ?? [])];
}

/**
 * Own the complete Elysia shutdown boundary.
 *
 * Elysia's Bun adapter neither awaits stop hooks nor continues after a hook
 * throws. It also skips every hook when stop is called before listen. The
 * barrier therefore closes the listener with native hooks temporarily
 * suppressed, then invokes every captured hook itself exactly once.
 */
export function installAppStopBarrier<T extends StoppableApp>(
  app: T,
  beforeHooksOrOptions: (() => void | Promise<void>) | AppStopBarrierOptions = {},
): T {
  const lifecycleApp = app as T & StopLifecycleApp;
  const options = typeof beforeHooksOrOptions === 'function'
    ? { beforeHooks: beforeHooksOrOptions }
    : beforeHooksOrOptions;
  const nativeStop = app.stop.bind(app);
  let nativeStopCompleted = false;
  let cleanupAttempted = false;
  let stopped = false;
  let stopping: Promise<T> | null = null;

  const orderedStop = async (closeActiveConnections?: boolean): Promise<T> => {
    if (stopped) return app;
    if (stopping) return stopping;
    const run = (async () => {
      const failures: unknown[] = [];
      if (!nativeStopCompleted) {
        const nativeResult = await closeNativeListener(
          lifecycleApp,
          nativeStop,
          closeActiveConnections,
        );
        nativeStopCompleted = nativeResult.completed;
        if (nativeResult.error !== undefined) failures.push(nativeResult.error);
        if (!nativeStopCompleted) {
          throwCollectedFailures(failures, 'Application listener shutdown failed');
          return app;
        }
        nativeStoppedApps.add(app);
      }

      if (!cleanupAttempted) {
        cleanupAttempted = true;
        if (options.beforeHooks) {
          await collectFailure(failures, options.beforeHooks);
        }
        const hooks = orderHooks(
          getAppStopHooks(lifecycleApp),
          options.firstHooks ?? [],
          options.lastHooks ?? [],
        );
        for (const hook of hooks) {
          await collectFailure(failures, () => hook.fn(lifecycleApp));
        }
      }

      // Listener closure and every captured cleanup were attempted. A cleanup
      // failure remains observable, but repeating closed-resource hooks would
      // be unsafe and would not make that first shutdown more complete.
      stopped = true;
      throwCollectedFailures(failures, 'Application shutdown failed');
      return app;
    })().catch((error) => {
      try {
        emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
          error,
          metadata: { lifecycle: 'stop', phase: 'shutdown' },
        });
      } catch {
        // A failing diagnostic sink must never replace the shutdown failure.
      }
      throw error;
    });
    stopping = run;
    try {
      return await run;
    } finally {
      if (stopping === run) stopping = null;
    }
  };

  Object.defineProperty(app, 'stop', {
    configurable: true,
    writable: true,
    value: orderedStop,
  });

  return app;
}

async function closeNativeListener(
  app: StopLifecycleApp,
  nativeStop: (closeActiveConnections?: boolean) => unknown,
  closeActiveConnections: boolean | undefined,
): Promise<{ completed: boolean; error?: unknown }> {
  const hasElysiaLifecycle = Boolean(app.event);
  if (hasElysiaLifecycle && !app.server) {
    return { completed: true };
  }

  const originalHooks = app.event?.stop;
  const hooksRegisteredWhileClosing: AppStopHook[] = [];
  if (app.event) app.event.stop = hooksRegisteredWhileClosing;
  try {
    await nativeStop(closeActiveConnections);
    return { completed: true };
  } catch (error) {
    // Some adapters can finish closing before surfacing a secondary error.
    // In that case cleanup is still safe and the native error is aggregated.
    return {
      completed: hasElysiaLifecycle && !app.server,
      error,
    };
  } finally {
    if (app.event) {
      app.event.stop = [
        ...(originalHooks ?? []),
        ...hooksRegisteredWhileClosing,
      ];
    }
  }
}

function orderHooks(
  hooks: readonly AppStopHook[],
  first: readonly AppStopHook[],
  last: readonly AppStopHook[],
): AppStopHook[] {
  const available = new Set(hooks);
  const reserved = new Set([...first, ...last]);
  return [...new Set([
    ...first.filter((hook) => available.has(hook)),
    ...hooks.filter((hook) => !reserved.has(hook)),
    ...last.filter((hook) => available.has(hook)),
  ])];
}

async function collectFailure(
  failures: unknown[],
  operation: () => unknown,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!failures.includes(error)) failures.push(error);
  }
}

function throwCollectedFailures(failures: unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
