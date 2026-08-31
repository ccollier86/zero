import type { Elysia } from 'elysia';

/**
 * Run a platform lifecycle barrier before Elysia begins plugin teardown.
 *
 * The Bun adapter invokes stop hooks without awaiting returned promises. The
 * barrier therefore wraps the public stop boundary so asynchronous owners can
 * finish before synchronous database teardown hooks run.
 */
export function installAppStopBarrier<T extends Elysia>(
  app: T,
  beforeStop: () => Promise<void>
): T {
  const nativeStop = app.stop.bind(app);
  let stopped = false;
  let stopping: Promise<T> | null = null;

  const orderedStop = async (closeActiveConnections?: boolean): Promise<T> => {
    if (stopped) return app;
    if (stopping) return stopping;
    const run = (async () => {
      await beforeStop();
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

  return app;
}
