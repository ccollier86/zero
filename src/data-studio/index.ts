/**
 * index.ts
 *
 * Collects the shared Data Studio domain foundation without importing routes,
 * runtime services, UI, or persistence side effects.
 */

export {
  DATA_STUDIO_COLUMN_TYPES,
  DATA_STUDIO_CELL_VALUE_TYPES,
  DATA_STUDIO_MAX_COLLECTION_ENTRIES,
  DATA_STUDIO_MAX_COLUMN_DESCRIPTION_LENGTH,
  DATA_STUDIO_MAX_COLUMN_ID_LENGTH,
  DATA_STUDIO_MAX_COLUMN_KEY_LENGTH,
  DATA_STUDIO_MAX_COLUMN_LABEL_LENGTH,
  DATA_STUDIO_MAX_COLUMNS,
  DATA_STUDIO_MAX_SCHEMA_BYTES,
  DATA_STUDIO_MAX_ROW_VALUES_BYTES,
  DATA_STUDIO_MAX_TABLE_KEY_LENGTH,
  DATA_STUDIO_MAX_VALUE_BYTES,
  DATA_STUDIO_MAX_VALUE_DEPTH,
  DATA_STUDIO_MAX_VALUE_NODES,
  DATA_STUDIO_SCHEMA_VERSION,
  DATA_STUDIO_TABLE_STATUSES,
} from './data-studio-contracts';
export type {
  DataStudioCell,
  DataStudioCellEncoding,
  DataStudioCellInput,
  DataStudioColumn,
  DataStudioColumnType,
  DataStudioCellValueType,
  DataStudioRevisionInput,
  DataStudioRow,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
  DataStudioValue,
} from './data-studio-contracts';

export {
  normalizeDataStudioSchema,
  normalizeDataStudioRowValues,
  normalizeDataStudioStoredRowValues,
  normalizeDataStudioValue,
  normalizeDataStudioValueForColumn,
  parseDataStudioSchema,
  parseDataStudioRowValues,
  parseDataStudioValue,
  serializeDataStudioSchema,
  serializeDataStudioRowValues,
  serializeDataStudioValue,
  encodeDataStudioCellValue,
} from './data-studio-codec';

export {
  DATA_STUDIO_ERROR_CODES,
  DataStudioError,
  isDataStudioError,
  isDataStudioErrorCode,
  normalizeDataStudioError,
} from './data-studio-error';
export type {
  DataStudioErrorCode,
  DataStudioErrorDetails,
  DataStudioErrorDetailValue,
  DataStudioErrorOptions,
  DataStudioOperationOutcome,
} from './data-studio-error';

export {
  dataStudioOutcomeRequiresSameIdempotencyKey,
  toDataStudioHttpFailure,
} from './data-studio-http-error';
export type {
  DataStudioHttpFailure,
  DataStudioHttpOperation,
} from './data-studio-http-error';

export {
  DATA_STUDIO_EDITOR_ROLE_FRAGMENT,
  DATA_STUDIO_MANAGER_ROLE_FRAGMENT,
  DATA_STUDIO_MANAGE_PERMISSION,
  DATA_STUDIO_PERMISSION_REGISTRY,
  DATA_STUDIO_READ_PERMISSION,
  DATA_STUDIO_ROLE_FRAGMENTS,
  DATA_STUDIO_VIEWER_ROLE_FRAGMENT,
  DATA_STUDIO_WRITE_PERMISSION,
} from './data-studio-access';

export {
  DATA_STUDIO_CLIENT_TABLES,
} from './data-studio-client-tables';

export {
  DATA_STUDIO_APP_TABLES,
} from './data-studio-app-tables';

export {
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
  DATA_STUDIO_TENANT_TABLES,
} from './data-studio-tenant-schema';
