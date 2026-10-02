import { OBS_CODES, emitPlatformCode } from '../../observability';

interface StoppableServer {
  pendingRequests?: number;
  pendingWebSockets?: number;
  stop(closeActiveConnections?: boolean): unknown;
  unref?(): unknown;
}

interface StoppableApp {
  stop(closeActiveConnections?: boolean): unknown;
}

export interface AppStopHook<T = unknown> {
  fn: (lifecycle: T) => unknown;
}

interface StopLifecycleApp extends StoppableApp {
  event?: { stop?: AppStopHook[] };
  server?: StoppableServer | null;
}

export interface AppStopBarrierOptions {
  /** App-owned cleanup that runs after listener quiescence and before plugin hooks. */
  beforeHooks?: () => void | Promise<void>;
  /** Captured hooks that must run before the remaining plugin hooks. */
  firstHooks?: readonly AppStopHook[];
  /** Captured hooks that must run after every remaining plugin hook. */
  lastHooks?: readonly AppStopHook[];
  /** Bound detection of Bun's stale server-initiated WebSocket accounting. */
  transportStopTimeoutMs?: number;
  /** Report recovery from stale native WebSocket accounting. */
  onTransportStopStalled?: (status: {
    pendingRequests: number;
    pendingWebSockets: number;
  }) => void;
}

const DEFAULT_TRANSPORT_STOP_TIMEOUT_MS = 1_000;
const TRANSPORT_STOPPED = Symbol('transport-stopped');
const TRANSPORT_STOP_TIMED_OUT = Symbol('transport-stop-timed-out');
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
 * The listener is quiesced first, app-owned asynchronous services are drained,
 * and every captured Elysia stop hook is then awaited exactly once. Bun's
 * stale WebSocket counter is recognized narrowly and recovered without
 * weakening shutdown behavior for live requests or unknown adapters.
 */
export function installAppStopBarrier<T extends StoppableApp>(
  app: T,
  beforeHooksOrOptions: (() => void | Promise<void>) | AppStopBarrierOptions = {},
  compatibilityOptions: AppStopBarrierOptions = {},
): T {
  const lifecycleApp = app as T & StopLifecycleApp;
  const options: AppStopBarrierOptions = typeof beforeHooksOrOptions === 'function'
    ? { ...compatibilityOptions, beforeHooks: beforeHooksOrOptions }
    : beforeHooksOrOptions;
  const nativeStop = app.stop.bind(app);
  let listenerCompleted = false;
  let cleanupAttempted = false;
  let stopped = false;
  let stopping: Promise<T> | null = null;

  const orderedStop = async (closeActiveConnections?: boolean): Promise<T> => {
    if (stopped) return app;
    if (stopping) return stopping;

    const run = (async () => {
      const failures: unknown[] = [];
      const hookCapture = suppressNativeStopHooks(lifecycleApp);
      let needsNativeFinalize = false;

      try {
        if (!listenerCompleted) {
          const listener = await quiesceListener(
            lifecycleApp,
            nativeStop,
            closeActiveConnections,
            options,
          );
          listenerCompleted = listener.completed;
          needsNativeFinalize = listener.needsNativeFinalize;
          failures.push(...listener.failures);
          if (!listenerCompleted) {
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
        }

        if (needsNativeFinalize) {
          await collectFailure(
            failures,
            () => nativeStop(closeActiveConnections),
          );
        }
      } finally {
        hookCapture.restore();
      }

      if (cleanupAttempted) {
        const hooks = orderHooks(
          hookCapture.hooks(),
          options.firstHooks ?? [],
          options.lastHooks ?? [],
        );
        for (const hook of hooks) {
          await collectFailure(failures, () => hook.fn(lifecycleApp));
        }
      }

      // Listener closure and every owned cleanup were attempted. Repeating
      // closed-resource hooks after a failure would be unsafe.
      stopped = listenerCompleted && cleanupAttempted;
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

async function quiesceListener(
  app: StopLifecycleApp,
  nativeStop: (closeActiveConnections?: boolean) => unknown,
  closeActiveConnections: boolean | undefined,
  options: AppStopBarrierOptions,
): Promise<{
  completed: boolean;
  needsNativeFinalize: boolean;
  failures: unknown[];
}> {
  const server = app.server;
  const hasElysiaLifecycle = Boolean(app.event);

  if (!server) {
    if (hasElysiaLifecycle) {
      return { completed: true, needsNativeFinalize: false, failures: [] };
    }
    try {
      await nativeStop(closeActiveConnections);
      return { completed: true, needsNativeFinalize: false, failures: [] };
    } catch (error) {
      return { completed: false, needsNativeFinalize: false, failures: [error] };
    }
  }

  try {
    const stoppedNormally = await stopTransport(server, options);
    if (!stoppedNormally) {
      server.unref?.();
      if (app.server === server) app.server = { stop() {} };
    }
    return { completed: true, needsNativeFinalize: true, failures: [] };
  } catch (transportError) {
    // Give the framework adapter one chance to complete a transport-specific
    // shutdown after the direct listener path failed.
    try {
      await nativeStop(closeActiveConnections);
      return {
        completed: true,
        needsNativeFinalize: false,
        failures: [transportError],
      };
    } catch (nativeError) {
      return {
        completed: false,
        needsNativeFinalize: false,
        failures: [transportError, nativeError],
      };
    }
  }
}

function suppressNativeStopHooks(app: StopLifecycleApp): {
  hooks(): readonly AppStopHook[];
  restore(): void;
} {
  const original = app.event?.stop;
  const registeredWhileClosing: AppStopHook[] = [];
  if (app.event) app.event.stop = registeredWhileClosing;
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (app.event) {
      app.event.stop = [
        ...(original ?? []),
        ...registeredWhileClosing,
      ];
    }
  };

  return {
    hooks() {
      restore();
      return [...(app.event?.stop ?? [])];
    },
    restore,
  };
}

async function stopTransport(
  server: StoppableServer,
  options: AppStopBarrierOptions,
): Promise<boolean> {
  const timeoutMs = normalizeTimeout(options.transportStopTimeoutMs);
  const stopping = Promise.resolve(server.stop(true));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof TRANSPORT_STOP_TIMED_OUT>((resolve) => {
    timeout = setTimeout(() => resolve(TRANSPORT_STOP_TIMED_OUT), timeoutMs);
  });

  try {
    const result = await Promise.race([
      stopping.then(() => TRANSPORT_STOPPED),
      timedOut,
    ]);
    if (result === TRANSPORT_STOPPED) return true;

    const pendingRequests = server.pendingRequests;
    const pendingWebSockets = server.pendingWebSockets;
    const recoverableBunAccountingStall = pendingRequests === 0
      && typeof pendingWebSockets === 'number'
      && pendingWebSockets > 0
      && typeof server.unref === 'function';
    if (!recoverableBunAccountingStall) {
      await stopping;
      return true;
    }

    try {
      options.onTransportStopStalled?.({ pendingRequests, pendingWebSockets });
    } catch {
      // Diagnostics cannot block application teardown.
    }
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TRANSPORT_STOP_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('transportStopTimeoutMs must be a finite non-negative number.');
  }
  return value;
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
