/** Synthetic Arc Cartesian fixtures. They never import app configuration, providers or databases. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LineChart } from './line-chart';
import { BarChart } from '../bar-chart/bar-chart';
import { Sparkline } from '../sparkline/sparkline';
import { BrushChart } from '../brush-chart/brush-chart';
import type { LineChartDatum } from './line-chart-model';
const dates=Array.from({length:90},(_,index)=>({date:Date.UTC(2026,0,index+1),value:Math.round(80+Math.sin(index/7)*45+index)}));
const original:LineChartDatum[]=Array.from({length:10},(_,index)=>({id:String(index),label:`Day ${index+1}`,axisLabel:String(index+1),values:{one:20+Math.sin(index/2)*15,two:10+index}}));
type State={data:readonly LineChartDatum[];controlled:boolean;reject:boolean;active:string|null;hidden:readonly string[];range:readonly[number,number];empty:boolean;motion:boolean;custom:boolean;mounted:boolean};
let current:State;
declare global {interface Window {__arcCartesian:{state:()=>State;patch:(patch:Partial<State>)=>void}}}
function Fixture(){
 const[state,setState]=useState<State>({data:original,controlled:false,reject:false,active:null,hidden:[],range:[dates[20]!.date,dates[50]!.date],empty:false,motion:true,custom:false,mounted:true});current=state;
 const patch=(next:Partial<State>)=>flushSync(()=>setState(previous=>({...previous,...next})));window.__arcCartesian={state:()=>current,patch};
 return <main style={{maxWidth:760,margin:'24px auto',padding:16,fontFamily:'var(--font-sans)'}}><h1>Arc Cartesian fixtures</h1>{state.mounted&&<div data-testid="charts" style={{display:'grid',gap:32}}>
  <section data-testid="line-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:18,background:'var(--card)',minWidth:0}}><LineChart label="Acquisition trend" data={state.empty?[]:state.data} series={[{id:'one',label:'Signups',area:true},{id:'two',label:'Previous',dashed:true}]} hiddenSeries={state.controlled?state.hidden:undefined} onHiddenSeriesChange={hidden=>{if(state.controlled&&!state.reject)patch({hidden});}} activeDatumId={state.controlled?state.active:undefined} onActiveChange={(_,datum)=>{if(state.controlled&&!state.reject)patch({active:datum?.id??null});}} renderTooltip={state.custom?({datum})=><div data-testid="custom-tip">Exact {datum.label}: {datum.values.one}</div>:undefined} motion={state.motion}/></section>
  <section data-testid="bar-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:18,background:'var(--card)',minWidth:0}}><BarChart label="Sessions" period="Last 10 days" data={state.empty?[]:state.data.map(item=>({id:item.id,label:item.label,axisLabel:item.axisLabel,value:item.values.one??0}))} motion={state.motion}/></section>
  <section data-testid="spark-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:18,background:'var(--card)',minWidth:0}}><Sparkline label="Revenue" value="$82K" change="+14.8%" data={state.empty?[]:[3,7,4,8,9,7,13,11,14]} labels={state.empty?[]:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep']} motion={state.motion}/></section>
  <section data-testid="brush-card" style={{padding:24,border:'1px solid var(--border)',borderRadius:18,background:'var(--card)',minWidth:0}}><BrushChart label="Daily active users" data={state.empty?[]:dates} annotations={[{date:dates[30]!.date,label:'Launch',description:'Public release'}]} range={state.controlled?state.range:undefined} defaultRange={state.range} onRangeChange={range=>{if(state.controlled&&!state.reject)patch({range});}} motion={state.motion}/></section>
 </div>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
