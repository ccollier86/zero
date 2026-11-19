/** Native Jobs evidence is prepared before Torrent recovery; dispatch starts only afterward. */
import type { Elysia } from 'elysia';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_JOBS_SERVICE, ZERO_LOGGING_RUNTIME, ZERO_OBSERVABILITY_RUNTIME, ZERO_SYSTEM_DB, ZERO_WORKFLOW_SERVICE } from '../../runtime/service-keys';
import type { SchedulerService } from '../../scheduler/scheduler-service';
import type { ResolvedConfig } from './types';
import { JobsRuntime } from '../../jobs/runtime';
import { JobsService } from '../../jobs/service';
import { createJobsHttp } from '../../jobs/http';
import { workflowDeferredStarts } from '../../workflows/workflow-deferred-start-bridge';
import { emitPlatformCodeTo } from '../../observability/sink';
import { OBS_CODES } from '../../observability/codes';
import { installJobsLogging } from '../../jobs/logging';
import type { WorkflowService } from '../../workflows/workflow-service';

export interface ManagedJobsOwner {
  readonly service: JobsService;
  start(scheduler: SchedulerService): void;
  close(): Promise<void>;
}

/** Private managed composition seam. No scheduler wake runs during construction.
 * Evidence stays alive until dependent Torrent activities have stopped.
 */
export async function prepareManagedJobs(app: Elysia, runtime: ZeroAppRuntime, config: ResolvedConfig,
  workflows: WorkflowService, stopWorkflows: () => Promise<void>): Promise<ManagedJobsOwner | null> {
  if (!config.jobs) return null;
  const manager = runtime.require(ZERO_DATABASE_MANAGER), logging = runtime.get(ZERO_LOGGING_RUNTIME), authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY);
  const bridge = workflowDeferredStarts(workflows); bridge.assertRuntimeCurrent();
  let persistence: JobsRuntime | undefined, service: JobsService | undefined, unregister: (() => void) | undefined;
  try {
    persistence = await JobsRuntime.open({ config: config.jobs, system: runtime.require(ZERO_SYSTEM_DB),
      installAllowed: config.migrate || manager.systemRuntime.sqlite.mode === 'ephemeral', authority,
      ...(logging ? { source: coordinator => installJobsLogging(logging, coordinator, authority.coordinator) } : {}),
    });
    bridge.assertRuntimeCurrent();
    service = new JobsService({ config: config.jobs, runtime: persistence, bridge,
      onFailure(stage, code) { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.JOBS_PROCESSING_FAILED, { metadata: { stage, failureCode: code } }); } });
    const selected = service; let closeTask: Promise<void> | null = null;
    const close = () => closeTask ??= (async () => {
      const failures: unknown[] = [];
      try { selected.quiesce(); } catch (error) { failures.push(error); }
      // Physical barrier, not a cancelled-caller or elapsed-time settlement claim.
      try { await selected.drain(); } catch (error) { failures.push(error); }
      try { await stopWorkflows(); } catch (error) { failures.push(error); }
      // Torrent's compatibility dispose grace can finish while an authored
      // callback still ignores cancellation. Keep evidence until the actual
      // invocation promise settles; a successful grace wait is not that proof.
      try { await workflows.drainPhysical(); } catch (error) { failures.push(error); }
      runtime.clear(ZERO_JOBS_SERVICE, selected);
      try { await selected.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Managed Jobs/dependent workflow shutdown failed.');
    })();
    unregister = runtime.addCleanup(close);
    runtime.set(ZERO_JOBS_SERVICE, selected);
    app.use(await createJobsHttp(runtime));
    return Object.freeze({ service: selected, start(scheduler: SchedulerService) { bridge.assertRuntimeCurrent(); selected.start(scheduler); }, close });
  } catch (error) {
    unregister?.(); if (service) runtime.clear(ZERO_JOBS_SERVICE, service);
    // Do not stop workflows from INSIDE their own dependency-preparation hook.
    // Their owner handles failed initialization after this construction settles.
    try { if (service) await service.close(); else await persistence?.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Managed Jobs preparation and cleanup failed.'); }
    throw error;
  }
}

export async function mountManagedJobs(app: Elysia, runtime: ZeroAppRuntime, config: ResolvedConfig, scheduler: SchedulerService): Promise<void> {
  if (!config.jobs) return;
  const workflows = runtime.require(ZERO_WORKFLOW_SERVICE);
  const owner = await prepareManagedJobs(app, runtime, config, workflows, () => workflows.dispose());
  owner?.start(scheduler);
}
