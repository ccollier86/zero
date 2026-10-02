import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import {
  AppSignalDispatcher,
  type AppSignalHost,
} from './app-signal-dispatcher';
import { hasCompletedNativeAppStop } from './app-stop-lifecycle';

const APP_SIGNAL_LIFECYCLE = Symbol.for('zero.app.signal-lifecycle');
const PROCESS_DISPATCHER = Symbol.for('zero.app.signal-dispatcher');
const processHost: AppSignalHost = {
  on: (signal, listener) => { process.on(signal, listener); },
  off: (signal, listener) => { process.off(signal, listener); },
  exit: (code) => { process.exit(code); },
};
const processDispatcher = getProcessDispatcher();

interface SignalStoppableApp {
  stop(closeActiveConnections?: boolean): unknown;
}

/** Register one createApp lifecycle with the process-shared signal barrier. */
export function installAppSignalLifecycle<T extends SignalStoppableApp>(
  app: T,
  dispatcher: Pick<AppSignalDispatcher, 'register'> = processDispatcher
): T {
  if (hasSignalLifecycle(app)) return app;
  const nativeStop = app.stop.bind(app);
  let stopped = false;
  let stopping: Promise<T> | null = null;
  let unregister = () => {};

  const orderedStop = async (closeActiveConnections?: boolean): Promise<T> => {
    if (stopped) return app;
    if (stopping) return stopping;
    const run = (async () => {
      try {
        await nativeStop(closeActiveConnections);
        stopped = true;
        unregister();
        return app;
      } catch (error) {
        // The inner lifecycle barrier can report cleanup failure after native
        // Elysia teardown succeeded. Retire this signal registration without
        // hiding that failure or requiring a second stop call.
        if (hasCompletedNativeAppStop(app)) {
          stopped = true;
          unregister();
        }
        throw error;
      }
    })();
    stopping = run;
    try { return await run; }
    finally { if (stopping === run) stopping = null; }
  };

  Object.defineProperty(app, 'stop', {
    configurable: true, writable: true, value: orderedStop,
  });
  Object.defineProperty(app, APP_SIGNAL_LIFECYCLE, { value: true });
  unregister = dispatcher.register(() => orderedStop());
  return app;
}

function hasSignalLifecycle(app: SignalStoppableApp): boolean {
  return Boolean((app as SignalStoppableApp & {
    [APP_SIGNAL_LIFECYCLE]?: boolean;
  })[APP_SIGNAL_LIFECYCLE]);
}

function getProcessDispatcher(): AppSignalDispatcher {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = scope[PROCESS_DISPATCHER];
  if (isProcessDispatcher(existing)) return existing;
  const created = new AppSignalDispatcher({
    host: processHost,
    onSignal: (signal) => emitPlatformCode(OBS_CODES.APP_SHUTDOWN_SIGNAL, {
      metadata: { signal },
    }),
    onFailure: (error) => emitPlatformCode(OBS_CODES.APP_LIFECYCLE_FAILED, {
      error, metadata: { stage: 'shutdown_signal' },
    }),
  });
  scope[PROCESS_DISPATCHER] = created;
  return created;
}

function isProcessDispatcher(value: unknown): value is AppSignalDispatcher {
  return typeof value === 'object' && value !== null
    && typeof (value as { register?: unknown }).register === 'function';
}
