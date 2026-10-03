/**
 * data-studio-client.ts
 *
 * Browser-safe Data Studio client entry point.
 *
 * The implementation is split by responsibility while this module preserves
 * the original public API used by the SDK, hooks, and package exports.
 */

export {
  DATA_STUDIO_API_PREFIX,
  createDataStudioSdkSurface,
} from './data-studio-surface';
export {
  DataStudioMutationError,
  createDataStudioOperationId,
  isDataStudioMutationError,
  isDataStudioRevisionConflict,
} from './data-studio-mutation';
export {
  dataStudioCellValue,
  dataStudioRowQueryKey,
  dataStudioRowValuesByKey,
} from './data-studio-query';

export type {
  DataStudioCacheSnapshot,
  DataStudioCapabilities,
  DataStudioMutationFailureBody,
  DataStudioMutationOptions,
  DataStudioRequestOptions,
  DataStudioRowFilter,
  DataStudioRowFilterOperator,
  DataStudioRowFilterValue,
  DataStudioRowPage,
  DataStudioRowQuery,
  DataStudioSchemaVersionQuery,
  DataStudioSdkSurface,
  DataStudioSdkSurfaceOptions,
  DataStudioTableCreate,
  DataStudioTableUpdate,
} from './data-studio-client-types';
export type {
  DataStudioColumn,
  DataStudioRow,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
  DataStudioValue,
} from '../../data-studio/data-studio-contracts';
export type { DataStudioReconciliationEvent } from './data-studio-sync';
