/** SYSTEM stores only the private Fabric ownership catalog and Storage namespace, never message bodies. */
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
export const MESSAGING_OWNER_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS _messaging_owners (id TEXT PRIMARY KEY,scope_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL,root_hash TEXT NOT NULL,realm_fingerprint TEXT NOT NULL,established INTEGER NOT NULL CHECK(established IN (0,1)))',
  'CREATE TABLE IF NOT EXISTS _messaging_storage (id INTEGER PRIMARY KEY CHECK(id=1),drive_id TEXT NOT NULL UNIQUE)',
] as const;
const normalize = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
/** Inspection never creates metadata; a schema collision never becomes an empty replacement. */
export function inspectMessagingOwnerSchema(db: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  let missing = false;
  for (const [index, name] of ['_messaging_owners', '_messaging_storage'].entries()) {
    const row = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(name) as { type: string; sql: string } | null;
    if (!row) missing = true; else if (row.type !== 'table' || !row.sql || normalize(row.sql) !== normalize(MESSAGING_OWNER_SCHEMA[index]!)) return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}
export function installMessagingOwnerSchema(db: ReactiveDB, allowed: boolean): boolean {
  const state = inspectMessagingOwnerSchema(db);
  if (state === 'invalid') throw new AuthError('Messaging ownership metadata is incompatible.', 'MESSAGING_STATE_INVALID', 500);
  if (allowed) for (const statement of MESSAGING_OWNER_SCHEMA) db.exec(statement);
  return state === 'ready' || allowed;
}
