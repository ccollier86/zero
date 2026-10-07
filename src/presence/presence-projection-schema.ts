/** Exact target schema admission on existing pinned/Fabric runtimes; no foreign migration registry. */
import type { ReactiveDB } from '../sync/reactive-db';
import { Migrator } from '../migrations/migrator';
import { guardianPresenceRealmMigration } from './presence-realm-migration';
import { PRESENCE_CURRENT_VIEW_SQL } from './presence-realm';
import { PRESENCE_PROJECTION_BINDING_SQL } from './presence-projection-store';
import { normalizePresenceSchemaSql, PRESENCE_SYSTEM_SCHEMA_OBJECTS } from './presence-schema-sql';
import { registerPresenceProjectionTables } from './presence-schema';

const objects = Object.freeze([
  ...PRESENCE_SYSTEM_SCHEMA_OBJECTS.filter(object => ['guardian_presence', 'guardian_presence_owner', 'idx_guardian_presence_scope_user'].includes(object.name)),
  { name: '_guardian_presence_projection_binding', type: 'table', sql: PRESENCE_PROJECTION_BINDING_SQL },
  { name: 'guardian_presence_current', type: 'view', sql: PRESENCE_CURRENT_VIEW_SQL },
]);

/** Real table/index/view shape, not table existence alone, is required before private publication. */
export function presenceProjectionSchemaReady(db: Pick<ReactiveDB, 'prepare'>): boolean {
  return objects.every(object => {
    const actual = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(object.name) as { type: string; sql: string | null } | null;
    return actual?.type === object.type && typeof actual.sql === 'string'
      && normalizePresenceSchemaSql(actual.sql) === normalizePresenceSchemaSql(object.sql);
  });
}

/** Fixed presence-only APPLICATION migration; migrate:false inspects without provisioning. */
export function admitPinnedPresenceProjection(db: ReactiveDB, installAllowed: boolean): boolean {
  if (!presenceProjectionSchemaReady(db) && installAllowed) {
    for (const object of objects) {
      const actual = db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(object.name) as { type: string; sql: string | null } | null;
      if (actual && (actual.type !== object.type || typeof actual.sql !== 'string'
        || normalizePresenceSchemaSql(actual.sql) !== normalizePresenceSchemaSql(object.sql))) return false;
    }
    const migrator = new Migrator({ database: db.getRawDatabase(), migrations: [guardianPresenceRealmMigration], createBackups: false, log: () => {} });
    try { migrator.run(); } finally { migrator.dispose(); }
  }
  if (!presenceProjectionSchemaReady(db)) return false;
  registerPresenceProjectionTables(db); return true;
}
