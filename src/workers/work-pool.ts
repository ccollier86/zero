/**
 * Bounded, fair asynchronous execution. This is not a durable queue, CPU process
 * executor or authorization boundary. Callers must not hold database leases
 * while waiting for admission. Cancellation never proves an effect rolled back.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { WorkerError } from './worker-error';
import { workerRecord } from './worker-value';

export const DEFAULT_WORK_POOL_CAPACITY = 100;
const MAX_CAPACITY = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface WorkPoolOptions {
  /** Omitted/max uses maxConcurrency (100 by default), never infinite concurrency. */
  concurrency?: number | 'max';
  maxConcurrency?: number;
  maxQueued?: number;
  /** Per-key waiting budget; defaults to maxQueued for standalone compatibility. */
  maxQueuedPerKey?: number;
  /** Optional per-key limit; keys partition fair admission, not Guardian authority. */
  maxConcurrentPerKey?: number;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
  shutdownGraceMs?: number;
}
export interface WorkPoolRunOptions {
  signal?: AbortSignal;
  /** Server-derived opaque fairness key. Never a user-selected tenant capability. */
  key?: string;
  queueTimeoutMs?: number;
  executionTimeoutMs?: number;
}
export interface WorkPoolStatus {
  readonly state: 'open' | 'closing' | 'closed';
  readonly capacity: number;
  readonly active: number;
  readonly queued: number;
  readonly waitingKeys: number;
}
interface Entry {
  key: string;
  controller: AbortController;
  state: 'queued' | 'active' | 'finished';
  timer?: ReturnType<typeof setTimeout>;
  removeSignal(): void;
  start(): void;
  abort(reason: unknown): void;
  finished: Promise<void>;
}

export class WorkPool {
  readonly capacity: number;
  private readonly maxQueued: number;
  private readonly maxQueuedPerKey: number;
  private readonly maxPerKey: number;
  private readonly queueTimeoutMs?: number;
  private readonly executionTimeoutMs?: number;
  private readonly shutdownGraceMs: number;
  private state: WorkPoolStatus['state'] = 'open';
  private readonly waiting = new Map<string, Entry[]>();
  private readonly ring: string[] = [];
  private queued = 0;
  private readonly active = new Set<Entry>();
  private readonly activeKeys = new Map<string, number>();
  private closeTask: Promise<void> | null = null;

  constructor(options: WorkPoolOptions = {}) {
    try {
      options = { ...workerRecord(options, ['concurrency', 'maxConcurrency', 'maxQueued', 'maxQueuedPerKey', 'maxConcurrentPerKey',
        'queueTimeoutMs', 'executionTimeoutMs', 'shutdownGraceMs']) } as WorkPoolOptions;
    } catch { throw invalid(); }
    const ceiling = integer(options.maxConcurrency ?? DEFAULT_WORK_POOL_CAPACITY, 1, MAX_CAPACITY);
    this.capacity = options.concurrency === undefined || options.concurrency === 'max'
      ? ceiling : integer(options.concurrency, 1, ceiling);
    this.maxQueued = integer(options.maxQueued ?? 100, 0, 100_000);
    this.maxQueuedPerKey = integer(options.maxQueuedPerKey ?? this.maxQueued, 0, this.maxQueued);
    this.maxPerKey = integer(options.maxConcurrentPerKey ?? this.capacity, 1, this.capacity);
    this.queueTimeoutMs = timeout(options.queueTimeoutMs);
    this.executionTimeoutMs = timeout(options.executionTimeoutMs);
    this.shutdownGraceMs = integer(options.shutdownGraceMs ?? 10_000, 1, MAX_TIMEOUT_MS);
  }

  get size(): number { return this.active.size + this.queued; }
  status(): WorkPoolStatus {
    return Object.freeze({ state: this.state, capacity: this.capacity, active: this.active.size,
      queued: this.queued, waitingKeys: this.waiting.size });
  }

