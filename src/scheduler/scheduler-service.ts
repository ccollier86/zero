/**
 * Owns the in-process named cron registry and job control. Croner provides
 * scheduling; Zero observability reports lifecycle/failures. HTTP authority,
 * persistence and distributed scheduling are outside this service.
 */

import { Cron } from 'croner';
import type { JobDefinition, JobStatus } from './types';
import { SchedulerError } from './scheduler-error';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── SchedulerService ────────────────────────────────────────────────────────

/**
 * Generic task scheduler backed by croner.
 *
 * Any plugin/service can register named jobs with cron expressions.
 * Jobs are managed centrally — pause, resume, trigger, list status.
 *
 * @example
 * ```ts
 * const scheduler = getScheduler()!;
 * scheduler.register({
 *   name: 'cleanup-expired-notifications',
 *   pattern: '0 0 * * * *', // every hour
 *   run: () => notificationService.deleteExpired(),
 * });
 * ```
 */
export class SchedulerService {
  private jobs = new Map<string, { cron: Cron; def: JobDefinition }>();

  /**
   * Register a new scheduled job.
   * Throws if a job with the same name is already registered.
   */
  register(definition: JobDefinition): void {
    // Scheduling, callbacks and status must share the identity/options admitted
    // at registration, not a caller-owned object that can change afterward.
    const def: JobDefinition = Object.freeze({ ...definition });
    if (this.jobs.has(def.name)) {
      throw new SchedulerError(
        'SCHEDULER_JOB_ALREADY_REGISTERED',
        `[scheduler] Job '${def.name}' is already registered`,
      );
    }

    const catchErrors = def.catchErrors ?? true;

    let cronInstance: Cron;
    try {
      cronInstance = new Cron(
        def.pattern,
        {
          timezone: def.timezone,
          paused: def.paused ?? false,
          protect: def.protect ?? true,
          catch: catchErrors
            ? (err: unknown) => {
                emitPlatformCode(OBS_CODES.SCHEDULER_JOB_FAILED, {
                  error: err,
                  metadata: { name: def.name, pattern: def.pattern },
                });
              }
            : undefined,
        },
        async () => {
          if (catchErrors) {
            await def.run();
            return;
          }

          try {
            await def.run();
          } catch (err) {
            emitPlatformCode(OBS_CODES.SCHEDULER_JOB_UNHANDLED_FAILED, {
              error: err,
              metadata: { name: def.name, pattern: def.pattern },
            });
            throw err;
          }
        },
      );
    } catch {
      throw new SchedulerError('SCHEDULER_JOB_INVALID', '[scheduler] Invalid job schedule or options.');
    }

    this.jobs.set(def.name, { cron: cronInstance, def });
    const state = def.paused ? 'paused' : 'scheduled';
    emitPlatformCode(OBS_CODES.SCHEDULER_JOB_REGISTERED, {
      metadata: { name: def.name, pattern: def.pattern, state },
    });
  }

  /** Canonical create alias for register(). */
  create(def: JobDefinition): void {
    this.register(def);
  }

  /**
   * Unregister and permanently stop a job.
   * Returns true if found and stopped, false if not found.
   */
  unregister(name: string): boolean {
    const entry = this.jobs.get(name);
    if (!entry) return false;
    entry.cron.stop();
    this.jobs.delete(name);
    emitPlatformCode(OBS_CODES.SCHEDULER_JOB_UNREGISTERED, {
      metadata: { name },
    });
    return true;
  }

  /** Canonical delete alias for unregister(). */
  delete(name: string): boolean {
    return this.unregister(name);
  }

  /** Pause a job (reversible). */
  pause(name: string): boolean {
    const entry = this.jobs.get(name);
    if (!entry) return false;
    entry.cron.pause();
    return true;
  }

  /** Resume a paused job. */
  resume(name: string): boolean {
    const entry = this.jobs.get(name);
    if (!entry) return false;
    entry.cron.resume();
    return true;
  }

  /** Trigger a job immediately (outside its schedule). */
  trigger(name: string): boolean {
    const entry = this.jobs.get(name);
    if (!entry) return false;
    // Croner's explicit trigger bypasses its scheduled-overrun check. Preserve
    // Zero's protect contract for both scheduled and immediate executions.
    if ((entry.def.protect ?? true) && entry.cron.isBusy()) return false;
    entry.cron.trigger();
    return true;
  }

  /** Canonical run alias for trigger(). */
  run(name: string): boolean {
    return this.trigger(name);
  }

  /** Get status of a single job. */
  getStatus(name: string): JobStatus | null {
    const entry = this.jobs.get(name);
    if (!entry) return null;
    return this.toStatus(entry);
  }

  /** Canonical get alias for getStatus(). */
  get(name: string): JobStatus | null {
    return this.getStatus(name);
  }

  /** List all registered jobs and their status. */
  listJobs(): JobStatus[] {
    return Array.from(this.jobs.values()).map((e) => this.toStatus(e));
  }

  /** Canonical list alias for listJobs(). */
  list(): JobStatus[] {
    return this.listJobs();
  }

  /** Check if a job is registered. */
  has(name: string): boolean {
    return this.jobs.has(name);
  }

  /** Stop all jobs. Called on plugin shutdown. */
  stopAll(): void {
    for (const entry of this.jobs.values()) {
      entry.cron.stop();
    }
    this.jobs.clear();
    emitPlatformCode(OBS_CODES.SCHEDULER_ALL_STOPPED);
  }

  /** Canonical stop alias for stopAll(). */
  stop(): void {
    this.stopAll();
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private toStatus(entry: { cron: Cron; def: JobDefinition }): JobStatus {
    const { cron, def } = entry;
    const next = cron.nextRun();
    const prev = cron.previousRun();

    return {
      name: def.name,
      pattern: def.pattern,
      running: cron.isRunning(),
      paused: !cron.isRunning() && !cron.isStopped(),
      stopped: cron.isStopped(),
      busy: cron.isBusy(),
      nextRun: next ? next.toISOString() : null,
      previousRun: prev ? prev.toISOString() : null,
    };
  }
}
