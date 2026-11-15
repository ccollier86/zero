/** Conditional SYSTEM catalog only; inputs, schedules and occurrences live in private Fabric files. */
import type { ReactiveDB } from '../sync/reactive-db';
import { JobsError } from './error';
export const JOBS_OWNER_SCHEMA = 'CREATE TABLE IF NOT EXISTS _jobs_owners (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)),wake_at INTEGER,wake_generation INTEGER NOT NULL CHECK(wake_generation>=0))';
const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
export function inspectJobsOwnerSchema(database: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  const row = database.prepare("SELECT type,sql FROM sqlite_master WHERE name='_jobs_owners'").get() as { type: string; sql: string } | null;
  return !row ? 'missing' : row.type === 'table' && row.sql && normalize(row.sql) === normalize(JOBS_OWNER_SCHEMA) ? 'ready' : 'invalid';
}
export function installJobsOwnerSchema(database: ReactiveDB, allowed: boolean): boolean {
  const state = inspectJobsOwnerSchema(database);
  if (state === 'invalid') throw new JobsError('JOBS_STATE_INVALID');
  if (allowed && state === 'missing') database.exec(JOBS_OWNER_SCHEMA);
  if (allowed) database.exec('CREATE INDEX IF NOT EXISTS jobs_owner_due ON _jobs_owners(established,wake_at,id)');
  return state === 'ready' || allowed;
}
