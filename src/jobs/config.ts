/** Pure opt-in managed configuration. No schema, actor, pool timer or provider is opened here. */
import { createAuthorizationKernel, type AccessRequirement } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { JobDefinitionCatalog, type JobDefinition } from './definition';
import { resolveJobsPersistenceConfig, type JobsPersistenceConfig, type ResolvedJobsPersistenceConfig } from './persistence-config';
import { JobsError } from './error';
import { jobInput, jobInteger, jobRecord } from './validation';

export interface JobsConfig extends JobsPersistenceConfig {
  readonly definitions?: readonly JobDefinition[];
  /** Omitted uses native scope management: platform admin in single mode, owner/declared jobs:manage in tenant mode. */
  readonly manage?: AccessRequirement;
  readonly batchSize?: number;
}
export interface ResolvedJobsConfig extends ResolvedJobsPersistenceConfig {
  readonly catalog: JobDefinitionCatalog; readonly manage: AccessRequirement | null; readonly batchSize: number;
}
export function resolveJobsConfig(input: JobsConfig | boolean | undefined, root: string, auth: NormalizedAuthBehaviorConfig | null, workflows: boolean): ResolvedJobsConfig | false {
  if (input === undefined || input === false) return false;
  try {
    if (!auth || !workflows) throw new JobsError('JOBS_CONFIG_INVALID');
    const r = input === true ? {} : jobRecord(input, ['definitions', 'manage', 'batchSize', 'rootDirectory', 'actors', 'maxActiveDatabases', 'maxDatabaseFiles', 'concurrency', 'capacity']);
    const catalog = new JobDefinitionCatalog((r.definitions ?? []) as readonly JobDefinition[]), kernel = createAuthorizationKernel(auth);
    for (const definition of catalog.list()) kernel.compile(definition.access, { user: 'required', credentials: ['session'] });
    const manage = r.manage === undefined ? null : jobInput(r.manage) as AccessRequirement;
    if (manage !== null) kernel.compile(manage, { user: 'required', credentials: ['session'] });
    const persistence = Object.fromEntries(['rootDirectory', 'actors', 'maxActiveDatabases', 'maxDatabaseFiles', 'concurrency', 'capacity'].filter(key => r[key] !== undefined).map(key => [key, r[key]]));
    return Object.freeze({ ...resolveJobsPersistenceConfig(persistence, root), catalog, manage,
      batchSize: jobInteger(r.batchSize ?? 32, 1, 100) });
  } catch { throw new JobsError('JOBS_CONFIG_INVALID'); }
}
