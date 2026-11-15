/** Managed opt-in lifecycle. Torrent recovers first; jobs stop before Torrent, the shared scheduler and database providers. */
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

export async function mountManagedJobs(app: Elysia, runtime: ZeroAppRuntime, config: ResolvedConfig, scheduler: SchedulerService): Promise<void> {
  if (!config.jobs) return;
  const manager = runtime.require(ZERO_DATABASE_MANAGER), logging = runtime.get(ZERO_LOGGING_RUNTIME), authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY);
  const persistence = await JobsRuntime.open({ config: config.jobs, system: runtime.require(ZERO_SYSTEM_DB),
    installAllowed: config.migrate || manager.systemRuntime.sqlite.mode === 'ephemeral', authority,
    ...(logging ? { source: coordinator => installJobsLogging(logging, coordinator, authority.coordinator) } : {}),
  });
  runtime.addCleanup(() => persistence.close());
  const service = new JobsService({ config: config.jobs, runtime: persistence, bridge: workflowDeferredStarts(runtime.require(ZERO_WORKFLOW_SERVICE)),
    onFailure(stage, code) { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.JOBS_PROCESSING_FAILED, { metadata: { stage, failureCode: code } }); } });
  runtime.addCleanup(async () => { runtime.clear(ZERO_JOBS_SERVICE, service); await service.close(); });
  runtime.set(ZERO_JOBS_SERVICE, service);
  app.use(await createJobsHttp(runtime));
  service.start(scheduler);
}
