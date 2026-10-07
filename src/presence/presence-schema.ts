/** Fixed presence schema contracts; registration reuses admitted ReactiveDB, never opens another handle. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { TableSchema } from '../sync/types';
import { PRESENCE_TABLE, PRESENCE_OWNER_TABLE } from './presence-client-tables';
export { PRESENCE_CLIENT_TABLES, PRESENCE_TABLE, PRESENCE_OWNER_TABLE } from './presence-client-tables';
import { presenceError } from './presence-error';
import { normalizePresenceSchemaSql, PRESENCE_SYSTEM_SCHEMA_OBJECTS } from './presence-schema-sql';

export const PRESENCE_PROJECTION_SCHEMAS: Readonly<Record<string, TableSchema>> = Object.freeze({
  [PRESENCE_TABLE]: Object.freeze({
    id: 'text primary key', scope_kind: 'text not null', scope_id: 'text not null', user_id: 'text not null',
    status_key: 'text not null', connected: 'integer not null', revision: 'integer not null',
    owner_epoch: 'integer not null', updated_at: 'integer not null',
  }),
  [PRESENCE_OWNER_TABLE]: Object.freeze({
    owner_key: 'text primary key', owner_epoch: 'integer not null', fresh_until: 'integer not null', retired: 'integer not null',
  }),
});
export const PRESENCE_PRIVATE_TABLES = Object.freeze([
  '_guardian_presence_authority', '_guardian_presence_intents', '_guardian_presence_outbox',
]);

/** Inspection is read-only and never silently provisions a file opened with migrate:false. */
export function presenceSystemSchemaReady(db: Pick<ReactiveDB, 'prepare'>): boolean {
  for (const object of PRESENCE_SYSTEM_SCHEMA_OBJECTS) {
    const actual = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(object.name) as { type: string; sql: string | null } | null;
    if (!actual || actual.type !== object.type || actual.sql === null
      || normalizePresenceSchemaSql(actual.sql) !== normalizePresenceSchemaSql(object.sql)) return false;
  }
  return true;
}

/** Register already-installed canonical tables with the owning ReactiveDB change log. */
export function registerPresenceProjectionTables(db: ReactiveDB): void {
  for (const [table, schema] of Object.entries(PRESENCE_PROJECTION_SCHEMAS)) {
    const installed = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    if (installed.map(column => column.name).sort().join(',') !== Object.keys(schema).sort().join(',')) {
      throw presenceError('AUTH_PRESENCE_PROJECTION_INVALID');
    }
    db.defineTable(table, schema);
  }
}

/** Explicit admitted SYSTEM installer; never repairs a colliding object or runs for migrate:false file storage. */
export function reconcilePresenceSystemSchema(db: ReactiveDB, installAllowed: boolean): boolean {
  if (presenceSystemSchemaReady(db) || !installAllowed) return presenceSystemSchemaReady(db);
  for (const object of PRESENCE_SYSTEM_SCHEMA_OBJECTS) {
    const actual = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(object.name) as { type: string; sql: string | null } | null;
    if (actual && (actual.type !== object.type || actual.sql === null
      || normalizePresenceSchemaSql(actual.sql) !== normalizePresenceSchemaSql(object.sql))) return false;
  }
  db.transaction(() => { for (const object of PRESENCE_SYSTEM_SCHEMA_OBJECTS) db.exec(object.sql); });
  return presenceSystemSchemaReady(db);
}
