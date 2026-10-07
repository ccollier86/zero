/** Inspect/install fixed private SYSTEM profile storage; never repair a colliding schema. */

import type { ReactiveDB } from '../sync/reactive-db';
import { USER_PROFILE_REVISION_COLUMN, USER_PROFILE_SCHEMA_OBJECTS } from './auth-user-profile-schema-sql';

export type AuthUserProfileSchemaStatus = 'ready' | 'missing' | 'invalid';

/** Exact admission applies on every store access, including cached service consumers. */
export function inspectUserProfileSchema(db: Pick<ReactiveDB, 'prepare'>): AuthUserProfileSchemaStatus {
  const users = db.prepare('PRAGMA table_info(users)').all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null;
  }>;
  const revision = users.find((column) => column.name === 'profile_revision');
  if (revision && (revision.type.toUpperCase() !== 'INTEGER' || revision.notnull !== 1
    || revision.dflt_value !== '1')) return 'invalid';
  if (revision) {
    const usersDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string } | null;
    if (!usersDefinition || !normalizeSql(usersDefinition.sql).toUpperCase().includes(
      `PROFILE_REVISION ${USER_PROFILE_REVISION_COLUMN}`.toUpperCase(),
    )) return 'invalid';
  }
  let missing = !revision;
  for (const object of USER_PROFILE_SCHEMA_OBJECTS) {
    const actual = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(object.name) as {
      type: string; sql: string | null;
    } | null;
    if (!actual) { missing = true; continue; }
    if (actual.type !== object.type || actual.sql === null
      || normalizeSql(actual.sql) !== normalizeSql(object.sql)) return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}

/** Fixed DDL is transactional/idempotent; forbidden or incompatible installs remain unready. */
export function reconcileUserProfileSchema(db: ReactiveDB, installAllowed: boolean): AuthUserProfileSchemaStatus {
  const status = inspectUserProfileSchema(db);
  if (status !== 'missing' || !installAllowed) return status;
  return db.transaction(() => {
    const current = inspectUserProfileSchema(db);
    if (current !== 'missing') return current;
    const columns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'profile_revision')) {
      db.exec(`ALTER TABLE users ADD COLUMN profile_revision ${USER_PROFILE_REVISION_COLUMN}`);
    }
    for (const object of USER_PROFILE_SCHEMA_OBJECTS) db.exec(object.sql);
    return inspectUserProfileSchema(db);
  });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
}
