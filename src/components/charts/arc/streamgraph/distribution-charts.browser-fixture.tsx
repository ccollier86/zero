'use client';
/** Synthetic fixture for the four Arc-derived analytical charts; no app configuration, services or provider data is loaded. */
import * as React from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {Streamgraph,type StreamgraphProps} from "./streamgraph";
import {SlopeChart,type SlopeChartProps} from "../slope-chart/slope-chart";
import {Ridgeline,type RidgelineProps} from "../ridgeline/ridgeline";
import {Treemap,type TreemapProps} from "../treemap/treemap";
const streamBase:StreamgraphProps={label:"Support topics",height:230,series:[{id:"billing",label:"Billing"},{id:"access",label:"Access"},{id:"product",label:"Product"},{id:"other",label:"Other"}],data:[
{id:"w1",label:"Week one",axisLabel:"Sep 1",values:{billing:24,access:12,product:18,other:7}},
{id:"w2",label:"Week two",axisLabel:"Sep 8",values:{billing:20,access:24,product:12,other:9}},
{id:"w3",label:"Week three",axisLabel:"Sep 15",values:{billing:12,access:32,product:24,other:6}},
{id:"w4",label:"Week four",axisLabel:"Sep 22",values:{billing:32,access:12,product:24,other:11}}]};
const slopeBase:SlopeChartProps={label:"Conversion by channel",startLabel:"Q1",endLabel:"Q2",height:240,highlightId:"organic",data:[
{id:"organic",label:"Organic",start:4.2,end:7.8},{id:"paid",label:"Paid",start:6.8,end:5.3},{id:"referral",label:"Referral",start:3.2,end:6.1},{id:"social",label:"Social",start:5.4,end:4.2}]};
const ridgeBase:RidgelineProps={label:"Response times by region",unit:"ms",series:[
{id:"east",label:"East",values:[24,25,30,32,35,40,42,48,50,58]},
{id:"west",label:"West",values:[30,35,38,42,50,54,58,60,64,72]},
{id:"north",label:"North",values:[18,20,24,26,28,30,34,35,38,44]},
{id:"south",label:"South",values:[22,24,28,30,35,38,44,48,52,68]}]};
const treeBase:TreemapProps={label:"Revenue by region",colorLabel:"Growth",height:340,data:{id:"root",label:"Revenue",children:[
{id:"eu",label:"Europe",children:[{id:"de",label:"Germany",value:42,color:5},{id:"fr",label:"France",value:30,color:2},{id:"ch",label:"Switzerland",value:18,color:8}]},
{id:"us",label:"United States",children:[{id:"east",label:"East",value:44,color:7},{id:"west",label:"West",value:28,color:3}]},
{id:"asia",label:"Asia",children:[{id:"jp",label:"Japan",value:22,color:4},{id:"sg",label:"Singapore",value:16,color:9}]}]}};
type Kind="stream"|"slope"|"ridge"|"tree";
declare global {interface Window{__arcDistribution:{update:(kind:Kind,patch:object)=>void;reference:(kind:Kind)=>object;custom:(mode:"default"|"custom"|"hidden")=>void;controlled:(accept:boolean)=>void;events:()=>unknown[];unmount:()=>void};__arcDistributionPending:()=>number;}}
const pending=new Set<number>(),originalRequest=window.requestAnimationFrame.bind(window),originalCancel=window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame=callback=>{let id=0;id=originalRequest(time=>{pending.delete(id);callback(time);});pending.add(id);return id;};
window.cancelAnimationFrame=id=>{pending.delete(id);originalCancel(id);};window.__arcDistributionPending=()=>pending.size;
const events:unknown[]=[];
const root=createRoot(document.getElementById("root")!);
function App(){
 const [stream,setStream]=React.useState(streamBase),[slope,setSlope]=React.useState(slopeBase),[ridge,setRidge]=React.useState(ridgeBase),[tree,setTree]=React.useState(treeBase);
 const [custom,setCustom]=React.useState<"default"|"custom"|"hidden">("default"),[control,setControl]=React.useState<boolean|undefined>(undefined);
 const [selected,setSelected]=React.useState({stream:"w4" as string|null,series:"billing" as string|null,slope:"organic" as string|null,ridge:"east" as string|null,tree:"root"});
 const renderer=custom==="default"?undefined:custom==="hidden"?()=>null:()=> <span data-testid="custom-distribution-inspector">Custom inspector</span>;
 window.__arcDistribution={update(kind,patch){flushSync(()=>{if(kind==="stream")setStream(previous=>({...previous,...patch}));else if(kind==="slope")setSlope(previous=>({...previous,...patch}));else if(kind==="ridge")setRidge(previous=>({...previous,...patch}));else setTree(previous=>({...previous,...patch}));});},reference:kind=>({stream:streamBase,slope:slopeBase,ridge:ridgeBase,tree:treeBase}[kind]),custom:mode=>flushSync(()=>setCustom(mode)),controlled:accept=>flushSync(()=>setControl(accept)),events:()=>events,unmount:()=>root.unmount()};
 return <main style={{maxWidth:800,margin:"24px auto",padding:"0 16px",fontFamily:"var(--font-platform-sans,system-ui)"}}>
 <h1>Arc distribution chart fixture</h1>
 <section data-testid="stream-card" style={card}><h2>Streamgraph</h2><Streamgraph {...stream} renderTooltip={renderer} activeDatumId={control===undefined?undefined:selected.stream} activeSeriesId={control===undefined?undefined:selected.series} onActiveChange={(datumId,seriesId)=>{events.push(["stream",datumId,seriesId]);if(control)setSelected(s=>({...s,stream:datumId,series:seriesId}));}} /></section>
 <section data-testid="slope-card" style={card}><h2>Slope</h2><SlopeChart {...slope} renderTooltip={renderer} activeId={control===undefined?undefined:selected.slope} onActiveChange={id=>{events.push(["slope",id]);if(control)setSelected(s=>({...s,slope:id}));}} /></section>
 <section data-testid="ridge-card" style={card}><h2>Ridgeline</h2><Ridgeline {...ridge} renderTooltip={renderer} activeSeriesId={control===undefined?undefined:selected.ridge} onActiveChange={id=>{events.push(["ridge",id]);if(control)setSelected(s=>({...s,ridge:id}));}} /></section>
 <section data-testid="tree-card" style={card}><h2>Treemap</h2><Treemap {...tree} renderTooltip={renderer} focusId={control===undefined?undefined:selected.tree} onFocusChange={id=>{events.push(["tree",id]);if(control)setSelected(s=>({...s,tree:id}));}} /></section>
 </main>;
}
const card:React.CSSProperties={background:"var(--card)",border:"1px solid var(--border)",borderRadius:18,padding:20,marginBottom:18,minWidth:0};
root.render(<App/>);
