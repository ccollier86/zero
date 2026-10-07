/** Side-effect-free Fabric contribution: private tracked projection plus actual readonly SQL/query source. */
import { defineDatabaseRealmContribution } from '../databases/database-realm-contribution';
import type { DatabaseReadQueryContext, DatabaseRealm } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { DatabaseError } from '../databases/database-error';
import { guardianPresenceRealmMigration } from './presence-realm-migration';

export const PRESENCE_REALM_QUERY = 'guardian.presence.current';
/** SQL clients join this view, not an unfenced persisted status string. */
export const PRESENCE_CURRENT_VIEW_SQL = `CREATE VIEW IF NOT EXISTS guardian_presence_current AS
  SELECT p.id,p.scope_kind,p.scope_id,p.user_id,
    CASE WHEN b.ready=1 AND o.retired=0 AND p.owner_epoch=o.owner_epoch AND o.fresh_until>unixepoch('subsec')*1000
      THEN p.status_key ELSE 'offline' END AS status_key,
    CASE WHEN b.ready=1 AND o.retired=0 AND p.owner_epoch=o.owner_epoch AND o.fresh_until>unixepoch('subsec')*1000
      THEN p.connected ELSE 0 END AS connected,
    p.revision,p.owner_epoch,p.updated_at,coalesce(o.fresh_until,0) AS fresh_until,
    CASE WHEN b.ready=1 AND o.retired=0 AND p.owner_epoch=o.owner_epoch AND o.fresh_until>unixepoch('subsec')*1000
      THEN 0 ELSE 1 END AS stale
  FROM guardian_presence p LEFT JOIN _guardian_presence_projection_binding b
    ON b.scope_kind=p.scope_kind AND b.scope_id=p.scope_id
    LEFT JOIN guardian_presence_owner o ON o.owner_key=b.target_key`;

/** Include identically in gateway and actor realm; retain the contribution when the runtime feature is disabled. */
export function guardianPresenceRealmContribution() {
  return defineDatabaseRealmContribution({ name: 'guardian-presence', version: '1', tables: {},
    migrations: [guardianPresenceRealmMigration],
    queries: { [PRESENCE_REALM_QUERY]: readGuardianPresenceCurrent },
  });
}

/** Admission checks an exact framework handler, not a guessed table or a gateway-only contribution. */
export function hasGuardianPresenceRealm(realm: DatabaseRealm): boolean {
  return realm.queries[PRESENCE_REALM_QUERY] === readGuardianPresenceCurrent
    && realm.migrations.some(migration => migration.version === 'guardian_presence_001');
}

/** Pure bounded actor-local SELECT. Client input cannot select another realm, owner, or trusted time. */
export function readGuardianPresenceCurrent(context: DatabaseReadQueryContext, input: DatabaseSerializableValue): DatabaseSerializableValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['limit', 'after'].includes(key))) throw invalidInput();
  const record = input as { limit?: unknown; after?: unknown }, limit = record.limit === undefined ? 100 : record.limit;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 500
    || record.after !== undefined && (typeof record.after !== 'string' || record.after.length > 300)) throw invalidInput();
  const rows = context.database.query(`SELECT id,user_id,status_key,connected,revision,owner_epoch,updated_at,fresh_until,stale
    FROM guardian_presence_current WHERE id>? ORDER BY id LIMIT ?`).all(record.after ?? '', limit as number) as Record<string, unknown>[];
  return rows.map(row => ({ id: row.id, userId: row.user_id, status: row.status_key, connected: row.connected === 1,
    revision: row.revision, ownerEpoch: row.owner_epoch, updatedAt: row.updated_at,
    freshUntil: row.fresh_until, stale: row.stale === 1 })) as DatabaseSerializableValue;
}
function invalidInput() { return new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Presence read input is invalid.'); }
