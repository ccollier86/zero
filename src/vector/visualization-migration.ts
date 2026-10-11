/**
 * Immutable optional SYSTEM-plane schema, shared by fixed-schema admission and
 * deliberate manual provisioning. Managed apps apply the handler transactionally
 * without adding a foreign version to the core migration ledger.
 */
import type { Migration } from '../migrations/types';

/** Canonical fixed DDL; admission inspects these same objects before and after installation. */
export const VECTOR_VISUALIZATION_SCHEMA_OBJECTS = Object.freeze([
  { name: 'vector_visualization_operations', type: 'table', sql: `CREATE TABLE vector_visualization_operations (
    operation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    tenant_id TEXT, index_name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` },
  { name: 'idx_vector_visualization_owner', type: 'index', sql: 'CREATE INDEX idx_vector_visualization_owner ON vector_visualization_operations(scope_id,owner_user_id,index_name,updated_at)' },
  { name: '_vector_visualization_maps', type: 'table', sql: `CREATE TABLE _vector_visualization_maps (
    map_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, index_name TEXT NOT NULL,
    revision INTEGER NOT NULL, projection_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL)` },
  { name: 'vector_visualization_feed', type: 'table', sql: `CREATE TABLE vector_visualization_feed (
    feed_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    tenant_id TEXT, index_name TEXT NOT NULL, kind TEXT NOT NULL,
    change_token TEXT NOT NULL, updated_at TEXT NOT NULL)` },
] as const);

/**
 * Do not run a one-entry Migrator against a managed SYSTEM core ledger. Use
 * admitVectorVisualizationSchema() for normal bootstrap/manual provisioning;
 * this descriptor exists for hosts that explicitly own a complete registry.
 */
export const vectorVisualizationMigration: Migration = {
  version: 'vector_visualization_001', description: 'Scoped vector operation snapshots and private stable projections', safety: 'safe', backupRequired: false,
  up(db) {
    for (const object of VECTOR_VISUALIZATION_SCHEMA_OBJECTS) {
      db.exec(object.sql.replace(/^CREATE (TABLE|INDEX)/u, 'CREATE $1 IF NOT EXISTS'));
    }
  },
};
