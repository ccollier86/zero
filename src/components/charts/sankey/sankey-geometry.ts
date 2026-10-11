/** SVG/canvas geometry for Sankey ribbons, independent of React, data access and animation scheduling. */
import type { SankeyLinkGeometry, SankeyNodeGeometry } from './sankey-types';

export type SankeyPoint = readonly [number, number];
export type SankeyCurve = readonly [SankeyPoint, SankeyPoint, SankeyPoint, SankeyPoint];
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const segment = (time: number, start: number, end: number) => clamp((time - start) / (end - start));
export const easeInOut = (t: number) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
const round = (n: number) => Math.round(n * 10) / 10;

/** Evaluate one cubic curve; callers transform along/cross coordinates into plot pixels. */
export function cubicPoint(curve: SankeyCurve, t: number): SankeyPoint {
  const [a, b, c, d] = curve, u = 1 - t;
  return [u ** 3 * a[0] + 3 * u ** 2 * t * b[0] + 3 * u * t ** 2 * c[0] + t ** 3 * d[0],
    u ** 3 * a[1] + 3 * u ** 2 * t * b[1] + 3 * u * t ** 2 * c[1] + t ** 3 * d[1]];
}
const mixPoint = (a: SankeyPoint, b: SankeyPoint, t: number): SankeyPoint => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
function split(curve: SankeyCurve, t: number): [SankeyCurve, SankeyCurve] {
  const [p0, p1, p2, p3] = curve, a = mixPoint(p0, p1, t), b = mixPoint(p1, p2, t), c = mixPoint(p2, p3, t);
  const d = mixPoint(a, b, t), e = mixPoint(b, c, t), f = mixPoint(d, e, t);
  return [[p0, a, d, f], [f, e, c, p3]];
}
function subCurve(curve: SankeyCurve, start: number, end: number): SankeyCurve {
  let out = end < 1 ? split(curve, end)[0] : curve;
  if (start > 0) out = split(out, start / end)[1];
  return out;
}
/** Both ribbon edges share along-axis controls, allowing clean partial-width and partial-length traces. */
export function ribbonCurves(g: SankeyLinkGeometry): [SankeyCurve, SankeyCurve] {
  const mid = (g.as + g.at) / 2;
  return [[[g.as, g.s0], [mid, g.s0], [mid, g.t0], [g.at, g.t0]],
    [[g.as, g.s0 + g.w], [mid, g.s0 + g.w], [mid, g.t0 + g.w], [g.at, g.t0 + g.w]]];
}
/** Serialize only finite layout geometry; labels and IDs never enter SVG markup. */
export function ribbonPath(g: SankeyLinkGeometry, P: (a: number, c: number) => readonly [number, number],
  fractionStart = 0, fractionEnd = 1, alongStart = 0, alongEnd = 1): string {
  if (alongEnd - alongStart < .001 || fractionEnd - fractionStart < .0001 || g.w * (fractionEnd - fractionStart) < .05) return 'M0,0';
  const mid = (g.as + g.at) / 2, edge = (f: number): SankeyCurve => [[g.as, g.s0 + g.w * f],
    [mid, g.s0 + g.w * f], [mid, g.t0 + g.w * f], [g.at, g.t0 + g.w * f]];
  const top = subCurve(edge(fractionStart), alongStart, alongEnd), bottom = subCurve(edge(fractionEnd), alongStart, alongEnd);
  const p = (point: SankeyPoint) => P(...point).map(round).join(',');
  return `M${p(top[0])}C${p(top[1])} ${p(top[2])} ${p(top[3])}L${p(bottom[3])}C${p(bottom[2])} ${p(bottom[1])} ${p(bottom[0])}Z`;
}
export function collapseNode(g: SankeyNodeGeometry): SankeyNodeGeometry { const mid = (g.c0 + g.c1) / 2; return { ...g, c0: mid, c1: mid }; }
export function collapseLink(g: SankeyLinkGeometry): SankeyLinkGeometry { return { ...g, s0: g.s0 + g.w / 2, t0: g.t0 + g.w / 2, w: 0 }; }
export function mixNode(a: SankeyNodeGeometry, b: SankeyNodeGeometry, t: number): SankeyNodeGeometry {
  return { ...b, a0: lerp(a.a0, b.a0, t), a1: lerp(a.a1, b.a1, t), c0: lerp(a.c0, b.c0, t),
    c1: lerp(a.c1, b.c1, t), la: lerp(a.la, b.la, t), lc: lerp(a.lc, b.lc, t) };
}
export function mixLink(a: SankeyLinkGeometry, b: SankeyLinkGeometry, t: number): SankeyLinkGeometry {
  return { as: lerp(a.as, b.as, t), at: lerp(a.at, b.at, t), s0: lerp(a.s0, b.s0, t), t0: lerp(a.t0, b.t0, t), w: lerp(a.w, b.w, t) };
}
