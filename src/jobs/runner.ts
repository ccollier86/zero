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
import type { JobsDueCursor, JobsRuntime } from './runtime';
import { jobHash } from './validation';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import type { JobsSourceBroker } from './source-service';

export function jobGateKey(scope: ServiceDataScope, id: string): string { return jobHash([serviceDataScopeKey(scope), id]); }
interface RunnerOptions {
  runtime: JobsRuntime; bridge: WorkflowDeferredStartBridge; config: ResolvedJobsConfig; gate: WorkPool;
  now?: () => number; onFailure?: (stage: 'scope' | 'dispatch' | 'completion', code: string) => void;
  sources?: Pick<JobsSourceBroker, 'prepareDispatch'>;
  /** Native service startup gate only; explicit ticks and their internal refill remain independent. */
  autoReady?: () => boolean;
}
interface DispatchContext { occurrence: JobOccurrenceRow; admission: JobAdmission; seal: JobSeal; dispatchAllowed: boolean }
export class JobsRunner {
  private state: 'ready' | 'closing' | 'closed' = 'ready';
  private tickTask: Promise<void> | null = null;
  private discoveryCursor: JobsDueCursor | undefined;
  private discoveryHorizon: number | undefined;
  private closeTask: Promise<void> | null = null;
  private readonly scopeTasks = new Map<string, Promise<void>>();
  // Durable wake publication may be fenced by another scope write or fail.
  // Keep this local fence too, so completion-driven refill cannot busy-loop
  // on an unchanged due marker. Keys are bounded by the retained scope catalog.
  private readonly retryNotBefore = new Map<string, number>();
  private readonly abort = new AbortController();
  private readonly completionCursors = new Map<string, string>();
  private readonly reported = new Set<string>();
  private suppressedFailures = 0;
  private scheduler: SchedulerService | null = null;
  private timerRun: (() => Promise<void>) | null = null;
  private startAttempt: object | null = null;
  private readonly now: () => number;
  constructor(private readonly options: RunnerOptions) { this.now = options.now ?? Date.now; }
  start(scheduler: SchedulerService): void {
    if (this.scheduler || this.startAttempt || this.state !== 'ready') throw new JobsError('JOBS_NOT_READY');
    const attempt = {}; this.startAttempt = attempt;
    const run = async () => {
      if (this.state !== 'ready' || this.startAttempt !== attempt || this.scheduler !== scheduler
        || this.options.autoReady && this.options.autoReady() !== true) return;
      await this.tick();
    };
    try {
      scheduler.register({ name: 'zero-durable-jobs', pattern: '* * * * * *', timezone: 'UTC', protect: true, run });
      if (this.state !== 'ready' || this.startAttempt !== attempt) throw new JobsError('JOBS_NOT_READY');
      this.scheduler = scheduler; this.timerRun = run;
      if (!this.options.autoReady || this.options.autoReady() === true) this.wake();
    } catch (error) {
      if (this.startAttempt === attempt) this.startAttempt = null;
      if (this.timerRun === run) { this.timerRun = null; this.scheduler = null; }
      // A registration may publish then throw. Retire only this attempt's
      // callback; never remove a replacement or turn the failed callback live
      // when a later retry enables automatic intake.
      try { scheduler.unregister('zero-durable-jobs', run); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Jobs scheduler registration and cleanup failed.'); }
      throw error;
    }
  }
  wake(): void {
    if (this.state === 'ready') withoutLoggingAttribution(() => queueMicrotask(() => { void this.tick().catch(error => this.report('scope', error)); }));
  }
  tick(): Promise<void> {
    // The runner owns background continuation, never its triggering HTTP
    // caller's active/retired audit lifetime. Sealed job authority is unchanged.
    return withoutLoggingAttribution(() => this.tickOwned());
  }
  private tickOwned(): Promise<void> {
    if (this.tickTask) return this.tickTask;
    if (this.state !== 'ready') return Promise.resolve();
    let continueScan = false;
    this.tickTask = Promise.resolve().then(() => {
      if (this.state !== 'ready') return;
      this.options.bridge.assertRuntimeCurrent();
      // Scope capacity is concurrent admission, not "N scopes per second".
      // Include a bounded look-ahead past currently running roots; completion
      // refills a free slot without waiting for the slowest scope or next tick.
      // Freeze one pass's horizon: continuously advancing cron wakes must not
      // keep the cursor moving forever while newly dirty roots sit behind it.
      const horizon = this.discoveryHorizon ??= this.now();
      const entries = this.options.runtime.dueScopePage(horizon, 100, this.discoveryCursor);
      let inspected = 0;
      for (const { scope, cursor } of entries) {
        if (this.state !== 'ready' || this.scopeTasks.size >= this.options.config.maxActiveDatabases) break;
        this.discoveryCursor = cursor; inspected++;
        const key = serviceDataScopeKey(scope); if (this.scopeTasks.has(key)) continue;
        const retryAt = this.retryNotBefore.get(key);
        if (retryAt !== undefined && retryAt > this.now()) continue;
        this.retryNotBefore.delete(key);
        const task = Promise.resolve().then(async () => { if (this.state === 'ready') await this.processScope(scope); })
          .catch(error => this.report('scope', error)).finally(() => {
            if (this.scopeTasks.get(key) === task) this.scopeTasks.delete(key); this.wake();
          });
        this.scopeTasks.set(key, task);
      }
      if (inspected === entries.length) {
        if (entries.length < 100) { this.discoveryCursor = undefined; this.discoveryHorizon = undefined; }
        else continueScan = this.scopeTasks.size < this.options.config.maxActiveDatabases;
      }
    }).finally(() => { this.tickTask = null; if (continueScan) this.wake(); });
    return this.tickTask;
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing'; this.startAttempt = null;
    const scheduler = this.scheduler, timerRun = this.timerRun; this.scheduler = null; this.timerRun = null;
    if (scheduler && timerRun) scheduler.unregister('zero-durable-jobs', timerRun);
    this.abort.abort();
    this.closeTask = (async () => {
      await Promise.allSettled([...(this.tickTask ? [this.tickTask] : []), ...this.scopeTasks.values()]);
      this.scopeTasks.clear(); this.completionCursors.clear(); this.retryNotBefore.clear(); this.discoveryCursor = undefined; this.discoveryHorizon = undefined; this.state = 'closed';
    })();
    return this.closeTask;
  }
  diagnostics() { return { state: this.state, ticking: this.tickTask !== null, activeScopes: this.scopeTasks.size, reportedFailures: [...this.reported], suppressedFailures: this.suppressedFailures }; }
  private guard = () => { this.options.bridge.assertRuntimeCurrent(); };
  private async processScope(scope: ServiceDataScope): Promise<void> {
    const scopeId = serviceDataScopeKey(scope), limit = this.options.config.batchSize;
    let retryDeferred = false;
    const failed = (stage: 'scope' | 'dispatch' | 'completion', error: unknown) => { retryDeferred = true; this.report(stage, error); };
    try {
      const due = await this.options.runtime.read<{ id: string; revision: number }[]>(scope, 'jobs.due', { scopeId, now: this.now(), limit }, this.guard, this.abort.signal);
      await Promise.allSettled(due.map(row => this.options.gate.run(async () => {
        if (this.state !== 'ready') return;
        try { await this.write(scope, 'jobs.materialize', { scopeId, id: row.id, expectedRevision: row.revision, now: this.now() }); }
        catch (error) {
          if (code(error) === 'JOBS_CAPACITY') await this.write(scope, 'jobs.cursor.block', { scopeId, id: row.id, expectedRevision: row.revision, code: 'JOBS_CAPACITY' });
          else if (code(error) !== 'JOBS_REVISION_CONFLICT') throw error;
        }
      }, { key: jobGateKey(scope, row.id), signal: this.abort.signal }).catch(error => failed('scope', error))));
      const pending = await this.options.runtime.read<{ id: string; schedule_id: string }[]>(scope, 'jobs.pending', { scopeId, now: this.now(), limit }, this.guard, this.abort.signal);
      await Promise.allSettled(pending.map(row => this.options.gate.run(() => this.dispatch(scope, row.id),
        { key: jobGateKey(scope, row.schedule_id), signal: this.abort.signal }).catch(error => failed('dispatch', error))));
      const after = this.completionCursors.get(scopeId);
      let dispatched = await this.options.runtime.read<{ id: string; schedule_id: string }[]>(scope, 'jobs.dispatched', { scopeId, limit, ...(after ? { after } : {}) }, this.guard, this.abort.signal);
      if (!dispatched.length && after) { this.completionCursors.delete(scopeId); dispatched = await this.options.runtime.read(scope, 'jobs.dispatched', { scopeId, limit }, this.guard, this.abort.signal); }
      if (dispatched.length) this.completionCursors.set(scopeId, dispatched[dispatched.length - 1]!.id);
      await Promise.allSettled(dispatched.map(row => this.options.gate.run(() => this.reconcileCompletion(scope, row.id),
        { key: jobGateKey(scope, row.schedule_id), signal: this.abort.signal }).catch(error => failed('completion', error))));
      await this.options.runtime.refreshWake(scope, this.now(), this.guard);
      // A full admission queue or invalid retained command must not become an
      // immediate refill busy-loop. Keep its durable work and retry it later;
      // another due scope may use the now-free slot in the meantime.
      if (retryDeferred && this.state === 'ready') {
        const retryAt = this.now() + 1000; this.retryNotBefore.set(scopeId, retryAt);
        await this.options.runtime.deferWake(scope, retryAt, this.guard);
      }
    } catch (error) {
      this.report('scope', error);
      if (this.state === 'ready') {
        const retryAt = this.now() + 5000; this.retryNotBefore.set(scopeId, retryAt);
        try { await this.options.runtime.deferWake(scope, retryAt, this.guard); } catch { /* Local backoff and retained dirty state remain; never spin on failed publication. */ }
      }
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
      // An uncertain claim still reconciles first after a backward clock step.
      // Without a receipt, keep it recoverable instead of inventing retirement.
      if (this.now() < context.occurrence.scheduled_at) throw new JobsError('JOBS_NOT_READY');
      if (!context.dispatchAllowed) {
        await this.write(scope, 'jobs.block', { scopeId, id, nonce, leaseGeneration: claim.leaseGeneration, code: 'JOBS_NOT_DISPATCHED', now: this.now() }); return;
      }
      let sourceGuard: (() => void) | undefined;
      const assertSourceCurrent = () => {
        this.guard(); this.abort.signal.throwIfAborted();
        const now = this.now();
        if (now < context.occurrence.scheduled_at) throw new JobsError('JOBS_NOT_READY');
        if (this.state !== 'ready' || context.occurrence.lease_until === null || context.occurrence.lease_until <= now
          || now > context.occurrence.scheduled_at + admission.timing.maxLatenessMs) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        const definition = this.options.config.catalog.resolve(admission.definition, admission.definitionVersion);
        assertJobDefinitionCurrent(definition, admission, authority, scope);
        if (admission.source && !sourceGuard) throw new JobsError('JOBS_AUTHORITY_RETIRED');
        sourceGuard?.();
      };
      try {
        if (admission.source) sourceGuard = await this.options.sources?.prepareDispatch(scope, admission);
        assertSourceCurrent();
        await this.options.bridge.enqueue(authority, admission.workflow, admission.input, jobDispatchKey(id), binding, assertSourceCurrent);
        accepted = inspect(); if (!accepted) throw new JobsError('JOBS_OUTCOME_UNKNOWN');
      } catch (error) {
        // A timeout/throw is not proof no workflow exists. Reconcile the exact
        // permanent key before selecting any known no-start terminal action.
        accepted = inspect();
        if (!accepted) {
          const rejection = dispatchRejection(error);
          if (!rejection) {
            if (code(error) === 'JOBS_NOT_READY') {
              // Source hydration must not cost a full 60-second uncertain lease.
              // Retain claimed state and the original key; retry still inspects
              // Torrent first, including an acceptance that arrived meanwhile.
              try { await this.write(scope, 'jobs.claim.defer', { scopeId, id, nonce, leaseGeneration: claim.leaseGeneration, now: this.now() }); }
              catch { /* Preserve the original failure and its still-recoverable claim. */ }
            }
            throw error;
          }
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
