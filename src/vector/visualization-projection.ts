/** Deterministic bounded PCA artifacts. Queries transform; they never refit the map. */

import { createHash } from 'node:crypto';
import { VectorError } from './vector-error';
import type { VectorValue } from './vector-types';
import type { VectorVisualizationPosition } from './visualization-types';

export interface VisualizationProjectionRecord { id: string; vector: VectorValue }
export interface VisualizationProjection {
  id: string;
  dimensions: number;
  mean: readonly number[];
  axes: readonly [readonly number[], readonly number[]];
  /** Numerical scaling of the fitted input, not a changed embedding model. */
  inputScale: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  seedIds: readonly string[];
}
export interface VisualizationProjectionOptions { dimensions?: number; iterations?: number }

/** Fit once from actual authorized vectors; input order cannot rotate the artifact. */
export function fitVisualizationProjection(records: readonly VisualizationProjectionRecord[], options: VisualizationProjectionOptions = {}): VisualizationProjection {
  const dimensions = validateRecords(records, options.dimensions);
  const workPerIteration = Math.max(1, records.length * dimensions * 6);
  const iterations = options.iterations ?? Math.min(48, Math.max(1, Math.floor(100_000_000 / workPerIteration)));
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 96
    || iterations * workPerIteration > 100_000_000) throw invalidProjection();
  const ordered = [...records].sort((a, b) => compareId(a.id, b.id));
  let inputScale = 0;
  for (const row of ordered) for (const value of row.vector) inputScale = Math.max(inputScale, Math.abs(value));
  if (inputScale === 0) inputScale = 1;
  const scaledMean = Array<number>(dimensions).fill(0);
  for (const row of ordered) for (let j = 0; j < dimensions; j++) scaledMean[j]! += row.vector[j]! / inputScale / Math.max(1, ordered.length);
  const centered = ordered.map(row => Array.from(row.vector, (value, j) => value / inputScale - scaledMean[j]!));
  const first = principalAxis(centered, dimensions, iterations, []);
  const second = principalAxis(centered, dimensions, iterations, [first]);
  const raw = centered.map(row => ({ x: dot(row, first), y: dot(row, second) }));
  const bounds = raw.length ? {
    minX: Math.min(...raw.map(p => p.x)), maxX: Math.max(...raw.map(p => p.x)),
    minY: Math.min(...raw.map(p => p.y)), maxY: Math.max(...raw.map(p => p.y)),
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const mean = scaledMean.map(value => value * inputScale);
  const seedIds = ordered.map(row => row.id);
  const digest = createHash('sha256').update('zero-visualization-pca-v1\0');
  digest.update(JSON.stringify({ dimensions, iterations, seedIds, vectors: ordered.map(row => Array.from(row.vector)), mean, axes: [first, second], inputScale, bounds }));
  return { id: `pca-v1-${digest.digest('hex').slice(0, 32)}`, dimensions, mean, axes: [first, second], inputScale, bounds, seedIds };
}

/** Transform with the fixed fitted frame, clamping outliers to its visible extent. */
export function transformVisualizationVector(projection: VisualizationProjection, vector: VectorValue): VectorVisualizationPosition {
  validateArtifact(projection);
  validateVector(vector, projection.dimensions);
  const scaled = Array.from(vector, (value, i) => {
    // Saturation protects a persisted tiny-input artifact from a huge finite query.
    const ratio = value / projection.inputScale;
    return Math.max(-1e100, Math.min(1e100, ratio)) - projection.mean[i]! / projection.inputScale;
  });
  const x = dot(scaled, projection.axes[0]), y = dot(scaled, projection.axes[1]);
  return { x: normalizeAxis(x, projection.bounds.minX, projection.bounds.maxX), y: normalizeAxis(y, projection.bounds.minY, projection.bounds.maxY) };
}

export interface VisualizationNeighbors {
  provenance: 'derived-neighbors';
  metric: 'cosine';
  neighborIds: Readonly<Record<string, readonly string[]>>;
}

/**
 * Exact neighbors within a deterministic graph subset, never native HNSW links.
 * Keep every supplied map ID in the output. Only the first N stable sorted IDs
 * participate, where N² × dimensions <= 100,000,000 scalar dot-product terms
 * (and N <= 400). Remaining points have no links, not guessed nearest records.
 * All ordinary 96-point samples fit this budget at every supported dimension.
 */
export function deriveVisualizationNeighbors(records: readonly VisualizationProjectionRecord[], k = 4): VisualizationNeighbors {
  const dimensions = validateRecords(records);
  if (!Number.isSafeInteger(k) || k < 0 || k > 16) throw invalidProjection();
  const ordered = [...records].sort((a, b) => compareId(a.id, b.id));
  const graphSize = k === 0 ? 0 : Math.min(ordered.length,
    Math.floor(Math.sqrt(100_000_000 / Math.max(1, dimensions))));
  const participating = ordered.slice(0, graphSize);
  const unit = participating.map(row => normalize(Array.from(row.vector)));
  const neighborIds: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  for (const row of ordered) neighborIds[row.id] = [];
  for (let i = 0; i < participating.length; i++) {
    neighborIds[participating[i]!.id] = participating.map((row, j) => ({ id: row.id, index: j, score: dot(unit[i]!, unit[j]!) }))
      .filter(row => row.index !== i)
      .sort((a, b) => b.score - a.score || compareId(a.id, b.id)).slice(0, k).map(row => row.id);
  }
  return { provenance: 'derived-neighbors', metric: 'cosine', neighborIds };
}

