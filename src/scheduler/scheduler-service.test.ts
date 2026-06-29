/**
 * scheduler-service.test.ts
 *
 * Verifies the scheduler service aliases used by Zero app code. This file
 * tests service contracts only; plugin lifecycle and route mounting live in
 * scheduler plugin tests.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { SchedulerService } from './scheduler-service';

let scheduler: SchedulerService | null = null;

afterEach(() => {
  scheduler?.stop();
  scheduler = null;
});

describe('SchedulerService aliases', () => {
  test('create, get, list, run, delete, and stop delegate to job lifecycle methods', () => {
    scheduler = new SchedulerService();

    scheduler.create({
      name: 'alias-job',
      pattern: '*/5 * * * * *',
      paused: true,
      run: async () => {},
    });

    expect(scheduler.get('alias-job')?.name).toBe('alias-job');
    expect(scheduler.list().map((job) => job.name)).toEqual(['alias-job']);
    expect(scheduler.run('alias-job')).toBe(true);
    expect(scheduler.delete('alias-job')).toBe(true);
    expect(scheduler.get('alias-job')).toBeNull();

    scheduler.stop();
    expect(scheduler.list()).toEqual([]);
  });
});
