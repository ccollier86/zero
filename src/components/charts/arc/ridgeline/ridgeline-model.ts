/**
 * Genuine observation statistics and Gaussian KDE adapted from Arc Free
 * (MIT), copyright 2026 Elia Kuratli. Pure deterministic math; no fabricated
 * observations or inference that density equals an exact percentile.
 */
import { ARC_DISTRIBUTION_LIMITS as LIMITS, ownArray, ownNumber, ownRecord, ownString, uniqueId, requireKeys, optionNumber } from "../streamgraph/distribution-admission";
export interface RidgelineSeries {
  /** Stable identity. A ridge that survives a data change morphs into its new shape. */
  id: string;
  label: string;
  /** Raw observations. The ridge is a smoothed density of these values. */
  values: readonly number[];
}


export type RidgelineStats = { q1: number|null; median: number|null; q3: number|null; min: number|null; max: number|null; n: number; sorted: number[] };
export type RidgelineShape = { xs: number[]; ys: number[]; row: number; q1: number; median: number; q3: number };


export const RIDGELINE_SAMPLES=96;
const SAMPLES=RIDGELINE_SAMPLES;
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export function ridgelineQuantile(sorted: number[], q: number) {
  if(!Number.isFinite(q)||q<0||q>1)throw new RangeError("Quantile must be within [0,1]");
  const admitted=ownArray(sorted,LIMITS.observations,"Sorted observations").map(v=>ownNumber(v,"Quantile observation"));
  if(admitted.some((value,index)=>index>0&&value<admitted[index-1]!))throw new TypeError("Quantiles require sorted observations");
  if (!admitted.length) return null;
  sorted=admitted;
  const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}
export function ridgelineStats(values: readonly number[]): RidgelineStats {
  const sorted = ownArray(values,LIMITS.observations,"Ridgeline observations").map(v=>ownNumber(v,"Ridgeline observation")).sort((a, b) => a - b);
  if(!sorted.length)return {sorted,n:0,min:null,max:null,q1:null,median:null,q3:null};
  return { sorted, n: sorted.length, min: sorted[0]!, max: sorted[sorted.length - 1]!, q1: ridgelineQuantile(sorted, .25), median: ridgelineQuantile(sorted, .5), q3: ridgelineQuantile(sorted, .75) };
}
export function ridgelineBandwidth(stats: RidgelineStats) {
  if (stats.n < 2) return 1;
  const mean = stats.sorted.reduce((sum, value) => sum + value, 0) / stats.n;
  const sd = Math.sqrt(stats.sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (stats.n - 1));
  const spread = Math.min(sd, (stats.q3! - stats.q1!) / 1.34 || sd);
  return Math.max(1e-6, .9 * (spread || 1) * Math.pow(stats.n, -.2));
}
export function ridgelineNiceStep(span: number, count: number) {
  const raw = span / Math.max(1, count) || 1, power = Math.pow(10, Math.floor(Math.log10(raw))), unit = raw / power;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
}
/** Integer-indexed, representability-aware ticks cannot stall on value += step. */
export function computeRidgelineTicks(lo:number,hi:number,count:number):{step:number;ticks:number[]} {
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>=hi||!Number.isFinite(count)||count<1)throw new RangeError("Tick domain and count must be finite and increasing");
 const target=Math.max(2,Math.min(32,Math.floor(count))),span=hi-lo;
 const ordinary=ridgelineNiceStep(span,target);
 const spacing=Math.max(Math.abs(lo),Math.abs(hi))*Number.EPSILON;
 const step=Math.max(ordinary,Math.min(span,spacing));
 if(!(step>0)||!Number.isFinite(step))return {step:span,ticks:[lo,hi]};
 const first=Math.ceil(lo/step)*step,ticks:number[]=[];
 // 64 is a hard work budget independent of source/container magnitude.
 for(let index=0;index<64;index++){
  const raw=first+index*step;
  if(!Number.isFinite(raw)||raw>hi)break;
  if(raw<lo)continue;
  const value=step>=1e-6&&Math.abs(raw)<1e9?Math.round(raw*1e6)/1e6:raw;
  if(value>=lo&&value<=hi&&(ticks.length===0||value>ticks[ticks.length-1]!))ticks.push(value===0?0:value);
 }
 if(!ticks.length)ticks.push(lo,hi);
 return {step,ticks};
}
/** Samples a Gaussian kernel density across the domain. */
export function ridgelineDensity(stats: RidgelineStats, lo: number, hi: number, bandwidth: number) {
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>=hi)throw new RangeError("KDE domain must increase");
  optionNumber(bandwidth,1,1e-6,1e12,"KDE bandwidth");
  const xs: number[] = [], ys: number[] = [];
  const norm = 1 / (Math.max(1, stats.n) * bandwidth * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / (SAMPLES - 1);
    let sum = 0;
    for (const value of stats.sorted) { const u = (x - value) / bandwidth; if (u > -5 && u < 5) sum += Math.exp(-.5 * u * u); }
    xs.push(x); ys.push(sum * norm);
  }
  return { xs, ys };
}
export const ridgelineHeightAt = (shape: RidgelineShape, x: number) => {
  const { xs, ys } = shape;
  if (x <= xs[0]! || x >= xs[xs.length - 1]!) return 0;
  let i = 1;
  while (i < xs.length - 1 && xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]! || 1);
  return mix(ys[i - 1]!, ys[i]!, t);
};


