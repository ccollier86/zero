/**
 * kv.plugin.test.ts
 *
 * Verifies the Elysia KV plugin exposes the expected context services. Runtime
 * app-factory wiring is covered in a later platform-runtime slice.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Elysia } from 'elysia';
import { describe, expect, test } from 'bun:test';

import { MemoryEventStore, OBS_CODES } from '../observability';
import {
  ZERO_KV_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createKvPlugin, getKvService, KvService } from './index';

describe('createKvPlugin', () => {
  test('exposes kv, counter, and limiter helpers on Elysia context', async () => {
    const service = new KvService({ durability: 'memory' });
    await service.start();

    const app = new Elysia()
      .use(createKvPlugin({ service }))
      .get('/kv', async ({ kv, counter }) => {
        await kv.set('message', 'ok');
        const count = await counter.increment('hits');
        return { value: kv.get('message'), count };
      });

    const body = await app
      .handle(new Request('http://localhost/kv'))
      .then((response) => response.json());

    expect(body).toEqual({ value: 'ok', count: 1 });
  });

  test('waits for KV startup before serving downstream app.handle routes', async () => {
    const service = new KvService({ durability: 'memory' });
    const originalStart = service.start.bind(service);
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let routeHandled = false;

    service.start = async () => {
      await startGate;
      await originalStart();
    };

    const app = new Elysia()
      .use(createKvPlugin({ service }))
      .get('/ready-handle', () => {
        routeHandled = true;
        return service.status().started;
      });

    const responsePromise = app.handle(new Request('http://localhost/ready-handle'));
    await Promise.resolve();
    expect(routeHandled).toBe(false);

    releaseStart();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
    expect(routeHandled).toBe(true);
  });

  test('shares one managed initializer and reports one successful lifecycle', async () => {
    const { runtime, events } = createObservedRuntime('kv-managed-start');
    const service = new KvService({ durability: 'memory' });
    let initialize: (() => Promise<void>) | null = null;

    createKvPlugin({
      service,
      runtime,
      onInitializerCreated(created) {
        initialize = created;
      },
    });

    expect(initialize).not.toBeNull();
    await Promise.all([initialize!(), initialize!()]);

    expect(service.status().started).toBeTrue();
    expect(events.query({ code: OBS_CODES.KV_STARTED.code }).events).toHaveLength(1);
    expect(events.query({ code: OBS_CODES.KV_START_FAILED.code }).events).toHaveLength(0);

    await runtime.dispose();

    expect(service.status().started).toBeFalse();
    expect(events.query({ code: OBS_CODES.KV_STOPPED.code }).events).toHaveLength(1);
  });

  test('reports managed startup failure without inventing a stopped lifecycle', async () => {
    const { runtime, events } = createObservedRuntime('kv-managed-start-failure');
    const service = new KvService({ durability: 'memory' });
    const failure = new Error('forced managed KV startup failure');
    let initialize: (() => Promise<void>) | null = null;
    service.start = async () => {
      throw failure;
    };

    createKvPlugin({
      service,
      runtime,
      onInitializerCreated(created) {
        initialize = created;
      },
    });

    await expect(initialize!()).rejects.toBe(failure);
    await runtime.dispose();

    expect(events.query({ code: OBS_CODES.KV_STARTED.code }).events).toHaveLength(0);
    expect(events.query({ code: OBS_CODES.KV_START_FAILED.code }).events).toHaveLength(1);
    expect(events.query({ code: OBS_CODES.KV_STOPPED.code }).events).toHaveLength(0);
  });

  test('joins runtime-owned KV shutdown before clearing the app service', async () => {
    const { runtime } = createObservedRuntime('kv-stop-barrier');
    const service = new KvService({ durability: 'memory' });
    await service.start();
    const originalStop = service.stop.bind(service);
    let releaseStop!: () => void;
    let stopEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseStop = resolve; });
    const entered = new Promise<void>((resolve) => { stopEntered = resolve; });
    service.stop = async () => {
      stopEntered();
      await release;
      await originalStop();
    };

    createKvPlugin({ service, runtime });
    const stopping = runtime.dispose();
    await entered;

    expect(runtime.get(ZERO_KV_SERVICE)).toBe(service);
    expect(service.status().started).toBeTrue();

    releaseStop();
    await stopping;

    expect(service.status().started).toBeFalse();
    expect(runtime.get(ZERO_KV_SERVICE)).toBeNull();
  });

  test('surfaces runtime-owned stop failures without leaking the compatibility provider', async () => {
    const { runtime, events } = createObservedRuntime('kv-stop-failure');
    const service = new KvService({ durability: 'memory' });
    const originalStop = service.stop.bind(service);
    const failure = new Error('forced KV stop failure');
    const app = new Elysia()
      .use(createKvPlugin({ service, runtime }))
      .get('/ready', () => 'ok');

    app.listen(0);
    try {
      await fetch(`http://localhost:${app.server!.port}/ready`);
      expect(getKvService()).toBe(service);
      service.stop = async () => { throw failure; };

      const dispose = runtime.dispose();
      await expect(dispose).rejects.toBeInstanceOf(AggregateError);
      expect(getKvService()).toBeNull();
      expect(events.query({ code: OBS_CODES.KV_STOP_FAILED.code }).events).toHaveLength(1);
    } finally {
      service.stop = originalStop;
      await app.stop().catch(() => undefined);
    }
  });

  test('routes managed KV persistence failures only to the owning app runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zero-kv-observability-'));
    const observedA = createObservedRuntime('kv-observability-a');
    const observedB = createObservedRuntime('kv-observability-b');
    let serviceA: KvService | null = null;
    let restoreFlush = () => undefined;
    const appA = new Elysia({ name: 'kv-observability-a' }).use(createKvPlugin({
      runtime: observedA.runtime,
      baseDir: join(directory, 'a'),
      durability: 'everysec',
      fsyncMs: 1,
      checkpointIntervalMs: 60_000,
      onServiceCreated(service) {
        serviceA = service;
        const originalFlush = service.flush.bind(service);
        service.flush = async () => {
          throw new Error('forced app A periodic flush failure');
        };
        restoreFlush = () => {
          service.flush = originalFlush;
        };
      },
    }));
    const appB = new Elysia({ name: 'kv-observability-b' }).use(createKvPlugin({
      runtime: observedB.runtime,
      durability: 'memory',
    }));
    let appAStarted = false;
    let appBStarted = false;

    try {
      appA.listen(0);
      appAStarted = true;
      appB.listen(0);
      appBStarted = true;
      await waitForEvent(observedA.events, OBS_CODES.KV_FLUSH_FAILED.code);

      expect(serviceA).not.toBeNull();
      expect(observedA.events.query({ code: OBS_CODES.KV_FLUSH_FAILED.code }).events)
        .toHaveLength(1);
      expect(observedB.events.query({ code: OBS_CODES.KV_FLUSH_FAILED.code }).events)
        .toHaveLength(0);
      expect(observedA.events.query({ code: OBS_CODES.KV_STARTED.code }).events)
        .toHaveLength(1);
      expect(observedB.events.query({ code: OBS_CODES.KV_STARTED.code }).events)
        .toHaveLength(1);
    } finally {
      restoreFlush();
      await observedB.runtime.dispose().catch(() => undefined);
      await observedA.runtime.dispose().catch(() => undefined);
      if (appBStarted) await appB.stop().catch(() => undefined);
      if (appAStarted) await appA.stop().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('holds standalone requests until asynchronous recovery completes', async () => {
    const service = new KvService({ durability: 'memory' });
    const originalStart = service.start.bind(service);
    let releaseStart!: () => void;
    let startEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseStart = resolve; });
    const entered = new Promise<void>((resolve) => { startEntered = resolve; });
    service.start = async () => {
      startEntered();
      await release;
      await originalStart();
    };
    const app = new Elysia()
      .use(createKvPlugin({ service }))
      .get('/ready', () => 'ready')
      .listen(0);

    try {
      await entered;
      let settled = false;
      const response = fetch(`http://localhost:${app.server!.port}/ready`)
        .then((value) => {
          settled = true;
          return value;
        });
      await Bun.sleep(10);
      expect(settled).toBeFalse();

      releaseStart();
      expect(await (await response).text()).toBe('ready');
    } finally {
      releaseStart();
      await app.stop();
    }
  });

  test('contains a standalone startup rejection and closes its listener', async () => {
    const service = new KvService({ durability: 'memory' });
    service.start = async () => {
      throw new Error('forced standalone KV startup failure');
    };
    const app = new Elysia()
      .use(createKvPlugin({ service }))
      .get('/ready', () => 'should-not-publish')
      .listen(0);
    const url = `http://localhost:${app.server!.port}/ready`;

    await Bun.sleep(10);
    await expect(fetch(url)).rejects.toThrow();
    expect(getKvService()).toBeNull();
    await app.stop();
  });
});

function createObservedRuntime(id: string): {
  runtime: ZeroAppRuntime;
  events: MemoryEventStore;
} {
  const runtime = new ZeroAppRuntime(id);
  const events = new MemoryEventStore({ maxEvents: 50 });
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: events,
    store: events,
    config: { console: false },
  });
  return { runtime, events };
}

async function waitForEvent(events: MemoryEventStore, code: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (events.query({ code }).events.length > 0) return;
    await Bun.sleep(2);
  }
  throw new Error(`Timed out waiting for observability event ${code}.`);
}
