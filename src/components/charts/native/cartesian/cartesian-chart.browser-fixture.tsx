/** Synthetic native Cartesian gallery and controlled-state fixture. No application configuration, providers or live rows. */
import{useState}from'react';import{createRoot}from'react-dom/client';
import{CartesianChart,XYLineChart,AreaChart,GroupedBarChart,StackedBarChart,HorizontalBarChart,ComposedChart,ScatterChart,BubbleChart}from'./cartesian-chart';
import type{CartesianDatum,CartesianSeries,CartesianActive}from'./cartesian-types';
const observations:CartesianDatum[]=Array.from({length:8},(_,index)=>({id:String(index),label:`Period ${index+1}`,x:index*10,values:{a:[18,25,22,35,32,28,42,36][index]!,b:[12,16,-4,18,20,22,18,26][index]!}}));
const series:CartesianSeries[]=[{id:'a',label:'Acquisition',color:'var(--zero-chart-blue)'},{id:'b',label:'Retention',color:'var(--zero-chart-purple)'}];
type State={data:readonly CartesianDatum[];controlled:boolean;reject:boolean;active:CartesianActive|null;hidden:readonly string[];window:readonly[number,number];motion:boolean;mounted:boolean;custom:boolean;regressions:boolean};let state:State;
function Fixture(){const[current,setState]=useState<State>({data:observations,controlled:false,reject:false,active:null,hidden:[],window:[0,7],motion:true,mounted:true,custom:false,regressions:false});state=current;const patch=(next:Partial<State>)=>setState(previous=>({...previous,...next}));
 const events:string[]=[];window.__nativeCartesian={patch,state:()=>state,events};
 const common={data:current.data,series,motion:current.motion};
 return<main style={{maxWidth:1120,margin:'auto',padding:24,display:'grid',gap:20,minWidth:0}}><h1>Native Cartesian fixtures</h1>{current.mounted&&<>
  <section data-testid="controlled" className="fixture-card"><CartesianChart {...common} label="Controlled measures" title="Acquisition and retention" series={series.map(line=>({...line,mark:'line' as const}))} brush window={current.controlled?current.window:undefined} defaultWindow={current.window} active={current.controlled?current.active:undefined} hiddenSeriesIds={current.controlled?current.hidden:undefined} onActiveChange={active=>{events.push('active');if(current.controlled&&!current.reject)patch({active});}} onHiddenSeriesChange={hidden=>{events.push('hidden');if(current.controlled&&!current.reject)patch({hidden});}} onWindowChange={window=>{events.push('window');if(current.controlled&&!current.reject)patch({window});}} renderTooltip={current.custom?context=><strong data-testid="custom-inspector">Exact {context.datum.label}: {String(context.datum.cells.a!.value)}</strong>:undefined}/></section>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,440px),1fr))',gap:20,minWidth:0}}>
   <section className="fixture-card"><XYLineChart {...common} label="XY lines" title="Numeric coordinate spacing" xAxis={{type:'linear'}} series={series.map(line=>({...line,curve:line.id==='a'?'smooth':'step'}))}/></section>
   <section className="fixture-card"><AreaChart {...common} label="Signed areas" title="Independent area baselines"/></section>
   <section className="fixture-card"><GroupedBarChart {...common} label="Grouped columns" title="Grouped category comparisons"/></section>
   <section className="fixture-card"><StackedBarChart {...common} label="Signed stacked columns" title="Positive and negative stacks"/></section>
   <section className="fixture-card"><HorizontalBarChart {...common} label="Horizontal measures" title="Horizontal comparisons" stack="signed"/></section>
   <section className="fixture-card"><ComposedChart {...common} label="Composed measures" title="Composed marks · dual scales" series={[{id:'a',label:'Acquisition',mark:'bar',axisId:'count'},{id:'b',label:'Retention',mark:'line',axisId:'rate'}]} yAxes={[{id:'count',label:'Count'},{id:'rate',side:'right',label:'Rate'}]} references={[{id:'goal',axis:'y',axisId:'count',value:30,label:'Goal'}]} bands={[{id:'target',axis:'y',axisId:'count',from:20,to:30}]}/></section>
   <section className="fixture-card"><ScatterChart {...common} label="Scatter measures" title="Genuine XY observations" data={current.data.map(datum=>({...datum,values:{a:{value:Number(datum.values.a),low:Number(datum.values.a)-3,high:Number(datum.values.a)+4},b:datum.values.b}}))}/></section>
   <section className="fixture-card"><BubbleChart {...common} label="Bubble measures" title="Bubble area is measured size" data={current.data.map((datum,index)=>({...datum,values:{a:{value:Number(datum.values.a),size:index*12},b:{value:Number(datum.values.b),size:90-index*7}}}))}/></section>
  </div>
  {current.regressions&&<div style={{display:'grid',gap:20,minWidth:0}}>
   <section className="fixture-card" data-testid="numeric-endpoints"><GroupedBarChart label="Numeric endpoint groups" title="Numeric endpoint groups" motion={current.motion} series={series} xAxis={{type:'linear'}} data={[{id:'start',label:'Start',x:0,values:{a:10,b:20}},{id:'end',label:'End',x:100,values:{a:20,b:10}}]}/></section>
   {(['vertical','horizontal']as const).map(layout=><section key={layout} className="fixture-card" data-testid={`interval-${layout}`}><AreaChart label={`Measured interval ${layout}`} motion={current.motion} layout={layout} xAxis={{type:'linear'}} series={[series[0]!]} data={[{id:'start',label:'Start',x:0,values:{a:{value:10,low:7,high:13}}},{id:'middle',label:'Middle',x:50,values:{a:{value:30,low:27,high:34}}},{id:'end',label:'End',x:100,values:{a:{value:20,low:17,high:23}}}]}/></section>)}
   <section className="fixture-card" data-testid="bubble-composed"><ComposedChart label="Bubble domain composer" motion={current.motion} xAxis={{type:'linear'}} series={[{id:'a',label:'Bubble',mark:'scatter',bubble:true},{id:'b',label:'Line metadata',mark:'line'}]} data={[{id:'start',label:'Start',x:0,values:{a:{value:10,size:100},b:{value:20,size:10000}}}]}/></section>
   <section className="fixture-card" data-testid="subnormal-path"><XYLineChart label="Subnormal coordinate line" motion={current.motion} xAxis={{type:'linear'}} series={[series[0]!]} data={[{id:'start',label:'Start',x:0,values:{a:0}},{id:'near',label:'Near',x:Number.MIN_VALUE,values:{a:10}},{id:'end',label:'End',x:1,values:{a:0}}]}/></section>
  </div>}
 </>}</main>;
}
declare global{interface Window{__nativeCartesian:{patch:(next:Partial<State>)=>void;state:()=>State;events:string[]}}}
createRoot(document.getElementById('root')!).render(<Fixture/>);
