/** Reusable local Bun processes. No database opening, implicit env or app boot; durable jobs remain Torrent-owned. */
import { availableParallelism } from 'node:os';
import type { DatabaseExecutor } from '../databases/database-executor';
import { DatabaseError } from '../databases/database-error';
import { createSubprocessDatabaseExecutorFactory, type DatabaseActorLaunch } from '../databases/subprocess-database-executor-factory';
import { WorkPool, type WorkPoolRunOptions } from './work-pool';
import { WorkerTaskCatalog, type WorkerTask, type WorkerTaskInput, type WorkerTaskOutput } from './worker-task';
import { WorkerError } from './worker-error';
import { workerRecord } from './worker-value';
import { WORKER_CHILD_FLAG } from './worker-bootstrap';

export interface ProcessWorkPoolOptions {
  tasks: readonly WorkerTask[];
  launch: DatabaseActorLaunch;
  /** Full explicit environment allowlist; default empty. Never process.env. */
  env?: Readonly<Record<string, string>>;
  /** Max is min(4, available CPUs), not 100 CPU-heavy child processes. */
  processes?: number | 'max';
  maxQueued?: number;
  /** Omitted caps one scope's waiting share at min(25, maxQueued). Not a reserved quota. */
  maxQueuedPerKey?: number;
  maxConcurrentPerKey?: number;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
  startupTimeoutMs?: number;
  shutdownGraceMs?: number;
}
interface Session { readonly executor: DatabaseExecutor; readonly slot: number; busy: boolean; closing: Promise<void> | null }

export class ProcessWorkPool {
  readonly catalog: WorkerTaskCatalog;
  readonly capacity: number;
  private readonly queue: WorkPool;
  private readonly createExecutor: ReturnType<typeof createSubprocessDatabaseExecutorFactory>;
  private readonly sessions = new Map<number, Session>();
  private closed = false;
  private closeTask: Promise<void> | null = null;
  private acquiring: Promise<void> = Promise.resolve();
  private readonly executionTimeoutMs: number;
  constructor(options: ProcessWorkPoolOptions) {
    workerRecord(options, ['tasks', 'launch', 'env', 'processes', 'maxQueued', 'maxQueuedPerKey', 'maxConcurrentPerKey', 'queueTimeoutMs', 'executionTimeoutMs', 'startupTimeoutMs', 'shutdownGraceMs']);
    this.catalog = new WorkerTaskCatalog(options.tasks);
    const processes = options.processes === undefined || options.processes === 'max' ? Math.min(4, availableParallelism()) : options.processes;
    if (!Number.isSafeInteger(processes) || processes < 1 || processes > 64) throw new WorkerError('WORKER_CONFIG_INVALID', 'Worker process capacity is invalid.');
    this.capacity = processes; this.executionTimeoutMs = options.executionTimeoutMs ?? 30_000;
    this.queue = new WorkPool({ concurrency: processes, maxConcurrency: 64, maxQueued: options.maxQueued,
      maxQueuedPerKey: options.maxQueuedPerKey ?? Math.min(25, options.maxQueued ?? 100), maxConcurrentPerKey: options.maxConcurrentPerKey,
      queueTimeoutMs: options.queueTimeoutMs, executionTimeoutMs: this.executionTimeoutMs, shutdownGraceMs: options.shutdownGraceMs });
    try {
      this.createExecutor = createSubprocessDatabaseExecutorFactory({ launch: options.launch, actorFlag: WORKER_CHILD_FLAG, env: options.env,
        executor: { maxInFlight: 1, operationTimeoutMs: this.executionTimeoutMs, startupTimeoutMs: options.startupTimeoutMs ?? 5000,
          shutdownAckTimeoutMs: 1000, shutdownExitTimeoutMs: 1000, sigtermTimeoutMs: 500, sigkillTimeoutMs: 1000 } });
    } catch { throw new WorkerError('WORKER_CONFIG_INVALID', 'Worker launch configuration is invalid.'); }
  }

