interface StoppableServer {
  pendingRequests?: number;
  pendingWebSockets?: number;
  stop(closeActiveConnections?: boolean): unknown;
  unref?(): unknown;
}

interface StoppableApp {
  server?: StoppableServer | null;
  stop(closeActiveConnections?: boolean): unknown;
}

interface AppStopBarrierOptions {
  /** Bound detection of Bun's server-initiated WebSocket close accounting bug. */
  transportStopTimeoutMs?: number;
  /** Report that Zero recovered from stale native WebSocket accounting. */
  onTransportStopStalled?: (status: {
    pendingRequests: number;
    pendingWebSockets: number;
  }) => void;
}

const DEFAULT_TRANSPORT_STOP_TIMEOUT_MS = 1_000;
const TRANSPORT_STOPPED = Symbol('transport-stopped');
const TRANSPORT_STOP_TIMED_OUT = Symbol('transport-stop-timed-out');

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
  beforeStop: () => Promise<void>,
  options: AppStopBarrierOptions = {},
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
          // Quiesce the listener while every handler dependency is still
          // alive. Bun 1.3.14 can permanently retain stale WebSocket
          // accounting after any server-initiated socket close even though
          // stop(true) has closed the listener and released its port. Detect
          // only that exact state; all other transport states retain native
          // stop semantics.
          const stoppedNormally = await stopTransport(server, options);
          if (!stoppedNormally) {
            // The unresolved native promise alone does not keep the process
            // alive, but Bun's stale server handle does unless it is unrefed.
            server.unref?.();
            if (app.server === server) {
              // Elysia must still run its normal stop adapter so plugin stop
              // hooks are dispatched. Give that adapter an already-stopped
              // transport instead of making it await the poisoned promise a
              // second time.
              app.server = { stop() {} };
            }
          }
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
      // A slow request or an unknown server implementation is not the known
      // Bun WebSocket counter defect. Preserve the host's native contract.
      await stopping;
      return true;
    }

    try {
      options.onTransportStopStalled?.({
        pendingRequests,
        pendingWebSockets,
      });
    } catch {
      // Lifecycle diagnostics are best-effort and cannot block shutdown.
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
