'use client';
/** Handmade Cartesian SVG organism. Consumes pure admitted geometry and shared Zero presentation/lifecycle, never data transport. */
import{useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode}from'react';
import{AnimatePresence,motion}from'motion/react';
import{NativeChartFrame,NativeChartInspector,NativeChartLegend,NativeChartDataTable,useNativeChartEnvironment,useNativeChartSelection,nativeColor,NATIVE_CHART_MOTION}from'../shared/native-chart';
import{formatNativeChartNumber}from'../shared/native-format';
import{admitCartesianHidden,buildCartesianModel,fitCartesianWindow}from'./cartesian-model';
import{computeCartesianLayout,cartesianBubbleRadius,cartesianBubbleMaximum}from'./cartesian-layout';
import{cartesianKeyboardTarget}from'./cartesian-interaction';
import{record,text,number,flag,list,choice,domain}from'./cartesian-admission';
import type{CartesianDatum,CartesianSeries,CartesianOptions,CartesianActive,CartesianModelDatum,CartesianModelSeries,CartesianAxisModel,CartesianModel}from'./cartesian-types';
export type{CartesianDatum,CartesianSeries,CartesianActive}from'./cartesian-types';
/** Exact admitted values are independent of normalized stack coordinates and animated SVG attributes. */
export interface CartesianTooltipContext{readonly datum:CartesianModelDatum;readonly series:readonly CartesianModelSeries[];readonly activeSeries:CartesianModelSeries|null;readonly model:CartesianModel;readonly formatValue:(value:number,series:CartesianModelSeries)=>string}
/** One typed mark/axis specification composes independent lines, areas, grouped/stacked bars and scatter/bubble points. */
export interface CartesianChartProps extends Omit<CartesianOptions,'hiddenSeriesIds'|'window'>{
 readonly data:readonly CartesianDatum[];readonly series:readonly CartesianSeries[];readonly label:string;readonly title?:string;readonly subtitle?:string;
 readonly height?:number;readonly className?:string;readonly motion?:boolean;readonly legend?:boolean;readonly grid?:boolean;readonly brush?:boolean;readonly emptyLabel?:string;
 readonly formatValue?:(value:number,series:CartesianModelSeries)=>string;readonly formatYTick?:(value:number,axis:CartesianAxisModel)=>string;readonly formatX?:(value:string|number)=>string;
 readonly active?:CartesianActive|null;readonly defaultActive?:CartesianActive|null;readonly onActiveChange?:(active:CartesianActive|null,datum:CartesianModelDatum|null)=>void;
 readonly hiddenSeriesIds?:readonly string[];readonly defaultHiddenSeriesIds?:readonly string[];readonly onHiddenSeriesChange?:(hidden:string[])=>void;
 readonly window?:readonly[number,number];readonly defaultWindow?:readonly[number,number];readonly onWindowChange?:(window:[number,number])=>void;
 readonly renderTooltip?:(context:CartesianTooltipContext)=>ReactNode;
}
const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
const encode=(active:CartesianActive|null|undefined):string|null|undefined=>active===undefined?undefined:active===null?null:JSON.stringify([active.datumId,active.seriesId??null]);
const decode=(value:string|null):CartesianActive|null=>{if(value===null)return null;const[id,series]=JSON.parse(value)as[string,string|null];return{datumId:id,...(series===null?{}:{seriesId:series})};};
function admitActive(value:CartesianActive|null|undefined,path:string):CartesianActive|null|undefined{if(value===undefined||value===null)return value;const active=record(value,path,['datumId','seriesId']);return{datumId:text(active.datumId,path,true),...(active.seriesId===undefined?{}:{seriesId:text(active.seriesId,path,true)})};}
function StaticGeometry({children}:{children:ReactNode;initial?:boolean}){return<g>{children}</g>;}
/** Native marks share stable controlled visibility/inspection/window state and complete exact SSR data. */
export function CartesianChart(props:CartesianChartProps){
 const label=text(props.label,'label'),height=number(props.height===undefined?300:props.height,'height',4096);if(height<120)throw new RangeError('Cartesian height must be at least 120px');
 for(const key of['title','subtitle','emptyLabel']as const)if(props[key]!==undefined)text(props[key],key);
 for(const key of['motion','legend','grid','brush']as const)flag(props[key],key);
 const figure=useRef<HTMLElement>(null),plot=useRef<HTMLDivElement>(null);const environment=useNativeChartEnvironment(figure,{motion:props.motion});const reduced=environment.reduced;
 const[width,setWidth]=useState(640);useLayoutEffect(()=>{const node=plot.current;if(!node)return;const measure=()=>setWidth(Math.max(120,Math.min(16384,node.clientWidth||640)));measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
 const[localHidden,setLocalHidden]=useState(()=>admitCartesianHidden(props.defaultHiddenSeriesIds));const knownSeries=new Set(list(props.series,'series',16).map(value=>text(record(value,'series',['id','label','mark','axisId','stackId','color','curve','connectNulls','baseline','bubble','dashed']).id,'series.id',true)));
 const hidden=admitCartesianHidden(props.hiddenSeriesIds===undefined?localHidden:props.hiddenSeriesIds).filter(id=>knownSeries.has(id));
 const externalWindow=props.window===undefined?undefined:domain(props.window,'window',8.64e15),initialWindow=props.defaultWindow===undefined?undefined:domain(props.defaultWindow,'defaultWindow',8.64e15);
 const[localWindow,setLocalWindow]=useState<readonly[number,number]|undefined>(()=>initialWindow);
 const model=useMemo(()=>buildCartesianModel(props.data,props.series,{xAxis:props.xAxis,yAxes:props.yAxes,layout:props.layout,stack:props.stack,missing:props.missing,hiddenSeriesIds:hidden,window:externalWindow??localWindow,references:props.references,bands:props.bands}),[props.data,props.series,props.xAxis,props.yAxes,props.layout,props.stack,props.missing,JSON.stringify(hidden),externalWindow?.[0],externalWindow?.[1],localWindow?.[0],localWindow?.[1],props.references,props.bands]);
 // Drop retired visibility state, so an unrelated later series with a reused ID does not inherit stale intent.
 useEffect(()=>{if(props.hiddenSeriesIds===undefined&&localHidden.some(id=>!model.series.some(series=>series.id===id)))setLocalHidden(localHidden.filter(id=>model.series.some(series=>series.id===id)));},[model.series,props.hiddenSeriesIds,localHidden]);
 const geometry=useMemo(()=>computeCartesianLayout(model,width,height),[model,width,height]);const horizontal=model.layout==='horizontal';
 const dataInWindow=model.data.filter(datum=>datum.coordinate>=model.window[0]&&datum.coordinate<=model.window[1]);
 const acceptedIds=dataInWindow.flatMap(datum=>model.visibleSeries.length?[JSON.stringify([datum.id,null]),...model.visibleSeries.filter(series=>datum.cells[series.id]!.value!==null).map(series=>JSON.stringify([datum.id,series.id]))]:[]);
 const external=admitActive(props.active,'active'),initial=admitActive(props.defaultActive,'defaultActive');
 const[accepted,request]=useNativeChartSelection(acceptedIds,encode(external),encode(initial)??null,value=>{const active=decode(value);props.onActiveChange?.(active,active?model.data.find(datum=>datum.id===active.datumId)??null:null);});
 const active=decode(accepted),datum=active?model.data.find(datum=>datum.id===active.datumId)??null:null;
 const selectedPoints=active?geometry.series.flatMap(series=>series.points).filter(point=>point.datumId===active.datumId&&(!active.seriesId||point.seriesId===active.seriesId)):[];
 const focusPoint=selectedPoints[0];const independent=datum?geometry.mapX(datum.coordinate):0;const point:readonly[number,number]=focusPoint?[geometry.left+focusPoint.x,geometry.top+focusPoint.y]:horizontal?[geometry.left+geometry.plotWidth/2,geometry.top+independent]:[geometry.left+independent,geometry.top+geometry.plotHeight/2];
 const format=(value:number,series:CartesianModelSeries)=>props.formatValue?.(value,series)??formatNativeChartNumber(value);
 const colors=new Map(model.series.map((series,index)=>[series.id,series.color??nativeColor(index)]));
 const toggle=(id:string)=>{const next=hidden.includes(id)?hidden.filter(value=>value!==id):[...hidden,id];if(props.hiddenSeriesIds===undefined)setLocalHidden(next);props.onHiddenSeriesChange?.(next);};
 const setWindow=(next:readonly[number,number])=>{const fitted=fitCartesianWindow(next,model.xDomain);if(props.window===undefined)setLocalWindow(fitted);props.onWindowChange?.(fitted);};
 const inspect=(datumId:string,seriesId?:string)=>request(JSON.stringify([datumId,seriesId??null]));
 const nearest=(event:PointerEvent<HTMLDivElement>)=>{const bounds=event.currentTarget.getBoundingClientRect(),x=(event.clientX-bounds.left)*width/(bounds.width||width)-geometry.left,y=(event.clientY-bounds.top)-geometry.top;const element=(event.target as Element).closest?.('[data-datum]');if(element){const id=element.getAttribute('data-datum'),series=element.getAttribute('data-series');if(id)return{id,series:series??undefined};}
  if(model.visibleSeries.every(series=>series.mark==='scatter')){let best:{id:string;series:string}|undefined,distance=Infinity;for(const shape of geometry.series)for(const point of shape.points){const d=(point.x-x)**2+(point.y-y)**2;if(d<distance){distance=d;best={id:point.datumId,series:point.seriesId};}}return best;}
  let best:CartesianModelDatum|undefined,distance=Infinity;for(const datum of dataInWindow){const d=Math.abs(geometry.mapX(datum.coordinate)-(horizontal?y:x));if(d<distance){distance=d;best=datum;}}return best?{id:best.id,series:undefined}:undefined;
 };
 const onMove=(event:PointerEvent<HTMLDivElement>)=>{if(event.pointerType!=='mouse')return;const next=nearest(event);if(next)inspect(next.id,next.series);};
 const onTouch=(event:PointerEvent<HTMLDivElement>)=>{if(event.pointerType==='mouse')return;const next=nearest(event);if(next)active?.datumId===next.id&&active.seriesId===next.series?request(null):inspect(next.id,next.series);};
 const onKey=(event:KeyboardEvent<HTMLDivElement>)=>{const target=cartesianKeyboardTarget(model,active,event.key);if(target===undefined)return;request(encode(target)??null);event.preventDefault();};
 const context:CartesianTooltipContext|null=datum?{datum,series:model.visibleSeries,activeSeries:model.visibleSeries.find(series=>series.id===active?.seriesId)??null,model,formatValue:format}:null;
 const custom=context?props.renderTooltip?.(context):undefined;
 const inspector=context?(custom===undefined?<><div>{context.datum.label}</div><div className="rows">{context.series.map(series=>{const cell=context.datum.cells[series.id]!;return<div key={series.id}><span className="muted">{series.label}</span><b>{cell.value===null?'—':format(cell.value,series)}</b></div>;})}</div>{context.activeSeries&&context.datum.cells[context.activeSeries.id]!.size!==null&&<div className="muted">Size {String(context.datum.cells[context.activeSeries.id]!.size)}</div>}</>:custom):null;
 const id=`native-cartesian-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;const transition=reduced?{duration:0}:NATIVE_CHART_MOTION.morph;
 const revealed=environment.inView||reduced;const maxBubble=cartesianBubbleMaximum(model);
 const tableShape=model.series.map(series=>({series,interval:model.data.some(datum=>datum.cells[series.id]!.low!==null),size:model.data.some(datum=>datum.cells[series.id]!.size!==null)}));
 const completeColumns=['Observation',model.xLabel||'X',...tableShape.flatMap(({series,interval,size})=>[series.label,...(interval?[`${series.label} low`,`${series.label} high`]:[]),...(size?[`${series.label} size`]:[])])];
 const completeRows=model.data.map(datum=>[datum.label,String(datum.x),...tableShape.flatMap(({series,interval,size})=>{const cell=datum.cells[series.id]!;return[cell.value===null?'—':String(cell.value),...(interval?[cell.low===null?'—':String(cell.low),cell.high===null?'—':String(cell.high)]:[]),...(size?[cell.size===null?'—':String(cell.size)]:[])];})]);
 const gridAxis=geometry.axes[0]!;const empty=!dataInWindow.length||!model.visibleSeries.length||geometry.series.every(shape=>!shape.points.length);const SeriesPresence=reduced?StaticGeometry:AnimatePresence;
 return<NativeChartFrame ref={figure} label={label} title={props.title} subtitle={props.subtitle} className={['zero-native-cartesian',props.className].filter(Boolean).join(' ')} motion={!reduced} summary={datum?`${datum.label}. ${model.visibleSeries.map(series=>`${series.label} ${datum.cells[series.id]!.value===null?'missing':format(datum.cells[series.id]!.value!,series)}`).join(', ')}`:undefined}>
  {(props.legend??model.series.length>1)&&<NativeChartLegend items={model.series.map(series=>({id:series.id,label:series.label,color:colors.get(series.id)}))} hiddenIds={hidden} onToggle={toggle}/>}
  <div ref={plot} className="zero-native-chart__plot zero-native-cartesian__plot" role="group" aria-roledescription="chart" aria-label={`${label}. Arrow keys inspect measurements; Home and End jump; Escape clears.`} tabIndex={empty?-1:0} onPointerMove={onMove} onPointerDown={onTouch} onPointerLeave={event=>{if(event.pointerType==='mouse')request(null);}} onKeyDown={onKey} onBlur={()=>request(null)}>
   <svg viewBox={`0 0 ${width} ${height}`} height={height} aria-hidden="true" focusable="false">
    <defs><clipPath id={id}><motion.rect key={reduced?'static':'animated'} x={0} y={0} width={revealed?geometry.plotWidth:0} height={geometry.plotHeight} initial={false} animate={{width:revealed?geometry.plotWidth:0}} transition={reduced?{duration:0}:{duration:NATIVE_CHART_MOTION.reveal,ease:[.2,0,0,1]}}/></clipPath></defs>
    <g transform={`translate(${geometry.left},${geometry.top})`}>
     {(props.grid??true)&&gridAxis.ticks.map(tick=>horizontal?<line key={tick.value} className="zero-native-chart__grid" x1={tick.position} x2={tick.position} y1={0} y2={geometry.plotHeight}/>:<line key={tick.value} className="zero-native-chart__grid" x1={0} x2={geometry.plotWidth} y1={tick.position} y2={tick.position}/>)}
     <g clipPath={`url(#${id})`}>
      {model.bands.map(band=>{const a=band.axis==='x'?geometry.mapX(band.from):geometry.mapY(band.from,band.axisId),b=band.axis==='x'?geometry.mapX(band.to):geometry.mapY(band.to,band.axisId),alongX=horizontal?band.axis==='y':band.axis==='x';return<rect key={band.id} className="zero-native-cartesian__band" x={alongX?Math.min(a,b):0} y={alongX?0:Math.min(a,b)} width={alongX?Math.abs(b-a):geometry.plotWidth} height={alongX?geometry.plotHeight:Math.abs(b-a)} style={{fill:band.color??nativeColor(0)}}><title>{band.label??band.id}</title></rect>;})}
      <SeriesPresence initial={false}>{geometry.series.map(shape=>{const series=model.visibleSeries.find(series=>series.id===shape.seriesId)!,paint=colors.get(series.id)!;return<motion.g key={series.id} style={{'--zero-native-cartesian-series':paint}as CSSProperties} initial={false} animate={{opacity:active?.seriesId&&active.seriesId!==series.id? .35:1}} exit={{opacity:0}} transition={transition}>
       {series.mark==='area'&&<motion.path className="zero-native-cartesian__area" d={shape.area} initial={false} animate={{d:shape.area}} transition={transition}/>}
       {series.mark==='area'&&shape.interval&&<motion.path className="zero-native-cartesian__interval" d={shape.interval} initial={false} animate={{d:shape.interval}} transition={transition}/>}
       {(series.mark==='line'||series.mark==='area')&&<motion.path className="zero-native-cartesian__line" d={shape.line} data-dashed={series.dashed||undefined} initial={false} animate={{d:shape.line}} transition={transition}/>}
       {shape.bars.map(bar=>{const cap={x1:bar.cap==='left'?bar.x:bar.cap==='right'?bar.x+bar.width:bar.x,x2:bar.cap==='left'?bar.x:bar.cap==='right'?bar.x+bar.width:bar.x+bar.width,y1:bar.cap==='top'?bar.y:bar.cap==='bottom'?bar.y+bar.height:bar.y,y2:bar.cap==='top'?bar.y:bar.cap==='bottom'?bar.y+bar.height:bar.y+bar.height};return<motion.g key={bar.datumId} data-datum={bar.datumId} data-series={series.id}><motion.rect className="zero-native-cartesian__bar" rx={3} x={bar.x} y={bar.y} width={bar.width} height={bar.height} initial={false} animate={{attrX:bar.x,attrY:bar.y,width:bar.width,height:bar.height}} transition={transition} data-active={active?.datumId===bar.datumId&&(!active.seriesId||active.seriesId===series.id)||undefined}/>{bar.height>0&&bar.width>0&&<motion.line className="zero-native-cartesian__cap" {...cap} initial={false} animate={cap} transition={transition}/>}</motion.g>;})}
       {shape.points.map(point=>{const show=series.mark==='scatter'||shape.points.length===1||active?.datumId===point.datumId;const radius=series.mark==='scatter'&&series.bubble?cartesianBubbleRadius(point.size,maxBubble,Math.min(3,geometry.maxBubbleRadius),geometry.maxBubbleRadius):series.mark==='scatter'?geometry.scatterRadius:3.5;return<g key={point.datumId} data-datum={point.datumId} data-series={series.id}>{show&&<motion.circle className="zero-native-cartesian__dot" cx={point.x} cy={point.y} r={radius} data-bubble={series.bubble||undefined} initial={false} animate={{cx:point.x,cy:point.y,r:radius}} transition={transition}/>} {point.low!==null&&point.high!==null&&(series.mark!=='area'||shape.intervalSingles.includes(point.datumId))&&(()=>{const a=geometry.mapY(point.low,series.axisId),b=geometry.mapY(point.high,series.axisId);return horizontal?<path className="zero-native-cartesian__error" d={`M${a},${point.y}H${b}M${a},${point.y-3}V${point.y+3}M${b},${point.y-3}V${point.y+3}`}/>:<path className="zero-native-cartesian__error" d={`M${point.x},${a}V${b}M${point.x-3},${a}H${point.x+3}M${point.x-3},${b}H${point.x+3}`}/>;})()}</g>;})}
      </motion.g>;})}</SeriesPresence>
      {model.references.map(reference=>{const coordinate=reference.axis==='x'?geometry.mapX(reference.value):geometry.mapY(reference.value,reference.axisId),vertical=horizontal?reference.axis==='y':reference.axis==='x';return<g key={reference.id} style={{color:reference.color??'var(--zero-chart-foreground,var(--foreground))'}}>{vertical?<line className="zero-native-cartesian__reference" x1={coordinate} x2={coordinate} y1={0} y2={geometry.plotHeight}/>:<line className="zero-native-cartesian__reference" x1={0} x2={geometry.plotWidth} y1={coordinate} y2={coordinate}/>} {reference.label&&<text className="zero-native-chart__axis" x={vertical?coordinate+4:4} y={vertical?12:coordinate-4}>{reference.label}</text>}</g>;})}
      {datum&&(horizontal?<line className="zero-native-cartesian__cursor" x1={0} x2={geometry.plotWidth} y1={independent} y2={independent}/>:<line className="zero-native-cartesian__cursor" x1={independent} x2={independent} y1={0} y2={geometry.plotHeight}/>)}
     </g>
     {geometry.axes.map(({axis,ticks})=><g key={axis.id}>{ticks.map(tick=><text key={tick.value} className="zero-native-chart__axis" x={horizontal?tick.position:axis.side==='right'?geometry.plotWidth+8:-8} y={horizontal?axis.side==='right'?-10:geometry.plotHeight+20:tick.position+4} textAnchor={horizontal?'middle':axis.side==='right'?'start':'end'}>{props.formatYTick?.(tick.value,axis)??(model.stack==='percent'?`${Math.round(tick.value*100)}%`:compact.format(tick.value))}</text>)}{axis.label&&<text className="zero-native-chart__axis" x={horizontal?geometry.plotWidth/2:axis.side==='right'?geometry.plotWidth+8:-8} y={horizontal?axis.side==='right'?-21:geometry.plotHeight+31:0} textAnchor={horizontal?'middle':axis.side==='right'?'start':'end'}>{axis.label}</text>}</g>)}
     {geometry.independentTicks.map(tick=><text key={tick.coordinate} className="zero-native-chart__axis" x={horizontal?-8:tick.position} y={horizontal?tick.position+4:geometry.plotHeight+20} textAnchor={horizontal?'end':tick.position<16?'start':tick.position>geometry.plotWidth-16?'end':'middle'}>{(props.formatX?.(model.xType==='category'?model.data.find(datum=>datum.coordinate===tick.coordinate)?.x??tick.label:tick.coordinate)??tick.label).slice(0,horizontal?18:48)}</text>)}
    </g>
   </svg>
   {empty&&<div className="zero-native-cartesian__empty">{props.emptyLabel??(!model.data.length?'No measurements yet':!model.visibleSeries.length?'Choose a visible series':'No measurements in this window')}</div>}
   <NativeChartInspector open={datum!==null&&!empty} content={inspector} point={point} onDismiss={()=>request(null)}/>
  </div>
  {props.brush&&model.xDomain[0]<model.xDomain[1]&&<div className="zero-native-cartesian__window"><label>From<input type="range" aria-label={`${label} window start`} min={model.xDomain[0]} max={model.xDomain[1]} step={model.xType==='category'?1:'any'} value={model.window[0]} onChange={event=>setWindow([Math.min(event.currentTarget.valueAsNumber,model.window[1]),model.window[1]])}/></label><label>To<input type="range" aria-label={`${label} window end`} min={model.xDomain[0]} max={model.xDomain[1]} step={model.xType==='category'?1:'any'} value={model.window[1]} onChange={event=>setWindow([model.window[0],Math.max(model.window[0],event.currentTarget.valueAsNumber)])}/></label><button type="button" onClick={()=>setWindow(model.xDomain)}>Reset</button></div>}
  <NativeChartDataTable label={label} columns={completeColumns} rows={completeRows}/>
 </NativeChartFrame>;
}
type WrapperProps=Omit<CartesianChartProps,'series'>&{readonly series:readonly CartesianSeries[]};
const markSeries=(series:readonly CartesianSeries[],mark:'line'|'area'|'bar'|'scatter',bubble=false)=>list(series,'series',16).map(value=>{const item=record(value,'series',['id','label','mark','axisId','stackId','color','curve','connectNulls','baseline','bubble','dashed']);if(item.mark!==undefined)choice(item.mark,'mark',['line','area','bar','scatter'],'line');return{...item,mark,...(bubble?{bubble:true}:{})} as unknown as CartesianSeries;});
function admitWrapperOptions(props:WrapperProps){choice(props.stack,'stack',['none','stacked','signed','percent'],'none');choice(props.layout,'layout',['vertical','horizontal'],'vertical');}
/** Multiseries XY line chart; genuine numeric/time X coordinates and gaps are retained. */
export function XYLineChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} series={markSeries(props.series,'line')}/>;}
/** Independent, stacked, signed or percent areas share the axis model; absolute low/high interval bands are available outside percent stacks. */
export function AreaChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} series={markSeries(props.series,'area')}/>;}
/** Side-by-side categories; each mark keeps its series and datum identity through updates. */
export function GroupedBarChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} stack="none" series={markSeries(props.series,'bar')}/>;}
/** Stacking defaults to positive/negative separation; percent and arithmetic stacking remain explicit alternatives. */
export function StackedBarChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} stack={props.stack??'signed'} series={markSeries(props.series,'bar')}/>;}
/** Horizontal categories support grouped or configured stacked/signed/percent bars. */
export function HorizontalBarChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} layout="horizontal" series={markSeries(props.series,'bar')}/>;}
/** Mixed marks share named axes, references, exact inspection and bounded controlled windows. */
export function ComposedChart(props:CartesianChartProps){return<CartesianChart {...props}/>;}
/** Genuine XY points; input order is detached and sorted by numeric X for stable keyboard traversal. */
export function ScatterChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} xAxis={props.xAxis===undefined?{type:'linear'}:props.xAxis} series={markSeries(props.series,'scatter')}/>;}
/** Bubble area, not radius, is proportional to a supplied nonnegative size; zero size is not drawn. */
export function BubbleChart(props:WrapperProps){admitWrapperOptions(props);return<CartesianChart {...props} xAxis={props.xAxis===undefined?{type:'linear'}:props.xAxis} series={markSeries(props.series,'scatter',true)}/>;}
