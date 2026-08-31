import { stopAuthRuntime } from './auth-runtime';

const AUTH_STOP_BARRIER = Symbol('zero.auth.stop-barrier');

interface AuthStoppableApp {
  stop(closeActiveConnections?: boolean): unknown;
}

/**
 * Make standalone auth-plugin shutdown await its asynchronous owners.
 *
 * Install this after composing the root Elysia app. Once `app.stop()` resolves,
 * auth email delivery is joined and an injected database may be disposed.
 * `createApp()` already installs its own platform-wide lifecycle barrier.
 */
export function installAuthStopBarrier<T extends AuthStoppableApp>(app: T): T {
  if (hasBarrier(app)) return app;
  const nativeStop = app.stop.bind(app);
  let stopped = false;
  let stopping: Promise<T> | null = null;

  const orderedStop = async (closeActiveConnections?: boolean): Promise<T> => {
    if (stopped) return app;
    if (stopping) return stopping;
    const run = (async () => {
      await stopAuthRuntime();
      await nativeStop(closeActiveConnections);
      stopped = true;
      return app;
    })();
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
  Object.defineProperty(app, AUTH_STOP_BARRIER, { value: true });
  return app;
}

function hasBarrier(app: AuthStoppableApp): boolean {
  return Boolean((app as AuthStoppableApp & {
    [AUTH_STOP_BARRIER]?: boolean;
  })[AUTH_STOP_BARRIER]);
}
