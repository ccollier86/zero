/** Synthetic consumer of the actual public entries; no application setup. */
import React from 'react';
import { LineChart, BarChart, DonutChart, Streamgraph, BrushChart, WaffleChart, SlopeChart,
  Sparkline, Gauge, ActivityHeatmap, Ridgeline, Treemap } from '@zero/framework/components/charts/arc';
import { buildLineChartModel, buildBarChartModel, buildDonutModel, buildStreamgraphModel,
  buildBrushChartModel, buildWaffleModel, buildSlopeModel, buildSparklineModel, buildGaugeModel,
  buildActivityHeatmapModel, buildRidgelineModel, buildTreemapModel } from '@zero/framework/charts/arc';
import { useChartQuery } from '@zero/framework/charts/react';
export const queryHook = useChartQuery;
const series = [{ id: 'alpha', label: 'Synthetic Alpha' }, { id: 'beta', label: 'Synthetic Beta' }];
const points = [
  { id: '2026-01', label: 'January', axisLabel: 'Jan', values: { alpha: 12, beta: 4 } },
  { id: '2026-02', label: 'February', axisLabel: 'Feb', values: { alpha: 6, beta: 18 } },
];
const bars = [{ id: 'one', label: 'One', value: 12 }, { id: 'two', label: 'Two', value: 18 }];
const parts = [{ id: 'alpha', label: 'Synthetic Alpha', value: 60 }, { id: 'beta', label: 'Synthetic Beta', value: 40 }];
const dates = [{ date: Date.UTC(2026, 0, 1), value: 12 }, { date: Date.UTC(2026, 0, 2), value: 18 }];
const slopes = [{ id: 'alpha', label: 'Synthetic Alpha', start: 12, end: 18 }, { id: 'beta', label: 'Synthetic Beta', start: 18, end: 12 }];
const days = [{ date: '2026-01-01', count: 12 }, { date: '2026-01-03', count: 18 }];
const ridges = [{ id: 'alpha', label: 'Synthetic Alpha', values: [1, 2, 3, 4] }];
const tree = { id: 'root', label: 'Synthetic Root', children: [
  { id: 'alpha', label: 'Synthetic Alpha', value: 60 }, { id: 'beta', label: 'Synthetic Beta', value: 40 },
] };
export const models = [buildLineChartModel(points, series), buildBarChartModel(bars), buildDonutModel(parts),
  buildStreamgraphModel(points, series), buildBrushChartModel(dates), buildWaffleModel(parts),
  buildSlopeModel(slopes), buildSparklineModel([12, 18]), buildGaugeModel(60),
  buildActivityHeatmapModel(days), buildRidgelineModel(ridges), buildTreemapModel(tree)];
export function ArcConsumer() {
  return <main>
    <LineChart label="Synthetic Line" data={points} series={series} />
    <BarChart label="Synthetic Bars" period="January" data={bars} />
    <DonutChart label="Synthetic Donut" data={parts} />
    <Streamgraph label="Synthetic Stream" data={points} series={series} />
    <BrushChart label="Synthetic Brush" data={dates} />
    <WaffleChart label="Synthetic Waffle" data={parts} />
    <SlopeChart label="Synthetic Slope" data={slopes} startLabel="Before" endLabel="After" />
    <Sparkline label="Synthetic Sparkline" data={[12, 18]} labels={['Before', 'After']} />
    <Gauge label="Synthetic Gauge" value={60} />
    <ActivityHeatmap label="Synthetic Activity" days={days} period="January" />
    <Ridgeline label="Synthetic Distribution" series={ridges} />
    <Treemap label="Synthetic Hierarchy" data={tree} />
  </main>;
}
