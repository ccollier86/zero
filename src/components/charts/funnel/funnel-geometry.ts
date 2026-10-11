/**
 * Pure centered segment boundaries, smooth Funnel SVG paths and edge sampling.
 * Browser runtimes may supply in-flight thicknesses; geometry is bounded to the
 * actual cross-axis and does not own animation, canvas or DOM objects.
 */
import { FUNNEL_LIMITS } from './funnel-model';
import type { FunnelBandEdges, FunnelLayout } from './funnel-types';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const coordinate = (value: number): string => String(Math.round(value * 10) / 10);

/** Stack current segment thicknesses around the center, retaining zero slots for stable identities. */
export function computeFunnelEdges(thicknesses: readonly (readonly number[])[], cross: number, gap = 0, growth = 1): readonly FunnelBandEdges[] {
  if (!Number.isFinite(cross) || cross < 0 || cross > 16_384 || !Number.isFinite(gap)
    || gap < 0 || !Number.isFinite(growth) || growth < 0 || growth > 1
    || thicknesses.length > FUNNEL_LIMITS.stages) throw new Error('Funnel boundaries require bounded finite geometry and growth between 0 and 1.');
  const K = thicknesses[0]?.length ?? 0;
  if (K > FUNNEL_LIMITS.segments || thicknesses.some(row => row.length !== K)) {
    throw new Error('Funnel thickness rows must have equal bounded segment counts.');
  }
  const result = Array.from({ length: K }, () => ({ top: [] as number[], bottom: [] as number[] }));
  for (const row of thicknesses) {
    const heights = row.map(value => {
      if (!Number.isFinite(value)) throw new Error('Funnel thicknesses must be finite.');
      return Math.min(cross, Math.max(0, value)) * growth;
    });
    const visible = heights.filter(value => value > 0.05).length;
    const effectiveGap = visible > 1 ? Math.min(gap, cross / (visible - 1)) : 0;
    const total = heights.reduce((sum, value) => sum + value, 0), available = Math.max(0, cross - effectiveGap * Math.max(0, visible - 1));
    const scale = total > available && total > 0 ? available / total : 1;
    let current = (cross - Math.min(total, available) - effectiveGap * Math.max(0, visible - 1)) / 2;
    heights.forEach((height, k) => {
      const h = height * scale, end = clamp(current + h, 0, cross);
      result[k]!.top.push(clamp(current, 0, cross)); result[k]!.bottom.push(end);
      current = end + (height > 0.05 ? effectiveGap : 0);
    });
  }
  return Object.freeze(result.map(edges => Object.freeze({ top: Object.freeze(edges.top), bottom: Object.freeze(edges.bottom) })));
}

function validateEdges(edges: readonly number[], layout: FunnelLayout): void {
  if (edges.length > FUNNEL_LIMITS.stages || edges.some(value => !Number.isFinite(value))) {
    throw new Error('Funnel edge values must be bounded finite coordinates.');
  }
  if (!Number.isFinite(layout.stepSize) || layout.stepSize < 0 || !Number.isFinite(layout.along)
    || layout.along < 0 || !Number.isFinite(layout.transitionZone) || layout.transitionZone < 0) {
    throw new Error('Funnel edge layout must contain finite nonnegative dimensions.');
  }
}

/** SVG band with flat stage cells and cubic S-shaped transitions over 30% of each cell. */
export function funnelBandPath(edges: FunnelBandEdges, layout: FunnelLayout): string {
  validateEdges(edges.top, layout); validateEdges(edges.bottom, layout);
  if (edges.top.length !== edges.bottom.length) throw new Error('Funnel upper and lower boundaries must have equal length.');
  const n = edges.top.length;
  if (!n) return '';
  const point = (along: number, cross: number): string => layout.mapPoint(along, cross).map(coordinate).join(',');
  let d = `M${point(0, edges.top[0]!)}`;
  for (let i = 0; i < n - 1; i++) {
    const boundary = (i + 1) * layout.stepSize;
    d += `L${point(boundary - layout.transitionZone, edges.top[i]!)}C${point(boundary, edges.top[i]!)} ${point(boundary, edges.top[i + 1]!)} ${point(boundary + layout.transitionZone, edges.top[i + 1]!)}`;
  }
  d += `L${point(layout.along, edges.top[n - 1]!)}L${point(layout.along, edges.bottom[n - 1]!)}`;
  for (let i = n - 2; i >= 0; i--) {
    const boundary = (i + 1) * layout.stepSize;
    d += `L${point(boundary + layout.transitionZone, edges.bottom[i + 1]!)}C${point(boundary, edges.bottom[i + 1]!)} ${point(boundary, edges.bottom[i]!)} ${point(boundary - layout.transitionZone, edges.bottom[i]!)}`;
  }
  return `${d}L${point(0, edges.bottom[0]!)}Z`;
}

/** Sample the actual boundary cubic, keeping illustrative particles inside its smooth taper. */
export function funnelEdgeAt(edges: readonly number[], along: number, layout: FunnelLayout): number {
  validateEdges(edges, layout);
  if (!Number.isFinite(along)) throw new Error('Funnel edge sample position must be finite.');
  if (!edges.length) return 0;
  if (!layout.stepSize || !layout.transitionZone) return edges[0]!;
  const a = clamp(along, 0, layout.along), i = clamp(Math.floor(a / layout.stepSize), 0, edges.length - 1);
  const before = i * layout.stepSize, after = (i + 1) * layout.stepSize;
  let boundary: number, start: number, end: number;
  if (i > 0 && a < before + layout.transitionZone) { boundary = before; start = edges[i - 1]!; end = edges[i]!; }
  else if (i < edges.length - 1 && a > after - layout.transitionZone) { boundary = after; start = edges[i]!; end = edges[i + 1]!; }
  else return edges[i]!;
  // The shared along-axis cubic is monotonic. A bounded binary inversion gives
  // the reference's smooth edge rather than a linear transition shortcut.
  let lo = 0, hi = 1;
  for (let k = 0; k < 14; k++) {
    const t = (lo + hi) / 2, u = 1 - t;
    const x = u ** 3 * (boundary - layout.transitionZone) + 3 * u ** 2 * t * boundary
      + 3 * u * t ** 2 * boundary + t ** 3 * (boundary + layout.transitionZone);
    if (x < a) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2, fraction = t * t * (3 - 2 * t);
  return start + (end - start) * fraction;
}

/** Resolve a local pointer into an ordered step, or null for empty data. */
export function funnelStageAt(layout: FunnelLayout, x: number, y: number, stageCount: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(stageCount)
    || stageCount < 0 || stageCount > FUNNEL_LIMITS.stages) throw new Error('Funnel hit testing requires finite coordinates and a bounded stage count.');
  if (!stageCount) return null;
  if (!layout.stepSize) return 0;
  return clamp(Math.floor((layout.vertical ? y : x) / layout.stepSize), 0, stageCount - 1);
}
