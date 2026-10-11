/** Bounded observed-time stream model and original line geometry; no synthetic event clock or provider authority. */
import { ownArray, ownRecord, numberValue, chartId, chartText, enumValue, NATIVE_CHART_LIMITS } from '../shared/admission';
export interface RealtimeSample { readonly id: string; readonly time: number; readonly value: number | null; readonly anomaly?: { readonly label: string; readonly severity?: 'info' | 'warning' | 'danger' } }
export interface RealtimeModel { readonly data: readonly RealtimeSample[]; readonly latestTime: number | null }
export interface RealtimeWindow { readonly start: number; readonly end: number; readonly data: readonly RealtimeSample[]; readonly domain: readonly [number, number]; readonly ticks: readonly number[] }
/** Exact segment geometry plus its observed identities; `id` remains the first sample, not a renderer lifecycle key. */
export interface RealtimePath { readonly id: string; readonly d: string; readonly sampleIds: readonly string[] }
/** Ordered epochs remain separate from finite signed measurements. Null creates a genuine gap. */
export function buildRealtimeModel(input: readonly RealtimeSample[]): RealtimeModel {
  const ids = new Set<string>(); let previous = -Infinity;
  const data = ownArray(input, 'data').map((raw, index) => {
    const row = ownRecord(raw, `data[${index}]`, ['id', 'time', 'value', 'anomaly']);
    const id = chartId(row.id, 'sample.id'); if (ids.has(id)) throw new TypeError('Sample IDs must be unique'); ids.add(id);
    const time = numberValue(row.time, 'sample.time', { min: -8.64e15, max: 8.64e15 });
    if (!(time > previous)) throw new RangeError('Sample epochs must strictly increase'); previous = time;
    const value = row.value === null ? null : numberValue(row.value, 'sample.value');
    let anomaly: RealtimeSample['anomaly'];
    if (row.anomaly !== undefined) { const a = ownRecord(row.anomaly, 'sample.anomaly', ['label', 'severity']); anomaly = Object.freeze({ label: chartText(a.label, 'anomaly.label', true), severity: a.severity === undefined ? 'info' as const : enumValue(a.severity, 'anomaly.severity', ['info', 'warning', 'danger']) }); }
    return Object.freeze({ id, time, value, ...(anomaly ? { anomaly } : {}) });
  });
  return Object.freeze({ data: Object.freeze(data), latestTime: data.at(-1)?.time ?? null });
}
/** The view follows the latest supplied event, never Date.now; hold an end epoch to inspect while new data arrives. */
export function computeRealtimeWindow(model: RealtimeModel, windowMs = 60_000, endTime?: number): RealtimeWindow {
  const record = ownRecord(model, 'model', ['data', 'latestTime']);
  const admitted = buildRealtimeModel(record.data as readonly RealtimeSample[]);
  numberValue(windowMs, 'windowMs', { min: 1, max: 31_536_000_000 });
  const end = endTime === undefined ? admitted.latestTime ?? 0 : numberValue(endTime, 'endTime', { min: -8.64e15, max: 8.64e15 });
  const start = Math.max(-8.64e15, end - windowMs);
  const data = admitted.data.filter(sample => sample.time >= start && sample.time <= end);
  let low = Infinity, high = -Infinity;
  for (const sample of data) if (sample.value !== null) { low = Math.min(low, sample.value); high = Math.max(high, sample.value); }
  if (low === Infinity) { low = 0; high = 1; }
  else if (low === high) { const padding = Math.max(1, Math.abs(low) * .05); low = Math.max(-NATIVE_CHART_LIMITS.magnitude, low - padding); high = Math.min(NATIVE_CHART_LIMITS.magnitude, high + padding); }
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4).filter((value, index, all) => index === 0 || value > all[index - 1]!);
  return Object.freeze({ start, end, data: Object.freeze(data), domain: Object.freeze([low, high]) as readonly [number, number], ticks: Object.freeze(ticks) });
}
/** Preserve actual irregular epoch spacing and split paths at missing observations. */
export function computeRealtimePaths(window: RealtimeWindow, width = 640, height = 220): readonly RealtimePath[] {
  const record = ownRecord(window, 'window', ['start', 'end', 'data', 'domain', 'ticks']);
  const start = numberValue(record.start, 'window.start', { min: -8.64e15, max: 8.64e15 }), end = numberValue(record.end, 'window.end', { min: start, max: 8.64e15 });
  const domain = ownArray(record.domain, 'window.domain', 2).map(value => numberValue(value, 'window.domain'));
  if (domain.length !== 2 || !(domain[0]! < domain[1]!)) throw new RangeError('Window domain must increase');
  const data = buildRealtimeModel(record.data as readonly RealtimeSample[]).data;
  for (const sample of data) if (sample.time < start || sample.time > end || (sample.value !== null && (sample.value < domain[0]! || sample.value > domain[1]!))) throw new RangeError('Window geometry requires measurements within its admitted time and value domain');
  window = { start, end, domain: domain as unknown as readonly [number, number], data, ticks: [] };
  numberValue(width, 'width', { min: 1, max: 4096 }); numberValue(height, 'height', { min: 1, max: 4096 });
  const x = (time: number) => 52 + (time - window.start) / Math.max(1, window.end - window.start) * Math.max(1, width - 64);
  const y = (value: number) => 12 + (1 - (value - window.domain[0]) / (window.domain[1] - window.domain[0])) * Math.max(1, height - 40);
  const groups: RealtimeSample[][] = []; let group: RealtimeSample[] = [];
  for (const sample of window.data) { if (sample.value === null) { if (group.length) groups.push(group); group = []; } else group.push(sample); }
  if (group.length) groups.push(group);
  return groups.map(samples => {
    // Every admitted observation remains a vertex. Uniform timestamp resampling
    // can erase brief real spikes in irregular streams; smooth motion must never
    // discard measured extrema or bridge a missing interval.
    const points = samples.map(sample => `${x(sample.time)},${y(sample.value!)}`);
    return Object.freeze({ id: samples[0]!.id, d: 'M' + points.join('L'), sampleIds: Object.freeze(samples.map(sample => sample.id)) });
  });
}