  run<Task extends WorkerTask>(task: Task, input: WorkerTaskInput<NoInfer<Task>>, options?: WorkPoolRunOptions, assertCurrent?: () => void): Promise<WorkerTaskOutput<Task>>;
  run(name: string, input: unknown, options?: WorkPoolRunOptions, assertCurrent?: () => void): Promise<unknown>;
  run(target: string | WorkerTask, input: unknown, options: WorkPoolRunOptions = {}, assertCurrent: () => void = () => {}): Promise<unknown> {
    try {
      const admittedOptions = Object.freeze({ ...workerRecord(options, ['signal', 'key', 'queueTimeoutMs', 'executionTimeoutMs']) }) as WorkPoolRunOptions;
      const task = this.catalog.resolve(target), acceptedInput = task.parseInput(input);
      let dispatched = false;
      return this.queue.run(async signal => {
        signal.throwIfAborted(); if (this.closed) throw new WorkerError('WORKER_NOT_READY', 'Worker pool is closing.');
        assertCurrent();
        let session = await this.acquire(signal);
        let authorityFailed = false;
        const fence = () => { try { assertCurrent(); } catch (error) { authorityFailed = true; throw error; } };
        const abort = () => { void this.retire(session).catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
          signal.throwIfAborted();
          for (let replacement = 0; ; replacement++) {
            const reused = session.executor.diagnostics().state === 'ready';
            try {
              signal.throwIfAborted();
              await session.executor.start(); signal.throwIfAborted();
              const fingerprint = await session.executor.execute({ operation: 'worker.catalog', kind: 'read', payload: null });
              if (fingerprint !== this.catalog.fingerprint) throw new WorkerError('WORKER_VERSION_MISMATCH', 'Worker catalog does not match the admitted task versions.');
              break;
            } catch (error) {
              // An idle generation can die after acquisition but before its
              // catalog response. No task has been sent. Reconcile that exact
              // generation once, never retry a task or mask a contract mismatch.
              if (replacement || !reused || signal.aborted || this.closed || !(error instanceof DatabaseError)
                || !['DATABASE_EXECUTOR_FAILED', 'DATABASE_EXECUTOR_START_FAILED'].includes(error.code)) throw error;
              await this.retire(session); session.busy = false;
              signal.throwIfAborted(); fence();
              session = await this.acquire(signal);
            }
          }
          signal.throwIfAborted(); fence(); dispatched = true;
          const raw = await session.executor.execute({ operation: 'worker.execute', kind: 'write',
            payload: { name: task.name, version: task.version, input: acceptedInput, catalog: this.catalog.fingerprint } },
          { timeoutMs: admittedOptions.executionTimeoutMs ?? this.executionTimeoutMs });
          signal.throwIfAborted(); fence();
          const result = workerRecord(raw, ['ok', 'value', 'code']);
          if (result.ok === false && result.code === 'WORKER_TASK_FAILED') throw new WorkerError('WORKER_TASK_FAILED', 'Worker task failed; reconcile any external effect.', 'unknown');
          if (result.ok !== true || !Object.hasOwn(result, 'value')) throw new WorkerError('WORKER_PROCESS_FAILED', 'Worker result was invalid.', 'unknown');
          return task.parseOutput(result.value);
        } catch (error) {
          await this.retire(session);
          if (authorityFailed) {
            if (dispatched) throw new WorkerError('WORKER_AUTHORITY_CHANGED', 'Worker authority changed after dispatch; reconcile any external effect.', 'unknown');
            throw error;
          }
          if (dispatched && error instanceof WorkerError && error.outcome === 'not-started') {
            throw new WorkerError('WORKER_PROCESS_FAILED', 'Worker result could not be confirmed; reconcile any external effect.', 'unknown');
          }
          if (error instanceof WorkerError) throw error;
          throw new WorkerError(dispatched ? 'WORKER_PROCESS_FAILED' : 'WORKER_START_FAILED',
            dispatched ? 'Worker execution was interrupted; reconcile any external effect.' : 'Worker process could not start.', dispatched ? 'unknown' : 'not-started');
        } finally {
          signal.removeEventListener('abort', abort);
          try {
            if (signal.aborted || this.closed || session.executor.diagnostics().state !== 'ready') await this.retire(session);
          } finally {
            // Even a failed cleanup has finished its callback. Keep its physical
            // slot quarantined, but let later admission retry observed settlement.
            session.busy = false;
          }
        }
      }, admittedOptions).catch(error => {
        if (admittedOptions.signal?.aborted && error === admittedOptions.signal.reason) {
          throw new WorkerError('WORKER_CANCELLED', 'Worker execution was cancelled; reconcile any dispatched external effect.', dispatched ? 'unknown' : 'not-started');
        }
        throw error;
      });
    } catch (error) { return Promise.reject(error); }
  }

