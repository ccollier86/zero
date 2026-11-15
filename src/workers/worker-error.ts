/** Stable failures from execution admission/lifecycle, never a fabricated job outcome. */
export type WorkerErrorCode = 'WORKER_CONFIG_INVALID' | 'WORKER_CAPACITY'
  | 'WORKER_NOT_READY' | 'WORKER_QUEUE_TIMEOUT' | 'WORKER_EXECUTION_TIMEOUT'
  | 'WORKER_DRAIN_TIMEOUT' | 'WORKER_TASK_INVALID' | 'WORKER_TASK_FAILED'
  | 'WORKER_START_FAILED' | 'WORKER_VERSION_MISMATCH' | 'WORKER_PROCESS_FAILED'
  | 'WORKER_AUTHORITY_CHANGED';

export class WorkerError extends Error {
  readonly name = 'WorkerError';
  constructor(readonly code: WorkerErrorCode, message: string,
    readonly outcome: 'not-started' | 'unknown' = 'not-started') {
    super(message);
  }
}
