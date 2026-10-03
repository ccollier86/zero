/** Server-only Data Studio exports. */

export * from './index';

export {
  createDataStudioFeature,
  type DataStudioFeature,
} from './data-studio-feature';
export {
  DATA_STUDIO_REALM_CONTRIBUTION,
} from './data-studio-realm-contribution';
export {
  DATA_STUDIO_RESOURCES,
} from './data-studio-resources';
export {
  createDataStudioRouter,
} from './data-studio-router';
export {
  DataStudioService,
  createDataStudioService,
} from './data-studio-service';
export type {
  DataStudioMutationReceipt,
  DataStudioMutationOptions,
  DataStudioRowsRequest,
  DataStudioServiceActor,
  DataStudioServiceOptions,
  DataStudioServiceRowFilter,
  DataStudioTableCreateRequest,
  DataStudioTableUpdateRequest,
} from './data-studio-service';
export {
  DATA_STUDIO_COMMAND_NAMES,
  DATA_STUDIO_DEFAULT_PAGE_SIZE,
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_ROWS_PER_TABLE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
  DATA_STUDIO_MAX_SCHEMA_VERSIONS,
  DATA_STUDIO_MAX_TABLES,
  DATA_STUDIO_QUERY_NAMES,
} from './data-studio-operation-contracts';
