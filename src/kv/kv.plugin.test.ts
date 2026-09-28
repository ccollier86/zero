/**
 * kv.plugin.test.ts
 *
 * Verifies the Elysia KV plugin exposes the expected context services. Runtime
 * app-factory wiring is covered in a later platform-runtime slice.
 */

import { Elysia } from 'elysia';
import { describe, expect, test } from 'bun:test';

import { ZERO_KV_SERVICE } from '../runtime/service-keys';
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

  test('joins runtime-owned KV shutdown before clearing the app service', async () => {
    const runtime = new ZeroAppRuntime('kv-stop-barrier');
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
    const runtime = new ZeroAppRuntime('kv-stop-failure');
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
    } finally {
      service.stop = originalStop;
      await app.stop();
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
