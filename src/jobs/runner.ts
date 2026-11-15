/** Bounded due discovery and durable Torrent handoff. Not another activity/retry engine; never awaits a provider. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { SchedulerService } from '../scheduler/scheduler-service';
import type { WorkPool } from '../workers/work-pool';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import type { WorkflowDeferredStartInspection } from '../workflows/workflow-deferred-start-contract';
import { JobsError } from './error';
import { assertJobDefinitionCurrent, assertJobExecutionIdentity, jobBinding, jobDispatchKey } from './admission';
import type { JobAdmission, JobOccurrenceRow, JobSeal } from './model';
import type { ResolvedJobsConfig } from './config';
import type { JobsRuntime } from './runtime';
import { jobHash } from './validation';

export function jobGateKey(scope: ServiceDataScope, id: string): string { return jobHash([serviceDataScopeKey(scope), id]); }
interface RunnerOptions {
  runtime: JobsRuntime; bridge: WorkflowDeferredStartBridge; config: ResolvedJobsConfig; gate: WorkPool;
  now?: () => number; onFailure?: (stage: 'scope' | 'dispatch' | 'completion', code: string) => void;
}
interface DispatchContext { occurrence: JobOccurrenceRow; admission: JobAdmission; seal: JobSeal; dispatchAllowed: boolean }
export class JobsRunner {
  private state: 'ready' | 'closing' | 'closed' = 'ready';
  private tickTask: Promise<void> | null = null;
  private readonly abort = new AbortController();
  private readonly completionCursors = new Map<string, string>();
  private readonly reported = new Set<string>();
  private suppressedFailures = 0;
  private scheduler: SchedulerService | null = null;
  private readonly timerRun = async () => { await this.tick(); };
  private readonly now: () => number;
  constructor(private readonly options: RunnerOptions) { this.now = options.now ?? Date.now; }
  start(scheduler: SchedulerService): void {
    if (this.scheduler || this.state !== 'ready') throw new JobsError('JOBS_NOT_READY');
    scheduler.register({ name: 'zero-durable-jobs', pattern: '* * * * * *', timezone: 'UTC', protect: true, run: this.timerRun });
    this.scheduler = scheduler; this.wake();
  }
  wake(): void { if (this.state === 'ready') queueMicrotask(() => { void this.tick().catch(error => this.report('scope', error)); }); }
  tick(): Promise<void> {
    if (this.tickTask) return this.tickTask;
    if (this.state !== 'ready') return Promise.resolve();
    this.tickTask = (async () => {
      this.options.bridge.assertRuntimeCurrent();
      const scopes = this.options.runtime.dueScopes(this.now(), this.options.config.maxActiveDatabases);
      await Promise.all(scopes.map(scope => this.processScope(scope)));
    })().finally(() => { this.tickTask = null; });
    return this.tickTask;
  }
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closing'; this.scheduler?.unregister('zero-durable-jobs', this.timerRun); this.scheduler = null;
    this.abort.abort(); await this.tickTask; this.completionCursors.clear(); this.state = 'closed';
  }
  diagnostics() { return { state: this.state, ticking: this.tickTask !== null, reportedFailures: [...this.reported], suppressedFailures: this.suppressedFailures }; }
  private guard = () => { this.options.bridge.assertRuntimeCurrent(); };
  private async processScope(scope: ServiceDataScope): Promise<void> {
    const scopeId = serviceDataScopeKey(scope), limit = this.options.config.batchSize;
    try {
      const due = await this.options.runtime.read<{ id: string; revision: number }[]>(scope, 'jobs.due', { scopeId, now: this.now(), limit }, this.guard, this.abort.signal);
      await Promise.allSettled(due.map(row => this.options.gate.run(async () => {
        if (this.state !== 'ready') return;
        try { await this.write(scope, 'jobs.materialize', { scopeId, id: row.id, expectedRevision: row.revision, now: this.now() }); }
        catch (error) {
          if (code(error) === 'JOBS_CAPACITY') await this.write(scope, 'jobs.cursor.block', { scopeId, id: row.id, expectedRevision: row.revision, code: 'JOBS_CAPACITY' });
          else if (code(error) !== 'JOBS_REVISION_CONFLICT') throw error;
        }
      }, { key: jobGateKey(scope, row.id), signal: this.abort.signal }).catch(error => this.report('scope', error))));
      const pending = await this.options.runtime.read<{ id: string; schedule_id: string }[]>(scope, 'jobs.pending', { scopeId, now: this.now(), limit }, this.guard, this.abort.signal);
      await Promise.allSettled(pending.map(row => this.options.gate.run(() => this.dispatch(scope, row.id),
        { key: jobGateKey(scope, row.schedule_id), signal: this.abort.signal }).catch(error => this.report('dispatch', error))));
      const after = this.completionCursors.get(scopeId);
      let dispatched = await this.options.runtime.read<{ id: string; schedule_id: string }[]>(scope, 'jobs.dispatched', { scopeId, limit, ...(after ? { after } : {}) }, this.guard, this.abort.signal);
      if (!dispatched.length && after) { this.completionCursors.delete(scopeId); dispatched = await this.options.runtime.read(scope, 'jobs.dispatched', { scopeId, limit }, this.guard, this.abort.signal); }
      if (dispatched.length) this.completionCursors.set(scopeId, dispatched[dispatched.length - 1]!.id);
      await Promise.allSettled(dispatched.map(row => this.options.gate.run(() => this.reconcileCompletion(scope, row.id),
        { key: jobGateKey(scope, row.schedule_id), signal: this.abort.signal }).catch(error => this.report('completion', error))));
      await this.options.runtime.refreshWake(scope, this.now(), this.guard);
    } catch (error) {
      this.report('scope', error);
      if (this.state === 'ready') try { await this.options.runtime.deferWake(scope, this.now() + 5000, this.guard); } catch { /* Retained dirty state and failure remain visible. */ }
    }
  }
  private async dispatch(scope: ServiceDataScope, id: string): Promise<void> {
    if (this.state !== 'ready') return;
    const scopeId = serviceDataScopeKey(scope), nonce = 'claim_' + crypto.randomUUID();
    const claim = await this.write<{ claimed: boolean; leaseGeneration?: number }>(scope, 'jobs.claim', { scopeId, id, nonce, leaseMs: 60_000, now: this.now() });
    if (!claim.claimed) return;
    const context = await this.context(scope, id), admission = context.admission, binding = jobBinding(admission, context.occurrence.generation);
    const authority = this.options.bridge.open(context.seal, binding); assertJobExecutionIdentity(admission, authority);
    const inspect = () => this.options.bridge.inspect(authority, admission.workflow, admission.input, jobDispatchKey(id), binding);
    let accepted = inspect();
    if (!accepted) {
      if (!context.dispatchAllowed) {
        await this.write(scope, 'jobs.block', { scopeId, id, nonce, leaseGeneration: claim.leaseGeneration, code: 'JOBS_NOT_DISPATCHED', now: this.now() }); return;
      }
      const assertSourceCurrent = () => {
        this.guard(); this.abort.signal.throwIfAborted();
        if (this.state !== 'ready' || context.occurrence.lease_until === null || context.occurrence.lease_until <= this.now()
          || this.now() > context.occurrence.scheduled_at + admission.timing.maxLatenessMs) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        const definition = this.options.config.catalog.resolve(admission.definition, admission.definitionVersion);
        assertJobDefinitionCurrent(definition, admission, authority, scope);
      };
      try {
        assertSourceCurrent();
        await this.options.bridge.enqueue(authority, admission.workflow, admission.input, jobDispatchKey(id), binding, assertSourceCurrent);
        accepted = inspect(); if (!accepted) throw new JobsError('JOBS_OUTCOME_UNKNOWN');
      } catch (error) {
        // A timeout/throw is not proof no workflow exists. Reconcile the exact
        // permanent key before selecting any known no-start terminal action.
        accepted = inspect();
        if (!accepted) {
          const rejection = dispatchRejection(error);
          if (!rejection) throw error;
          await this.write(scope, 'jobs.block', { scopeId, id, nonce, leaseGeneration: claim.leaseGeneration, code: rejection, now: this.now() }); return;
        }
      }
    }
    await this.write(scope, 'jobs.dispatch', { scopeId, id, nonce, leaseGeneration: claim.leaseGeneration, receipt: accepted.receipt, now: this.now() });
    await this.finish(scope, id, accepted);
  }
  private async reconcileCompletion(scope: ServiceDataScope, id: string): Promise<void> {
    if (this.state !== 'ready') return;
    const context = await this.context(scope, id), binding = jobBinding(context.admission, context.occurrence.generation);
    const authority = this.options.bridge.open(context.seal, binding); assertJobExecutionIdentity(context.admission, authority);
    const accepted = this.options.bridge.inspect(authority, context.admission.workflow, context.admission.input, jobDispatchKey(id), binding);
    if (!accepted) throw new JobsError('JOBS_STATE_INVALID'); await this.finish(scope, id, accepted);
  }
  private async finish(scope: ServiceDataScope, id: string, accepted: WorkflowDeferredStartInspection): Promise<void> {
    if (['completed', 'failed', 'cancelled'].includes(accepted.status)) await this.write(scope, 'jobs.complete', {
      scopeId: serviceDataScopeKey(scope), id, instanceId: accepted.receipt.instanceId, status: accepted.status, now: this.now() });
  }
  private context(scope: ServiceDataScope, id: string): Promise<DispatchContext> {
    return this.options.runtime.read(scope, 'jobs.context', { scopeId: serviceDataScopeKey(scope), id, now: this.now() }, this.guard, this.abort.signal);
  }
  private write<T = unknown>(scope: ServiceDataScope, name: string, input: unknown): Promise<T> {
    return this.options.runtime.write(scope, name, input, crypto.randomUUID(), this.guard, this.abort.signal);
  }
  private report(stage: 'scope' | 'dispatch' | 'completion', error: unknown): void {
    if (this.state !== 'ready') return;
    const failure = code(error), key = stage + ':' + failure;
    if (this.reported.has(key)) return; this.reported.add(key);
    if (this.reported.size > 64) { this.reported.delete(key); this.suppressedFailures = Math.min(Number.MAX_SAFE_INTEGER, this.suppressedFailures + 1); return; }
    try { this.options.onFailure?.(stage, failure); } catch { /* Diagnostics cannot change an accepted effect. */ }
  }
}
function code(error: unknown): string {
  const value = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
  return typeof value === 'string' && /^(?:JOBS|WORKFLOW|WORKER|DATABASE|AUTH)_[A-Z_]{1,64}$/.test(value) ? value : 'JOBS_NOT_READY';
}
function dispatchRejection(error: unknown): 'JOBS_AUTHORITY_RETIRED' | 'JOBS_DEFINITION_UNAVAILABLE' | 'JOBS_CAPACITY' | null {
  const failure = code(error);
  return ['AUTH_STATE_CHANGED', 'WORKFLOW_AUTHORITY_CHANGED', 'WORKFLOW_AUTHORITY_REQUIRED', 'JOBS_AUTHORITY_RETIRED', 'JOBS_FORBIDDEN'].includes(failure) ? 'JOBS_AUTHORITY_RETIRED'
    : ['WORKFLOW_NOT_FOUND', 'WORKFLOW_VERSION_NOT_FOUND', 'WORKFLOW_VERSION_CONFLICT', 'JOBS_DEFINITION_UNAVAILABLE'].includes(failure) ? 'JOBS_DEFINITION_UNAVAILABLE'
    : ['WORKFLOW_START_LIMIT_EXCEEDED', 'JOBS_CAPACITY'].includes(failure) ? 'JOBS_CAPACITY' : null;
}
