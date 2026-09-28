import { describe, expect, test } from 'bun:test';

import { ZERO_SCHEDULER_SERVICE } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { SchedulerService } from './scheduler-service';
import { createSchedulerPlugin } from './scheduler.plugin';

describe('createSchedulerPlugin lifecycle', () => {
  test('stops composition-time jobs when the owning runtime is disposed', async () => {
    const runtime = new ZeroAppRuntime('scheduler-composition-failure');
    const scheduler = new SchedulerService();
    createSchedulerPlugin({
      runtime,
      service: scheduler,
      getTokenService: () => null,
    });
    scheduler.register({
      name: 'composition-job',
      pattern: '0 0 1 1 *',
      run: async () => {},
    });

    expect(runtime.get(ZERO_SCHEDULER_SERVICE)).toBe(scheduler);
    expect(scheduler.has('composition-job')).toBeTrue();

    await runtime.dispose();

    expect(runtime.get(ZERO_SCHEDULER_SERVICE)).toBeNull();
    expect(scheduler.list()).toEqual([]);
  });
});
