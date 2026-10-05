/**
 * scheduler-service.test.ts
 *
 * Verifies the scheduler service aliases used by Zero app code. This file
 * tests service contracts only; plugin lifecycle and route mounting live in
 * scheduler plugin tests.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  MemoryEventStore,
  OBS_CODES,
  configureObservability,
  getObservabilityRuntime,
} from '../observability';
import { SchedulerService } from './scheduler-service';

let scheduler: SchedulerService | null = null;

afterEach(() => {
  scheduler?.stop();
  scheduler = null;
});

describe('SchedulerService aliases', () => {
  test('duplicate registration exposes a stable code without replacing the job', () => {
    scheduler = new SchedulerService();
    const definition = { name: 'duplicate', pattern: '@daily', paused: true, run() {} };
    scheduler.register(definition);
    try {
      scheduler.register(definition);
      throw new Error('Expected duplicate registration to fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('SCHEDULER_JOB_ALREADY_REGISTERED');
    }
    expect(scheduler.list()).toHaveLength(1);
  });

  test('invalid patterns expose a stable code and leave no registered job', () => {
    scheduler = new SchedulerService();
    try {
      scheduler.register({ name: 'invalid', pattern: 'not a cron pattern', run() {} });
      throw new Error('Expected invalid pattern to fail');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('SCHEDULER_JOB_INVALID');
    }
    expect(scheduler.list()).toEqual([]);
  });

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

  test('catches and reports job failures by default', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    scheduler = new SchedulerService();
    const failure = new Error('caught scheduler failure');

    try {
      scheduler.register({
        name: 'caught-failure',
        pattern: '0 0 1 1 *',
        paused: true,
        run: async () => {
          throw failure;
        },
      });

      await triggerCronJob(scheduler, 'caught-failure');

      const caught = events.query({ code: OBS_CODES.SCHEDULER_JOB_FAILED.code });
      expect(caught.count).toBe(1);
      expect(caught.events[0]?.error).toBe(failure);
      expect(events.query({
        code: OBS_CODES.SCHEDULER_JOB_UNHANDLED_FAILED.code,
      }).count).toBe(0);
    } finally {
      configureObservability(previousObservability);
    }
  });

  test('reports and rethrows job failures when catchErrors is false', async () => {
    const previousObservability = getObservabilityRuntime().config;
    const events = new MemoryEventStore();
    configureObservability({ console: false, store: events });
    scheduler = new SchedulerService();
    const failure = new Error('unhandled scheduler failure');

    try {
      scheduler.register({
        name: 'unhandled-failure',
        pattern: '0 0 1 1 *',
        paused: true,
        catchErrors: false,
        run: async () => {
          throw failure;
        },
      });

      await expect(triggerCronJob(scheduler, 'unhandled-failure')).rejects.toBe(failure);

      const unhandled = events.query({
        code: OBS_CODES.SCHEDULER_JOB_UNHANDLED_FAILED.code,
      });
      expect(unhandled.count).toBe(1);
      expect(unhandled.events[0]?.error).toBe(failure);
      expect(events.query({ code: OBS_CODES.SCHEDULER_JOB_FAILED.code }).count).toBe(0);
    } finally {
      configureObservability(previousObservability);
    }
  });
});

function triggerCronJob(service: SchedulerService, name: string): Promise<void> {
  const jobs = (service as unknown as {
    jobs: Map<string, { cron: { trigger(): Promise<void> } }>;
  }).jobs;
  const job = jobs.get(name);
  if (!job) throw new Error(`Missing test scheduler job: ${name}`);
  return job.cron.trigger();
}
