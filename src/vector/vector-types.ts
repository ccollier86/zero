/**
 * vector-types.ts
 *
 * Public contracts for Zero's local vector store. This file owns stable
 * framework-neutral types only; it does not import zvec, execute AI models,
 * register Elysia plugins, or perform persistence.
 */

/** Dense embedding accepted by the vector store. */
export type VectorValue = number[] | Float32Array;

/** Scalar values that can be indexed and filtered by zvec. */
export type VectorScalar = string | number | boolean;

/** App-owned metadata stored beside each vector record. */
export type VectorMetadata = Record<string, unknown>;

/** Supported metadata field types for indexed scalar filters. */
export type VectorMetadataFieldType = 'string' | 'number' | 'boolean';

/** User-facing metadata field config accepted by vector index config. */
export type VectorMetadataFieldInput = VectorMetadataFieldType | VectorMetadataFieldConfig;

/** Configures one indexed metadata scalar field. */
export interface VectorMetadataFieldConfig {
  /** Scalar type stored in zvec for this metadata key. */
  type: VectorMetadataFieldType;
  /** Set false to store the field as nullable but avoid a scalar index. */
  indexed?: boolean;
  /** Set false when the field should always be present. Default: true. */
  nullable?: boolean;
  /** Enables zvec range optimization on indexed scalar fields. Default: true. */
  range?: boolean;
}

/** Normalized metadata field config consumed by the zvec adapter. */
export interface ResolvedVectorMetadataFieldConfig extends Required<VectorMetadataFieldConfig> {
  name: string;
}

/** Distance metric used by the zvec vector index. */
export type VectorMetric = 'cosine' | 'ip' | 'l2';

/** Vector index family used by zvec. */
export type VectorIndexType = 'hnsw' | 'flat' | 'ivf' | 'diskann';

/** Query-time tuning knobs for zvec vector searches. */
export interface VectorQueryTuningConfig {
  /** HNSW candidate list size. */
  ef?: number;
  /** IVF cluster probe count. */
  nprobe?: number;
  /** DiskANN candidate list size. */
  listSize?: number;
  /** Force linear scan for debugging or tiny collections. */
  linear?: boolean;
  /** Optional zvec search radius. */
  radius?: number;
}

/** User-facing config for one named vector index. */
export interface VectorIndexConfig {
  /** Dense vector dimension. Required unless defaultDimensions is configured. */
  dimensions?: number;
  /** Collection path. Defaults to `${dataDir}/${indexName}`. */
  path?: string;
  /** zvec vector field name. Default: `embedding`. */
  vectorField?: string;
  /** Scalar field used for human-readable chunk text. Default: `text`. */
  textField?: string;
  /** Scalar field used for JSON metadata backup. Default: `_metadata`. */
  metadataField?: string;
  /** Metadata keys promoted to zvec scalar fields for filtering. */
  metadata?: Record<string, VectorMetadataFieldInput>;
  /** zvec vector metric. Default: `cosine`. */
  metric?: VectorMetric;
  /** zvec vector index family. Default: `hnsw`. */
  indexType?: VectorIndexType;
  /** Open collection read-only. Default: false. */
  readOnly?: boolean;
  /** Enable memory-mapped IO in zvec. Default: true. */
  enableMMAP?: boolean;
  /** Batch size used for bulk upserts. Default: 250. */
  insertBatchSize?: number;
  /** Query-time defaults for this index. */
  query?: VectorQueryTuningConfig;
}

/** Top-level vector config accepted by createApp(). */
export interface VectorConfig {
  /** Base directory for vector collections. Default: env or `./data/vector`. */
  dataDir?: string;
  /** Index used when API calls omit an explicit index name. Default: `default`. */
  defaultIndex?: string;
  /** Dimension used by `vector: true` or index configs that omit dimensions. */
  defaultDimensions?: number;
  /** Named vector indexes. Number shorthand means `{ dimensions: number }`. */
  indexes?: Record<string, number | VectorIndexConfig>;
}

