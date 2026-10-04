/** Add the durable system-plane catalog used for automation source recovery. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '037',
  description: 'ReactiveDB durable automation source catalog',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep this numbered definition self-contained and immutable. Runtime
    // schema helpers may evolve after this migration has been released.
    db.exec(`CREATE TABLE _zero_database_automation_sources_v1 (
      source_ref TEXT PRIMARY KEY CHECK (
        length(source_ref) = 64
        AND source_ref NOT GLOB '*[^a-f0-9]*'
      ),
      source_kind TEXT NOT NULL CHECK (
        source_kind IN ('application', 'tenant', 'named')
      ),
      logical_source_id TEXT NOT NULL CHECK (
        length(CAST(logical_source_id AS BLOB)) BETWEEN 1 AND 256
      ),
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application', 'tenant')),
      scope_id TEXT NOT NULL CHECK (
        length(CAST(scope_id AS BLOB)) BETWEEN 1 AND 256
      ),
      tenant_id TEXT CHECK (
        tenant_id IS NULL
        OR length(CAST(tenant_id AS BLOB)) BETWEEN 1 AND 256
      ),
      lifecycle_status TEXT NOT NULL CHECK (
        lifecycle_status IN ('active', 'disabled')
      ),
      source_revision INTEGER NOT NULL CHECK (
        source_revision BETWEEN 1 AND 9007199254740991
      ),
      insertion_ordinal INTEGER NOT NULL UNIQUE CHECK (
        insertion_ordinal BETWEEN 1 AND 100000
      ),
      registered_at INTEGER NOT NULL CHECK (
        registered_at BETWEEN 0 AND 9007199254740991
      ),
      updated_at INTEGER NOT NULL CHECK (
        updated_at BETWEEN registered_at AND 9007199254740991
      ),
      schema_version INTEGER NOT NULL CHECK (
        schema_version = 1
      ),
      CHECK (
        (
          source_kind = 'application'
          AND logical_source_id = 'application'
          AND scope_kind = 'application'
          AND scope_id = 'application'
          AND tenant_id IS NULL
        )
        OR (
          source_kind = 'named'
          AND scope_kind = 'application'
          AND scope_id = 'application'
          AND tenant_id IS NULL
        )
        OR (
          source_kind = 'tenant'
          AND scope_kind = 'tenant'
          AND tenant_id IS NOT NULL
          AND scope_id = tenant_id
          AND logical_source_id = tenant_id
        )
      )
    ) STRICT, WITHOUT ROWID`);
    db.exec(`CREATE TABLE _zero_database_automation_source_catalog_state_v1 (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL CHECK (
        schema_version = 1
      ),
      total_sources INTEGER NOT NULL CHECK (
        total_sources BETWEEN 0 AND 100000
      ),
      last_ordinal INTEGER NOT NULL CHECK (
        last_ordinal BETWEEN 0 AND 100000
      ),
      catalog_revision INTEGER NOT NULL CHECK (
        catalog_revision BETWEEN 0 AND 9007199254740991
      ),
      CHECK (
        (total_sources = 0 AND last_ordinal = 0 AND catalog_revision = 0)
        OR (total_sources > 0 AND last_ordinal >= total_sources
          AND catalog_revision >= total_sources)
      )
    ) STRICT, WITHOUT ROWID`);
    db.exec(`INSERT INTO _zero_database_automation_source_catalog_state_v1 (
      singleton, schema_version, total_sources, last_ordinal, catalog_revision
    ) VALUES (1, 1, 0, 0, 0)`);
    db.exec(`CREATE UNIQUE INDEX _zero_database_automation_sources_logical_v1
      ON _zero_database_automation_sources_v1
      (source_kind, logical_source_id)`);
    db.exec(`CREATE INDEX _zero_database_automation_sources_scan_v1
      ON _zero_database_automation_sources_v1
      (lifecycle_status, insertion_ordinal, source_ref)`);
    db.exec(`CREATE TRIGGER _zero_database_automation_sources_insert_guard_v1
      BEFORE INSERT ON _zero_database_automation_sources_v1
      WHEN (SELECT count(*)
            FROM _zero_database_automation_source_catalog_state_v1
            WHERE singleton = 1) != 1
        OR (SELECT total_sources
            FROM _zero_database_automation_source_catalog_state_v1
            WHERE singleton = 1) >= 100000
        OR NEW.insertion_ordinal != (
          SELECT last_ordinal + 1
          FROM _zero_database_automation_source_catalog_state_v1
          WHERE singleton = 1
        )
        OR NEW.source_revision != 1
        OR NEW.registered_at != NEW.updated_at
      BEGIN
        SELECT RAISE(ABORT, 'zero automation source catalog admission rejected');
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_sources_insert_state_v1
      AFTER INSERT ON _zero_database_automation_sources_v1
      BEGIN
        UPDATE _zero_database_automation_source_catalog_state_v1
        SET
          total_sources = total_sources + 1,
          last_ordinal = NEW.insertion_ordinal,
          catalog_revision = catalog_revision + 1
        WHERE singleton = 1;
        SELECT CASE WHEN changes() != 1
          THEN RAISE(ABORT, 'zero automation source catalog state unavailable') END;
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_sources_update_guard_v1
      BEFORE UPDATE ON _zero_database_automation_sources_v1
      WHEN NOT (
        NEW.source_ref IS OLD.source_ref
        AND NEW.source_kind IS OLD.source_kind
        AND NEW.logical_source_id IS OLD.logical_source_id
        AND NEW.scope_kind IS OLD.scope_kind
        AND NEW.scope_id IS OLD.scope_id
        AND NEW.tenant_id IS OLD.tenant_id
        AND NEW.lifecycle_status != OLD.lifecycle_status
        AND NEW.source_revision = OLD.source_revision + 1
        AND NEW.insertion_ordinal IS OLD.insertion_ordinal
        AND NEW.registered_at IS OLD.registered_at
        AND NEW.updated_at >= OLD.updated_at
        AND NEW.schema_version IS OLD.schema_version
      )
      BEGIN
        SELECT RAISE(ABORT, 'zero automation source identity is immutable');
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_sources_update_state_v1
      AFTER UPDATE ON _zero_database_automation_sources_v1
      BEGIN
        UPDATE _zero_database_automation_source_catalog_state_v1
        SET catalog_revision = catalog_revision + 1
        WHERE singleton = 1;
        SELECT CASE WHEN changes() != 1
          THEN RAISE(ABORT, 'zero automation source catalog state unavailable') END;
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_sources_delete_guard_v1
      BEFORE DELETE ON _zero_database_automation_sources_v1
      BEGIN
        SELECT RAISE(ABORT, 'zero automation source identities are permanent');
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_source_state_update_guard_v1
      BEFORE UPDATE ON _zero_database_automation_source_catalog_state_v1
      WHEN NOT (
        NEW.singleton IS OLD.singleton
        AND NEW.schema_version IS OLD.schema_version
        AND NEW.total_sources = (
          SELECT count(*) FROM _zero_database_automation_sources_v1
        )
        AND NEW.last_ordinal = coalesce((
          SELECT max(insertion_ordinal)
          FROM _zero_database_automation_sources_v1
        ), 0)
        AND NEW.catalog_revision = coalesce((
          SELECT sum(source_revision)
          FROM _zero_database_automation_sources_v1
        ), 0)
        AND NEW.catalog_revision = OLD.catalog_revision + 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'zero automation source catalog state is invalid');
      END`);
    db.exec(`CREATE TRIGGER _zero_database_automation_source_state_delete_guard_v1
      BEFORE DELETE ON _zero_database_automation_source_catalog_state_v1
      BEGIN
        SELECT RAISE(ABORT, 'zero automation source catalog state is permanent');
      END`);
  },

  down(db: Database) {
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_source_state_delete_guard_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_source_state_update_guard_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_sources_delete_guard_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_sources_update_state_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_sources_update_guard_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_sources_insert_state_v1');
    db.exec('DROP TRIGGER IF EXISTS _zero_database_automation_sources_insert_guard_v1');
    db.exec('DROP INDEX IF EXISTS _zero_database_automation_sources_scan_v1');
    db.exec('DROP INDEX IF EXISTS _zero_database_automation_sources_logical_v1');
    db.exec('DROP TABLE IF EXISTS _zero_database_automation_source_catalog_state_v1');
    db.exec('DROP TABLE IF EXISTS _zero_database_automation_sources_v1');
  },
};
