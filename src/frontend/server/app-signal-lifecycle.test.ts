import { expect, test } from 'bun:test';
import { installAppSignalLifecycle } from './app-signal-lifecycle';

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
