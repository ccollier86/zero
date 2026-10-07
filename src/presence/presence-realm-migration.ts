/** Immutable Fabric presence001 DDL. It never imports evolving runtime schema/constants or feature configuration. */
import type { Migration } from '../migrations/types';

export const guardianPresenceRealmMigration: Migration = {
  version: 'guardian_presence_001', description: 'Guardian readonly scoped presence projection', safety: 'safe', backupRequired: false,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS guardian_presence (
      id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, user_id TEXT NOT NULL,
      status_key TEXT NOT NULL, connected INTEGER NOT NULL, revision INTEGER NOT NULL,
      owner_epoch INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_presence_scope_user ON guardian_presence(scope_kind,scope_id,user_id);
    CREATE TABLE IF NOT EXISTS guardian_presence_owner (
      owner_key TEXT PRIMARY KEY, owner_epoch INTEGER NOT NULL, fresh_until INTEGER NOT NULL, retired INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS _guardian_presence_projection_binding (
      target_key TEXT PRIMARY KEY, installation_id TEXT NOT NULL, target_id TEXT NOT NULL,
      scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, owner_epoch INTEGER NOT NULL,
      publication_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, ready INTEGER NOT NULL
    );
    CREATE VIEW IF NOT EXISTS guardian_presence_current AS
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
        LEFT JOIN guardian_presence_owner o ON o.owner_key=b.target_key`);
  },
};
