/** Brush time-series types, admission, window/decimation math. Pure layer; Arc UI MIT Copyright (c) 2026 Elia Kuratli. */
import { CARTESIAN_LIMITS, ownChartArray, ownChartRecord, chartNumber, chartText,chartEpoch,chartWindow,chartDimension } from "../line-chart/cartesian-admission";
export interface BrushChartDatum {
  /** A point in time, as a Date or epoch milliseconds. Points must be in ascending order. */
  readonly date: Date | number;
  readonly value: number;
}

export interface BrushChartAnnotation {
  readonly date: Date | number;
  /** Short label printed beside the marker, such as "v2 launch". */
  readonly label: string;
  /** Longer note for the tooltip and screen readers. */
  readonly description?: string;
}


export type Point={t:number;value:number};
export const BRUSH_CHART_DAY=86_400_000;
const DAY=BRUSH_CHART_DAY;
const clean=(value:number)=>Number(value.toPrecision(12));
const utc=(options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',...options});
const dayTick=utc({month:'short',day:'numeric'}),monthTick=utc({month:'short'}),yearTick=utc({year:'numeric'});
/** Clean gridlines from zero: the smallest step of 1, 2, 2.5, or 5 that covers the data in four rows or fewer. */
export function computeBrushChartScale(high: number) {
  const hi = Math.max(high, 1), magnitude = 10 ** Math.floor(Math.log10(hi / 4));
  for (const factor of [1, 2, 2.5, 5, 10]) { const step = factor * magnitude, top = Math.ceil(hi / step) * step; if (top / step <= 4 + 1e-9) return { top: clean(top), step: clean(step) }; }
  return { top: hi, step: hi / 4 };
}

/** Calendar ticks that fit the width: days, weeks, then months, quarters, and years, each landing on a real boundary. */
export function computeBrushChartTimeTicks(start: number, end: number, width: number) {
  chartEpoch(start,'start');chartEpoch(end,'end');chartDimension(width,'width');if(start>end)throw new TypeError('time bounds must be ordered');
  const room = Math.max(2, Math.floor(width / 76)), span = end - start;
  for (const days of [1, 2, 7, 14]) {
    if (span / (days * DAY) > room) continue;
    const ticks: { t: number; label: string }[] = [];
    let t = Math.ceil(start / DAY) * DAY;
    if (days >= 7) for(let day=0;day<7&&new Date(t).getUTCDay()!==1;day++) t += DAY;
    for (; t <= end; t += days * DAY) ticks.push({ t, label: dayTick.format(t) });
    return ticks;
  }
  for (const months of [1, 2, 3, 6, 12]) {
    if (span / (months * 30.44 * DAY) > room) continue;
    const ticks: { t: number; label: string }[] = [];
    const first = new Date(start);
    let y = first.getUTCFullYear(), m = first.getUTCMonth() + (first.getUTCDate() > 1 || first.getUTCHours() > 0 ? 1 : 0);
    for (let month=0;month<room*months+24;month++) {
      y += Math.floor(m / 12); m %= 12;
      const date=new Date(0);date.setUTCFullYear(y,m,1);date.setUTCHours(0,0,0,0);const t=date.getTime();
      if (!Number.isFinite(t)||t > end) break;
      if (m % months === 0) ticks.push({ t, label: m === 0 ? yearTick.format(t) : monthTick.format(t) });
      m += 1;
    }
    return ticks;
  }
  const ticks: { t: number; label: string }[] = [];
  const firstYear = new Date(start).getUTCFullYear() + 1, lastYear = new Date(end).getUTCFullYear();
  const stride = Math.max(1, Math.ceil((lastYear - firstYear + 1) / room));
  for (let y = firstYear; y <= lastYear; y += stride){const date=new Date(0);date.setUTCFullYear(y,0,1);date.setUTCHours(0,0,0,0);const t=date.getTime();if(Number.isFinite(t))ticks.push({t,label:String(y)});}
  return ticks;
}

/** First index at or after t. */
export function brushChartLowerBound(points: Point[], t: number) {
  let low = 0, high = points.length;
  while (low < high) { const middle = (low + high) >> 1; if (points[middle]!.t < t) low = middle + 1; else high = middle; }
  return low;
}

/** A line through the points in view. Past two points per pixel, each pixel column keeps only its low and high so spikes survive. */
export function computeBrushChartLinePath(points: Point[], from: number, to: number, x: (t: number) => number, y: (value: number) => number, width: number) {
  const slice = points.slice(Math.max(0, from), Math.min(points.length, to));
  if (!slice.length) return "";
  const parts: string[] = [];
  if (slice.length <= width * 2) { for (const point of slice) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`); }
  else {
    let column = -1, low: Point | null = null, high: Point | null = null;
    const flush = () => { if (!low || !high) return; const pair = low.t < high.t ? [low, high] : [high, low]; for (const point of pair) parts.push(`${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`); };
    for (const point of slice) {
      const at = Math.floor(x(point.t));
      if (at !== column) { flush(); column = at; low = high = point; continue; }
      if (point.value < low!.value) low = point;
      if (point.value > high!.value) high = point;
    }
    flush();
  }
  return `M${parts.join("L")}`;
}


/** Detached epoch data and ordered events. Dates are copied to epoch values, not retained mutable objects. */
export interface BrushChartModel {readonly data:readonly BrushChartDatum[];readonly annotations:readonly BrushChartAnnotation[]}
/** Admit sorted unique finite timestamps and bounded finite nonnegative observations. */
export function buildBrushChartModel(data:readonly BrushChartDatum[],annotations:readonly BrushChartAnnotation[]=[]):BrushChartModel {
 let previous=-Infinity;
 const points=ownChartArray(data,'data',CARTESIAN_LIMITS.brushPoints).map((value,index)=>{
  const item=ownChartRecord(value,`data[${index}]`,['date','value']);const date=chartEpoch(item.date,'datum.date');if(date<=previous)throw new TypeError('dates must be strictly ascending');previous=date;
  return Object.freeze({date,value:chartNumber(item.value,'datum.value',true)});
 });
 const dates=new Set<number>();const events=ownChartArray(annotations,'annotations',CARTESIAN_LIMITS.annotations).map((value,index)=>{
  const item=ownChartRecord(value,`annotations[${index}]`,['date','label','description']);const date=chartEpoch(item.date,'annotation.date');if(dates.has(date))throw new TypeError('annotation dates must be unique');dates.add(date);
  return Object.freeze({date,label:chartText(item.label,'annotation.label'),...(item.description===undefined?{}:{description:chartText(item.description,'annotation.description')})});
 }).sort((a,b)=>a.date-b.date);
 return Object.freeze({data:Object.freeze(points),annotations:Object.freeze(events)});
}
/** Clamp an ordered requested window to real data bounds; empty/single-point inputs have no fabricated interval. */
export function fitBrushChartRange(range:readonly [number,number],whole:readonly [number,number],minSpan:number):[number,number] {
 if(!Number.isFinite(minSpan)||minSpan<0)throw new TypeError('minSpan must be finite and nonnegative');
 const requested=chartWindow(range,'range'),[first,last]=chartWindow(whole,'whole');if(last===first)return[first,first];
 const span=Math.min(last-first,Math.max(Math.min(minSpan,last-first),requested[1]-requested[0]));const start=Math.max(first,Math.min(last-span,requested[0]));return[start,start+span];
}