  status() {
    const queue = this.queue.status();
    const state = this.closed ? this.sessions.size || queue.active || queue.queued ? 'closing' as const : 'closed' as const : queue.state;
    return Object.freeze({ ...queue, state, processes: this.sessions.size,
      quarantined: [...this.sessions.values()].filter(session => session.executor.diagnostics().state === 'quarantined').length });
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    const closing = (async () => {
      const outcomes = await Promise.allSettled([this.queue.close(), ...[...this.sessions.values()].map(session => this.retire(session))]);
      if (outcomes.some(outcome => outcome.status === 'rejected') || this.sessions.size) throw new WorkerError('WORKER_DRAIN_TIMEOUT', 'Worker shutdown could not confirm all child processes settled.', 'unknown');
    })();
    this.closeTask = closing;
    void closing.catch(() => { if (this.closeTask === closing) this.closeTask = null; });
    return closing;
  }
  private acquire(signal: AbortSignal): Promise<Session> {
    // Only process assignment/retirement is serialized, never task execution.
    // Waiting calls are already bounded by the shared execution pool.
    const admitted = this.acquiring.then(() => { signal.throwIfAborted(); return this.acquireSession(signal); });
    this.acquiring = admitted.then(() => undefined, () => undefined);
    return admitted;
  }
  private async acquireSession(signal: AbortSignal): Promise<Session> {
    if (this.closed) throw new WorkerError('WORKER_NOT_READY', 'Worker pool is closing.');
    signal.throwIfAborted();
    // A quarantined generation still owns its physical slot, not every slot.
    // Do not delay unrelated healthy/free capacity on another failed drain.
    const available = this.availableSession(); if (available) return available;
    // Idle children can die between requests too. Reconcile their exact
    // generation before selecting a replacement; do not strand a permanent
    // capacity slot or treat a mere disconnect as process settlement.
    for (const session of [...this.sessions.values()]) if (!session.busy && session.executor.diagnostics().state !== 'ready') {
      session.busy = true;
      try { await this.retire(session); }
      catch { /* Unconfirmed retirement retains this exact physical slot; independent slots remain usable. */ }
      finally { session.busy = false; }
      signal.throwIfAborted();
      if (this.closed) throw new WorkerError('WORKER_NOT_READY', 'Worker pool is closing.');
      const replacement = this.availableSession(); if (replacement) return replacement;
    }
    signal.throwIfAborted();
    if (this.closed) throw new WorkerError('WORKER_NOT_READY', 'Worker pool is closing.');
    throw new WorkerError('WORKER_CAPACITY', 'Worker process capacity is exhausted.');
  }
  private availableSession(): Session | null {
    for (const session of this.sessions.values()) if (!session.busy && !session.closing && session.executor.diagnostics().state === 'ready') { session.busy = true; return session; }
    let slot = 0; while (this.sessions.has(slot)) slot++;
    if (slot >= this.capacity) return null;
    const session: Session = { executor: this.createExecutor({ role: 'writer', slot }), slot, busy: true, closing: null };
    this.sessions.set(slot, session); return session;
  }
  private retire(session: Session): Promise<void> {
    if (session.closing) return session.closing;
    const closing = (async () => {
      try { await session.executor.close(); }
      catch (error) {
        // A missing graceful ack may have required forced termination. Reconcile
        // only after the transport has actually observed that exact exit. Its
        // second close still verifies/retries private cwd cleanup; a settled PID
        // alone never authorizes deleting unknown child-created contents.
        if (error instanceof DatabaseError && session.executor.diagnostics().settled) {
          try { await session.executor.close(); }
          catch { throw new WorkerError('WORKER_PROCESS_FAILED', 'Worker launch-directory cleanup was not confirmed.', 'unknown'); }
        } else if (error instanceof DatabaseError) {
          throw new WorkerError('WORKER_PROCESS_FAILED', 'Worker process settlement was not confirmed.', 'unknown');
        } else throw error;
      }
      if (!session.executor.diagnostics().settled) throw new WorkerError('WORKER_PROCESS_FAILED', 'Worker process settlement was not confirmed.', 'unknown');
      if (this.sessions.get(session.slot) === session) this.sessions.delete(session.slot);
    })();
    session.closing = closing;
    void closing.catch(() => { if (session.closing === closing) session.closing = null; });
    return closing;
  }
}
