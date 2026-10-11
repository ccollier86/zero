/**
 * visualization-schema.ts
 *
 * Fixed optional visualization schemas and safe client table metadata. This
 * module declares shape only; startup admission owns migration and runtime
 * registration, and Guardian owns all client read/write decisions.
 */
import type { ClientTableDef, TableSchema } from '../sync/types';

export const VECTOR_VISUALIZATION_OPERATIONS_TABLE = 'vector_visualization_operations';
export const VECTOR_VISUALIZATION_MAPS_TABLE = '_vector_visualization_maps';
export const VECTOR_VISUALIZATION_FEED_TABLE = 'vector_visualization_feed';

/** Durable snapshots are private; authorized HTTP reads attach to one operation at a time. */
export const VECTOR_VISUALIZATION_OPERATION_SCHEMA: TableSchema = Object.freeze({
  operation_id: 'TEXT PRIMARY KEY',
  scope_id: 'TEXT NOT NULL',
  owner_user_id: 'TEXT NOT NULL',
  tenant_id: 'TEXT',
  index_name: 'TEXT NOT NULL',
  kind: 'TEXT NOT NULL',
  status: 'TEXT NOT NULL',
  revision: 'INTEGER NOT NULL',
  snapshot_json: 'TEXT NOT NULL',
  created_at: 'TEXT NOT NULL',
  updated_at: 'TEXT NOT NULL',
});

/** Projection artifacts and sample identity are never generic client data. */
export const VECTOR_VISUALIZATION_MAP_SCHEMA: TableSchema = Object.freeze({
  map_id: 'TEXT PRIMARY KEY',
  scope_id: 'TEXT NOT NULL',
  index_name: 'TEXT NOT NULL',
  revision: 'INTEGER NOT NULL',
  projection_json: 'TEXT NOT NULL',
  snapshot_json: 'TEXT NOT NULL',
  updated_at: 'TEXT NOT NULL',
});

/** One bounded, opaque change signal per owner/scope/index/kind; never includes operation content. */
export const VECTOR_VISUALIZATION_FEED_SCHEMA: TableSchema = Object.freeze({
  feed_id: 'TEXT PRIMARY KEY',
  scope_id: 'TEXT NOT NULL',
  owner_user_id: 'TEXT NOT NULL',
  tenant_id: 'TEXT',
  index_name: 'TEXT NOT NULL',
  kind: 'TEXT NOT NULL',
  change_token: 'TEXT NOT NULL',
  updated_at: 'TEXT NOT NULL',
});

/** Only metadata signals use SYSTEM Sync; retained snapshots/projections are never baseline data. */
export const VECTOR_VISUALIZATION_CLIENT_TABLES: Readonly<Record<string, ClientTableDef>> = Object.freeze({
  [VECTOR_VISUALIZATION_FEED_TABLE]: Object.freeze({
    _pk: 'feed_id', _sync: 'full', feed_id: 'string', scope_id: 'string',
    owner_user_id: 'string', tenant_id: 'string', index_name: 'string', kind: 'string',
    change_token: 'string', updated_at: 'string',
  }),
});
