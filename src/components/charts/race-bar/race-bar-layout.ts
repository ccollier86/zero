/**
 * Pure responsive Race Bar geometry. Injected text measurement preserves theme
 * font metrics in browsers and deterministic SSR without a canvas dependency.
 */
import { RACE_BAR_DEFAULTS } from './race-bar-math';
import { RACE_BAR_LIMITS } from './race-bar-model';
import type { RaceBarLayout, RaceBarLayoutOptions, RaceBarModel } from './race-bar-types';

function defaultMeasure(text: string): number {
  return Array.from(text).reduce((width, char) => width + (/[MW@#]/u.test(char) ? .82 : /[il.,' ]/u.test(char) ? .32 : .56) * 12.5, 0);
}

/**
 * Compute the reference 26/18px rows or 30/22px inside-label rows below 400px.
 * Label/value gutters are bounded by the actual container; a narrow chart never
 * forces the demo's minimum plotting width into an accidental scrollbar.
 */
export function computeRaceBarLayout(model: RaceBarModel, options: RaceBarLayoutOptions): RaceBarLayout {
  const W = options.width, bars = options.bars ?? RACE_BAR_DEFAULTS.bars;
  if (!Number.isFinite(W) || W <= 0 || W > 20_000) throw new Error('Race Bar layout width must be finite, positive and at most 20000px.');
  if (!Number.isInteger(bars) || bars < 1 || bars > RACE_BAR_LIMITS.visibleBars) {
    throw new Error(`Race Bar visible bars must be an integer from 1 to ${RACE_BAR_LIMITS.visibleBars}.`);
  }
  const inside = W < RACE_BAR_DEFAULTS.insideBelow;
  const rowH = inside ? RACE_BAR_DEFAULTS.insideRowHeight : RACE_BAR_DEFAULTS.rowHeight;
  const barH = inside ? RACE_BAR_DEFAULTS.insideBarHeight : RACE_BAR_DEFAULTS.barHeight;
  const axisH = RACE_BAR_DEFAULTS.axisHeight, measure = (text: string, kind: 'label' | 'value'): number => {
    const width = (options.measureText ?? defaultMeasure)(text, kind);
    return Number.isFinite(width) && width >= 0 ? Math.min(width, 100_000) : defaultMeasure(text);
  };
  const format = options.formatValue ?? (value => Math.round(value).toLocaleString());
  const actualNameWidths = new Map(model.items.map(item => [item.id, measure(item.label, 'label')]));
  const labelW = inside ? 0 : Math.min(W * .3, Math.max(70, Math.round(Math.max(0, ...actualNameWidths.values()) + 12)));
  let requestedValueWidth = 46;
  for (const frame of model.frames) for (const value of frame.values) requestedValueWidth = Math.max(requestedValueWidth, measure(String(format(value)), 'value'));
  const valW = Math.min(Math.max(0, W - labelW), requestedValueWidth + 10);
  const area = Math.max(0, W - labelW - valW), n = Math.min(bars, model.items.length);
  const itemNameWidths = new Map(model.items.map(item => [item.id, inside
    ? Math.min(actualNameWidths.get(item.id)!, Math.max(0, W - valW - 23))
    : actualNameWidths.get(item.id)!]));
  return { W, H: axisH + n * rowH, inside, rowH, barH, axisH, labelW, valW, x0: labelW, area, n, itemNameWidths };
}
