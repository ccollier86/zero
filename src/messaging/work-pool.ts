/** Bounded concurrent I/O, not a serialized automation handler. No database lease is retained while waiting here. */
import { AuthError } from '../auth/types';
import { WorkPool } from '../workers/work-pool';
import { WorkerError } from '../workers/worker-error';
export class MessagingWorkPool {
  private readonly pool: WorkPool;
  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) throw new Error('Invalid messaging work-pool capacity.');
    this.pool = new WorkPool({ concurrency: capacity, maxQueued: 100 });
  }
  get size(): number { return this.pool.size; }
  run<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.pool.run(work, { signal }).catch(error => { throw messagingFailure(error); });
  }
  close(): Promise<void> {
    return this.pool.close().catch(error => { throw messagingFailure(error); });
  }
}
function unavailable() { return new AuthError('Messaging work-pool admission is closed.', 'MESSAGING_NOT_READY', 503); }
function messagingFailure(error: unknown): unknown {
  if (!(error instanceof WorkerError)) return error;
  if (error.code === 'WORKER_CAPACITY') return new AuthError('Messaging work-pool admission is exhausted.', 'MESSAGING_CAPACITY', 429);
  if (error.code === 'WORKER_NOT_READY' || error.code === 'WORKER_DRAIN_TIMEOUT') return unavailable();
  return error;
}
