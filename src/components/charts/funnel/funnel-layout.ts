/**
 * Pure responsive Funnel layout and pixel thickness targets. The supplied
 * container width controls geometry; no DOM measurement, token lookup or data
 * subscription is performed here.
 */
import { FUNNEL_LIMITS, normalizeFunnelView } from './funnel-model';
import type { FunnelLayout, FunnelLayoutOptions, FunnelModel, FunnelView } from './funnel-types';

/** Reference geometry remains separate from shared chart typography and tokens. */
export const FUNNEL_LAYOUT_DEFAULTS = Object.freeze({ height: 170, verticalBelow: 420,
  headerHeight: 70, dropHeight: 22, labelGap: 14, splitGap: 2, transitionFraction: 0.3 });

/** Map actual container width to reference horizontal or upright geometry. */
export function computeFunnelLayout(stageCount: number, options: FunnelLayoutOptions): FunnelLayout {
  if (!Number.isInteger(stageCount) || stageCount < 0 || stageCount > FUNNEL_LIMITS.stages) {
    throw new Error(`Funnel layout stage count must be an integer from 0 to ${FUNNEL_LIMITS.stages}.`);
  }
  const width = options.width, bandHeight = options.height ?? FUNNEL_LAYOUT_DEFAULTS.height;
  const orientation = options.orientation ?? 'auto';
  if (!Number.isFinite(width) || width < 0 || width > 16_384 || !Number.isFinite(bandHeight)
    || bandHeight <= 0 || bandHeight > 4096) throw new Error('Funnel layout needs a finite width from 0 to 16384 and height from 0 exclusive to 4096.');
  if (orientation !== 'auto' && orientation !== 'vertical' && orientation !== 'horizontal') {
    throw new Error('Funnel orientation must be auto, horizontal or vertical.');
  }
  const vertical = orientation === 'vertical' || (orientation === 'auto' && width < FUNNEL_LAYOUT_DEFAULTS.verticalBelow);
  const count = Math.max(1, stageCount);
  if (!vertical) {
    const headerHeight = FUNNEL_LAYOUT_DEFAULTS.headerHeight, stepSize = width / count;
    return Object.freeze({ vertical, width, height: headerHeight + bandHeight + FUNNEL_LAYOUT_DEFAULTS.dropHeight,
      stepSize, along: width, cross: bandHeight, headerHeight, transitionZone: stepSize * FUNNEL_LAYOUT_DEFAULTS.transitionFraction,
      labelWidth: stepSize, labelGap: 0, mapPoint: (along: number, cross: number) => [along, headerHeight + cross] as const });
  }
  const labelWidth = Math.min(150, Math.round(width * 0.42)), labelGap = Math.min(FUNNEL_LAYOUT_DEFAULTS.labelGap, width * 0.08);
  const cross = Math.max(0, width - labelWidth - labelGap), stepSize = Math.max(64, Math.min(86, 420 / count));
  const along = stepSize * count;
  return Object.freeze({ vertical, width, height: along + 6, stepSize, along, cross, headerHeight: 0,
    transitionZone: stepSize * FUNNEL_LAYOUT_DEFAULTS.transitionFraction, labelWidth, labelGap,
    mapPoint: (a: number, c: number) => [c, a] as const });
}

/**
 * Pixel targets retain all segment slots for stable ID-based motion. Total and
 * split scale against the complete entry cohort; isolate scales its own entry
 * count to the full cross-axis. Zero baselines yield zero thickness.
 */
export function computeFunnelTargets(model: FunnelModel, layout: FunnelLayout, view: FunnelView): readonly (readonly number[])[] {
  const selected = normalizeFunnelView(model, view), K = model.segmentCount;
  const segment = selected.kind === 'segment' ? model.segmentById.get(selected.id)!.index : null;
  const first = model.stages[0];
  const baseline = first ? (segment === null ? first.total : first.values[segment]!) : 0;
  const gap = selected.kind === 'split' ? Math.min(FUNNEL_LAYOUT_DEFAULTS.splitGap, layout.cross / Math.max(1, K - 1)) : 0;
  const available = segment === null ? Math.max(0, layout.cross - gap * Math.max(0, K - 1)) : layout.cross;
  return Object.freeze(model.stages.map(stage => Object.freeze(stage.values.map((value, k) =>
    baseline > 0 && (segment === null || segment === k) ? value / baseline * available : 0))));
}
