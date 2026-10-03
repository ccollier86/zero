import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createKvPlugin, KvService } from '../../kv';
import {
  getAppStopHooks,
  hasCompletedNativeAppStop,
  installAppStopBarrier,
} from './app-stop-lifecycle';

describe('app stop lifecycle', () => {
  test('closes the listener, awaits async hooks, and shares concurrent stop', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const app = new Elysia()
      .onStop(async () => {
        order.push('hook:entered');
        await gate;
        order.push('hook:settled');
      })
      .listen(0);
    const managed = installAppStopBarrier(app, async () => {
      order.push('before');
    });

    const first = managed.stop();
    const second = managed.stop();
    await waitFor(() => order.includes('hook:entered'));
    expect(managed.server).toBeNull();
    expect(order).toEqual(['before', 'hook:entered']);
    let settled = false;
    void first.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    expect(await first).toBe(managed);
    expect(await second).toBe(managed);
    expect(order).toEqual(['before', 'hook:entered', 'hook:settled']);
    expect(hasCompletedNativeAppStop(managed)).toBe(true);
  });

  test('runs every hook once when an earlier synchronous hook throws', async () => {
    const failure = new Error('first hook failed');
    const calls: string[] = [];
    const app = new Elysia()
      .onStop(() => {
        calls.push('first');
        throw failure;
      })
      .onStop(async () => {
        await Promise.resolve();
        calls.push('second');
      })
      .listen(0);
    const managed = installAppStopBarrier(app);

    await expect(managed.stop()).rejects.toBe(failure);
    expect(calls).toEqual(['first', 'second']);
    expect(managed.server).toBeNull();
    await expect(managed.stop()).resolves.toBe(managed);
    expect(calls).toEqual(['first', 'second']);
  });

  test('aggregates stop-hook failures in registration order', async () => {
    const first = new Error('first hook failed');
    const second = new Error('second hook failed');
    let finalHookRan = false;
    const app = new Elysia()
      .onStop(() => { throw first; })
      .onStop(async () => {
        await Promise.resolve();
        throw second;
      })
      .onStop(() => { finalHookRan = true; })
      .listen(0);
    const managed = installAppStopBarrier(app);

    let failure: unknown;
    try {
      await managed.stop();
    } catch (error) {
      failure = error;
    }
    expect(finalHookRan).toBe(true);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, second]);
  });

  test('runs captured hooks for an app stopped before listen', async () => {
    const calls: string[] = [];
    const app = new Elysia()
      .onStop(() => { calls.push('sync'); })
      .onStop(async () => {
        await Promise.resolve();
        calls.push('async');
      });
    const managed = installAppStopBarrier(app);

    await expect(managed.stop()).resolves.toBe(managed);
    expect(calls).toEqual(['sync', 'async']);
    expect(hasCompletedNativeAppStop(managed)).toBe(true);
    await managed.stop();
    expect(calls).toEqual(['sync', 'async']);
  });

  test('joins an asynchronous KV shutdown before stop resolves', async () => {
    const service = new KvService({ durability: 'memory' });
    const originalStop = service.stop.bind(service);
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    service.stop = async () => {
      entered = true;
      await gate;
      await originalStop();
    };
    const app = new Elysia().use(createKvPlugin({ service }));
    const managed = installAppStopBarrier(app);

    let settled = false;
    const stopping = managed.stop().then(() => { settled = true; });
    await waitFor(() => entered);
    expect(settled).toBe(false);
    release();
    await stopping;
    expect(settled).toBe(true);
  });

  test('applies explicit first and last hook groups without duplication', async () => {
    const calls: string[] = [];
    const app = new Elysia()
      .onStop(() => { calls.push('database'); })
      .onStop(() => { calls.push('auth'); })
      .onStop(() => { calls.push('extension'); });
    const [database, auth] = getAppStopHooks(app);
    const managed = installAppStopBarrier(app, {
      firstHooks: [auth],
      lastHooks: [database],
    });

    await managed.stop();
    expect(calls).toEqual(['auth', 'extension', 'database']);
  });

  test('runs extension drains before final service disposal', async () => {
    const calls: string[] = [];
    let servicesAvailable = true;
    const app = new Elysia()
      .onStop(() => {
        calls.push('guardian');
        servicesAvailable = false;
      })
      .onStop(async () => {
        await Promise.resolve();
        expect(servicesAvailable).toBe(true);
        calls.push('extension');
      });
    const [, extension] = getAppStopHooks(app);
    const managed = installAppStopBarrier(app, {
      drainHooks: [extension],
      beforeHooks: () => {
        expect(servicesAvailable).toBe(true);
        calls.push('runtime');
      },
    });

    await managed.stop();

    expect(calls).toEqual(['extension', 'runtime', 'guardian']);
  });

  test('attempts every hook and final service disposal after an extension rejects', async () => {
    const extensionFailure = new Error('extension drain failed');
    const runtimeFailure = new Error('runtime cleanup failed');
    const platformFailure = new Error('platform stop failed');
    const calls: string[] = [];
    const app = new Elysia()
      .onStop(() => {
        calls.push('platform');
        throw platformFailure;
      })
      .onStop(async () => {
        calls.push('extension:first');
        throw extensionFailure;
      })
      .onStop(() => { calls.push('extension:second'); });
    const [, firstExtension, secondExtension] = getAppStopHooks(app);
    const managed = installAppStopBarrier(app, {
      drainHooks: [firstExtension, secondExtension],
      beforeHooks: () => {
        calls.push('runtime');
        throw runtimeFailure;
      },
    });

    let received: unknown;
    try {
      await managed.stop();
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(AggregateError);
    expect((received as AggregateError).errors).toEqual([
      extensionFailure,
      runtimeFailure,
      platformFailure,
    ]);
    expect(calls).toEqual([
      'extension:first',
      'extension:second',
      'runtime',
      'platform',
    ]);
    await expect(managed.stop()).resolves.toBe(managed);
    expect(calls).toHaveLength(4);
  });

  test('retries native listener closure but never repeats cleanup', async () => {
    const nativeFailure = new Error('native stop failed');
    let nativeCalls = 0;
    let cleanupCalls = 0;
    let failNative = true;
    const app = { async stop() {
      nativeCalls += 1;
      if (failNative) throw nativeFailure;
      return app;
    } };
    const managed = installAppStopBarrier(app, async () => {
      cleanupCalls += 1;
    });

    await expect(managed.stop()).rejects.toBe(nativeFailure);
    expect({ nativeCalls, cleanupCalls }).toEqual({ nativeCalls: 1, cleanupCalls: 0 });
    failNative = false;
    await expect(managed.stop()).resolves.toBe(managed);
    expect({ nativeCalls, cleanupCalls }).toEqual({ nativeCalls: 2, cleanupCalls: 1 });
    await managed.stop();
    expect({ nativeCalls, cleanupCalls }).toEqual({ nativeCalls: 2, cleanupCalls: 1 });
  });

});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lifecycle condition did not settle');
}
