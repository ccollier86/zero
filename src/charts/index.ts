/**
 * Browser-independent Zero Charts facade. Owns public aggregate contracts and
 * flow/ranking/cohort presentation math, not transport, authorization or React lifecycle.
 * Components live at /components/charts; reactive reads live at /charts/react.
 */
export type * from '../components/charts/sankey/sankey-types';
export * from './native';
export { SANKEY_LIMITS, buildSankeyModel, sankeyPairId, sankeyNodeHue } from '../components/charts/sankey/sankey-model';
export { computeSankeyTrace } from '../components/charts/sankey/sankey-trace';
export { computeSankeyLayout, SANKEY_LAYOUT_DEFAULTS } from '../components/charts/sankey/sankey-layout';
export type * from '../components/charts/race-bar/race-bar-types';
export { RACE_BAR_LIMITS, buildRaceBarModel, computeRaceBarSnapshot, inspectRaceBarItem,
  preserveRaceBarFramePosition, raceBarValueAt } from '../components/charts/race-bar/race-bar-model';
export { RACE_BAR_DEFAULTS, RACE_BAR_MOTION_DEFAULTS, advanceRaceBarSpring,
  normalizeRaceBarPosition, raceBarBlend, raceBarNiceStep, raceBarTicks } from '../components/charts/race-bar/race-bar-math';
export { computeRaceBarLayout } from '../components/charts/race-bar/race-bar-layout';
export type * from '../components/charts/funnel/funnel-types';
export { FUNNEL_LIMITS, buildFunnelModel, normalizeFunnelView, funnelStageValue, funnelRate,
  computeFunnelSnapshot, inspectFunnelStage } from '../components/charts/funnel/funnel-model';
export { FUNNEL_LAYOUT_DEFAULTS, computeFunnelLayout, computeFunnelTargets } from '../components/charts/funnel/funnel-layout';
export { computeFunnelEdges, funnelBandPath, funnelEdgeAt, funnelStageAt } from '../components/charts/funnel/funnel-geometry';
export { FUNNEL_MOTION_DEFAULTS, advanceFunnelSpring, funnelCompact, funnelPercent } from '../components/charts/funnel/funnel-math';
export { computeFunnelParticleDistribution, sampleFunnelParticle, createFunnelRandom } from '../components/charts/funnel/funnel-particles';
