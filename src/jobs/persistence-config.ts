/** Private persistence composition, not yet managed AppConfig. Pure resolution opens no feature files or actors. */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions } from '../databases/subprocess-database-executor-factory';
import { JobsError } from './error';
import { jobInteger, jobRecord } from './validation';

export interface JobsPersistenceConfig {
  rootDirectory?: string;
  actors?: Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
  maxActiveDatabases?: number;
  maxDatabaseFiles?: number;
  concurrency?: number | 'max';
}
export interface ResolvedJobsPersistenceConfig {
  readonly rootDirectory: string; readonly createExecutor: SubprocessDatabaseExecutorFactory; readonly defaultActorEntrypoint: string | null;
  readonly maxActiveDatabases: number; readonly maxDatabaseFiles: number; readonly concurrency: number;
}
export function resolveJobsPersistenceConfig(input: JobsPersistenceConfig, projectRoot: string): ResolvedJobsPersistenceConfig {
  try {
    const r = jobRecord(input, ['rootDirectory', 'actors', 'maxActiveDatabases', 'maxDatabaseFiles', 'concurrency']);
    if (r.rootDirectory !== undefined && (typeof r.rootDirectory !== 'string' || !r.rootDirectory.trim() || r.rootDirectory.includes('\0'))) throw new JobsError('JOBS_CONFIG_INVALID');
    const adjacent = fileURLToPath(new URL('./actor-entry.ts', import.meta.url));
    let entry = adjacent;
    if (!existsSync(entry)) try { entry = join(dirname(Bun.resolveSync('@zero/framework/jobs/server', projectRoot)), 'actor-entry.ts'); } catch { /* Open reports a closed not-ready failure; never start the app entry. */ }
    const actors = r.actors === undefined ? { launch: { kind: 'source' as const, entrypoint: entry }, env: {} }
      : jobRecord(r.actors, ['launch', 'env', 'executor']);
    const maxActiveDatabases = jobInteger(r.maxActiveDatabases ?? 4, 1, 64);
    return Object.freeze({ rootDirectory: resolve(projectRoot, r.rootDirectory as string ?? 'data/zero.jobs'),
      createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: '--zero-jobs-actor' } as unknown as SubprocessDatabaseExecutorFactoryOptions),
      defaultActorEntrypoint: r.actors === undefined ? entry : null, maxActiveDatabases,
      maxDatabaseFiles: jobInteger(r.maxDatabaseFiles ?? 1000, maxActiveDatabases, 10_000),
      concurrency: r.concurrency === undefined || r.concurrency === 'max' ? 100 : jobInteger(r.concurrency, 1, 100) });
  } catch { throw new JobsError('JOBS_CONFIG_INVALID'); }
}
