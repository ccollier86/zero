import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createSyncPlugin } from '../../sync/sync.plugin';
import { installAppStopBarrier } from './app-stop-lifecycle';

describe('installAppStopBarrier', () => {
  test('closes the native listener and preserves a runtime cleanup failure', async () => {
    const cleanupFailure = new Error('runtime cleanup failed');
    let nativeStops = 0;
    const app = {
      async stop() {
        nativeStops += 1;
        return app;
      },
    };

    installAppStopBarrier(app, async () => { throw cleanupFailure; });

    await expect(app.stop()).rejects.toBe(cleanupFailure);
    expect(nativeStops).toBe(1);
    expect(await app.stop()).toBe(app);
    expect(nativeStops).toBe(1);
  });

  test('preserves a native stop failure and permits a later retry', async () => {
    const nativeFailure = new Error('native stop failed');
    let nativeStops = 0;
    let cleanups = 0;
    const app = {
      async stop() {
        nativeStops += 1;
        if (nativeStops === 1) throw nativeFailure;
        return app;
      },
    };

    installAppStopBarrier(app, async () => { cleanups += 1; });

    await expect(app.stop()).rejects.toBe(nativeFailure);
    expect(await app.stop()).toBe(app);
    expect(nativeStops).toBe(2);
    expect(cleanups).toBe(2);
  });

  test('aggregates runtime and native failures without losing either cause', async () => {
    const cleanupFailure = new Error('runtime cleanup failed');
    const nativeFailure = new Error('native stop failed');
    const app = {
      async stop() {
        throw nativeFailure;
      },
    };

    installAppStopBarrier(app, async () => { throw cleanupFailure; });

    let received: unknown;
    try {
      await app.stop();
    } catch (error) {
      received = error;
    }
    expect(received).toBeInstanceOf(AggregateError);
    expect((received as AggregateError).errors).toEqual([
      cleanupFailure,
      nativeFailure,
    ]);
  });

  test('force-stops the native transport before cleanup even when the caller requests graceful stop', async () => {
    const events: string[] = [];
    const app = {
      server: {
        async stop(force?: boolean) {
          events.push(`transport:${String(force)}`);
        },
      },
      async stop(force?: boolean) {
        events.push(`native:${String(force)}`);
        return app;
      },
    };

    installAppStopBarrier(app, async () => { events.push('cleanup'); });

    await app.stop(false);
    expect(events).toEqual([
      'transport:true',
      'cleanup',
      'native:false',
    ]);
  });

  test('keeps shutdown retryable when the first transport stop leaves its server attached', async () => {
    const transportFailure = new Error('first transport stop failed');
    let transportStops = 0;
    let nativeStops = 0;
    let cleanups = 0;
    const app = {
      server: {
        async stop() {
          transportStops += 1;
          if (transportStops === 1) throw transportFailure;
        },
      },
      async stop() {
        nativeStops += 1;
        return app;
      },
    };
    installAppStopBarrier(app, async () => { cleanups += 1; });

    await expect(app.stop()).rejects.toBe(transportFailure);
    await expect(app.stop()).resolves.toBe(app);
    await expect(app.stop()).resolves.toBe(app);
    expect(transportStops).toBe(2);
    expect(nativeStops).toBe(2);
    expect(cleanups).toBe(2);
  });

  test('aggregates transport, runtime, and native-hook failures', async () => {
    const transportFailure = new Error('transport stop failed');
    const cleanupFailure = new Error('runtime cleanup failed');
    const nativeFailure = new Error('native hook failed');
    const app = {
      server: { async stop(_force?: boolean) { throw transportFailure; } },
      async stop(_force?: boolean) { throw nativeFailure; },
    };
    installAppStopBarrier(app, async () => { throw cleanupFailure; });

    let received: unknown;
    try {
      await app.stop(true);
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(AggregateError);
    expect((received as AggregateError).errors).toEqual([
      transportFailure,
      cleanupFailure,
      nativeFailure,
    ]);
  });

  test('recovers only stale WebSocket accounting while preserving native stop hooks', async () => {
    const events: string[] = [];
    const stalled = new Promise<void>(() => {});
    const poisonedTransport = {
      pendingRequests: 0,
      pendingWebSockets: 4,
      stop(force?: boolean) {
        events.push(`transport:${String(force)}`);
        return stalled;
      },
      unref() {
        events.push('transport:unref');
      },
    };
    const app: {
      server: null | {
        pendingRequests?: number;
        pendingWebSockets?: number;
        stop(force?: boolean): unknown;
        unref?(): unknown;
      };
      stop(force?: boolean): Promise<typeof app>;
    } = {
      server: poisonedTransport,
      async stop(force?: boolean) {
        events.push(`native:${String(force)}`);
        const server = app.server;
        if (server) {
          await server.stop(force);
          app.server = null;
          events.push('hook');
        }
        return app;
      },
    };

    installAppStopBarrier(
      app,
      async () => { events.push('cleanup'); },
      {
        transportStopTimeoutMs: 5,
        onTransportStopStalled(status) {
          events.push(`stalled:${status.pendingWebSockets}`);
        },
      },
    );

    await expect(withTimeout(app.stop(false))).resolves.toBe(app);
    expect(events).toEqual([
      'transport:true',
      'stalled:4',
      'transport:unref',
      'cleanup',
      'native:false',
      'hook',
    ]);
    expect(app.server).toBeNull();
  });

  test('stops after a real server-initiated WebSocket close poisons Bun accounting', async () => {
    let hooks = 0;
    let cleanups = 0;
    let stalls = 0;
    const app = new Elysia()
      .ws('/poison', {
        open(socket) {
          socket.close(4001, 'authority changed');
        },
        message() {},
      })
      .onStop(() => { hooks += 1; })
      .listen(0);
    const port = app.server?.port;
    if (port === undefined) throw new Error('Test server is not listening');
    const client = new WebSocket(`ws://localhost:${port}/poison`);
    await withTimeout(new Promise<void>((resolve, reject) => {
      client.addEventListener('close', () => resolve(), { once: true });
      client.addEventListener('error', () => reject(new Error('WebSocket failed')), {
        once: true,
      });
    }));

    installAppStopBarrier(
      app,
      async () => { cleanups += 1; },
      {
        transportStopTimeoutMs: 25,
        onTransportStopStalled() { stalls += 1; },
      },
    );

    await expect(withTimeout(app.stop(true))).resolves.toBe(app);
    expect(cleanups).toBe(1);
    expect(hooks).toBe(1);
    // Bun 1.3.14 takes the recovery path. A runtime containing the upstream
    // fix is also valid and completes without reporting a stall.
    expect(stalls === 0 || stalls === 1).toBe(true);
  });

  test('stops deterministically with a live Sync WebSocket', async () => {
    const harness = await createSyncLifecycleHarness();
    const connection = await connectSync(harness.app);

    await expect(withTimeout(harness.app.stop(true))).resolves.toBe(harness.app);
    await expect(connection.closed).resolves.toBeUndefined();
  });

  test('stops deterministically after the peer has already closed', async () => {
    const harness = await createSyncLifecycleHarness();
    const connection = await connectSync(harness.app);
    connection.ws.close();
    await connection.closed;

    await expect(withTimeout(harness.app.stop(true))).resolves.toBe(harness.app);
  });
});

async function createSyncLifecycleHarness() {
  const runtime = new ZeroAppRuntime('app-stop-lifecycle-test');
  const app = new Elysia()
    .use(createSyncPlugin({
      runtime,
      db: { mode: 'memory' },
      tables: {},
    }))
    .listen(0);
  return {
    app: installAppStopBarrier(app, () => runtime.dispose()),
  };
}

async function connectSync(app: { server?: { port?: number } | null }) {
  const port = app.server?.port;
  if (port === undefined) throw new Error('Test server is not listening');
  const ws = new WebSocket(`ws://localhost:${port}/sync`);
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket failed')), {
      once: true,
    });
  });
  return { ws, closed };
}

async function withTimeout<T>(value: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('App stop timed out')), 2_000);
    void value.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
