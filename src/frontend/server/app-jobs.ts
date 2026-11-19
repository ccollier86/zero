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
import type { JobDefinition } from '../../jobs/definition';
import { JobsError } from '../../jobs/error';

/** @internal App-owned dependent phases, never request/configuration callbacks.
 * Each drain must join its actual native callback bodies even if an earlier
 * bounded caller drain failed. No phase may await its own startup initializer.
 */
export interface ManagedJobsDependency {
  quiesce(): void;
  drainIntake(): Promise<void>;
  drainEvidence(): Promise<void>;
  closeProvider(): Promise<void>;
}

export interface ManagedJobsOwner {
  readonly service: JobsService;
  /** Validate the exact native owner and branded catalog entry without work. */
  assertDependency(workflows: WorkflowService, definition: JobDefinition): void;
  /** One construction-time dependent only. No replacement or late attachment. */
  attachDependency(dependency: ManagedJobsDependency): void;
  /** Close attachment BEFORE recovery is allowed; idempotent. */
  sealDependencies(): void;
  /** Failure/cancellation inside the unsealed beforeRecovery factory only. */
  cancelPreparation(): Promise<void>;
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
    const selected = service;
    let closeTask: Promise<void> | null = null, dependency: ManagedJobsDependency | null = null;
    let physicalShutdown: Promise<readonly unknown[]> | null = null;
    let phase: 'preparing' | 'sealed' | 'started' | 'closing' = 'preparing';
    const beginClose = (stopWorkflowOwner: boolean): Promise<void> => {
      if (closeTask) return closeTask;
      phase = 'closing';
      const quiesceFailures: unknown[] = [];
      let providerFailed = false;
      // Publish the shared close before synchronous quiescence can call back.
      const task = Promise.resolve().then(async () => {
        physicalShutdown ??= (async () => {
          const failures = [...quiesceFailures];
          // Calendar joins raw intake bodies, even after bounded caller drainage
          // failed. Jobs evidence remains available throughout this phase.
          try { await dependency?.drainIntake(); } catch (error) { failures.push(error); }
          try { await selected.drain(); } catch (error) { failures.push(error); }
          if (stopWorkflowOwner) {
            try { await stopWorkflows(); } catch (error) { failures.push(error); }
            // Compatibility disposal grace is not authored callback settlement.
            try { await workflows.drainPhysical(); } catch (error) { failures.push(error); }
          }
          // A cancelled Torrent caller can leave a physical Calendar evidence
          // callback behind. Join it BEFORE releasing its native Jobs provider.
          try { await dependency?.drainEvidence(); } catch (error) { failures.push(error); }
          runtime.clear(ZERO_JOBS_SERVICE, selected);
          try { await selected.close(); } catch (error) { failures.push(error); }
          return failures;
        })();
        const failures = [...await physicalShutdown];
        try { await dependency?.closeProvider(); } catch (error) { providerFailed = true; failures.push(error); }
        if (failures.length) throw new AggregateError(failures, 'Managed Jobs/dependent workflow shutdown failed.');
      });
      closeTask = task;
      // Retry only a failed dependent final provider. Completed physical joins
      // and their failures remain fixed; Workflow stop and intake never reopen.
      // Default no-dependency close keeps its historical failure memoization.
      void task.catch(() => { if (providerFailed && closeTask === task) closeTask = null; });
      if (!physicalShutdown) {
        try { dependency?.quiesce(); } catch (error) { quiesceFailures.push(error); }
        try { selected.quiesce(); } catch (error) { quiesceFailures.push(error); }
      }
      return task;
    };
    const close = () => beginClose(true);
    unregister = runtime.addCleanup(close);
    runtime.set(ZERO_JOBS_SERVICE, selected);
    app.use(await createJobsHttp(runtime));
    return Object.freeze({ service: selected,
      assertDependency(owner: WorkflowService, definition: JobDefinition) {
        if (phase !== 'preparing' || owner !== workflows) throw new JobsError('JOBS_NOT_READY');
        bridge.assertRuntimeCurrent(); config.jobs && config.jobs.catalog.resolve(definition);
      },
      attachDependency(value: ManagedJobsDependency) {
        if (phase !== 'preparing' || dependency || !value
          || ['quiesce', 'drainIntake', 'drainEvidence', 'closeProvider'].some(key => typeof value[key as keyof ManagedJobsDependency] !== 'function')) throw new JobsError('JOBS_NOT_READY');
        const { quiesce, drainIntake, drainEvidence, closeProvider } = value;
        // Capture validated callbacks once; mutating the attachment object
        // later cannot substitute a different teardown beneath live work.
        dependency = Object.freeze({ quiesce: () => quiesce.call(value), drainIntake: () => drainIntake.call(value),
          drainEvidence: () => drainEvidence.call(value), closeProvider: () => closeProvider.call(value) });
      },
      sealDependencies() {
        if (phase === 'closing') throw new JobsError('JOBS_NOT_READY');
        if (phase === 'preparing') phase = 'sealed';
      },
      cancelPreparation() {
        if (phase !== 'preparing') return Promise.reject(new JobsError('JOBS_NOT_READY'));
        // This factory has not admitted recovery. Never recursively stop the
        // Workflow initializer whose dependency hook is awaiting this cleanup.
        return beginClose(false);
      },
      start(scheduler: SchedulerService) {
        if (phase === 'closing') throw new JobsError('JOBS_NOT_READY');
        if (phase === 'preparing') phase = 'sealed';
        bridge.assertRuntimeCurrent(); selected.start(scheduler); phase = 'started';
      }, close });
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
