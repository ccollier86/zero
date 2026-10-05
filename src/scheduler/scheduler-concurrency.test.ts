/** Exercise public immediate triggers with controlled barriers, never wall-clock cron scheduling. */

import { expect, test } from 'bun:test';
import { SchedulerService } from './scheduler-service';
import type { JobDefinition } from './types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('protected immediate triggers cannot overlap, and progress resumes after settlement', async () => {
  const scheduler = new SchedulerService();
  const barrier = deferred();
  const started = deferred();
  const finished = deferred();
  let calls = 0;
  scheduler.register({
    name: 'protected', pattern: '@daily', paused: true,
    async run() {
      calls += 1;
      started.resolve();
      await barrier.promise;
      finished.resolve();
    },
  });
  try {
    expect(scheduler.trigger('protected')).toBe(true);
    await started.promise;
    expect(scheduler.get('protected')?.busy).toBe(true);
    expect(scheduler.trigger('protected')).toBe(false);
    expect(calls).toBe(1);
    barrier.resolve();
    await finished.promise;
    // The public control is synchronous, while Croner clears busy after its
    // callback wrappers settle. Drain that bounded microtask chain explicitly.
    for (let turn = 0; turn < 8 && scheduler.get('protected')?.busy; turn += 1) {
      await Promise.resolve();
    }
    expect(scheduler.get('protected')?.busy).toBe(false);
    expect(scheduler.trigger('protected')).toBe(true);
    expect(calls).toBe(2);
  } finally {
    barrier.resolve();
    scheduler.stopAll();
  }
});

test('explicitly unprotected immediate triggers still admit concurrent work', async () => {
  const scheduler = new SchedulerService();
  const barrier = deferred();
  let calls = 0;
  scheduler.register({
    name: 'unprotected', pattern: '@daily', paused: true, protect: false,
    async run() { calls += 1; await barrier.promise; },
  });
  try {
    expect(scheduler.trigger('unprotected')).toBe(true);
    expect(scheduler.trigger('unprotected')).toBe(true);
    expect(calls).toBe(2);
  } finally {
    barrier.resolve();
    scheduler.stopAll();
  }
});

test('registered identity, schedule and handler do not alias a mutable declaration', async () => {
  const scheduler = new SchedulerService();
  const executed = deferred();
  let originalCalls = 0;
  let replacementCalls = 0;
  const definition: JobDefinition = {
    name: 'original', pattern: '@daily', paused: true,
    run() { originalCalls += 1; executed.resolve(); },
  };
  scheduler.register(definition);
  definition.name = 'renamed';
  definition.pattern = '@hourly';
  definition.run = () => { replacementCalls += 1; executed.resolve(); };
  try {
    expect(scheduler.get('original')).toMatchObject({ name: 'original', pattern: '@daily' });
    expect(scheduler.has('renamed')).toBe(false);
    expect(scheduler.trigger('original')).toBe(true);
    await executed.promise;
    expect(originalCalls).toBe(1);
    expect(replacementCalls).toBe(0);
  } finally { scheduler.stopAll(); }
});
