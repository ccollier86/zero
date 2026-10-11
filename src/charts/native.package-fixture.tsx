/** Synthetic consumers of the actual public native entries and every typed ZeroChart discriminant. */
import * as React from 'react';
import * as Native from '@zero/framework/components/charts/native';
import { ZeroChart,type ZeroChartProps } from '@zero/framework/components/charts';
import { buildCartesianModel,buildHistogramModel,buildBoxPlotModel,buildWaterfallModel,buildCandlestickModel,buildMatrixHeatmapModel,buildRadarModel,buildRadialBarModel,buildPieModel,buildSunburstModel,buildRealtimeModel } from '@zero/framework/charts/native';
import { useChartQuery } from '@zero/framework/charts/react';
import { data as sankeyData,raceData,funnelData } from './charts.package-fixture';

const series=[{id:'alpha',label:'Synthetic Alpha'},{id:'beta',label:'Synthetic Beta'}];
const points=[{id:'one',label:'January',x:1,values:{alpha:12,beta:4}},{id:'two',label:'February',x:2,values:{alpha:6,beta:18}}];
const observations=[{id:'a',value:1},{id:'b',value:2},{id:'c',value:3}];
const parts=[{id:'alpha',label:'Synthetic Alpha',value:60},{id:'beta',label:'Synthetic Beta',value:40}];
const tree={id:'root',label:'Synthetic Root',children:parts};
const boxes=[{id:'a',label:'Synthetic Alpha',values:[1,2,3,4,10]}];
const matrix={rows:[{id:'r',label:'Synthetic Row'}],columns:[{id:'c',label:'Synthetic Column'}],cells:[{id:'cell',rowId:'r',columnId:'c',value:12}]};
const steps=[{id:'open',label:'Opening',kind:'total' as const,value:12},{id:'change',label:'Change',kind:'contribution' as const,value:-4},{id:'total',label:'Closing',kind:'subtotal' as const}];
const candles=[{id:'jan',label:'January',time:1,open:3,high:5,low:2,close:4,volume:12},{id:'feb',label:'February',time:2,open:4,high:6,low:2,close:3}];
const axes=[{id:'a',label:'A',max:100},{id:'b',label:'B',max:100},{id:'c',label:'C',max:100}];
const profiles=[{id:'one',label:'Synthetic Alpha',values:[{id:'a',value:30},{id:'b',value:120},{id:'c',value:60}]}];
const rings=[{id:'range',label:'Synthetic Range',value:15,min:10,max:20}];
const samples=[{id:'jan',time:Date.UTC(2026,0,1),value:3},{id:'missing',time:Date.UTC(2026,0,1)+1000,value:null},{id:'feb',time:Date.UTC(2026,0,1)+2000,value:7}];
export const nativeComponents=[Native.CartesianChart,Native.XYLineChart,Native.AreaChart,Native.GroupedBarChart,Native.StackedBarChart,Native.HorizontalBarChart,Native.ComposedChart,Native.ScatterChart,Native.BubbleChart,Native.HistogramChart,Native.MatrixHeatmap,Native.BoxPlotChart,Native.WaterfallChart,Native.CandlestickChart,Native.RadarChart,Native.RadialBarChart,Native.PieChart,Native.SunburstChart,Native.RealtimeChart];
export const models=[buildCartesianModel(points,series),buildHistogramModel(observations),buildBoxPlotModel(boxes),buildWaterfallModel(steps),buildCandlestickModel(candles),buildMatrixHeatmapModel(matrix),buildRadarModel(axes,profiles),buildRadialBarModel(rings),buildPieModel(parts),buildSunburstModel(tree),buildRealtimeModel(samples)];
export const queryHook=useChartQuery;
const xyKinds=['cartesian','line','area','grouped-bar','stacked-bar','horizontal-bar','composed','scatter','bubble'] as const;
export const nativeCases:readonly ZeroChartProps[]=[
 ...xyKinds.map(kind=>({kind,label:'Synthetic '+kind,data:points,series,xAxis:{type:'linear' as const},motion:false})),
 {kind:'histogram',label:'Synthetic histogram',observations,motion:false},
 {kind:'matrix-heatmap',label:'Synthetic matrix-heatmap',data:matrix,motion:false},
 {kind:'box-plot',label:'Synthetic box-plot',series:boxes,motion:false},
 {kind:'waterfall',label:'Synthetic waterfall',steps,motion:false},
 {kind:'candlestick',label:'Synthetic candlestick',data:candles,showVolume:true,motion:false},
 {kind:'radar',label:'Synthetic radar',axes,profiles,motion:false},
 {kind:'radial-bar',label:'Synthetic radial-bar',data:rings,motion:false},
 {kind:'pie',label:'Synthetic pie',data:parts,motion:false},
 {kind:'sunburst',label:'Synthetic sunburst',data:tree,motion:false},
 {kind:'realtime',label:'Synthetic realtime',data:samples,windowMs:10000,motion:false},
];
const arcPoints=[{id:'jan',label:'January',values:{alpha:12,beta:4}},{id:'feb',label:'February',values:{alpha:6,beta:18}}];
export const legacyAndArcCases:readonly ZeroChartProps[]=[
 {kind:'sankey',label:'Synthetic sankey',data:sankeyData},
 {kind:'race-bar',label:'Synthetic race-bar',data:raceData,autoPlay:false},
 {kind:'funnel',label:'Synthetic funnel',data:funnelData},
 {kind:'arc-line',label:'Synthetic arc-line',data:arcPoints,series,motion:false},
 {kind:'arc-bar',label:'Synthetic arc-bar',period:'January',data:[{id:'one',label:'One',value:12}],motion:false},
 {kind:'donut',label:'Synthetic donut',data:parts,motion:false},
 {kind:'streamgraph',label:'Synthetic streamgraph',data:arcPoints,series,motion:false},
 {kind:'brush',label:'Synthetic brush',data:[{date:Date.UTC(2026,0,1),value:12},{date:Date.UTC(2026,0,2),value:18}],motion:false},
 {kind:'waffle',label:'Synthetic waffle',data:parts,motion:false},
 {kind:'slope',label:'Synthetic slope',data:[{id:'a',label:'Synthetic Alpha',start:12,end:18}],startLabel:'Before',endLabel:'After',motion:false},
 {kind:'sparkline',label:'Synthetic sparkline',data:[12,18],motion:false},
 {kind:'gauge',label:'Synthetic gauge',value:60,motion:false},
 {kind:'activity-heatmap',label:'Synthetic activity-heatmap',period:'January',days:[{date:'2026-01-01',count:12}],motion:false},
 {kind:'ridgeline',label:'Synthetic ridgeline',series:boxes,motion:false},
 {kind:'treemap',label:'Synthetic treemap',data:tree,motion:false},
];
export function NativeConsumer(){return<main>{nativeCases.map(props=><ZeroChart key={props.kind}{...props}/>)}</main>;}
export function AllChartKindsConsumer(){return<main>{[...nativeCases,...legacyAndArcCases].map(props=><ZeroChart key={props.kind}{...props}/>)}</main>;}
