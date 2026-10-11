'use client';
/** Typed chart-family facade. Dispatches original organisms; never chooses transport, credentials, database topology or chart-engine providers. */
import * as Native from './native';
import * as Arc from './arc';
import { SankeyChart, type SankeyChartProps } from './sankey/sankey-chart';
import { RaceBarChart, type RaceBarChartProps } from './race-bar/race-bar-chart';
import { FunnelChart, type FunnelChartProps } from './funnel/funnel-chart';

type Choice<TKind extends string, TProps> = { readonly kind: TKind } & TProps;
/** Each discriminant retains its real measured-data/settings contract; unrelated chart fields cannot leak across kinds. */
export type ZeroChartProps =
  | Choice<'cartesian' | 'line' | 'area' | 'grouped-bar' | 'stacked-bar' | 'horizontal-bar' | 'composed' | 'scatter' | 'bubble', Native.CartesianChartProps>
  | Choice<'histogram', Native.HistogramChartProps>
  | Choice<'matrix-heatmap', Native.MatrixHeatmapProps>
  | Choice<'box-plot', Native.BoxPlotChartProps>
  | Choice<'waterfall', Native.WaterfallChartProps>
  | Choice<'candlestick', Native.CandlestickChartProps>
  | Choice<'radar', Native.RadarChartProps>
  | Choice<'radial-bar', Native.RadialBarChartProps>
  | Choice<'pie', Native.PieChartProps>
  | Choice<'sunburst', Native.SunburstChartProps>
  | Choice<'realtime', Native.RealtimeChartProps>
  | Choice<'sankey', SankeyChartProps>
  | Choice<'race-bar', RaceBarChartProps>
  | Choice<'funnel', FunnelChartProps>
  | Choice<'arc-line', Arc.LineChartProps>
  | Choice<'arc-bar', Arc.BarChartProps>
  | Choice<'donut', Arc.DonutChartProps>
  | Choice<'streamgraph', Arc.StreamgraphProps>
  | Choice<'brush', Arc.BrushChartProps>
  | Choice<'waffle', Arc.WaffleChartProps>
  | Choice<'slope', Arc.SlopeChartProps>
  | Choice<'sparkline', Arc.SparklineProps>
  | Choice<'gauge', Arc.GaugeProps>
  | Choice<'activity-heatmap', Arc.ActivityHeatmapProps>
  | Choice<'ridgeline', Arc.RidgelineProps>
  | Choice<'treemap', Arc.TreemapProps>;

/** One React facade selects typed handmade organisms without imposing a universal data shape or owning a subscription. */
export function ZeroChart(props: ZeroChartProps) {
  switch (props.kind) {
    case 'cartesian': return <Native.CartesianChart {...props} />;
    case 'line': return <Native.XYLineChart {...props} />;
    case 'area': return <Native.AreaChart {...props} />;
    case 'grouped-bar': return <Native.GroupedBarChart {...props} />;
    case 'stacked-bar': return <Native.StackedBarChart {...props} />;
    case 'horizontal-bar': return <Native.HorizontalBarChart {...props} />;
    case 'composed': return <Native.ComposedChart {...props} />;
    case 'scatter': return <Native.ScatterChart {...props} />;
    case 'bubble': return <Native.BubbleChart {...props} />;
    case 'histogram': return <Native.HistogramChart {...props} />;
    case 'matrix-heatmap': return <Native.MatrixHeatmap {...props} />;
    case 'box-plot': return <Native.BoxPlotChart {...props} />;
    case 'waterfall': return <Native.WaterfallChart {...props} />;
    case 'candlestick': return <Native.CandlestickChart {...props} />;
    case 'radar': return <Native.RadarChart {...props} />;
    case 'radial-bar': return <Native.RadialBarChart {...props} />;
    case 'pie': return <Native.PieChart {...props} />;
    case 'sunburst': return <Native.SunburstChart {...props} />;
    case 'realtime': return <Native.RealtimeChart {...props} />;
    case 'sankey': return <SankeyChart {...props} />;
    case 'race-bar': return <RaceBarChart {...props} />;
    case 'funnel': return <FunnelChart {...props} />;
    case 'arc-line': return <Arc.LineChart {...props} />;
    case 'arc-bar': return <Arc.BarChart {...props} />;
    case 'donut': return <Arc.DonutChart {...props} />;
    case 'streamgraph': return <Arc.Streamgraph {...props} />;
    case 'brush': return <Arc.BrushChart {...props} />;
    case 'waffle': return <Arc.WaffleChart {...props} />;
    case 'slope': return <Arc.SlopeChart {...props} />;
    case 'sparkline': return <Arc.Sparkline {...props} />;
    case 'gauge': return <Arc.Gauge {...props} />;
    case 'activity-heatmap': return <Arc.ActivityHeatmap {...props} />;
    case 'ridgeline': return <Arc.Ridgeline {...props} />;
    case 'treemap': return <Arc.Treemap {...props} />;
    default: throw new TypeError('Unsupported Zero chart kind');
  }
}
