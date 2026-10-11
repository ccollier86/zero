/**
 * Arc UI Free derivation. Copyright (c) 2026 Elia Kuratli, MIT.
 * Zero chart model layer: detached finite admission and mathematical layout;
 * no React, browser globals, subscriptions, authorization or transport.
 */
import type { DonutChartDatum } from "./donut-chart-types";
import { isChartCssColor } from '../../chart-color';
export const DONUT_LIMITS = Object.freeze({ data: 256, segments: 64, size: 4096 });
export interface DonutSlice extends Readonly<DonutChartDatum> { readonly members?: readonly Readonly<DonutChartDatum>[] }
export interface DonutModel { readonly data: readonly Readonly<DonutChartDatum>[]; readonly slices: readonly DonutSlice[]; readonly total: number; readonly otherId: string; readonly totalId: string }
const CHART = "Donut";
const TAU = Math.PI * 2;

const fail = (message: string): never => { throw new TypeError(CHART + ": " + message); };
function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("expected own plain data");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) fail("unknown or accessor field");
  }
  const own = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) own[key] = descriptor.value;
  return own;
}
function text(value: unknown, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.length > 4096) fail("invalid text");
  return value as string;
}
function color(value: unknown): string { const result=text(value); if(!isChartCssColor(result)) fail("expected a supported resource-free CSS color"); return result; }
function number(value: unknown, minimum = 0, maximum = 1e12): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail("expected finite bounded number");
  return value as number;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  const n = number(value, minimum, maximum); if (!Number.isInteger(n)) fail("expected integer"); return n;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("expected ordinary bounded array");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if(typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > maximum) fail("expected bounded array");
  for(const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as string];
    if(typeof key !== "string" || (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) || !descriptor || !("value" in descriptor)) fail("accessor or extra array field");
  }
  const detached: unknown[] = [];
  for(let i=0; i<length; i++) { const descriptor = descriptors[String(i)]; if(!descriptor || !("value" in descriptor)) fail("sparse or accessor array"); detached.push(descriptor.value); }
  return detached;
}

/** Validate and detach parts, and group only two or more small parts into a collision-free Other identity. */
export function detachDonutIds(value: readonly string[]): string[] { return list(value, DONUT_LIMITS.data).map(item=>{ const id=text(item); if(!id || id.length>256) fail("invalid hidden identity"); return id; }); }

/** Validate and detach parts, and group only two or more small parts into a collision-free Other identity. */
export function buildDonutModel(input: readonly DonutChartDatum[], groupBelow = .04, maxSegments = 6, otherLabel = "Other"): DonutModel {
  number(groupBelow, 0, 1); integer(maxSegments, 2, DONUT_LIMITS.segments); text(otherLabel);
  const ids = new Set<string>(); let total = 0;
  const data = list(input, DONUT_LIMITS.data).map(raw => {
    const r = plain(raw, ["id", "label", "value", "color"]), id = text(r.id);
    if (!id || id.length > 256 || ids.has(id)) fail("invalid or duplicate identity"); ids.add(id);
    const value = number(r.value); total += value; if(total > 1e12) fail("total budget exceeded");
    return Object.freeze({ id, label: text(r.label, id), value, ...(r.color !== undefined ? { color: color(r.color) } : {}) });
  });
  const unused = (base: string) => { let id = base, suffix = 0; while(ids.has(id)) id = `${base}:${++suffix}`; ids.add(id); return id; };
  const otherId = unused("@zero/other"), totalId = unused("@zero/total");
  const slices = sliceData(data, groupBelow, maxSegments, otherLabel, otherId);
  for(const slice of slices) { if(slice.members) Object.freeze(slice.members); Object.freeze(slice); }
  return Object.freeze({ data: Object.freeze(data), slices: Object.freeze(slices), total, otherId, totalId });
}
/** Reject dimensions that could produce invalid radii, paths or unbounded SVG allocations. */
export function validateDonutGeometry(size: number, thickness: number): void {
  number(size, 48, DONUT_LIMITS.size); number(thickness, 1, size / 2 - 15);
}

/** Small parts join one "Other" segment, but only when at least two would; grouping a single part hides it for nothing. */
function sliceData(data: readonly DonutChartDatum[], groupBelow: number, maxSegments: number, otherLabel: string, otherId: string): DonutSlice[] {
  const parts = data.filter(item => item.value > 0);
  const total = parts.reduce((sum, item) => sum + item.value, 0);
  if (!total) return [];
  const ranked = [...parts].sort((a, b) => b.value - a.value);
  const keep = new Set(ranked.filter((item, rank) => item.value / total >= groupBelow && rank < maxSegments - 1).map(item => item.id));
  const rest = parts.filter(item => !keep.has(item.id));
  if (rest.length < 2) return parts.map(item => ({ ...item }));
  return [...parts.filter(item => keep.has(item.id)).map(item => ({ ...item })), { id: otherId, label: otherLabel, value: rest.reduce((sum, item) => sum + item.value, 0), members: rest }];
}

