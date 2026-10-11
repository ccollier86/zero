/**
 * visualization-types.ts
 *
 * Transport-safe contracts shared by Zero's ingestion/search coordinators,
 * authenticated clients and presentational organisms. No provider, native
 * index, persistence or React implementation belongs in this module.
 */

/** A committed operation or stage state, independent of animation playback. */
export type VectorVisualizationStatus = 'pending' | 'running' | 'waiting'
  | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';

/** Known pipeline stages; custom engine stages may use an explicitly labeled ID. */
export type VectorVisualizationStageId = 'accept' | 'chunk' | 'embed' | 'enrich'
  | 'index' | 'query' | 'retrieve' | 'lexical' | 'fusion' | 'rerank';

/** One authoritative process stage. Missing progress means indeterminate. */
export interface VectorVisualizationStage {
  id: VectorVisualizationStageId | (string & {});
  label: string;
  status: VectorVisualizationStatus;
  completed?: number;
  total?: number;
  startedAt?: string;
  completedAt?: string;
}

/** Bounded source identity displayed in a preview or result row. */
export interface VectorVisualizationSource {
  id?: string;
  label: string;
  /** Optional short source abbreviation; never arbitrary HTML. */
  abbreviation?: string;
}

/** Stable coordinates in one versioned visualization projection. */
export interface VectorVisualizationPosition { x: number; y: number }

/** One authorized cluster label; components choose its theme series color. */
export interface VectorVisualizationCluster { id: string; label: string }

/** A real stored record or accepted search record represented on the map. */
export interface VectorVisualizationPoint {
  id: string;
  title: string;
  position: VectorVisualizationPosition;
  clusterId?: string;
  source?: VectorVisualizationSource;
  neighborIds?: readonly string[];
  kind?: 'stored' | 'new';
}

/** Meaning of the graph and search motion a supplied engine can substantiate. */
export interface VectorVisualizationCapabilities {
  nativeTraversal: boolean;
  graph: 'native' | 'derived-neighbors' | 'none';
  liveUpdates: boolean;
}

/** Authorized bounded map sample; the projection ID remains stable across queries. */
export interface VectorVisualizationMap {
  revision: number;
  projectionId: string;
  projectionKind: 'pca' | 'provided';
  dimensions: number;
  model?: string;
  points: readonly VectorVisualizationPoint[];
  clusters: readonly VectorVisualizationCluster[];
  /** Include only when measured for the viewer's authorized corpus. */
  totalRecords?: number;
  capabilities: VectorVisualizationCapabilities;
}

/** Score provenance prevents mixing native distance, fusion and reranker scales. */
export interface VectorVisualizationScore {
  value: number;
  kind: 'cosine' | 'distance' | 'inner-product' | 'lexical' | 'fusion' | 'rerank';
  direction: 'higher' | 'lower';
}

/** One candidate/result with actual retrieval and final rank identity. */
export interface VectorVisualizationCandidate {
  id: string;
  title: string;
  source?: VectorVisualizationSource;
  clusterId?: string;
  text?: string;
  foundRank: number;
  rank: number;
  score: VectorVisualizationScore;
  scores?: readonly VectorVisualizationScore[];
  returned: boolean;
}

/** Native trace telemetry is optional and must not be invented from map proximity. */
export interface VectorVisualizationTrace {
  provenance: 'native' | 'illustrative';
  visitedIds: readonly string[];
  edges?: readonly { from: string; to: string }[];
  comparisons?: number;
}

/** Actual query diagnostics; raw full embeddings are deliberately absent. */
export interface VectorVisualizationQuery {
  text: string;
  retrieval: 'vector' | 'hybrid';
  rerank: boolean;
  topK: number;
  candidateCount?: number;
  dimensions?: number;
  model?: string;
  embeddingPreview?: readonly number[];
  position?: VectorVisualizationPosition;
}

/** Accepted source document identity for one ingestion operation. */
export interface VectorVisualizationDocument {
  id: string;
  title: string;
  text?: string;
  source?: VectorVisualizationSource;
  clusterId?: string;
}

/** Accepted chunk state and source-coordinate diagnostics. */
export interface VectorVisualizationChunk {
  id: string;
  documentId: string;
  index: number;
  text: string;
  section?: string;
  start: number;
  end: number;
  overlapChars: number;
  tokenCount: number;
  tokenCountApproximate: boolean;
  status: VectorVisualizationStatus;
  stageId?: VectorVisualizationStageId;
  attempt?: number;
  dimensions?: number;
  embeddingPreview?: readonly number[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
  /** Set only after the native storage acknowledgement succeeds. */
  storedAt?: string;
}

/** Ingestion totals describe this operation, not an unrestricted underlying index. */
export interface VectorVisualizationIngestion {
  sourceRevision?: string;
  document: VectorVisualizationDocument;
  chunks: readonly VectorVisualizationChunk[];
  completedChunks: number;
  tokenCount: number;
  tokenCountApproximate: boolean;
  currentChunkId?: string;
}

/** Safe operation error suitable for authenticated UI. */
export interface VectorVisualizationFailure {
  code: string;
  message: string;
  retryable?: boolean;
  /** A write may have happened before cancellation or delivery failed. */
  outcomeUnknown?: boolean;
}

/** Canonical operation snapshot accepted by controllers and both organisms. */
export interface VectorVisualizationSnapshot {
  id: string;
  kind: 'search' | 'ingestion';
  index: string;
  status: VectorVisualizationStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stages: readonly VectorVisualizationStage[];
  map?: VectorVisualizationMap;
  query?: VectorVisualizationQuery;
  ingestion?: VectorVisualizationIngestion;
  candidates?: readonly VectorVisualizationCandidate[];
  results?: readonly VectorVisualizationCandidate[];
  trace?: VectorVisualizationTrace;
  error?: VectorVisualizationFailure;
  /** Nonfatal diagnostic failures never turn acknowledged business results into failures. */
  warnings?: readonly VectorVisualizationFailure[];
}

/** Search command; service/route authority determines its permitted index/scope. */
export interface VectorVisualizationSearchInput {
  index?: string;
  text: string;
  retrieval?: 'vector' | 'hybrid';
  rerank?: boolean;
  topK?: number;
  candidateCount?: number;
  operationId?: string;
}

/** Ingestion command; stable source revision supports retry-safe chunk identity. */
export interface VectorVisualizationIngestInput {
  index?: string;
  document: VectorVisualizationDocument & { text: string };
  sourceRevision?: string;
  operationId?: string;
}

/** SDK/external-engine adapter. Attaching or observing never starts another operation. */
export interface VectorVisualizationAdapter {
  get(id: string, signal?: AbortSignal): Promise<VectorVisualizationSnapshot | null>;
  /** Null retires sensitive state after authority loss/deletion. */
  subscribe(id: string, listener: (snapshot: VectorVisualizationSnapshot | null) => void,
    onError?: (error: unknown) => void): () => void;
  search?(input: VectorVisualizationSearchInput, signal?: AbortSignal): Promise<VectorVisualizationSnapshot>;
  ingest?(input: VectorVisualizationIngestInput, signal?: AbortSignal): Promise<VectorVisualizationSnapshot>;
  cancel?(id: string, signal?: AbortSignal): Promise<VectorVisualizationSnapshot | null>;
  map?(index?: string, signal?: AbortSignal): Promise<VectorVisualizationMap>;
}

/** Presentation choices shared by controlled organisms and bound tool activities. */
export type VectorVisualizationPresentation = 'full' | 'compact' | 'inspector';
