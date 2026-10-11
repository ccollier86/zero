/** Opt-in application policy for authorized, real vector visualizations. */
import type { ResolvedVectorConfig } from './vector-types';
import { VectorError } from './vector-error';
import { isAuthorizationPermissionKey } from '../auth/authorization-registry-validation';

export interface VectorVisualizationIndexConfig {
  /** Existing promoted string metadata field stamped with serviceDataScopeKey(scope). */
  scopeField: string;
  /** Declared Guardian permission; checked again before every effect/delivery. */
  searchPermission: string;
  /** Omit to disable ingestion for this index. */
  ingestPermission?: string;
  embeddingModel?: string;
  rerankingModel?: string;
  /** Bounded real corpus sample, not a claim about the whole corpus. Default 96. */
  sampleSize?: number;
  /** Metadata permitted in safe snapshots. Never include credentials or private fields. */
  metadataFields?: readonly string[];
  chunk?: { maxChars?: number; maxTokens?: number; overlapChars?: number; maxChunks?: number };
}
export interface VectorVisualizationConfig {
  indexes: Record<string, VectorVisualizationIndexConfig>;
  defaultIndex?: string;
}
export interface ResolvedVectorVisualizationConfig {
  readonly indexes: Readonly<Record<string, VectorVisualizationIndexConfig>>;
  readonly defaultIndex: string;
}

export function resolveVectorVisualizationConfig(input: false | VectorVisualizationConfig | undefined,
  vectors: false | ResolvedVectorConfig, authEnabled: boolean, aiEnabled: boolean): false | ResolvedVectorVisualizationConfig {
  if (input === false || input === undefined) return false;
  const invalid = (message: string): never => { throw new VectorError('VECTOR_CONFIG_INVALID', message); };
  if (!authEnabled || !aiEnabled || vectors === false) invalid('vectorVisualization requires Guardian, AI and vector services.');
  if (!input || typeof input !== 'object' || !input.indexes || typeof input.indexes !== 'object') invalid('vectorVisualization.indexes is required.');
  const entries = Object.entries(input.indexes);
  if (!entries.length || entries.length > 32) invalid('Configure between one and 32 visualization indexes.');
  const indexes: Record<string, VectorVisualizationIndexConfig> = Object.create(null);
  for (const [name, policy] of entries) {
    const native = vectors === false ? undefined : vectors.indexes[name];
    if (!native || !policy || typeof policy !== 'object') invalid('Visualization index must reference a configured native index.');
    if (typeof policy.scopeField !== 'string' || native!.metadata[policy.scopeField]?.type !== 'string' || !native!.metadata[policy.scopeField]?.indexed) invalid('Visualization scopeField must be an existing indexed string metadata field.');
    for (const key of ['searchPermission', 'ingestPermission'] as const) {
      const value = policy[key];
      if ((key === 'searchPermission' || value !== undefined) && !isAuthorizationPermissionKey(value)) invalid(`Visualization ${key} must be a declared Guardian permission key.`);
    }
    if (policy.ingestPermission && native!.readOnly) invalid('Ingestion cannot target a read-only vector index.');
    const sampleSize = policy.sampleSize ?? 96;
    if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 256) invalid('Visualization sampleSize must be between 1 and 256.');
    for (const model of [policy.embeddingModel, policy.rerankingModel]) if (model !== undefined && (typeof model !== 'string' || !model.trim() || model.length > 256)) invalid('Visualization model aliases must be nonempty bounded strings.');
    const fields = policy.metadataFields ?? [];
    if (!Array.isArray(fields) || fields.length > 32 || fields.some(field => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field) || field === policy.scopeField)) invalid('Visualization metadataFields must be safe explicit field names, excluding scopeField.');
    const chunk = policy.chunk ?? {};
    for (const [key, min, max] of [['maxChars', 64, 16000], ['maxTokens', 16, 16000], ['overlapChars', 0, 4000], ['maxChunks', 1, 128]] as const) {
      const value = chunk[key];
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) invalid(`Visualization chunk.${key} is out of bounds.`);
    }
    if ((chunk.overlapChars ?? 120) >= (chunk.maxChars ?? 1000)) invalid('Chunk overlap must be smaller than chunk size.');
    indexes[name] = Object.freeze({ ...policy, sampleSize, metadataFields: Object.freeze([...fields]), chunk: Object.freeze({ ...chunk }) });
  }
  const defaultIndex = input.defaultIndex ?? entries[0]![0];
  if (!Object.hasOwn(indexes, defaultIndex)) invalid('Visualization defaultIndex must be enabled.');
  return Object.freeze({ indexes: Object.freeze(indexes), defaultIndex });
}