/** Turns of the ring for each slice in data order; a hidden slice closes to a point where it sits. */
export function computeDonutLayout(slices: readonly DonutSlice[], hidden: ReadonlySet<string>) {
  const total = slices.reduce((sum, item) => sum + (hidden.has(item.id) ? 0 : item.value), 0) || 1;
  let at = 0;
  return new Map(slices.map(item => { const arc = { start: at, end: at + (hidden.has(item.id) ? 0 : item.value / total) }; at = arc.end; return [item.id, arc]; }));
}

/** Half the width, in pixels, of a sector's outer edge once the gap is cut; below a couple of pixels a segment fades rather than drawing a hairline. */
export function donutBreadth(R: number, t0: number, t1: number, gap: number) {
  const turns = t1 - t0;
  if (turns >= 1 - 1e-6) return Infinity;
  return Math.sin(Math.min(turns * Math.PI, Math.PI / 2)) * R - Math.min(gap / 2, ((1 - turns) * TAU * R) / 2);
}

const n2 = (value: number) => (Math.round(value * 100) / 100).toString();
/**
 * An annular sector between two turns of the ring, measured clockwise from the top, with rounded corners.
 * Its sides run parallel to the radius at a fixed distance, so the gap between neighbours is the same number of pixels from the inner edge to the outer one.
 * A thin sector narrows to a wedge and then to nothing, so a closing segment never pops.
 */
export function donutSectorPath(c: number, R: number, r: number, t0: number, t1: number, gap: number, corner: number) {
  const turns = t1 - t0;
  if (turns <= 1e-6) return "";
  const at = (radius: number, angle: number) => `${n2(c + radius * Math.cos(angle))} ${n2(c + radius * Math.sin(angle))}`;
  if (turns >= 1 - 1e-6) return `M${at(R, -Math.PI / 2)}A${n2(R)} ${n2(R)} 0 1 1 ${at(R, Math.PI / 2)}A${n2(R)} ${n2(R)} 0 1 1 ${at(R, -Math.PI / 2)}ZM${at(r, -Math.PI / 2)}A${n2(r)} ${n2(r)} 0 1 0 ${at(r, Math.PI / 2)}A${n2(r)} ${n2(r)} 0 1 0 ${at(r, -Math.PI / 2)}Z`;
  // Half the gap on each side; a lone segment closes its gap as the rest of the ring empties, so it becomes a whole ring without a jump.
  const p = Math.min(gap / 2, ((1 - turns) * TAU * R) / 2);
  const a0 = t0 * TAU - Math.PI / 2, a1 = t1 * TAU - Math.PI / 2, half = (a1 - a0) / 2, s = Math.sin(Math.min(half, Math.PI / 2));
  if (s * R <= p + 1e-6) return "";
  const side = (t: number, angle: number, sign: number) => `${n2(c + t * Math.cos(angle) - sign * p * Math.sin(angle))} ${n2(c + t * Math.sin(angle) + sign * p * Math.cos(angle))}`;
  const band = (R - r) / 2;
  const ro = Math.max(0, Math.min(corner, band, s >= .9999 ? Infinity : (s * R - p) / (1 + s)));
  const dO = Math.asin(Math.min(1, (p + ro) / (R - ro))), tO = Math.sqrt(Math.max(0, (R - ro) ** 2 - (p + ro) ** 2));
  const bigO = a1 - a0 - 2 * dO > Math.PI ? 1 : 0;
  let d = `M${side(tO, a0, 1)}`;
  if (ro > .01) d += `A${n2(ro)} ${n2(ro)} 0 0 1 ${at(R, a0 + dO)}`;
  d += `A${n2(R)} ${n2(R)} 0 ${bigO} 1 ${at(R, a1 - dO)}`;
  if (ro > .01) d += `A${n2(ro)} ${n2(ro)} 0 0 1 ${side(tO, a1, -1)}`;
  if (s * r > p + 1e-6 || s >= .9999) {
    const ri = Math.max(0, Math.min(corner, band, s >= .9999 ? Infinity : (s * r - p) / (1 - s)));
    const dI = Math.asin(Math.min(1, (p + ri) / (r + ri))), tI = Math.sqrt(Math.max(0, (r + ri) ** 2 - (p + ri) ** 2));
    const bigI = a1 - a0 - 2 * dI > Math.PI ? 1 : 0;
    d += `L${side(tI, a1, -1)}`;
    if (ri > .01) d += `A${n2(ri)} ${n2(ri)} 0 0 1 ${at(r, a1 - dI)}`;
    d += `A${n2(r)} ${n2(r)} 0 ${bigI} 0 ${at(r, a0 + dI)}`;
    if (ri > .01) d += `A${n2(ri)} ${n2(ri)} 0 0 1 ${side(tI, a0, 1)}`;
  } else d += `L${at(p / s, (a0 + a1) / 2)}`;
  return `${d}Z`;
}
