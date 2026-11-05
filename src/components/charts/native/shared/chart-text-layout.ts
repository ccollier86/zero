/** Pure bounded axis text layout. Exact values stay in models/tables; only visible labels may be shortened. */
export interface ChartTextMetrics { readonly fontSize: number; readonly measureText?: (text: string) => number }
export interface ChartAxisText { readonly fullText: string; readonly text: string; readonly x: number; readonly y: number; readonly anchor: 'start' | 'middle' | 'end'; readonly maxWidth: number }
/** Use browser measurements when supplied, with a deterministic SSR fallback for missing/invalid widths. */
export function chartTextWidth(value: string, metrics: ChartTextMetrics): number {
  const measured = metrics.measureText?.(value);
  return measured !== undefined && Number.isFinite(measured) && measured >= 0 ? measured : Array.from(value).length * metrics.fontSize * .65;
}
/** Fit by grapheme rather than UTF-16 slicing, preserving complete labels separately for accessible/native inspection. */
export function fitChartText(value: string, maxWidth: number, metrics: ChartTextMetrics): string {
  if (!(maxWidth > 0)) return '';
  if (chartTextWidth(value, metrics) <= maxWidth) return value;
  if (chartTextWidth('…', metrics) > maxWidth) return '';
  const parts = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), part => part.segment) : Array.from(value);
  let low = 0, high = parts.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (chartTextWidth(parts.slice(0, middle).join('') + '…', metrics) <= maxWidth) low = middle; else high = middle - 1; }
  return parts.slice(0, low).join('').trimEnd() + '…';
}
/** An immutable displayed label carries its complete text and the actual reserved horizontal budget. */
export function chartAxisText(fullText: string, x: number, y: number, anchor: ChartAxisText['anchor'], maxWidth: number, metrics: ChartTextMetrics): ChartAxisText {
  return Object.freeze({ fullText, text: fitChartText(fullText, maxWidth, metrics), x, y, anchor, maxWidth: Math.max(0, maxWidth) });
}
/** Deterministic sampling retains endpoints when space permits; tiny plots show one tick rather than overlapping text. */
export function sampleChartTicks<T>(values: readonly T[], count: number): T[] {
  const size = Math.max(1, Math.min(values.length, Math.floor(count)));
  if (values.length <= size) return [...values];
  if (size === 1) return values.length ? [values[0]!] : [];
  return Array.from({ length: size }, (_, index) => values[Math.round(index * (values.length - 1) / (size - 1))]!);
}
/** Neighbor-midpoint label cells prevent formatted horizontal ticks from colliding or leaving their SVG. */
export function horizontalChartAxisText<T extends { position: number; label: string }>(ticks: readonly T[], extent: number, y: number, metrics: ChartTextMetrics): Array<T & { textLayout: ChartAxisText }> {
  const ordered = [...ticks].sort((a, b) => a.position - b.position);
  return ordered.map((tick, index) => {
    const left = index ? (ordered[index - 1]!.position + tick.position) / 2 + 3 : 0;
    const right = index + 1 < ordered.length ? (tick.position + ordered[index + 1]!.position) / 2 - 3 : extent;
    const anchor = tick.position < 16 ? 'start' : tick.position > extent - 16 ? 'end' : 'middle';
    const budget = anchor === 'start' ? right - tick.position : anchor === 'end' ? tick.position - left : 2 * Math.min(tick.position - left, right - tick.position);
    return { ...tick, textLayout: chartAxisText(tick.label, tick.position, y, anchor, budget, metrics) };
  });
}
