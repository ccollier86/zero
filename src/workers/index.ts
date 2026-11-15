/** Trusted execution primitives. Pools do not confer Guardian authority or durable acceptance. */
export { WorkPool, DEFAULT_WORK_POOL_CAPACITY, type WorkPoolOptions, type WorkPoolRunOptions, type WorkPoolStatus } from './work-pool';
export { WorkerError, type WorkerErrorCode } from './worker-error';
export { defineWorkerTask, WorkerTaskCatalog, type WorkerTaskDefinition, type WorkerTask } from './worker-task';
export { ProcessWorkPool, type ProcessWorkPoolOptions } from './process-pool';
export { runWorkerIfRequested } from './worker-bootstrap';
export { type WorkerValue } from './worker-value';
export { WorkerService, type ScopedWorkers, type ScopedWorkerRunOptions } from './service';
export { type WorkersConfig, type ResolvedWorkersConfig } from './config';
