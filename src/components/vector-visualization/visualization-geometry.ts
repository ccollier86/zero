/** Pure bounded presentation geometry. Never projects raw embeddings or invents index topology. */
import type { VectorVisualizationMap, VectorVisualizationPosition, VectorVisualizationScore } from '../../vector/visualization-types';

/** Reference isometric dimensions; all coordinates use this intrinsic, responsive SVG space. */
export const VECTOR_VISUALIZATION_GEOMETRY = Object.freeze({ width: 640, height: 410, halfWidth: 300,
  halfHeight: 154.5, centerX: 320, centerY: 224.5, slab: 10, gridDivisions: 8, previewBars: 16 });

/** Preserve only valid supplied coordinates; clipping is visual, not a new embedding projection. */
export function projectVectorPosition(position: VectorVisualizationPosition): { x: number; y: number } | null {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const u = Math.max(-1, Math.min(1, position.x)), v = Math.max(-1, Math.min(1, position.y));
  const g = VECTOR_VISUALIZATION_GEOMETRY;
  return { x: g.centerX + (u - v) * g.halfWidth / 2, y: g.centerY + (u + v) * g.halfHeight / 2 };
}

/** A stable theme-series number for an identity, independent of result rank or query order. */
export function vectorSeries(identity: string): number {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) hash = (Math.imul(hash, 31) + identity.charCodeAt(i)) | 0;
  return ((hash >>> 0) % 5) + 1;
}

/** Prefer the canonical cluster order so the first five visible clusters have distinct theme series. */
export function vectorClusterSeries(clusters: readonly { id: string }[], identity: string): number {
  const index = clusters.findIndex(cluster => cluster.id === identity);
  return index >= 0 ? index % 5 + 1 : vectorSeries(identity);
}

/** Deduplicate explicitly supplied neighbor edges; absent graph capabilities means no graph. */
export function vectorMapEdges(map: VectorVisualizationMap): Array<{ from: string; to: string }> {
  if (map.capabilities.graph === 'none') return [];
  const ids = new Set(map.points.map(point => point.id)), seen = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];
  for (const point of map.points) for (const id of point.neighborIds ?? []) {
    if (id === point.id || !ids.has(id)) continue;
    const key = JSON.stringify([point.id, id].sort());
    if (seen.has(key)) continue;
    seen.add(key); edges.push({ from: point.id, to: id });
  }
  return edges;
}

/** Keep scores truthful across native distance, similarity, fusion and reranking scales. */
export function formatVectorScore(score: VectorVisualizationScore): string {
  return Number.isFinite(score.value) ? score.value.toFixed(2) : '—';
}

/** Describes provenance without claiming native traversal or measured map fidelity. */
export function vectorMapDescription(map: VectorVisualizationMap): string {
  const projection = map.projectionKind === 'pca' ? 'PCA projection' : 'Provided projection';
  const graph = map.capabilities.graph === 'derived-neighbors' ? 'derived neighbor links'
    : map.capabilities.graph === 'native' ? 'native index links' : 'no graph telemetry';
  return [map.model, `${projection} · ${map.dimensions.toLocaleString('en-US')} dimensions`,
    `${map.points.length.toLocaleString('en-US')} sampled records`, graph].filter(Boolean).join(' · ');
}
