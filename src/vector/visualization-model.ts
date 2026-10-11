/** Honest rank fusion and recomputed vector score provenance, independent of engines. */

import { VectorError } from './vector-error';
import type { VectorMetric, VectorValue } from './vector-types';
import type { VectorVisualizationScore } from './visualization-types';

export interface VisualizationFusionResult {
  id: string;
  rank: number;
  score: VectorVisualizationScore;
  vectorRank?: number;
  lexicalRank?: number;
}
export interface VisualizationFusionOptions {
  vectorWeight?: number;
  lexicalWeight?: number;
  rankConstant?: number;
  limit?: number;
}

/** Weighted RRF uses independent full-corpus rankings, never adds unlike metrics. */
export function fuseVisualizationRanks(vectorIds: readonly string[], lexicalIds: readonly string[], options: VisualizationFusionOptions = {}): VisualizationFusionResult[] {
  const vectorWeight = options.vectorWeight ?? 1, lexicalWeight = options.lexicalWeight ?? 1;
  const rankConstant = options.rankConstant ?? 60, limit = options.limit ?? 10;
  if (![vectorWeight, lexicalWeight].every(n => Number.isFinite(n) && n >= 0 && n <= 100)
    || vectorWeight + lexicalWeight === 0 || !Number.isSafeInteger(rankConstant) || rankConstant < 1 || rankConstant > 10_000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw invalidModel();
  const found = new Map<string, { id: string; value: number; vectorRank?: number; lexicalRank?: number }>();
  for (const [ids, weight, key] of [[vectorIds, vectorWeight, 'vectorRank'], [lexicalIds, lexicalWeight, 'lexicalRank']] as const) {
    if (!Array.isArray(ids) || ids.length > 1_000) throw invalidModel();
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== 'string' || !id.trim() || id.length > 1_024) throw invalidModel();
      if (seen.has(id)) continue;
      seen.add(id);
      if (weight === 0) continue;
      const rank = seen.size;
      const row = found.get(id) ?? { id, value: 0 };
      row.value += weight / (rankConstant + rank);
      row[key] = rank;
      found.set(id, row);
    }
  }
  return [...found.values()].sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit).map(({ value, ...row }, i) => ({ ...row, rank: i + 1, score: { value, kind: 'fusion', direction: 'higher' } }));
}

/** Compute a known metric from actual vectors; do not infer native score semantics. */
export function normalizeVisualizationVectorScore(metric: VectorMetric, vector: VectorValue, query: VectorValue): VectorVisualizationScore {
  if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || (!Array.isArray(query) && !(query instanceof Float32Array))
    || vector.length === 0 || vector.length !== query.length || vector.length > 8_192
    || !Array.from(vector).every(Number.isFinite) || !Array.from(query).every(Number.isFinite)) {
    throw new VectorError('VECTOR_DIMENSION_MISMATCH', 'Vector score requires finite dimension-matched vectors.');
  }
  let scaleA = 0, scaleB = 0;
  for (let i = 0; i < vector.length; i++) { scaleA = Math.max(scaleA, Math.abs(vector[i]!)); scaleB = Math.max(scaleB, Math.abs(query[i]!)); }
  if (metric === 'cosine') {
    let product = 0, a2 = 0, b2 = 0;
    for (let i = 0; i < vector.length; i++) {
      const a = scaleA ? vector[i]! / scaleA : 0, b = scaleB ? query[i]! / scaleB : 0;
      product += a * b; a2 += a * a; b2 += b * b;
    }
    return { value: a2 > 0 && b2 > 0 ? Math.max(-1, Math.min(1, product / Math.sqrt(a2) / Math.sqrt(b2))) : 0,
      kind: 'cosine', direction: 'higher' };
  }
  const scale = Math.max(scaleA, scaleB) || 1;
  let distance2 = 0;
  for (let i = 0; i < vector.length; i++) {
    const a = vector[i]! / scale, b = query[i]! / scale;
    distance2 += (a - b) ** 2;
  }
  let value: number;
  if (metric === 'ip') {
    let normalizedProduct = 0;
    for (let i = 0; i < vector.length; i++) normalizedProduct += (scaleA ? vector[i]! / scaleA : 0) * (scaleB ? query[i]! / scaleB : 0);
    value = normalizedProduct * scaleA * scaleB;
    if (normalizedProduct !== 0 && (!Number.isFinite(value) || value === 0)) {
      value = Math.sign(normalizedProduct) * Math.exp(Math.log(Math.abs(normalizedProduct)) + Math.log(scaleA) + Math.log(scaleB));
    }
  } else value = metric === 'l2' ? Math.sqrt(distance2) * scale : NaN;
  if (!Number.isFinite(value)) throw new VectorError('VECTOR_OPERATION_FAILED', 'Vector metric cannot be represented as a finite score.');
  return { value, kind: metric === 'ip' ? 'inner-product' : 'distance', direction: metric === 'ip' ? 'higher' : 'lower' };
}

function invalidModel(): VectorError { return new VectorError('VECTOR_CONFIG_INVALID', 'Visualization fusion configuration or ranked identity list is invalid.'); }
