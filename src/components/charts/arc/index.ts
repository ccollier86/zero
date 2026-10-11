/**
 * Arc-derived analytical organisms. This separate entry preserves Zero's custom
 * charts and the legacy Recharts composition without colliding with their names.
 * Components consume admitted data; reactive transport lives at /charts/react.
 */
export { LineChart } from './line-chart/line-chart';
export type { LineChartProps, LineChartTooltipContext } from './line-chart/line-chart';
export type { LineChartDatum, LineChartSeries } from './line-chart/line-chart-model';
export { BarChart } from './bar-chart/bar-chart';
export type { BarChartProps } from './bar-chart/bar-chart';
export type { BarChartDatum } from './bar-chart/bar-chart-model';
export { DonutChart } from './donut-chart/donut-chart';
export type { DonutChartProps, DonutChartDatum } from './donut-chart/donut-chart-types';
export { Streamgraph } from './streamgraph/streamgraph';
export type { StreamgraphProps, StreamgraphTooltipContext } from './streamgraph/streamgraph';
export type { StreamgraphDatum, StreamgraphSeries, StreamgraphOffset } from './streamgraph/streamgraph-model';
export { BrushChart } from './brush-chart/brush-chart';
export type { BrushChartProps } from './brush-chart/brush-chart';
export type { BrushChartDatum, BrushChartAnnotation } from './brush-chart/brush-chart-model';
export { WaffleChart } from './waffle-chart/waffle-chart';
export type { WaffleChartProps, WaffleCategory } from './waffle-chart/waffle-chart-types';
export type { WaffleTooltipContext } from './waffle-chart/waffle-chart-types';
export { SlopeChart } from './slope-chart/slope-chart';
export type { SlopeChartProps, SlopeTooltipContext } from './slope-chart/slope-chart';
export type { SlopeItem } from './slope-chart/slope-chart-model';
export { Sparkline } from './sparkline/sparkline';
export type { SparklineProps } from './sparkline/sparkline';
export { Gauge } from './gauge/gauge';
export type { GaugeProps, GaugeTone, GaugeThreshold } from './gauge/gauge-types';
export { ActivityHeatmap } from './activity-heatmap/activity-heatmap';
export type { ActivityHeatmapProps, ActivityDay } from './activity-heatmap/activity-heatmap-types';
export type { ActivityDayTooltipContext } from './activity-heatmap/activity-heatmap-types';
export { Ridgeline } from './ridgeline/ridgeline';
export type { RidgelineProps, RidgelineTooltipContext } from './ridgeline/ridgeline';
export type { RidgelineSeries } from './ridgeline/ridgeline-model';
export { Treemap } from './treemap/treemap';
export type { TreemapProps, TreemapTooltipContext } from './treemap/treemap';
export type { TreemapNode } from './treemap/treemap-model';
export { ARC_CHART_MOTION_DEFAULTS } from './shared/motion-tokens';