/** One fully normalized index config consumed by runtime services. */
export interface ResolvedVectorIndexConfig {
  name: string;
  dimensions: number;
  path: string;
  vectorField: string;
  textField: string;
  metadataField: string;
  metadata: Record<string, ResolvedVectorMetadataFieldConfig>;
  metric: VectorMetric;
  indexType: VectorIndexType;
  readOnly: boolean;
  enableMMAP: boolean;
  insertBatchSize: number;
  query: VectorQueryTuningConfig;
}

/** Fully normalized vector runtime config. */
export interface ResolvedVectorConfig {
  enabled: true;
  dataDir: string;
  defaultIndex: string;
  indexes: Record<string, ResolvedVectorIndexConfig>;
}

/** Record accepted by VectorService.upsert(). */
export interface VectorRecord {
  id: string;
  vector: VectorValue;
  text?: string;
  metadata?: VectorMetadata;
}

/** Record returned by vector search and fetch calls. */
export interface StoredVectorRecord {
  id: string;
  vector?: number[];
  text?: string;
  metadata: VectorMetadata;
  score?: number;
}

/** Field operators accepted by Zero's safe zvec filter builder. */
export interface VectorFilterOperators {
  eq?: VectorScalar | null;
  ne?: VectorScalar | null;
  gt?: VectorScalar;
  gte?: VectorScalar;
  lt?: VectorScalar;
  lte?: VectorScalar;
  in?: readonly VectorScalar[];
  notIn?: readonly VectorScalar[];
  exists?: boolean;
  like?: string;
}

/** Value accepted for one field in a VectorFilter. */
export type VectorFilterValue =
  | VectorScalar
  | null
  | readonly VectorScalar[]
  | VectorFilterOperators;

/**
 * Structured filter converted to zvec's SQL-like scalar filter expression.
 *
 * `$and` and `$or` combine nested filters. Other keys must reference scalar
 * fields configured for the target index, or built-in `id`/`text` fields.
 */
export type VectorFilter = {
  $and?: readonly VectorFilter[];
  $or?: readonly VectorFilter[];
} & {
  [field: string]: VectorFilterValue | readonly VectorFilter[] | undefined;
};

/** Options for vector similarity or scalar-only queries. */
export interface VectorQueryOptions {
  vector?: VectorValue;
  topK?: number;
  filter?: VectorFilter;
  minScore?: number;
  includeVector?: boolean;
  outputFields?: string[];
  query?: VectorQueryTuningConfig;
}

/** Options for fetching records by id. */
export interface VectorFetchOptions {
  includeVector?: boolean;
  outputFields?: string[];
}

/** Non-fatal write/delete issue returned by zvec status objects. */
export interface VectorOperationIssue {
  id?: string;
  code: string;
  message: string;
}

/** Result returned by upsert operations. */
export interface VectorWriteResult {
  ok: boolean;
  count: number;
  errors: VectorOperationIssue[];
}

/** Result returned by delete operations. */
export interface VectorDeleteResult {
  ok: boolean;
  count: number;
  errors: VectorOperationIssue[];
}

/** Runtime stats for one vector index. */
export interface VectorStats {
  index: string;
  path: string;
  dimensions: number;
  documentCount: number;
  indexCompleteness: Record<string, number>;
}

/** Minimal storage adapter contract consumed by VectorService. */
export interface VectorIndexStore {
  readonly config: ResolvedVectorIndexConfig;
  upsert(records: readonly VectorRecord[]): Promise<VectorWriteResult>;
  query(options: VectorQueryOptions): Promise<StoredVectorRecord[]>;
  fetch(ids: readonly string[], options?: VectorFetchOptions): Promise<StoredVectorRecord[]>;
  delete(ids: readonly string[]): Promise<VectorDeleteResult>;
  deleteWhere(filter: VectorFilter): Promise<VectorDeleteResult>;
  stats(): Promise<VectorStats>;
  optimize(): Promise<void>;
  dispose(): Promise<void>;
}
