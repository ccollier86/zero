/** Bounded short durable starts plus independent Torrent activities. Empty queues have no idle poll and no provider runs on a DB queue. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { WorkflowService } from '../workflows/workflow-service';
import type { StepContext } from '../workflows/types';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import { AuthError } from '../auth/types';
import { MessagingWorkPool } from './work-pool';
import { executeMessagingJob, type MessagingJobContext, type MessagingJobExecutionDependencies } from './job-execution';
import { MESSAGING_JOB_PRINCIPAL, MESSAGING_JOB_WORKFLOW } from './jobs-workflow';
import { TERMINAL_MESSAGING_JOBS, type MessagingJobRow, type MessagingJobState } from './job-model';
import { messagingHash, messagingId } from './validation';
import type { MessagingNotificationContext } from './notification-queries';

export const ZERO_MESSAGING_JOBS = createZeroRuntimeServiceKey<MessagingJobs>('Managed messaging jobs');
export class MessagingJobs {
  private stopped = false;
  private workflow: WorkflowService | null = null;
  private readonly pool: MessagingWorkPool;
  private readonly pending = new Map<string, ServiceDataScope>();
  private readonly cursors = new Map<string, string>();
  private readonly rescan = new Set<string>();
  private readonly scheduled = new Map<string, { scope: ServiceDataScope; workflowId: string | null }>();
  private pumping: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private removeWorkflow: (() => void) | null = null;
  constructor(private readonly deps: Omit<MessagingJobExecutionDependencies, 'assertOpen'> & { system: ReactiveDB; dispatchFailed(): void }) {
    this.pool = new MessagingWorkPool(deps.config.jobConcurrency);
  }
  /** Called only after Torrent recovery/publication, not from an initializer it must itself await. */
  start(workflow: WorkflowService): void {
    this.assertOpen(); if (this.workflow) { if (this.workflow !== workflow) throw unavailable(); return; }
    this.workflow = workflow;
    this.removeWorkflow = this.deps.system.onChange(change => {
      if (change.table !== 'workflow_instances' || !change.row || !['completed', 'failed', 'cancelled'].includes(String(change.row.status))) return;
      for (const [key, value] of this.scheduled) if (value.workflowId === change.rowId) { this.scheduled.delete(key); this.wake(value.scope); }
    });
    for (const scope of this.deps.runtime.retainedScopes()) this.wake(scope);
  }
  wake(scope: ServiceDataScope): void {
    if (this.stopped) return;
    // New work may sort before the current page, but must not reset an active
    // scan on every completion. Finish that scan, then wrap once if dirtied;
    // otherwise a busy conversation can starve older jobs on later pages.
    const key = serviceDataScopeKey(scope); this.pending.set(key, scope); this.rescan.add(key);
    if (this.workflow && !this.timer && !this.pumping) this.arm(0);
  }
  execute(context: StepContext<{ jobId: string }>): Promise<{ jobId: string; state: MessagingJobState }> {
    if (context.execution.kind !== 'system' || context.execution.principal !== MESSAGING_JOB_PRINCIPAL || context.execution.legacyCompatibility) return Promise.reject(unavailable());
    const scope = trustedSystemServiceDataScope(context.execution.scopeKind === 'tenant' ? { scopeKind: 'tenant', tenantId: context.execution.tenantId! } : { scopeKind: 'application' });
    const id = messagingId(context.input.jobId), key = serviceDataScopeKey(scope) + ':' + id;
    this.scheduled.set(key, { scope, workflowId: context.instanceId });
    return this.pool.run(async signal => {
      const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
      let remove: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, refreshing = false;
      const check = () => { this.assertOpen(); context.assertCurrentAuthority(); combined.throwIfAborted(); };
      const current = () => this.deps.runtime.read<MessagingJobContext>(scope, 'messaging.job.context', { id, scopeId: serviceDataScopeKey(scope) }, check, combined);
      try {
        const initial = await current();
        const changed = () => {
          if (timer || refreshing || combined.aborted) return;
          timer = withoutLoggingAttribution(() => setTimeout(() => { timer = undefined; refreshing = true;
            void current().then(value => { if (!value.valid && !TERMINAL_MESSAGING_JOBS.has(value.job.state)) controller.abort(); }, () => { controller.abort(); }).finally(() => { refreshing = false; });
          }, 50));
        };
        if (initial.customerId) remove = this.deps.runtime.subscribe(scope, changed, { actorId: initial.customerId, conversationId: initial.job.conversation_id });
        return await executeMessagingJob({ ...this.deps, assertOpen: () => this.assertOpen() }, context, combined);
      } finally { clearTimeout(timer); remove?.(); controller.abort(); }
    }, context.signal).finally(() => { this.scheduled.delete(key); this.wake(scope); });
  }
  async close(): Promise<void> {
    if (this.stopped) return; this.stopped = true; clearTimeout(this.timer); this.removeWorkflow?.(); this.removeWorkflow = null;
    this.pending.clear(); this.cursors.clear(); this.rescan.clear();
    try { await this.pool.close(); } finally { await this.pumping?.catch(() => {}); this.scheduled.clear(); }
  }
  diagnostics() { return { activeAndQueued: this.pool.size, admitted: this.scheduled.size, pendingScopes: this.pending.size, concurrency: this.pool.capacity, ready: this.workflow !== null && !this.stopped }; }
  private assertOpen(): void { if (this.stopped) throw unavailable(); }
  private arm(delay: number): void {
    if (this.stopped || !this.workflow || this.timer) return;
    this.timer = withoutLoggingAttribution(() => setTimeout(() => { this.timer = undefined; void this.pump(); }, delay)); this.timer.unref?.();
  }
  private pump(): Promise<void> {
    if (this.pumping || this.stopped || !this.workflow) return this.pumping ?? Promise.resolve();
    this.pumping = withoutLoggingAttribution(async () => {
      let failed = false;
      while (!this.stopped && this.pending.size && this.scheduled.size < this.pool.capacity) {
        const [scopeId, scope] = this.pending.entries().next().value!;
        this.pending.delete(scopeId);
        try {
          const after = this.cursors.get(scopeId);
          if (!after) this.rescan.delete(scopeId);
          const page = await this.deps.runtime.read<(MessagingJobRow & { workflow_id: string | null })[]>(scope, 'messaging.jobs.pending', { scopeId, ...(after ? { after } : {}), limit: 25 }, () => this.assertOpen());
          let processed = 0;
          for (const job of page) {
            if (this.stopped || this.scheduled.size >= this.pool.capacity) break;
            const key = scopeId + ':' + job.id; processed++;
            if (this.scheduled.has(key)) continue;
            if (job.workflow_id) {
              const instance = this.workflow!.get(job.workflow_id, scope);
              if (instance && ['pending', 'running', 'paused'].includes(instance.status)) { this.scheduled.set(key, { scope, workflowId: job.workflow_id }); continue; }
              await this.reconcileTerminal(scope, job, instance?.status ?? null); continue;
            }
            this.scheduled.set(key, { scope, workflowId: null });
            try {
              const started = await this.workflow!.enqueueAsSystemOnce(MESSAGING_JOB_WORKFLOW, { jobId: job.id }, { principal: MESSAGING_JOB_PRINCIPAL, reason: 'Execute accepted private messaging work', scope,
                idempotencyKey: 'messaging-job:' + messagingHash([scopeId, job.id, job.dispatch_generation]) });
              const scheduled = this.scheduled.get(key); if (scheduled) scheduled.workflowId = started.instanceId;
              await this.deps.runtime.write(scope, 'messaging.job.dispatch', { scopeId, id: job.id, generation: job.dispatch_generation, workflowId: started.instanceId }, 'job-dispatch:' + messagingHash([scopeId, job.id, job.dispatch_generation]), () => this.assertOpen());
            } catch (failure) { this.scheduled.delete(key); throw failure; }
          }
          if (page.length === 25 || processed < page.length) { this.pending.set(scopeId, scope); if (processed) this.cursors.set(scopeId, page[processed - 1]!.id); }
          else {
            this.cursors.delete(scopeId);
            if (this.rescan.delete(scopeId)) this.pending.set(scopeId, scope);
          }
        } catch { if (!this.stopped) { this.pending.set(scopeId, scope); this.cursors.delete(scopeId); failed = true; try { this.deps.dispatchFailed(); } catch { /* Diagnostics cannot change a durable effect. */ } break; } }
      }
      return failed;
    }).then(failed => { if (failed) this.arm(1000); }).finally(() => {
      this.pumping = null;
      if (!this.stopped && this.pending.size && this.scheduled.size < this.pool.capacity && !this.timer) this.arm(0);
    });
    return this.pumping;
  }
  private async reconcileTerminal(scope: ServiceDataScope, job: MessagingJobRow & { workflow_id?: string | null }, workflowStatus: string | null): Promise<void> {
    const scopeId = serviceDataScopeKey(scope), nonce = 'reconcile_' + crypto.randomUUID(), check = () => this.assertOpen();
    if (job.kind === 'notification' && job.dispatch_generation < 2 && this.deps.config.notifications && this.deps.notifications && workflowStatus === 'failed' && job.workflow_id) {
      const source = await this.deps.runtime.read<MessagingNotificationContext>(scope, 'messaging.notification.context', { scopeId, id: job.id }, check);
      if (source.audiencePresent) {
        await this.deps.runtime.write(scope, 'messaging.notification.redispatch', { scopeId, id: job.id, generation: job.dispatch_generation, workflowId: job.workflow_id },
          'notice-redispatch:' + messagingHash([scopeId, job.id, job.dispatch_generation]), check);
        this.wake(scope); return;
      }
    }
    const policy = this.deps.config.assistants[job.assistant_id ?? 'default'];
    const claimed = await this.deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.job.claim', { scopeId, id: job.id, nonce, policyHash: policy?.policyHash ?? null, leaseMs: 10000 }, 'job-reconcile:' + nonce, check);
    if (!TERMINAL_MESSAGING_JOBS.has(claimed.state)) await this.deps.runtime.write(scope, 'messaging.job.review', { scopeId, id: job.id, nonce, code: 'WORKFLOW_REQUIRES_RECONCILIATION' }, 'job-review:' + nonce, check);
  }
}
function unavailable() { return new AuthError('Managed messaging jobs are not available.', 'MESSAGING_NOT_READY', 503); }
