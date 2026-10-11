/** Sparkline bounded numerical admission and monotone geometry. Pure layer; Arc UI MIT Copyright (c) 2026 Elia Kuratli. */
import { CARTESIAN_LIMITS, ownChartArray, chartNumber, chartText } from "../line-chart/cartesian-admission";
export type Point = [number, number];
/** Space kept above the highest and below the lowest point, and half the line width. */
const inset = 5, cap = 1.25;
const grid = Array.from({ length: 161 }, (_, index) => index / 160);

/** A smooth line through every point, sampled densely in unit space (x and y both 0 to 1, y up). Monotone cubic tangents keep it from swinging past the data. */
export function computeSparklineCurve(data: readonly number[]): Point[] {
  if (!data.length) return [];
  if (data.length === 1) return [[0, .5], [1, .5]];
  const min = Math.min(...data), span = Math.max(...data) - min;
  const ys = data.map(value => span ? (value - min) / span : .5);
  const last = ys.length - 1, step = 1 / last;
  const slopes = ys.slice(1).map((y, index) => (y - ys[index]!) / step);
  const tangents = ys.map((_, index) => index === 0 || index === last ? slopes[0]! : (Math.sign(slopes[index - 1]!) + Math.sign(slopes[index]!)) * Math.min(Math.abs(slopes[index - 1]!), Math.abs(slopes[index]!), Math.abs(slopes[index - 1]! + slopes[index]!) / 4) || 0);
  if (last > 1) { tangents[0] = (3 * slopes[0]! - tangents[1]!) / 2; tangents[last] = (3 * slopes[last - 1]! - tangents[last - 1]!) / 2; }
  const samples = Math.max(1, Math.min(16, Math.round(128 / last)));
  const points: Point[] = [];
  for (let index = 0; index < last; index++) for (let sample = 0; sample < samples; sample++) {
    const t = sample / samples, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[index]! + (t3 - 2 * t2 + t) * step * tangents[index]! + (3 * t2 - 2 * t3) * ys[index + 1]! + (t3 - t2) * step * tangents[index + 1]!;
    points.push([(index + t) * step, Math.min(1, Math.max(0, y))]);
  }
  points.push([1, ys[last]!]);
  return points;
}

/** Height of the sampled line at x, straight between samples. */
export function sparklineHeightAt(shape: Point[], x: number) {
  if (!shape.length) return 0;
  let low = 0, high = shape.length - 1;
  if (x <= shape[low]![0]) return shape[low]![1];
  if (x >= shape[high]![0]) return shape[high]![1];
  while (high - low > 1) { const middle = (low + high) >> 1; if (shape[middle]![0] < x) low = middle; else high = middle; }
  const [x0, y0] = shape[low]!, [x1, y1] = shape[high]!;
  return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Every drawn string for one frame, in the chart's own pixels so strokes and dots stay round at any width. */
export function computeSparklineGeometry(shape: Point[], w: number, h: number, at: number) {
  if (!shape.length) return { points: [] as Point[], line: '', trail: '', fill: '', dot: '', cx: 0 };
  const toY = (y: number) => inset + (1 - y) * (h - inset * 2);
  const points = shape.map(([x, y]): Point => [x * w, toY(y)]);
  const pairs = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  const cx = at * w, cy = toY(sparklineHeightAt(shape, at));
  return { points, line: pairs.join(" "), trail: `M${pairs.join("L")}`, fill: `M${pairs.join("L")}L${w},${h}L0,${h}Z`, dot: `${cx},${cy} ${cx},${cy}`, cx };
}

/** Where the pen is along the line once `progress` of its length is drawn, so the fill follows the tip. */
export function sparklineTipAt(points: Point[], progress: number) {
  if (!points.length) return 0;
  const steps = points.slice(1).map(([x, y], index) => Math.hypot(x - points[index]![0], y - points[index]![1]));
  let left = progress * steps.reduce((sum, step) => sum + step, 0);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!, from = points[index]![0];
    if (left <= step) return from + (points[index + 1]![0] - from) * (step ? left / step : 1);
    left -= step;
  }
  return points[points.length - 1]![0];
}


/** Detached numeric observations and optional per-observation labels. */
export interface SparklineModel {readonly data:readonly number[];readonly labels:readonly string[]|undefined}
/** Preserve numeric-array simplicity without evaluating accessors or pretending empty data is zero. */
export function buildSparklineModel(data:readonly number[],labels?:readonly string[]):SparklineModel {
 const values=ownChartArray(data,'data',CARTESIAN_LIMITS.points).map((value,index)=>chartNumber(value,`data[${index}]`));
 const names=labels===undefined?undefined:ownChartArray(labels,'labels',CARTESIAN_LIMITS.points).map((value,index)=>chartText(value,`labels[${index}]`));
 if(names && names.length!==values.length)throw new TypeError('labels must match the number of observations');
 return Object.freeze({data:Object.freeze(values),labels:names?Object.freeze(names):undefined});
}
