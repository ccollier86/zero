import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { installAppStartBarrier } from './app-start-lifecycle';

interface FakeLifecycleApp {
  event: { start: Array<{ fn: (app: FakeLifecycleApp) => unknown }> };
  onStart(handler: (app: FakeLifecycleApp) => unknown): FakeLifecycleApp;
}

function fakeApp(hooks: Array<(app: FakeLifecycleApp) => unknown>): FakeLifecycleApp {
  const app: FakeLifecycleApp = {
    event: { start: hooks.map((fn) => ({ fn })) },
    onStart(handler) {
      this.event.start.push({ fn: handler });
      return this;
    },
  };
  return app;
}

describe('app start lifecycle barrier', () => {
  test('settles only after all earlier asynchronous hooks settle', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const app = fakeApp([
      async () => {
        order.push('async:entered');
        await gate;
        order.push('async:settled');
      },
      () => { order.push('sync'); },
    ]);
    const barrier = installAppStartBarrier(app as never);

    for (const hook of app.event.start) hook.fn(app);
    let ready = false;
    void barrier.ready.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(order).toEqual(['async:entered', 'sync']);

    release();
    await barrier.ready;
    expect(order).toEqual(['async:entered', 'sync', 'async:settled']);
  });

  test('rejects when an earlier asynchronous hook rejects', async () => {
    const app = fakeApp([
      async () => { throw new Error('dependency failed'); },
    ]);
    const barrier = installAppStartBarrier(app as never);

    for (const hook of app.event.start) hook.fn(app);
    await expect(barrier.ready).rejects.toThrow('dependency failed');
  });

  test('waits for every dependency and aggregates failures in hook order', async () => {
    const firstFailure = new Error('first dependency failed');
    const thirdFailure = new Error('third dependency failed');
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondSettled = false;
    const app = fakeApp([
      async () => { throw firstFailure; },
      async () => {
        await secondGate;
        secondSettled = true;
      },
      async () => { throw thirdFailure; },
    ]);
    const barrier = installAppStartBarrier(app as never);

    for (const hook of app.event.start) hook.fn(app);
    let rejected = false;
    void barrier.ready.catch(() => { rejected = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toBe(false);
    expect(secondSettled).toBe(false);

    releaseSecond();
    let failure: unknown;
    try {
      await barrier.ready;
    } catch (error) {
      failure = error;
    }
    expect(secondSettled).toBe(true);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      firstFailure,
      thirdFailure,
    ]);
  });

  test('converts a synchronous hook failure so final cleanup closes the listener', async () => {
    const failure = new Error('synchronous startup failed');
    let laterHookRan = false;
    const app = new Elysia()
      .onStart(() => { throw failure; })
      .onStart(() => { laterHookRan = true; });
    const barrier = installAppStartBarrier(app);
    app.onStart((lifecycle) => {
      void barrier.ready.catch(() => lifecycle.stop(true));
    });

    app.listen(0);
    await expect(barrier.ready).rejects.toBe(failure);
    await waitFor(() => app.server === null);
    expect(laterHookRan).toBe(true);
    expect(app.server).toBeNull();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Lifecycle condition did not settle');
}
