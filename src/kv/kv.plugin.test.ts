/**
 * kv.plugin.test.ts
 *
 * Verifies the Elysia KV plugin exposes the expected context services. Runtime
 * app-factory wiring is covered in a later platform-runtime slice.
 */

import { Elysia } from 'elysia';
import { describe, expect, test } from 'bun:test';

import { createKvPlugin, KvService } from './index';

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

  test('waits for KV startup before serving downstream routes', async () => {
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
      .get('/ready', () => {
        routeHandled = true;
        return service.status().started;
      });

    const responsePromise = app.handle(new Request('http://localhost/ready'));
    await Promise.resolve();
    expect(routeHandled).toBe(false);

    releaseStart();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toBe(true);
    expect(routeHandled).toBe(true);
  });
});
