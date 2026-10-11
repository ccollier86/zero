/**
 * index.ts
 *
 * Public server-side barrel for Zero's vector store. Client/browser code
 * should not import this module because it can open local zvec collections.
 */

export { resolveVectorConfig } from './vector-config';
export { VectorVisualizationService } from './visualization-service';
export type { VectorVisualizationServiceOptions, VectorVisualizationExecutionOptions, VectorVisualizationStartedOperation } from './visualization-service-context';
export { AsyncVectorVisualizationStore } from './visualization-store';
export type { VectorVisualizationStore, VectorVisualizationClaim } from './visualization-store';
export { AsyncVectorVisualizationMapStore } from './visualization-store-map';
export type { VectorVisualizationMapStore, VectorVisualizationMapState } from './visualization-store-map';
export type * from './visualization-types';
export { resolveVectorVisualizationConfig } from './visualization-config';
export type { VectorVisualizationConfig, VectorVisualizationIndexConfig, ResolvedVectorVisualizationConfig } from './visualization-config';
export { vectorVisualizationMigration } from './visualization-migration';
export { vectorVisualizationSchemaReady, admitVectorVisualizationSchema } from './visualization-admission';
export { registerVectorVisualizationActivities } from './visualization-workflow';
export type { VectorVisualizationWorkflowInput, VectorVisualizationWorkflowOptions, VectorVisualizationWorkflowResult } from './visualization-workflow';
export { VectorError } from './vector-error';
export { createAIVectorBridge } from './vector-ai-bridge';
export { createVectorPlugin, getVectorStore } from './vector.plugin';
export { VectorRegistry } from './vector-registry';
export { VectorScope, VectorService } from './vector-service';
export type { VectorServiceOptions } from './vector-service';
export { ZvecAdapter } from './zvec-adapter';
export {
  buildZvecFilter,
  extractSimpleEqualityMetadata,
  getVectorFilterFields,
  mergeVectorFilters,
  recordMatchesVectorFilter,
} from './vector-filter';
export type {
  AIVectorBridge,
  AIVectorBridgeOptions,
  AIVectorRecordInput,
  AIVectorTextQuery,
  ScopedAIVectorBridge,
} from './vector-ai-bridge';
export type {
  ResolvedVectorConfig,
  ResolvedVectorIndexConfig,
  ResolvedVectorMetadataFieldConfig,
  StoredVectorRecord,
  VectorConfig,
  VectorDeleteResult,
  VectorFetchOptions,
  VectorFilter,
  VectorFilterOperators,
  VectorFilterValue,
  VectorIndexConfig,
  VectorIndexStore,
  VectorIndexType,
  VectorMetadata,
  VectorMetadataFieldConfig,
  VectorMetadataFieldInput,
  VectorMetadataFieldType,
  VectorMetric,
  VectorOperationIssue,
  VectorQueryOptions,
  VectorQueryTuningConfig,
  VectorRecord,
  VectorScalar,
  VectorStats,
  VectorValue,
  VectorWriteResult,
} from './vector-types';
