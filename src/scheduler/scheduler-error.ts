/**
 * Defines Scheduler's framework-neutral setup errors. This module owns stable
 * error identity only; services own job invariants and plugins own HTTP mapping.
 */

/** Stable codes for rejected Scheduler registration or lifecycle transitions. */
export type SchedulerErrorCode =
  | 'SCHEDULER_JOB_ALREADY_REGISTERED'
  | 'SCHEDULER_JOB_INVALID'
  | 'SCHEDULER_JOB_BUSY'
  | 'SCHEDULER_STOPPED';

/** Scheduler setup failure, with no dependency-specific message exposed. */
export class SchedulerError extends Error {
  constructor(public readonly code: SchedulerErrorCode, message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}
