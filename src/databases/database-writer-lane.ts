/** Per-database bounded FIFO for serialized writer work. */

import { DatabaseError } from './database-error';
import type { DatabaseRef } from './database-file';
import type { DatabaseObservability } from './database-observability';
import type { DatabaseActorPlacementConfig } from './database-actor-protocol';
import {
  elapsed,
  queueCancelled,
  safeCoordinatorError,
} from './database-coordinator-errors';
import type { DatabaseWriterLaneOperationClass } from './database-coordinator-runtime';

interface WriterLaneTask<T> {
  readonly execute: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: DatabaseError) => void;
  readonly queuedAt: number;
  readonly timeoutMs: number;
  readonly operationClass: DatabaseWriterLaneOperationClass;
  readonly chargedToGlobalQueue: boolean;
  readonly signal?: AbortSignal;
  timer: ReturnType<typeof setTimeout> | null;
  abortListener: (() => void) | null;
  settled: boolean;
}

export interface DatabaseWriterLaneOptions {
  readonly databaseRef: DatabaseRef;
  readonly placement: DatabaseActorPlacementConfig['mode'];
  readonly maxQueued: number;
  readonly now: () => number;
  readonly onQueued: () => boolean;
  readonly onDequeued: () => void;
  readonly observability: DatabaseObservability | null;
}

export class DatabaseWriterLane {
  private readonly queue: WriterLaneTask<any>[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private active = false;

  constructor(private readonly options: DatabaseWriterLaneOptions) {}

  get depth(): number { return this.queue.length + (this.active ? 1 : 0); }

  enqueue<T>(
    execute: () => Promise<T>,
    options: {
      readonly signal?: AbortSignal;
      readonly timeoutMs: number;
      readonly operationClass: DatabaseWriterLaneOperationClass;
    },
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(queueCancelled());
    }
    const willWait = this.active || this.queue.length > 0;
    if (willWait
      && (this.queue.length >= this.options.maxQueued
        || !this.options.onQueued())) {
      this.emit({
        type: 'queue-saturated',
        databaseRef: this.options.databaseRef,
        placement: this.options.placement,
        operation: options.operationClass,
        queueDepth: this.queue.length,
        queueLimit: this.options.maxQueued,
      });
      return Promise.reject(new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database writer queue capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            queueDepth: this.queue.length,
            queueLimit: this.options.maxQueued,
          },
        },
      ));
    }

    const promise = new Promise<T>((resolve, reject) => {
      const task: WriterLaneTask<T> = {
        execute,
        resolve,
        reject,
        queuedAt: this.options.now(),
        timeoutMs: options.timeoutMs,
        operationClass: options.operationClass,
        chargedToGlobalQueue: willWait,
        ...(options.signal ? { signal: options.signal } : {}),
        timer: null,
        abortListener: null,
        settled: false,
      };
      if (willWait) task.timer = setTimeout(() => this.expire(task), options.timeoutMs);
      if (willWait && options.signal) {
        task.abortListener = () => this.cancel(task);
        options.signal.addEventListener('abort', task.abortListener, { once: true });
      }
      this.queue.push(task);
    });
    this.pump();
    return promise;
  }

  rejectQueued(error: DatabaseError): void {
    for (const task of [...this.queue]) this.rejectTask(task, error);
    this.resolveIdleIfNeeded();
  }

  idle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private pump(): void {
    if (this.active) return;
    let task = this.queue.shift();
    while (task?.settled) task = this.queue.shift();
    if (!task) {
      this.resolveIdleIfNeeded();
      return;
    }
    if (task.chargedToGlobalQueue) this.options.onDequeued();
    this.detachWaitHooks(task);
    this.active = true;
    void Promise.resolve().then(task.execute).then(
      (value) => {
        const shouldResolve = !task!.settled;
        if (shouldResolve) task!.settled = true;
        this.finishActiveTask();
        if (shouldResolve) task!.resolve(value);
      },
      (caught) => {
        const shouldReject = !task!.settled;
        if (shouldReject) task!.settled = true;
        const error = shouldReject ? safeCoordinatorError(caught) : null;
        this.finishActiveTask();
        if (error) task!.reject(error);
      },
    );
  }

  /** Release the writer FIFO before the operation result reaches host code. */
  private finishActiveTask(): void {
    this.active = false;
    this.pump();
  }

  private expire(task: WriterLaneTask<any>): void {
    if (!this.removeQueued(task)) return;
    const durationMs = elapsed(task.queuedAt, this.options.now());
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(new DatabaseError(
      'DATABASE_QUEUE_TIMEOUT',
      'Database operation expired in the writer queue.',
      {
        retryable: true,
        outcome: 'not-started',
        details: { durationMs, queueDepth: this.queue.length },
      },
    ));
    this.emit({
      type: 'queue-timeout',
      databaseRef: this.options.databaseRef,
      placement: this.options.placement,
      operation: task.operationClass,
      queueDepth: this.queue.length,
      durationMs,
    });
    this.resolveIdleIfNeeded();
  }

  private cancel(task: WriterLaneTask<any>): void {
    if (!this.removeQueued(task)) return;
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(queueCancelled());
    this.resolveIdleIfNeeded();
  }

  private rejectTask(task: WriterLaneTask<any>, error: DatabaseError): void {
    if (!this.removeQueued(task)) return;
    task.settled = true;
    this.detachWaitHooks(task);
    task.reject(error);
  }

  private removeQueued(task: WriterLaneTask<any>): boolean {
    if (task.settled) return false;
    const index = this.queue.indexOf(task);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    if (task.chargedToGlobalQueue) this.options.onDequeued();
    return true;
  }

  private detachWaitHooks(task: WriterLaneTask<any>): void {
    if (task.timer) clearTimeout(task.timer);
    task.timer = null;
    if (task.signal && task.abortListener) {
      task.signal.removeEventListener('abort', task.abortListener);
    }
    task.abortListener = null;
  }

  private resolveIdleIfNeeded(): void {
    if (this.active || this.queue.length > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private emit(event: Parameters<DatabaseObservability['emit']>[0]): void {
    try {
      this.options.observability?.emit(event);
    } catch {
      // Telemetry cannot change queue behavior.
    }
  }
}
