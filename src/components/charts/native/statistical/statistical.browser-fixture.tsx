'use client';
/** Isolated synthetic native statistical fixture. No app config, provider, database or external market feed. */
import{createRoot}from"react-dom/client";
import{useState,type ReactNode}from"react";
import{HistogramChart,type HistogramChartProps}from"./histogram-chart";
import{MatrixHeatmap,type MatrixHeatmapProps}from"./matrix-heatmap";
import{BoxPlotChart,type BoxPlotChartProps}from"./box-plot-chart";
import{WaterfallChart,type WaterfallChartProps}from"./waterfall-chart";
import{CandlestickChart,type CandlestickChartProps}from"./candlestick-chart";
type Kind="histogram"|"matrix"|"box"|"waterfall"|"candlestick";
type State={histogram:HistogramChartProps;matrix:MatrixHeatmapProps;box:BoxPlotChartProps;waterfall:WaterfallChartProps;candlestick:CandlestickChartProps};
const reference:State={
 histogram:{label:"Response time distribution",title:"Response time",subtitle:"Measured requests · milliseconds",observations:[2,3,6,8,9,12,14,15,16,17,18,20,23,26,27,32,38,40,42,48,55,62,75].map((value,index)=>({id:"request-"+index,value})),binning:{edges:[0,10,20,30,40,50,60,80]}},
 matrix:{label:"Service measure matrix",title:"Service matrix",subtitle:"Arbitrary service/region measures",data:{rows:[{id:"api",label:"API"},{id:"jobs",label:"Jobs"},{id:"mail",label:"Mail"}],columns:[{id:"us",label:"US"},{id:"eu",label:"Europe"},{id:"apac",label:"APAC"}],cells:[{id:"api-us",rowId:"api",columnId:"us",value:12},{id:"api-eu",rowId:"api",columnId:"eu",value:0},{id:"api-apac",rowId:"api",columnId:"apac",value:null},{id:"jobs-us",rowId:"jobs",columnId:"us",value:-3},{id:"jobs-eu",rowId:"jobs",columnId:"eu",value:8},{id:"mail-us",rowId:"mail",columnId:"us",value:20},{id:"mail-apac",rowId:"mail",columnId:"apac",value:6}]}},
 box:{label:"Measured latency boxes",title:"Latency by service",subtitle:"Actual observations · Tukey whiskers",series:[{id:"api",label:"API",values:[8,9,11,12,14,16,18,22,75]},{id:"jobs",label:"Jobs",values:[12,13,18,20,26,28,31,33]},{id:"mail",label:"Mail",values:[4,6,8,9,12,14,16,19]}]},
 waterfall:{label:"Operating balance",title:"Operating balance",subtitle:"Signed contributions and explicit snapshots",startingValue:20,steps:[{id:"sales",label:"Sales",kind:"contribution",value:80},{id:"costs",label:"Costs",kind:"contribution",value:-30},{id:"subtotal",label:"Subtotal",kind:"subtotal"},{id:"reset",label:"Reset",kind:"total",value:60},{id:"refunds",label:"Refunds",kind:"contribution",value:-18},{id:"closing",label:"Closing",kind:"subtotal"}]},
 candlestick:{label:"Ordered OHLC prices",title:"Price movement",subtitle:"Synthetic ordered OHLC · no external feed",showVolume:true,data:Array.from({length:12},(_,index)=>{const open=100+[0,4,1,5,3,8,9,6,10,12,9,14][index]!,close=open+[4,-3,4,-2,5,1,-3,4,2,-3,5,-1][index]!;return{id:"period-"+index,label:"Oct "+(index+1),time:1790812800000+index*86400000,open,close,low:Math.min(open,close)-3,high:Math.max(open,close)+4,volume:index===3?undefined:100+index*37};})},
};
declare global{interface Window{__nativeStatisticalTest:{patch:(kind:Kind,patch:Record<string,unknown>)=>void;reference:(kind:Kind)=>unknown;custom:(mode:"default"|"custom"|"hidden")=>void;controlled:(kind:Kind,id:string|null|undefined)=>void;motion:(on:boolean)=>void;events:()=>readonly(readonly[Kind,string|null])[];unmount:()=>void};__nativeStatisticalPending:()=>number}}
const root=createRoot(document.getElementById("root")!);const events:Array<[Kind,string|null]>=[];
const frames=new Set<number>(),request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);window.requestAnimationFrame=callback=>{let id=0;id=request(time=>{frames.delete(id);callback(time);});frames.add(id);return id;};window.cancelAnimationFrame=id=>{frames.delete(id);cancel(id);};window.__nativeStatisticalPending=()=>frames.size;
function Fixture(){const[state,setState]=useState(reference),[custom,setCustom]=useState<"default"|"custom"|"hidden">("default"),[motion,setMotion]=useState(true),[controlled,setControlled]=useState<Partial<Record<Kind,string|null|undefined>>>({});
 const customTooltip=custom==="default"?undefined:()=>custom==="hidden"?null:<div data-testid="custom-native-statistical">Custom exact reading</div>;
 window.__nativeStatisticalTest={patch:(kind,patch)=>setState(previous=>({...previous,[kind]:{...previous[kind],...patch}})),reference:kind=>reference[kind],custom:setCustom,controlled:(kind,id)=>setControlled(previous=>({...previous,[kind]:id})),motion:setMotion,events:()=>events,unmount:()=>root.unmount()};
 const control=(kind:Kind)=>({motion,activeId:controlled[kind],onActiveChange:(id:string|null)=>events.push([kind,id]),renderTooltip:customTooltip});
 const card=(kind:Kind,chart:ReactNode)=><section className="fixture-card"data-testid={kind+"-card"}key={kind}>{chart}</section>;
 return<main className="fixture"><h1>Native statistical chart fixture</h1><div className="fixture-grid">{card("histogram",<HistogramChart {...state.histogram}{...control("histogram")}/>)}{card("matrix",<MatrixHeatmap {...state.matrix}{...control("matrix")}/>)}{card("box",<BoxPlotChart {...state.box}{...control("box")}/>)}{card("waterfall",<WaterfallChart {...state.waterfall}{...control("waterfall")}/>)}{card("candlestick",<CandlestickChart {...state.candlestick}{...control("candlestick")}/>)}</div></main>;
}
root.render(<Fixture/>);