function principalAxis(rows: readonly number[][], dimensions: number, iterations: number, prior: readonly number[][]): number[] {
  if (rows.length < 2 || !dimensions) return Array<number>(dimensions).fill(0);
  const multiply = (vector: readonly number[]): number[] => {
    const result = Array<number>(dimensions).fill(0);
    for (const row of rows) {
      const weight = dot(row, vector);
      for (let j = 0; j < dimensions; j++) result[j]! += row[j]! * weight / rows.length;
    }
    for (const axis of prior) {
      const component = dot(result, axis);
      for (let j = 0; j < dimensions; j++) result[j]! -= component * axis[j]!;
    }
    return result;
  };
  // Multiple deterministic starts avoid a symmetric input being orthogonal to
  // a single chosen start. Selection uses the actual Rayleigh quotient.
  let best = Array<number>(dimensions).fill(0), bestEnergy = 0;
  for (let trial = 0; trial < 3; trial++) {
    let axis = normalize(Array.from({ length: dimensions }, (_, i) => Math.sin((i + 1) * (trial + 1) * 1.618033988749895)));
    for (let step = 0; step < iterations; step++) {
      const next = normalize(multiply(axis));
      const delta = next.reduce((sum, value, i) => sum + (value - axis[i]!) ** 2, 0);
      axis = next;
      if (delta < 1e-20) break;
    }
    const energy = dot(axis, multiply(axis));
    if (energy > bestEnergy + 1e-18) { best = axis; bestEnergy = energy; }
  }
  let largest = 0;
  for (let i = 1; i < dimensions; i++) if (Math.abs(best[i]!) > Math.abs(best[largest]!)) largest = i;
  if (best[largest]! < 0) best = best.map(value => -value);
  return best;
}

function normalize(values: number[]): number[] {
  // Math.hypot rescaling avoids overflow for finite high-magnitude embeddings.
  const magnitude = Math.hypot(...values);
  if (magnitude === 0) return values.map(() => 0);
  if (!Number.isFinite(magnitude)) {
    const scale = Math.max(...values.map(value => Math.abs(value)));
    const scaled = values.map(value => value / scale);
    const norm = Math.hypot(...scaled);
    return scaled.map(value => value / norm);
  }
  return values.map(value => value / magnitude);
}
function dot(a: readonly number[], b: readonly number[]): number {
  let result = 0;
  for (let j = 0; j < a.length; j++) result += a[j]! * b[j]!;
  return result;
}
function normalizeAxis(value: number, min: number, max: number): number {
  if (max - min < 1e-12) return 0;
  return Math.max(-0.85, Math.min(0.85, ((value - min) / (max - min) * 2 - 1) * 0.85));
}
function validateRecords(records: readonly VisualizationProjectionRecord[], dimensions?: number): number {
  if (!Array.isArray(records) || records.length > 400) throw invalidProjection();
  const d = dimensions ?? records[0]?.vector?.length ?? 0;
  if (!Number.isSafeInteger(d) || d < 0 || d > 8_192 || (records.length > 0 && d === 0)) throw invalidProjection();
  const ids = new Set<string>();
  for (const row of records) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 1_024 || ids.has(row.id)) throw invalidProjection();
    ids.add(row.id);
    validateVector(row.vector, d);
  }
  return d;
}
function validateVector(vector: VectorValue, dimensions: number): void {
  if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length !== dimensions
    || Array.from(vector).some(value => !Number.isFinite(value))) {
    throw new VectorError('VECTOR_DIMENSION_MISMATCH', 'Projection requires finite, dimension-matched stored vectors.', { expected: dimensions });
  }
}
function validateArtifact(p: VisualizationProjection): void {
  if (!p || !Number.isSafeInteger(p.dimensions) || p.dimensions < 0 || p.dimensions > 8_192
    || !Number.isFinite(p.inputScale) || p.inputScale <= 0 || !p.bounds
    || ![p.bounds.minX, p.bounds.maxX, p.bounds.minY, p.bounds.maxY].every(Number.isFinite)
    || p.bounds.minX > p.bounds.maxX || p.bounds.minY > p.bounds.maxY
    || !Array.isArray(p.mean) || !Array.isArray(p.axes) || p.axes.length !== 2) throw invalidProjection();
  for (const vector of [p.mean, ...(p.axes ?? [])]) validateVector(vector as number[], p.dimensions);
}
function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function invalidProjection(): VectorError { return new VectorError('VECTOR_CONFIG_INVALID', 'Visualization projection input is invalid or exceeds capacity.'); }
