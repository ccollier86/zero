/** Scheduler job ownership for workflow retry and timeout polling. */

import { getScheduler } from '../scheduler';
import type { SchedulerService } from '../scheduler';
import { WorkflowError } from './workflow-error';
import type { WorkflowService } from './workflow-service';

const RETRY_JOB = 'workflow-retries';
const TIMEOUT_JOB = 'workflow-timeouts';

export interface WorkflowSchedulerOwner {
  start(): void;
  stop(): void;
}

export function createWorkflowSchedulerOwner(
  getService: () => WorkflowService | null,
): WorkflowSchedulerOwner {
  let ownsRetryJob = false;
  let ownsTimeoutJob = false;
  let ownedScheduler: SchedulerService | null = null;

  const stop = (): void => {
    // Never consult the process-wide compatibility getter during teardown: a
    // second Elysia app may have published its scheduler since this owner
    // registered its jobs.
    const scheduler = ownedScheduler;
    const failures: unknown[] = [];
    if (ownsRetryJob) {
      try {
        scheduler?.unregister(RETRY_JOB);
      } catch (error) {
        failures.push(error);
      }
    }
    if (ownsTimeoutJob) {
      try {
        scheduler?.unregister(TIMEOUT_JOB);
      } catch (error) {
        failures.push(error);
      }
    }
    ownsRetryJob = false;
    ownsTimeoutJob = false;
    ownedScheduler = null;
    throwFailures(failures, 'Workflow scheduler cleanup failed');
  };

  const start = (): void => {
    const scheduler = getScheduler();
    if (!scheduler) {
      throw new WorkflowError(
        'Workflow scheduler is not available',
        'WORKFLOW_STARTUP_FAILED',
        503,
      );
    }
    if (scheduler.has(RETRY_JOB) || scheduler.has(TIMEOUT_JOB)) {
      throw new WorkflowError(
        'Workflow scheduler jobs are already registered',
        'WORKFLOW_STARTUP_FAILED',
        503,
      );
    }
    ownedScheduler = scheduler;

    try {
      scheduler.register({
        name: RETRY_JOB,
        pattern: '* * * * *',
        run: async () => { await getService()?.pollRetries(); },
      });
      ownsRetryJob = true;
      scheduler.register({
        name: TIMEOUT_JOB,
        pattern: '* * * * *',
        run: async () => { await getService()?.pollTimeouts(); },
      });
      ownsTimeoutJob = true;
    } catch (error) {
      try {
        stop();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Workflow scheduler registration and cleanup both failed',
        );
      }
      throw error;
    }
  };

  return { start, stop };
}

function throwFailures(failures: unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}