/** Validate signed raw observations and detach every array before statistics. */
export function admitRidgelineSeries(input: readonly RidgelineSeries[]): RidgelineSeries[] {
 const ids=new Set<string>(); let count=0;
 return Object.freeze(ownArray(input,LIMITS.ridges,"Ridgeline series").map(value=>{
 const r=ownRecord(value,"Ridgeline series");requireKeys(r,["id","label","values"],"Ridgeline series");
 const values=ownArray(r.values,LIMITS.observations,"Ridgeline observations").map(v=>ownNumber(v,"Ridgeline observation"));
 count+=values.length;if(count>LIMITS.observations)throw new RangeError("Ridgeline exceeds 16384 observations");
 return Object.freeze({id:uniqueId(r.id,ids,"Ridgeline id"),label:ownString(r.label,"Ridgeline label"),values:Object.freeze(values) as unknown as number[]});
 })) as unknown as RidgelineSeries[];
}
/** Build shared-domain densities and exact descriptive statistics. */
export function buildRidgelineModel(input: readonly RidgelineSeries[], options: {domain?:readonly [number,number];bandwidth?:number} = {}) {
 const series=admitRidgelineSeries(input);
 const domain=options.domain;
 if(domain){ownArray(domain,2,"Ridgeline domain");if(domain.length!==2||ownNumber(domain[0],"Domain lower")>=ownNumber(domain[1],"Domain upper"))throw new RangeError("Ridgeline domain must increase");}
 const bandwidth=options.bandwidth===undefined?undefined:optionNumber(options.bandwidth,1,1e-6,1e12,"Ridgeline bandwidth");
    const stats = series.map(entry => ridgelineStats(entry.values));
    const widths = stats.map(entry => bandwidth ?? ridgelineBandwidth(entry));
    const filled = stats.map((entry, index) => ({ entry, room: 2.5 * widths[index]! })).filter(({ entry }) => entry.n);
    let lo = domain?.[0] ?? Math.min(...filled.map(({ entry, room }) => entry.min! - room));
    let hi = domain?.[1] ?? Math.max(...filled.map(({ entry, room }) => entry.max! + room));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = 0; hi = 1; }
    if (!domain) { const step = ridgelineNiceStep(hi - lo, 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; }
    const curves = stats.map((entry, index) => entry.n ? ridgelineDensity(entry, lo, hi, widths[index]!) : { xs: Array.from({ length: SAMPLES }, (_, i) => lo + ((hi - lo) * i) / (SAMPLES - 1)), ys: new Array(SAMPLES).fill(0) });
    const peak = Math.max(0, ...curves.flatMap(curve => curve.ys)) || 1;
    const shapes = new Map<string, RidgelineShape>(series.map((entry, index) => { const curve = curves[index]!, stat = stats[index]!; return [entry.id, { xs: curve.xs, ys: curve.ys.map(y => y / peak), row: index, q1: stat.q1??0, median: stat.median??0, q3: stat.q3??0 }]; }));
    return { series, stats: new Map(series.map((entry, index) => [entry.id, stats[index]!])), shapes, lo, hi };

}
/** Exact empirical cumulative share of supplied observations, not the KDE. */
export function inspectRidgeline(stats: RidgelineStats, value:number): number|null {
 if(typeof value!=="number"||!Number.isFinite(value))throw new TypeError("Ridgeline reading must be finite"); if(!stats.n)return null;
 let lo=0,hi=stats.sorted.length;while(lo<hi){const at=(lo+hi)>>>1;if(stats.sorted[at]!<=value)lo=at+1;else hi=at;}return lo/stats.n;
}
