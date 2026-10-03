/** Browser Sync definitions for Data Studio's public reconciliation plane. */

import type { ClientTableDef } from '../sync/types';
import {
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

/**
 * Spread these lightweight definitions into a browser client's table catalog
 * when live Data Studio reconciliation is desired. Canonical schemas and row
 * values stay on the dedicated byte-bounded API; mutations are command-only.
 */
export const DATA_STUDIO_CLIENT_TABLES = Object.freeze({
  [DATA_STUDIO_TABLES_TABLE_NAME]: Object.freeze({
    _pk: 'table_id',
    _sync: 'full',
    table_id: 'text',
    key: 'text',
    name: 'text',
    status: 'text',
    schema_revision: 'integer',
    revision: 'integer',
    row_count: 'integer',
    created_at: 'integer',
    updated_at: 'integer',
  }),
  [DATA_STUDIO_ROWS_TABLE_NAME]: Object.freeze({
    _pk: 'record_id',
    _sync: 'lazy',
    record_id: 'text',
    table_id: 'text',
    row_id: 'text',
    schema_revision: 'integer',
    revision: 'integer',
    created_at: 'integer',
    updated_at: 'integer',
  }),
} satisfies Record<string, ClientTableDef>);
