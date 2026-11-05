/** Pure Cartesian axis gutters and captions. Formatting and font measurements affect layout, never domains or exact values. */
import { chartAxisText, chartTextWidth, type ChartTextMetrics } from '../shared/chart-text-layout';
import type { CartesianAxisModel, CartesianLayoutOptions, CartesianModel } from './cartesian-types';
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export function cartesianAxisPresentation(model: CartesianModel, width: number, height: number, options: CartesianLayoutOptions) {
  const fontSize = options.fontSize ?? 11.5;
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 96) throw new RangeError('Axis font size must be finite and within (0,96]');
  for (const key of ['measureText', 'formatYTick', 'formatX'] as const) if (options[key] !== undefined && typeof options[key] !== 'function') throw new TypeError(`${key} must be a function`);
  const metrics: ChartTextMetrics = { fontSize, measureText: options.measureText }, horizontal = model.layout === 'horizontal';
  const formatTick = (value: number, axis: CartesianAxisModel) => options.formatYTick?.(value, axis) ?? (model.stack === 'percent' ? `${Math.round(value * 100)}%` : compact.format(value));
  const numeric = new Map(model.axes.map(axis => [axis.id, axis.ticks.map(value => ({ value, label: formatTick(value, axis) }))]));
  const categoryWidth = horizontal ? Math.max(0, ...model.data.filter(datum => datum.coordinate >= model.window[0] && datum.coordinate <= model.window[1]).map(datum => chartTextWidth(options.formatX?.(datum.x) ?? datum.label, metrics))) : 0;
  const sides = model.axes.length, hasLeft = model.axes.some(axis => axis.side === 'left'), hasRight = model.axes.some(axis => axis.side === 'right');
  const sideBudget = Math.max(0, width - 48 - (hasLeft ? 0 : 18) - (hasRight ? 0 : 18)) / sides;
  const gutter = (side: 'left' | 'right') => { const axis = model.axes.find(item => item.side === side); return axis ? Math.min(sideBudget, Math.max(52, ...numeric.get(axis.id)!.map(tick => chartTextWidth(tick.label, metrics) + 14))) : 18; };
  const left = horizontal ? Math.min(width * .32, Math.max(70, categoryWidth + 14)) : gutter('left'), right = horizontal ? 18 : gutter('right');
  const topCaption = horizontal ? !!model.xLabel || model.axes.some(axis => axis.side === 'right' && axis.label) : model.axes.some(axis => axis.label);
  const bottomCaption = horizontal ? model.axes.some(axis => axis.side === 'left' && axis.label) : !!model.xLabel;
  const top = topCaption ? 2 * fontSize + 18 : horizontal && hasRight ? fontSize + 12 : Math.max(12, fontSize + 2);
  // A bottom tick's baseline already includes the font size and an 8px gap.
  // Keep its descenders inside the SVG when a scoped density increases type.
  const bottom = bottomCaption ? 2 * fontSize + 24 : Math.max(32, fontSize * 1.35 + 12);
  // Large supported font roles can leave a tiny plot; never move captions back
  // into ticks to manufacture chart area. Tick sampling handles that case.
  const verticalBudget = Math.max(0, height - 1), scale = Math.min(1, verticalBudget / (top + bottom));
  return { metrics, numeric, left, right, top: top * scale, bottom: bottom * scale, lineHeight: fontSize * 1.35,
    formatX: options.formatX,
    caption: (axis: CartesianAxisModel, plotWidth: number, plotHeight: number) => {
      if (!axis.label) return null;
      if (horizontal) return chartAxisText(axis.label, plotWidth / 2, axis.side === 'right' ? fontSize + 2 - top * scale : plotHeight + bottom * scale - 6, 'middle', plotWidth, metrics);
      const count = model.axes.filter(item => item.label).length, budget = count > 1 ? Math.max(0, (plotWidth - 12) / 2) : plotWidth;
      return chartAxisText(axis.label, axis.side === 'right' ? plotWidth : 0, fontSize + 2 - top * scale, axis.side === 'right' ? 'end' : 'start', budget, metrics);
    },
    independentCaption: (plotWidth: number, plotHeight: number) => !model.xLabel ? null : horizontal
      ? chartAxisText(model.xLabel, -8, fontSize + 2 - top * scale, 'end', left - 12, metrics)
      : chartAxisText(model.xLabel, plotWidth / 2, plotHeight + bottom * scale - 6, 'middle', plotWidth, metrics),
  };
}
