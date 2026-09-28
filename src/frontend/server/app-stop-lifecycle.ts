interface StoppableApp {
  server?: {
    stop(closeActiveConnections?: boolean): unknown;
  } | null;
  stop(closeActiveConnections?: boolean): unknown;
}

/**
 * Stop the native transport, then run the platform lifecycle barrier before
 * Elysia begins plugin teardown.
 *
 * The Bun adapter invokes stop hooks without awaiting returned promises. The
 * barrier therefore wraps the public stop boundary so transport callbacks and
 * asynchronous owners finish before synchronous database teardown hooks run.
 * Managed shutdown always force-closes the native listener first; Bun's
 * graceful WebSocket shutdown can otherwise remain pending indefinitely.
 */
export function installAppStopBarrier<T extends StoppableApp>(
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
      const failures: unknown[] = [];
      const server = app.server;
      let transportStopFailed = false;
      if (server) {
        try {
          // Bun 1.3 can leave server.stop() pending when a WebSocket was
          // closed or terminated by plugin cleanup first. Quiesce the native
          // transport while every handler dependency is still alive, then
          // release app-owned services below. The later Elysia stop call is
          // still required to dispatch framework/plugin stop hooks.
          await server.stop(true);
        } catch (error) {
          transportStopFailed = true;
          failures.push(error);
        }
      }
      try {
        await beforeStop();
      } catch (error) {
        failures.push(error);
      }
      try {
        await nativeStop(closeActiveConnections);
        // A failed direct transport stop may have been retried successfully by
        // Elysia's native stop implementation, which releases app.server. If a
        // generic host leaves the same server attached, keep the barrier
        // retryable instead of ambiguously claiming a completed shutdown.
        if (!transportStopFailed || app.server !== server) stopped = true;
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          '[app] Transport, runtime cleanup, or native server shutdown failed.',
        );
      }
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
