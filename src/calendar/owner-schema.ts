/** Conditional SYSTEM ownership catalog only; calendar domain records remain in private Fabric files. */
import type { ReactiveDB } from '../sync/reactive-db';
import { CalendarError } from './error';

export interface CalendarOwnerRecord {
  readonly id: string;
  readonly scope_id: string;
  readonly owner_id: string;
  readonly root_hash: string;
  readonly realm_fingerprint: string;
  readonly established: number;
}

export const CALENDAR_OWNER_SCHEMA = 'CREATE TABLE IF NOT EXISTS _calendar_owners (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)))';

const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();

/** Read-only admission shared with future startup/Doctor; incompatible retained metadata is never replaced. */
export function inspectCalendarOwnerSchema(database: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  // SQLite identifiers are case-insensitive; a differently cased collision must not look missing.
  const row = database.prepare('SELECT type,sql FROM sqlite_master WHERE name=? COLLATE NOCASE').get('_calendar_owners') as { type: string; sql: string | null } | null;
  return !row ? 'missing' : row.type === 'table' && row.sql && normalize(row.sql) === normalize(CALENDAR_OWNER_SCHEMA) ? 'ready' : 'invalid';
}

/** Explicit additive installation only. migrate:false may inspect, but never provisions a missing owner catalog. */
export function installCalendarOwnerSchema(database: Pick<ReactiveDB, 'prepare' | 'exec'>, installAllowed: boolean): boolean {
  const state = inspectCalendarOwnerSchema(database);
  if (state === 'invalid') throw new CalendarError('CALENDAR_STATE_INVALID');
  if (state === 'missing' && installAllowed === true) database.exec(CALENDAR_OWNER_SCHEMA);
  return state === 'ready' || installAllowed === true;
}
