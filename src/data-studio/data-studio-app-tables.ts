/** createApp()-ready Data Studio table definitions. */

import type { ClientTableDef, TableSchema } from '../sync/types';
import { DATA_STUDIO_CLIENT_TABLES } from './data-studio-client-tables';
import {
  DATA_STUDIO_CELLS_SCHEMA,
  DATA_STUDIO_CELLS_TABLE_NAME,
  DATA_STUDIO_COLUMN_STATS_SCHEMA,
  DATA_STUDIO_COLUMN_STATS_TABLE_NAME,
  DATA_STUDIO_ROWS_SCHEMA,
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA,
  DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME,
  DATA_STUDIO_TABLES_SCHEMA,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

type DataStudioAppTable = Readonly<TableSchema> | Readonly<{
  serverTable: Readonly<TableSchema>;
  clientTable: ClientTableDef;
}>;

/**
 * Spread this catalog into `createApp({ tables })`.
 *
 * Public reconciliation tables carry their explicit full/lazy client modes;
 * private implementation tables remain server-only through their Resource
 * declarations and the platform Sync policy.
 */
export const DATA_STUDIO_APP_TABLES = Object.freeze({
  [DATA_STUDIO_TABLES_TABLE_NAME]: Object.freeze({
    serverTable: DATA_STUDIO_TABLES_SCHEMA,
    clientTable: DATA_STUDIO_CLIENT_TABLES[DATA_STUDIO_TABLES_TABLE_NAME],
  }),
  [DATA_STUDIO_ROWS_TABLE_NAME]: Object.freeze({
    serverTable: DATA_STUDIO_ROWS_SCHEMA,
    clientTable: DATA_STUDIO_CLIENT_TABLES[DATA_STUDIO_ROWS_TABLE_NAME],
  }),
  [DATA_STUDIO_SCHEMA_VERSIONS_TABLE_NAME]: DATA_STUDIO_SCHEMA_VERSIONS_SCHEMA,
  [DATA_STUDIO_CELLS_TABLE_NAME]: DATA_STUDIO_CELLS_SCHEMA,
  [DATA_STUDIO_COLUMN_STATS_TABLE_NAME]: DATA_STUDIO_COLUMN_STATS_SCHEMA,
} satisfies Readonly<Record<string, DataStudioAppTable>>);
