/** Managed Zero facade. Processes stay private; every queued task rechecks current actor/scope before dispatch. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { AuthError } from '../auth/types';
import { ProcessWorkPool, type ProcessWorkPoolOptions } from './process-pool';
import { workerRecord } from './worker-value';
import { WorkerError } from './worker-error';
import type { WorkerTask, WorkerTaskInput, WorkerTaskOutput } from './worker-task';

export interface ScopedWorkerRunOptions {
  signal?: AbortSignal;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
}
export interface ScopedWorkers {
  run<Task extends WorkerTask>(task: Task, input: WorkerTaskInput<NoInfer<Task>>, options?: ScopedWorkerRunOptions): Promise<WorkerTaskOutput<Task>>;
  run(name: string, input: unknown, options?: ScopedWorkerRunOptions): Promise<unknown>;
}
export interface WorkerAuthority {
  access: RequestAuthorizationAccess;
  scope: ServiceDataScope;
  assertCurrentAuthoritySync(): void;
  assertCurrentAuthority(): Promise<void>;
  signal?: AbortSignal;
}

export class WorkerService {
  private readonly pool: ProcessWorkPool;
  constructor(options: ProcessWorkPoolOptions) { this.pool = new ProcessWorkPool(options); }
  /** Trusted composition only. Request code gets forAuthority(), never the process owner. */
  run<Task extends WorkerTask>(task: Task, input: WorkerTaskInput<NoInfer<Task>>, options?: ScopedWorkerRunOptions): Promise<WorkerTaskOutput<Task>>;
  run(name: string, input: unknown, options?: ScopedWorkerRunOptions): Promise<unknown>;
  run(target: string | WorkerTask, input: unknown, options?: ScopedWorkerRunOptions): Promise<unknown> {
    return typeof target === 'string' ? this.pool.run(target, input, options) : this.pool.run(target, input, options);
  }
  status() { return this.pool.status(); }
  close(): Promise<void> { return this.pool.close(); }
  forAuthority(authority: WorkerAuthority): ScopedWorkers {
    const key = serviceDataScopeKey(authority.scope);
    const run = async (target: string | WorkerTask, input: unknown, options: ScopedWorkerRunOptions = {}) => {
      const admitted = workerRecord(options, ['signal', 'queueTimeoutMs', 'executionTimeoutMs']) as ScopedWorkerRunOptions;
      const task = this.pool.catalog.resolve(target);
      const fence = () => {
        invokeSynchronousAuthCallback(authority.assertCurrentAuthoritySync, { component: 'workers', invariant: 'current-authority-is-synchronous',
          message: 'Worker authority checks must not yield.', createError: () => new AuthError('Worker authority checks must not yield.', 'WORKER_CONFIG_INVALID', 500) });
        authority.access.requireUser(); authority.access.authorize(task.access);
        if (serviceDataScopeKey(authority.scope) !== key) throw new AuthError('Worker authority changed.', 'AUTH_STATE_CHANGED', 409);
      };
      await authority.assertCurrentAuthority(); fence();
      const signals = [authority.signal, admitted.signal].filter((signal): signal is AbortSignal => signal !== undefined);
      if (signals.some(signal => !(signal instanceof AbortSignal))) throw new WorkerError('WORKER_CONFIG_INVALID', 'Worker cancellation signal is invalid.');
      const result = await this.pool.run(task, input, { ...admitted, key, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) }, fence);
      try { await authority.assertCurrentAuthority(); fence(); }
      catch { throw new WorkerError('WORKER_AUTHORITY_CHANGED', 'Worker authority changed after execution; reconcile any external effect.', 'unknown'); }
      return result;
    };
    return Object.freeze({ run: run as ScopedWorkers['run'] });
  }
}
