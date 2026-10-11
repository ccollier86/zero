/**
 * Browser-independent Arc chart facade: bounded detached models and analytical
 * geometry. No React renderer, Motion runtime, database or browser clock enters
 * this module. Authorize/aggregate upstream; project with /charts/react.
 */
export { CARTESIAN_LIMITS } from '../components/charts/arc/line-chart/cartesian-admission';
export { buildLineChartModel, computeLineChartScale, computeLineChartCurve, lineChartValueAt } from '../components/charts/arc/line-chart/line-chart-model';
export type { LineChartDatum, LineChartSeries, LineChartModel, Point as LineChartPoint } from '../components/charts/arc/line-chart/line-chart-model';
export { buildBarChartModel, computeBarChartScale, computeBarChartPath } from '../components/charts/arc/bar-chart/bar-chart-model';
export type { BarChartDatum, BarChartModel } from '../components/charts/arc/bar-chart/bar-chart-model';
export { DONUT_LIMITS, buildDonutModel, computeDonutLayout, donutSectorPath } from '../components/charts/arc/donut-chart/donut-chart-model';
export type { DonutModel, DonutSlice } from '../components/charts/arc/donut-chart/donut-chart-model';
export type { DonutChartDatum } from '../components/charts/arc/donut-chart/donut-chart-types';
export { ARC_DISTRIBUTION_LIMITS } from '../components/charts/arc/streamgraph/distribution-admission';
export { buildStreamgraphModel, resampleStreamgraph, computeStreamgraphBaseline, stackStreamgraphOrder } from '../components/charts/arc/streamgraph/streamgraph-model';
export type { StreamgraphModel, StreamgraphDatum, StreamgraphSeries, StreamgraphOffset } from '../components/charts/arc/streamgraph/streamgraph-model';
export { buildBrushChartModel, fitBrushChartRange, computeBrushChartScale, computeBrushChartTimeTicks, brushChartLowerBound, computeBrushChartLinePath, BRUSH_CHART_DAY } from '../components/charts/arc/brush-chart/brush-chart-model';
export type { BrushChartModel, BrushChartDatum, BrushChartAnnotation, Point as BrushChartPoint } from '../components/charts/arc/brush-chart/brush-chart-model';
export { WAFFLE_LIMITS, buildWaffleModel, allocateWaffleCells, reassignWaffleCells } from '../components/charts/arc/waffle-chart/waffle-chart-model';
export type { WaffleModel, WaffleCell } from '../components/charts/arc/waffle-chart/waffle-chart-model';
export type { WaffleCategory } from '../components/charts/arc/waffle-chart/waffle-chart-types';
export { buildSlopeModel, computeSlopeLayout, spreadSlopeLabels } from '../components/charts/arc/slope-chart/slope-chart-model';
export type { SlopeItem, SlopeRow } from '../components/charts/arc/slope-chart/slope-chart-model';
export { buildSparklineModel, computeSparklineCurve, sparklineHeightAt, computeSparklineGeometry, sparklineTipAt } from '../components/charts/arc/sparkline/sparkline-model';
export type { SparklineModel, Point as SparklinePoint } from '../components/charts/arc/sparkline/sparkline-model';
export { GAUGE_LIMITS, buildGaugeModel, gaugeArcPath } from '../components/charts/arc/gauge/gauge-model';
export type { GaugeModel, GaugeTone, GaugeThreshold } from '../components/charts/arc/gauge/gauge-types';
export { ACTIVITY_HEATMAP_LIMITS, ACTIVITY_DAY_MS, buildActivityHeatmapModel, parseActivityDate, activityDateISO } from '../components/charts/arc/activity-heatmap/activity-heatmap-model';
export type { ActivityHeatmapModel } from '../components/charts/arc/activity-heatmap/activity-heatmap-model';
export type { ActivityDay } from '../components/charts/arc/activity-heatmap/activity-heatmap-types';
export { buildRidgelineModel, computeRidgelineTicks, ridgelineDensity, ridgelineStats, ridgelineQuantile, inspectRidgeline } from '../components/charts/arc/ridgeline/ridgeline-model';
export type { RidgelineSeries, RidgelineStats, RidgelineShape } from '../components/charts/arc/ridgeline/ridgeline-model';
export { buildTreemapModel, squarifyTreemap, computeTreemapLayout, normalizeTreemapFocus } from '../components/charts/arc/treemap/treemap-model';
export type { TreemapNode, TreemapRect, TreemapFlat } from '../components/charts/arc/treemap/treemap-model';
export { ARC_CHART_MOTION_DEFAULTS } from '../components/charts/arc/shared/motion-tokens';
