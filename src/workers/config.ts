/** Pure opt-in configuration. No child, temporary directory or database is opened while resolving it. */
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { ProcessWorkPool, type ProcessWorkPoolOptions } from './process-pool';
import { WorkerTaskCatalog } from './worker-task';
import { workerRecord } from './worker-value';
import { WorkerError } from './worker-error';

export type WorkersConfig = ProcessWorkPoolOptions;
export type ResolvedWorkersConfig = Readonly<ProcessWorkPoolOptions>;

export function resolveWorkersConfig(input: WorkersConfig | false | undefined, projectRoot: string,
  auth: NormalizedAuthBehaviorConfig | null): ResolvedWorkersConfig | false {
  if (input === undefined || input === false) return false;
  if (!auth) throw new WorkerError('WORKER_CONFIG_INVALID', 'Managed workers require Guardian.');
  workerRecord(input, ['tasks', 'launch', 'env', 'processes', 'maxQueued', 'queueTimeoutMs', 'executionTimeoutMs', 'startupTimeoutMs', 'shutdownGraceMs']);
  const launch = { ...workerRecord(input.launch) } as unknown as WorkersConfig['launch'];
  if ((launch.kind === 'source' || launch.kind === 'bundle') && typeof launch.entrypoint === 'string' && !isAbsolute(launch.entrypoint)) {
    (launch as { entrypoint: string }).entrypoint = resolve(projectRoot, launch.entrypoint);
  }
  const environment = input.env === undefined ? undefined : workerRecord(input.env);
  if (environment && Object.values(environment).some(value => typeof value !== 'string')) throw new WorkerError('WORKER_CONFIG_INVALID', 'Worker environment must contain strings only.');
  const result: ResolvedWorkersConfig = Object.freeze({ ...input, tasks: Object.freeze([...input.tasks]), launch: Object.freeze(launch),
    ...(environment === undefined ? {} : { env: Object.freeze({ ...environment }) as Readonly<Record<string, string>> }) });
  const catalog = new WorkerTaskCatalog(result.tasks), kernel = createAuthorizationKernel(auth);
  for (const task of catalog.list()) kernel.compile(task.access, { user: 'required', credentials: ['session'] });
  // Constructor validates capacities/launch without starting a worker. It owns
  // no timers/files until run(), so invalid configuration fails before app boot.
  new ProcessWorkPool(result);
  // Freeze alone does not freeze URL internal slots or a nested argv array.
  // Validation above rejects hostile containers before we copy those values.
  const admittedLaunch = result.launch.kind === 'command-prefix'
    ? Object.freeze({ ...result.launch, commandPrefix: Object.freeze([...result.launch.commandPrefix]) as readonly [string, ...string[]] })
    : Object.freeze({ ...result.launch, entrypoint: result.launch.entrypoint instanceof URL
      ? fileURLToPath(result.launch.entrypoint) : result.launch.entrypoint });
  return Object.freeze({ ...result, launch: admittedLaunch });
}