  run<T>(work: (signal: AbortSignal) => T | PromiseLike<T>, options: WorkPoolRunOptions = {}): Promise<T> {
    try {
      try { options = { ...workerRecord(options, ['signal', 'key', 'queueTimeoutMs', 'executionTimeoutMs']) } as WorkPoolRunOptions; }
      catch { throw invalid(); }
      if (typeof work !== 'function') throw invalid();
      if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw invalid();
      const signal = options.signal;
      const key = options.key ?? 'default';
      if (typeof key !== 'string' || !key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) throw invalid();
      const queueMs = timeout(options.queueTimeoutMs) ?? this.queueTimeoutMs;
      const executionMs = timeout(options.executionTimeoutMs) ?? this.executionTimeoutMs;
      if (this.state !== 'open') throw closed();
      signal?.throwIfAborted();
      // Refill may occur in a different caller's completion/cancellation frame.
      // Preserve the submitter's stores (including an intentionally empty one),
      // not the previous task's live or already-retired audit/authority lifetime.
      const execute = AsyncLocalStorage.bind((executionSignal: AbortSignal) => Promise.resolve().then(() => {
        executionSignal.throwIfAborted(); return work(executionSignal);
      }));
      // Admit older eligible waiters first. Remaining waiters may all be blocked
      // by their own per-key limits; they must not strand a free slot or prevent
      // an independent key from using it just because the waiting budget is full.
      this.pump();
      const canStart = this.active.size < this.capacity && (this.activeKeys.get(key) ?? 0) < this.maxPerKey;
      if (!canStart && (this.queued >= this.maxQueued || (this.waiting.get(key)?.length ?? 0) >= this.maxQueuedPerKey)) {
        throw new WorkerError('WORKER_CAPACITY', 'Work-pool admission is exhausted.');
      }
      return new Promise<T>((resolve, reject) => {
        let callerSettled = false;
        const settle = (ok: boolean, value: unknown) => {
          if (callerSettled) return;
          callerSettled = true; if (ok) resolve(value as T); else reject(value);
        };
        let finish!: () => void;
        const finished = new Promise<void>(resolveFinished => { finish = resolveFinished; });
        const controller = new AbortController();
        const onAbort = () => entry.abort(signal!.reason);
        const entry: Entry = {
          key, controller, state: 'queued', finished,
          removeSignal: () => signal?.removeEventListener('abort', onAbort),
          abort: AsyncLocalStorage.bind((reason: unknown) => {
            if (entry.state === 'finished' || controller.signal.aborted) return;
            // Abort listeners run synchronously. Cancellation, shutdown and a
            // refill-created timer must notify work in its submitter's stores.
            controller.abort(reason); settle(false, controller.signal.reason);
            clearTimeout(entry.timer); entry.timer = undefined; entry.removeSignal();
            if (entry.state === 'queued') {
              this.removeQueued(entry); entry.state = 'finished'; finish(); this.pump();
            }
            // Running work keeps its slot until the actual callback settles,
            // even if the caller has already observed cancellation/timeout.
          }),
          start: () => {
            clearTimeout(entry.timer); entry.timer = undefined; entry.state = 'active';
            this.active.add(entry); this.activeKeys.set(key, (this.activeKeys.get(key) ?? 0) + 1);
            if (executionMs !== undefined) entry.timer = setTimeout(() => entry.abort(
              new WorkerError('WORKER_EXECUTION_TIMEOUT', 'Work-pool execution timed out; reconcile any external effect.', 'unknown')), executionMs);
            const complete = () => {
              clearTimeout(entry.timer); entry.removeSignal(); entry.state = 'finished';
              this.active.delete(entry);
              const remaining = (this.activeKeys.get(key) ?? 1) - 1;
              if (remaining) this.activeKeys.set(key, remaining); else this.activeKeys.delete(key);
              finish(); this.pump();
              if (this.state === 'closing' && !this.active.size) this.state = 'closed';
            };
            // Both branches consume callback rejection. Cleanup cannot reject a
            // detached finally promise or let a synchronous throw strand a slot.
            void execute(controller.signal)
              .then(value => { settle(true, value); complete(); }, error => { settle(false, error); complete(); });
          },
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (canStart) entry.start();
        else {
          let queue = this.waiting.get(key);
          if (!queue) { queue = []; this.waiting.set(key, queue); this.ring.push(key); }
          queue.push(entry); this.queued++;
          if (queueMs !== undefined) entry.timer = setTimeout(() => entry.abort(
            new WorkerError('WORKER_QUEUE_TIMEOUT', 'Work-pool admission timed out.')), queueMs);
          this.pump();
        }
      });
    } catch (error) { return Promise.reject(error); }
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing';
    for (const queue of [...this.waiting.values()]) for (const entry of [...queue]) entry.abort(closed());
    const running = [...this.active];
    for (const entry of running) entry.abort(new WorkerError('WORKER_NOT_READY', 'Work-pool execution is closing; reconcile any external effect.', 'unknown'));
    const closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(running.map(entry => entry.finished)), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new WorkerError('WORKER_DRAIN_TIMEOUT',
            'Work-pool shutdown could not confirm completion of running callbacks.', 'unknown')), this.shutdownGraceMs);
        })]);
        this.state = 'closed';
      } finally { clearTimeout(timer); }
    })();
    this.closeTask = closing;
    void closing.catch(() => { if (this.closeTask === closing) this.closeTask = null; });
    return closing;
  }

  private removeQueued(entry: Entry): void {
    const queue = this.waiting.get(entry.key), index = queue?.indexOf(entry) ?? -1;
    if (index < 0) return;
    queue!.splice(index, 1); this.queued--;
    if (!queue!.length) {
      this.waiting.delete(entry.key);
      const ringIndex = this.ring.indexOf(entry.key); if (ringIndex >= 0) this.ring.splice(ringIndex, 1);
    }
  }
  private pump(): void {
    if (this.state !== 'open') return;
    while (this.active.size < this.capacity && this.ring.length) {
      let found = false;
      const rounds = this.ring.length;
      for (let turn = 0; turn < rounds; turn++) {
        const key = this.ring.shift()!, queue = this.waiting.get(key)!;
        if ((this.activeKeys.get(key) ?? 0) >= this.maxPerKey) { this.ring.push(key); continue; }
        const entry = queue.shift()!; this.queued--;
        if (queue.length) this.ring.push(key); else this.waiting.delete(key);
        entry.start(); found = true; break;
      }
      if (!found) break;
    }
  }
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw invalid();
  return value;
}
function timeout(value: unknown): number | undefined { return value === undefined ? undefined : integer(value, 1, MAX_TIMEOUT_MS); }
function invalid() { return new WorkerError('WORKER_CONFIG_INVALID', 'Work-pool configuration is invalid.'); }
function closed() { return new WorkerError('WORKER_NOT_READY', 'Work-pool admission is closed.'); }
