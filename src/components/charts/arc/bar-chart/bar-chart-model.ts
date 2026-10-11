/** Bar chart types, bounded admission and column geometry. Pure layer; Arc UI MIT Copyright (c) 2026 Elia Kuratli. */
import { CARTESIAN_LIMITS, ownChartArray, ownChartRecord, chartNumber, chartText } from "../line-chart/cartesian-admission";
export interface BarChartDatum {
  /** Stable identity, such as an ISO date. A bar whose key survives a data change keeps its place, so switching ranges morphs instead of redrawing. */
  readonly id: string;
  /** Full label for the headline and screen readers, such as "Tue, Sep 15". */
  readonly label: string;
  /** Short label under the bar, such as "T" or "Sep 14". Leave it out to keep the axis quiet. */
  readonly axisLabel?: string;
  readonly value: number;
}


const RADIUS=4;
/** Clean gridlines: the smallest step of 1, 2, 3, or 5 that covers the data in four rows or fewer, so shared steps survive a range change. */
export function computeBarChartScale(max: number) {
  const safe = Math.max(max, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safe / 4));
  for (const factor of [1, 2, 3, 5, 10]) {
    const step = factor * magnitude, rows = Math.ceil(safe / step);
    if (rows <= 4) return { top: rows * step, ticks: Array.from({ length: rows + 1 }, (_, row) => row * step) };
  }
  return { top: safe, ticks: [0, safe] };
}

/** A column that grows from a square baseline to a softly rounded data end. */
export function computeBarChartPath(x: number, w: number, h: number, base: number) {
  if (w <= 0 || h <= .01) return `M${x.toFixed(2)} ${base}H${(x + Math.max(w, 0)).toFixed(2)}Z`;
  const r = Math.min(RADIUS, w / 2, h), top = base - h, f = (value: number) => value.toFixed(2);
  return `M${f(x)} ${base}V${f(top + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(top)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(top + r)}V${base}Z`;
}


/** Detached immutable bars with exact aggregate readouts. */
export interface BarChartModel {readonly data:readonly BarChartDatum[];readonly total:number;readonly average:number;readonly peak:number}
/** Admit finite nonnegative observations, stable unique IDs, and bounded work. */
export function buildBarChartModel(data:readonly BarChartDatum[]):BarChartModel {
 const ids=new Set<string>();const points=ownChartArray(data,'data',CARTESIAN_LIMITS.points).map((value,index)=>{
  const item=ownChartRecord(value,`data[${index}]`,['id','label','axisLabel','value']);const id=chartText(item.id,'datum.id',true);
  if(ids.has(id))throw new TypeError('datum IDs must be unique');ids.add(id);
  return Object.freeze({id,label:chartText(item.label,'datum.label'),...(item.axisLabel===undefined?{}:{axisLabel:chartText(item.axisLabel,'datum.axisLabel')}),value:chartNumber(item.value,'datum.value',true)});
 });
 const total=points.reduce((sum,point)=>sum+point.value,0);
 return Object.freeze({data:Object.freeze(points),total,average:points.length?total/points.length:0,peak:points.reduce((max,point)=>Math.max(max,point.value),0)});
}
