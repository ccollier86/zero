import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createKvPlugin, KvService } from '../../kv';
import { AppSignalDispatcher, type AppSignalHost } from './app-signal-dispatcher';
import { installAppSignalLifecycle } from './app-signal-lifecycle';
import { installAppStopBarrier } from './app-stop-lifecycle';

test('signal lifecycle installs once and shares concurrent or repeated stop', async () => {
  const registered = new Set<() => unknown>();
  let registrations = 0;
  const dispatcher = { register(stop: () => unknown) {
    registrations += 1; registered.add(stop);
    return () => { registered.delete(stop); };
  } };
  let release!: () => void;
  const stopped = new Promise<void>((resolve) => { release = resolve; });
  let nativeStops = 0;
  const app = { async stop() {
    nativeStops += 1; await stopped; return app;
  } };

  expect(installAppSignalLifecycle(app, dispatcher)).toBe(app);
  expect(installAppSignalLifecycle(app, dispatcher)).toBe(app);
  expect(registrations).toBe(1);
  expect(registered.size).toBe(1);
  const first = app.stop();
  const second = app.stop();
  expect(nativeStops).toBe(1);
  release();
  expect(await first).toBe(app);
  expect(await second).toBe(app);
  expect(registered.size).toBe(0);
  expect(await app.stop()).toBe(app);
  expect(nativeStops).toBe(1);
});

test('unregisters after native teardown even when owned cleanup reports failure', async () => {
  const registered = new Set<() => unknown>();
  const dispatcher = { register(stop: () => unknown) {
    registered.add(stop);
    return () => { registered.delete(stop); };
  } };
  const cleanupFailure = new Error('workflow cleanup failed');
  let nativeStops = 0;
  const app = { async stop() {
    nativeStops += 1;
    return app;
  } };
  const stopped = installAppStopBarrier(app, async () => {
    throw cleanupFailure;
  });
  const managed = installAppSignalLifecycle(stopped, dispatcher);

  expect(registered.size).toBe(1);
  await expect(managed.stop()).rejects.toBe(cleanupFailure);
  expect(nativeStops).toBe(1);
  expect(registered.size).toBe(0);
  await expect(managed.stop()).resolves.toBe(managed);
  expect(nativeStops).toBe(1);
});

test('signal shutdown waits for the durable KV stop hook before exiting', async () => {
  const exits: number[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const host: AppSignalHost = {
    on(signal, listener) {
      const registered = listeners.get(signal) ?? new Set();
      registered.add(listener);
      listeners.set(signal, registered);
    },
    off(signal, listener) { listeners.get(signal)?.delete(listener); },
    exit(code) { exits.push(code); },
  };
  const dispatcher = new AppSignalDispatcher({ host });
  const kv = new KvService({ durability: 'memory' });
  const originalStop = kv.stop.bind(kv);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let kvStopEntered = false;
  kv.stop = async () => {
    kvStopEntered = true;
    await gate;
    await originalStop();
  };
  const app = new Elysia().use(createKvPlugin({ service: kv })).listen(0);
  installAppSignalLifecycle(installAppStopBarrier(app), dispatcher);

  const shutdown = dispatcher.dispatch('SIGTERM');
  await waitFor(() => kvStopEntered);
  expect(exits).toEqual([]);
  release();
  await shutdown;
  expect(exits).toEqual([0]);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lifecycle condition did not settle');
}
