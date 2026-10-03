/** Resource classifications for the Data Studio tenant data plane. */

import {
  allOf,
  authorizationPolicy,
  defineResource,
  tenantKindPolicy,
  tenantRealm,
} from '../resources';
import { DATA_STUDIO_READ_PERMISSION } from './data-studio-access';
import {
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

const readPolicy = allOf(
  authorizationPolicy({
    tenant: 'required',
    permission: DATA_STUDIO_READ_PERMISSION,
    credentials: ['session', 'api-key'],
  }),
  tenantKindPolicy('organization', 'administration'),
);

/**
 * Merge these definitions into createApp({ resources }). The two public
 * resources expose only lightweight authorized reconciliation metadata over
 * HTTP and Sync. Canonical schemas/values use the dedicated bounded API, and
 * every mutation must cross its command path.
 */
export const DATA_STUDIO_RESOURCES = Object.freeze([
  defineResource({
    name: 'data-studio-tables',
    table: DATA_STUDIO_TABLES_TABLE_NAME,
    primaryKey: 'table_id',
    exposure: 'all',
    realm: tenantRealm(),
    actions: ['list', 'get'],
    fields: {
      read: [
        'table_id', 'key', 'name', 'status', 'schema_revision', 'revision',
        'row_count', 'created_at', 'updated_at',
      ],
      filter: ['table_id', 'key', 'status'],
      sort: ['key', 'name', 'created_at', 'updated_at'],
    },
    policy: readPolicy,
  }),
  defineResource({
    name: 'data-studio-rows',
    table: DATA_STUDIO_ROWS_TABLE_NAME,
    primaryKey: 'record_id',
    exposure: 'all',
    realm: tenantRealm(),
    actions: ['list', 'get'],
    fields: {
      read: [
        'record_id', 'table_id', 'row_id', 'schema_revision', 'revision',
        'created_at', 'updated_at',
      ],
      filter: ['record_id', 'table_id', 'row_id'],
      sort: ['row_id', 'created_at', 'updated_at'],
    },
    policy: readPolicy,
  }),
  internalResource(DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME, 'schema_version_id'),
  internalResource(DATA_STUDIO_CELLS_TABLE_NAME, 'cell_id'),
  internalResource(DATA_STUDIO_COLUMN_STATS_TABLE_NAME, 'stat_id'),
]);

function internalResource(table: string, primaryKey: string) {
  return defineResource({
    name: table.replace(/^_/u, '').replaceAll('_', '-'),
    table,
    primaryKey,
    exposure: 'internal',
    realm: tenantRealm(),
    actions: ['list', 'get'],
    policy: readPolicy,
  });
}
