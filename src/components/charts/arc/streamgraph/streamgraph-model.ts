/**
 * Streamgraph model and monotone/wiggle math adapted from Arc Free (MIT),
 * copyright 2026 Elia Kuratli. Pure deterministic presentation; no DOM/network.
 */
import { ARC_DISTRIBUTION_LIMITS as LIMITS, ownArray, ownNumber, ownRecord, ownString, ownPaintColor, uniqueId, requireKeys } from "./distribution-admission";
export interface StreamgraphSeries {
  /** Stable identity. A layer keeps its place and color across data changes, so switching datasets morphs it. */
  id: string;
  /** Name in the legend, the direct label, the tooltip, and the data table. */
  label: string;
  /** Any CSS color. Defaults to the chart series for the first four layers (the first in the accent), then neutral steps. */
  color?: string;
}

export interface StreamgraphDatum {
  /** Stable identity, such as an ISO week. */
  id: string;
  /** Full label for the tooltip and screen readers, such as "Week of Sep 14". */
  label: string;
  /** Short label on the time axis. Leave it out to keep the axis quiet at that point. */
  axisLabel?: string;
  /** One value per series key. Missing own values count as zero; negative/nonfinite values are rejected. */
  values: Readonly<Record<string, number>>;
}


export type StreamgraphOffset = "wiggle" | "silhouette" | "zero";
export const STREAMGRAPH_SAMPLES = 161;
const N = STREAMGRAPH_SAMPLES;
export interface StreamgraphModel { data: StreamgraphDatum[]; series: StreamgraphSeries[] }
/** Validate and detach explicit identities and own nonnegative values before drawing. */
export function buildStreamgraphModel(dataInput: readonly StreamgraphDatum[], seriesInput: readonly StreamgraphSeries[]): StreamgraphModel {
 const seriesIds = new Set<string>();
 const series = ownArray(seriesInput, LIMITS.series, "Streamgraph series").map(input => {
  const r=ownRecord(input,"Streamgraph series"); requireKeys(r,["id","label","color"],"Streamgraph series");
  return Object.freeze({id:uniqueId(r.id,seriesIds,"Series id"),label:ownString(r.label,"Series label"),...(r.color===undefined?{}:{color:ownPaintColor(r.color,"Series color")})});
 });
 const dataIds = new Set<string>();
 const data = ownArray(dataInput,LIMITS.points,"Streamgraph data").map(input=>{
  const r=ownRecord(input,"Streamgraph datum"); requireKeys(r,["id","label","axisLabel","values"],"Streamgraph datum");
  const v=ownRecord(r.values,"Streamgraph values"), values: Record<string,number> = Object.create(null);
  if(Object.keys(v).some(key=>!seriesIds.has(key))) throw new TypeError("Streamgraph values name an unknown series");
  let total=0;
  for(const s of series){const n=Object.hasOwn(v,s.id)?ownNumber(v[s.id],"Streamgraph value",true):0; values[s.id]=n; total+=n;}
  if(total>LIMITS.magnitude) throw new RangeError("Streamgraph period total exceeds 1e12");
  return Object.freeze({id:uniqueId(r.id,dataIds,"Datum id"),label:ownString(r.label,"Datum label"),...(r.axisLabel===undefined?{}:{axisLabel:ownString(r.axisLabel,"Axis label")}),values:Object.freeze(values)});
 });
 if(data.length*series.length>LIMITS.cells) throw new RangeError("Streamgraph exceeds 32768 cells");
 return Object.freeze({data:Object.freeze(data) as unknown as StreamgraphDatum[],series:Object.freeze(series) as unknown as StreamgraphSeries[]});
}
/** The first layer sits in the middle of the stream and the rest alternate above and below it; a flat baseline stacks them in order. */
export function stackStreamgraphOrder(count: number, mode: StreamgraphOffset) {
  if(!Number.isInteger(count)||count<0||count>LIMITS.series||!["wiggle","silhouette","zero"].includes(mode))throw new RangeError("Invalid stream stack order");
  const order = Array.from({ length: count }, (_, index) => index);
  if (mode === "zero") return order;
  return order.reduce<number[]>((list, index) => index === 0 ? [0] : index % 2 ? [...list, index] : [index, ...list], []);
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Resamples values onto the shared grid with monotone cubic tangents, so curves never swing past the data or below zero. */
export function resampleStreamgraph(raw: readonly number[]): number[] {
  const values = ownArray(raw,LIMITS.points,"Streamgraph samples").map(value => ownNumber(value,"Streamgraph sample",true));
  const out = new Array<number>(N);
  if (!values.length) return out.fill(0);
  if (values.length === 1) return out.fill(values[0]!);
  const last = values.length - 1;
  const slopes = values.slice(1).map((value, index) => value - values[index]!);
  const tangents = values.map((_, index) => index === 0 || index === last ? 0 : (Math.sign(slopes[index - 1]!) + Math.sign(slopes[index]!)) * Math.min(Math.abs(slopes[index - 1]!), Math.abs(slopes[index]!), Math.abs(slopes[index - 1]! + slopes[index]!) / 4) || 0);
  if (last > 1) { tangents[0] = (3 * slopes[0]! - tangents[1]!) / 2; tangents[last] = (3 * slopes[last - 1]! - tangents[last - 1]!) / 2; } else { tangents[0] = tangents[1] = slopes[0]!; }
  for (let k = 0; k < N; k++) {
    const at = (k / (N - 1)) * last, seg = Math.min(last - 1, Math.floor(at)), t = at - seg, t2 = t * t, t3 = t2 * t;
    const a = values[seg]!, b = values[seg + 1]!;
    const value = (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * tangents[seg]! + (3 * t2 - 2 * t3) * b + (t3 - t2) * tangents[seg + 1]!;
    out[k] = clamp(value, Math.min(a, b), Math.max(a, b));
  }
  return out;
}

/** The baseline under the stack. Wiggle follows Byron and Wattenberg, then removes its linear drift so the stream stays level. */
export function computeStreamgraphBaseline(input: readonly (readonly number[])[], mode: StreamgraphOffset): number[] {
  const layers = ownArray(input, LIMITS.series, "Streamgraph layers").map(value => {
    const samples = ownArray(value, N, "Streamgraph layer");
    if (samples.length !== N) throw new RangeError("Streamgraph layers require 161 samples");
    return samples.map(sample => ownNumber(sample, "Streamgraph layer", true));
  });
  stackStreamgraphOrder(layers.length, mode);
  const g = new Array<number>(N).fill(0);
  const totals = g.map((_, j) => layers.reduce((sum, layer) => sum + layer[j]!, 0));
  if (mode === "zero" || !layers.length) return g;
  if (mode === "silhouette") return totals.map(total => -total / 2);
  for (let j = 1; j < N; j++) {
    let s1 = 0, s2 = 0, below = 0;
    for (const layer of layers) {
      const change = layer[j]! - layer[j - 1]!;
      s1 += layer[j]!;
      s2 += (below + change / 2) * layer[j]!;
      below += change;
    }
    g[j] = g[j - 1]! - (s1 ? s2 / s1 : 0);
  }
  // Least squares line through the centre of the stream, subtracted so it never tilts off the plot.
  const centers = g.map((value, j) => value + totals[j]! / 2);
  const mx = (N - 1) / 2, my = centers.reduce((sum, value) => sum + value, 0) / N;
  let num = 0, den = 0;
  centers.forEach((value, j) => { num += (j - mx) * (value - my); den += (j - mx) ** 2; });
  const slope = den ? num / den : 0;
  return g.map((value, j) => value - (my + slope * (j - mx)));
}
