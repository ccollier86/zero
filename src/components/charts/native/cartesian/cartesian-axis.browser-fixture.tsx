/** Synthetic public chart composition for axis-caption, text-token and formatting regression measurements. No application services. */
import { createRoot } from 'react-dom/client';
import { useState, type CSSProperties } from 'react';
import { ComposedChart, HistogramChart, BoxPlotChart, WaterfallChart, CandlestickChart, MatrixHeatmap, RealtimeChart } from '../../index';
import { LineChart, BarChart } from '../../arc';
import type { CartesianChartProps } from './cartesian-chart';
const variants = [
  ['vertical-left', 'vertical', ['left']], ['vertical-right', 'vertical', ['right']], ['vertical-dual', 'vertical', ['left', 'right']],
  ['horizontal-bottom', 'horizontal', ['left']], ['horizontal-top', 'horizontal', ['right']], ['horizontal-dual', 'horizontal', ['left', 'right']],
] as const;
const domains = { mixed: [-50, 0, 50], positive: [0, 25, 50], negative: [-50, -25, -5], zero: [0, 0, 0] } as const;
const period = 'Billing period';
function DynamicAxisChart() {
  const [loaded, setLoaded] = useState(false), [large, setLarge] = useState(false);
  return <section className="axis-card" data-dynamic-axis style={{ '--zero-chart-metadata-size': large ? '22px' : '18px', '--zero-chart-font-family': large ? 'Georgia, serif' : 'system-ui, sans-serif' } as CSSProperties}>
    <button onClick={() => setLoaded(true)}>Load synthetic measurements</button><button onClick={() => setLarge(true)}>Change axis typography</button>
    <ComposedChart label="Dynamic typography" height={260} motion={false} data={loaded ? [-50,0,50].map((value,index)=>({id:String(index),label:`Period ${index}`,values:{net:value}})) : []} series={[{id:'net',label:'Balance'}]} yAxes={[{id:'primary',label:'USD'}]} formatYTick={value=>`USD ${value.toFixed(2)}`}/>
    <MatrixHeatmap label="Late matrix measurements" motion={false} data={{rows:loaded?[{id:'r',label:'Long regional label'}]:[],columns:loaded?[{id:'a',label:'Long international service category'},{id:'b',label:'Another service category'}]:[],cells:loaded?[{id:'a',rowId:'r',columnId:'a',value:50},{id:'b',rowId:'r',columnId:'b',value:100}]:[]}}/>
  </section>;
}
function AxisGallery() {
  return <main><h1>Cartesian axis layout review</h1><p>Synthetic measurements only. Units, tick labels and captions must remain separate and inside their SVG.</p>
    <div className="axis-gallery">{variants.flatMap(([variant, layout, sides]) => Object.entries(domains).flatMap(([domain, values]) => [false, true].map(long => {
      const id = `${variant}-${domain}-${long ? 'long' : 'short'}`, labels = sides.map((side, index) => long ? `${index ? 'Secondary' : 'Operating'} balance in US dollars including adjustments and corrections` : index ? 'Count' : 'USD');
      const yAxes = sides.map((side, index) => ({ id: `axis-${index}`, side, label: labels[index]!, includeZero: true }));
      const series = sides.map((_, index) => ({ id: `net-${index}`, axisId: `axis-${index}`, label: index ? 'Other balance' : 'Net cash', mark: 'line' as const, curve: 'linear' as const }));
      const data = values.map((value, index) => ({ id: String(index), label: ['Expense', 'No transactions', 'Payment'][index]!, values: Object.fromEntries(sides.map((_, n) => [`net-${n}`, value * (n + 1)])) }));
      const options: Pick<CartesianChartProps, 'formatX' | 'formatYTick'> = long ? { formatX: value => `${value} — 東京の明細と請求の長い名前`, formatYTick: value => `USD ${value.toFixed(2)}` } : {};
      return <article className="axis-card" key={id} data-axis-case={id} data-unit-labels={JSON.stringify(labels)} style={{ '--zero-chart-metadata-size': long ? '18px' : '11.5px', '--zero-chart-font-family': long ? 'Georgia, serif' : undefined } as CSSProperties}>
        <ComposedChart label={id} title={variant} height={210} motion={false} data={data} series={series} yAxes={yAxes} xAxis={{ label: period }} layout={layout} {...options} />
      </article>;
    })))}</div><h2>Long labels across chart families</h2><div className="axis-gallery">
      <article className="axis-card" data-text-case="arc-line"><LineChart motion={false} label="Long Arc line labels" data={Array.from({length:8},(_,i)=>({id:String(i),label:`Observation ${i}`,axisLabel:`Extremely long billing period ${i} with corrections`,values:{net:i*10}}))} series={[{id:'net',label:'Operating balance including adjustments and corrections'}]} formatTick={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="arc-bar"><BarChart motion={false} label="Long Arc bar labels" period="Synthetic periods" data={[0,1,2].map(i=>({id:String(i),label:`Record ${i}`,axisLabel:`Long billing period ${i} including all corrections`,value:20+i*10}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="histogram"><HistogramChart motion={false} label="Long histogram values" observations={[10,20,50,70].map((value,i)=>({id:String(i),value}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="box"><BoxPlotChart motion={false} label="Long box labels" series={[0,1,2].map(i=>({id:String(i),label:`Extremely long service measurement ${i}`,values:[10,20,30,40]}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="waterfall"><WaterfallChart motion={false} label="Long waterfall labels" steps={[0,1,2].map(i=>({id:String(i),label:`Long operating adjustment ${i}`,kind:'contribution' as const,value:50-i*20}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="candlestick"><CandlestickChart motion={false} label="Long candle labels" data={[0,1,2].map(i=>({id:String(i),label:`Synthetic exchange observation ${i}`,time:i*1000,open:10,high:50,low:5,close:30}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="matrix"><MatrixHeatmap motion={false} label="Long matrix labels" data={{rows:[{id:'r',label:'Very long server region label'}],columns:[{id:'a',label:'Very long column label one'},{id:'b',label:'Very long column label two'}],cells:[{id:'a',rowId:'r',columnId:'a',value:50},{id:'b',rowId:'r',columnId:'b',value:100}]}} formatValue={value=>`USD ${value.toFixed(2)} dollars`}/></article>
      <article className="axis-card" data-text-case="realtime"><RealtimeChart motion={false} label="Long realtime labels" data={[0,1,2].map(i=>({id:String(i),time:i*10000,value:20+i*10}))} formatValue={value=>`USD ${value.toFixed(2)} dollars`} formatTimeTick={time=>`Very long observed UTC timestamp ${time}`}/></article>
    </div><h2>Reactive typography and initially empty data</h2><DynamicAxisChart/></main>;
}
createRoot(document.getElementById('root')!).render(<AxisGallery />);
