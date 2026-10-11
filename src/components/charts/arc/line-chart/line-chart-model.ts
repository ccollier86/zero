/** Line chart types, admission and monotone geometry. Pure headless layer; Arc UI MIT Copyright (c) 2026 Elia Kuratli. */
import { CARTESIAN_LIMITS, ownChartArray, ownChartRecord, chartNumber, chartText,chartColor } from "./cartesian-admission";
export interface LineChartSeries {
  /** Stable identity. A series keeps its line across data changes, so switching ranges morphs the path instead of redrawing it. */
  readonly id: string;
  /** Name in the legend, the tooltip, and the data table. */
  readonly label: string;
  /** Any CSS color. Defaults to the accent for the first series, then quieter neutral steps. */
  readonly color?: string;
  /** Draws a dashed stroke, useful for a previous period or a target. */
  readonly dashed?: boolean;
  /** Fills the area under the line with a faint tint of its color. Defaults to true for the first series. */
  readonly area?: boolean;
}

export interface LineChartDatum {
  /** Stable identity, such as an ISO date. */
  readonly id: string;
  /** Full label for the tooltip and screen readers, such as "Tue, Sep 15". */
  readonly label: string;
  /** Short label on the x axis, such as "Sep 15". Leave it out to keep the axis quiet at that point. */
  readonly axisLabel?: string;
  /** One value per series key. A missing value counts as zero. */
  readonly values: Readonly<Record<string, number | undefined>>;
}


export type Point = [x:number,value:number];
const clamp = (value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
const clean = (value: number) => Number(value.toPrecision(12));

/** Clean gridlines: the smallest step of 1, 2, 2.5, or 5 that covers the data in four rows or fewer, from zero unless the data dips below it. */
export function computeLineChartScale(low: number, high: number) {
  chartNumber(low,'low');chartNumber(high,'high');
  const lo = Math.min(0, low), hi = Math.max(high, lo + 1);
  const span = hi - lo, magnitude = 10 ** Math.floor(Math.log10(span / 4));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const step = factor * magnitude, bottom = Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step;
    if ((top - bottom) / step <= 4 + 1e-9) {
      const ticks: number[] = [];
      const rows=Math.min(4,Math.round((top-bottom)/step));
      for (let row=0;row<=rows;row++) ticks.push(clean(bottom+row*step));
      return { min: clean(bottom), max: clean(top), ticks };
    }
  }
  return { min: lo, max: hi, ticks: [lo, hi] };
}

/** The line through every value, sampled densely on x from 0 to 1 in data units. Monotone cubic tangents keep a smooth curve from swinging past the data. */
export function computeLineChartCurve(values: readonly number[], smooth: boolean): Point[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [[0, values[0]!], [1, values[0]!]];
  const last = values.length - 1, step = 1 / last;
  if (!smooth) return values.map((value, index) => [index * step, value]);
  const slopes = values.slice(1).map((value, index) => (value - values[index]!) / step);
  const tangents = values.map((_, index) => index === 0 || index === last ? 0 : (Math.sign(slopes[index - 1]!) + Math.sign(slopes[index]!)) * Math.min(Math.abs(slopes[index - 1]!), Math.abs(slopes[index]!), Math.abs(slopes[index - 1]! + slopes[index]!) / 4) || 0);
  if (last > 1) { tangents[0] = (3 * slopes[0]! - tangents[1]!) / 2; tangents[last] = (3 * slopes[last - 1]! - tangents[last - 1]!) / 2; }
  else { tangents[0] = slopes[0]!; tangents[1] = slopes[0]!; }
  const samples = Math.max(1, Math.min(16, Math.round(192 / last)));
  const points: Point[] = [];
  for (let index = 0; index < last; index++) {
    const low = Math.min(values[index]!, values[index + 1]!), high = Math.max(values[index]!, values[index + 1]!);
    for (let sample = 0; sample < samples; sample++) {
      const t = sample / samples, t2 = t * t, t3 = t2 * t;
      const value = (2 * t3 - 3 * t2 + 1) * values[index]! + (t3 - 2 * t2 + t) * step * tangents[index]! + (3 * t2 - 2 * t3) * values[index + 1]! + (t3 - t2) * step * tangents[index + 1]!;
      points.push([(index + t) * step, clamp(value, low, high)]);
    }
  }
  points.push([1, values[last]!]);
  return points;
}

/** Value of a sampled line at x, straight between samples. */
export function lineChartValueAt(shape: readonly Point[], x: number) {
  if (!shape.length) return 0;
  let low = 0, high = shape.length - 1;
  if (x <= shape[low]![0]) return shape[low]![1];
  if (x >= shape[high]![0]) return shape[high]![1];
  while (high - low > 1) { const middle = (low + high) >> 1; if (shape[middle]![0] < x) low = middle; else high = middle; }
  const [x0, y0] = shape[low]!, [x1, y1] = shape[high]!;
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}


export type LineChartPoint = Point;

/** A detached immutable multi-series dataset. Values omitted from an own record explicitly count as zero. */
export interface LineChartModel { readonly data: readonly LineChartDatum[]; readonly series: readonly LineChartSeries[] }
/** Validate stable IDs, finite signed values, and bounded work before rendering or reactive projection. */
export function buildLineChartModel(data: readonly LineChartDatum[], series: readonly LineChartSeries[]): LineChartModel {
 const seriesIds = new Set<string>();
 const lines = ownChartArray(series,'series',CARTESIAN_LIMITS.series).map((value,index) => {
  const item=ownChartRecord(value,`series[${index}]`,['id','label','color','dashed','area']);
  const id=chartText(item.id,'series.id',true); if(seriesIds.has(id)) throw new TypeError('series IDs must be unique'); seriesIds.add(id);
  const line:{id:string;label:string;color?:string;dashed?:boolean;area?:boolean}={id,label:chartText(item.label,'series.label')};
  if(item.color!==undefined) line.color=chartColor(item.color,'series.color');
  for(const key of ['dashed','area'] as const) if(item[key]!==undefined){if(typeof item[key]!=='boolean') throw new TypeError(`series.${key} must be boolean`);line[key]=item[key] as boolean;}
  return Object.freeze(line);
 });
 const ids=new Set<string>(); const inputs=ownChartArray(data,'data',CARTESIAN_LIMITS.points);
 if(inputs.length*lines.length>CARTESIAN_LIMITS.cells) throw new TypeError('chart exceeds the cell limit');
 const points=inputs.map((value,index)=>{
  const item=ownChartRecord(value,`data[${index}]`,['id','label','axisLabel','values']);
  const id=chartText(item.id,'datum.id',true);if(ids.has(id))throw new TypeError('datum IDs must be unique');ids.add(id);
  const supplied=ownChartRecord(item.values,'datum.values',[...seriesIds]);const values=Object.create(null) as Record<string,number>;
  for(const line of lines) values[line.id]=supplied[line.id]===undefined?0:chartNumber(supplied[line.id],`datum.values.${line.id}`);
  return Object.freeze({id,label:chartText(item.label,'datum.label'),...(item.axisLabel===undefined?{}:{axisLabel:chartText(item.axisLabel,'datum.axisLabel')}),values:Object.freeze(values)});
 });
 return Object.freeze({data:Object.freeze(points),series:Object.freeze(lines)});
}
