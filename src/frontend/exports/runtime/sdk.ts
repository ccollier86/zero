/** Client SDK, data-studio, storage-studio and typed API. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

export {
  createClient,
  getClient,
  FetchError,
  ResourceMutationError,
  SYNC_MUTATION_ERROR_CODES,
  SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
  SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS,
  SyncMutationError,
  isSyncMutationError,
} from '../../client/sdk';
export type {
  Client,
  Collection,
  ClientConfig,
  FetchInit,
  InternalClient,
  ResourceClient,
  ResourceClientOptions,
  ResourceDeleteResult,
  ResourceListResult,
  ResourceMutationOptions,
  ResourceRowResult,
  SyncClient,
  SyncMutationErrorCode,
  SyncMutationErrorDetails,
  SyncMutationRejection,
  SyncMutationWaitOptions,
} from '../../client/sdk';
export {
  DATA_STUDIO_API_PREFIX,
  DataStudioMutationError,
  createDataStudioOperationId,
  createDataStudioSdkSurface,
  dataStudioCellValue,
  dataStudioRowQueryKey,
  dataStudioRowValuesByKey,
  isDataStudioMutationError,
  isDataStudioRevisionConflict,
} from '../../client/data-studio-client';
export type {
  DataStudioCacheSnapshot,
  DataStudioCapabilities,
  DataStudioColumn,
  DataStudioMutationFailureBody,
  DataStudioMutationOptions,
  DataStudioRequestOptions,
  DataStudioReconciliationEvent,
  DataStudioRow,
  DataStudioRowFilter,
  DataStudioRowFilterOperator,
  DataStudioRowFilterValue,
  DataStudioRowPage,
  DataStudioRowQuery,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioSchemaVersionQuery,
  DataStudioSdkSurface,
  DataStudioSdkSurfaceOptions,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableCreate,
  DataStudioTableStatus,
  DataStudioTableUpdate,
  DataStudioValue,
} from '../../client/data-studio-client';
export {
  STORAGE_STUDIO_API_PREFIX,
  StorageStudioMutationError,
  createStorageStudioOperationId,
  createStorageStudioSdkSurface,
  isStorageStudioMutationError,
} from '../../client/storage-studio-client';
export type {
  StorageStudioMutationFailureBody,
  StorageStudioMutationOptions,
  StorageStudioRequestOptions,
  StorageStudioSdkSurface,
} from '../../client/storage-studio-client';
export {
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  parseDataRealmReadinessSnapshot,
} from '../../../auth/data-realm-readiness-types';
export type {
  DataRealmReadinessScope,
  DataRealmReadinessSdkSurface,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
} from '../../../auth/data-realm-readiness-types';
export type { IdentityKey, IdentityValue } from '../../../sync/identity';

// ─── Typed API (Eden Treaty) ────────────────────────────────────────────
export { ApiError, unwrap } from '../../client/api';
export type { Api } from '../../client/api';
