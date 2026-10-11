'use client';
/** Native statistical interaction atoms. Shared Zero environment/selection own lifecycle; no data transport or authority. */
import{useEffect,useRef,useState,type KeyboardEvent,type PointerEvent,type ReactNode,type RefObject,type CSSProperties}from"react";
import{motion}from"motion/react";
import{useNativeChartEnvironment,useNativeChartSelection,NATIVE_CHART_MOTION}from"../shared/native-chart";
import{formatNativeChartNumber}from"../shared/native-format";
import{statNumber}from"./statistical-admission";
import{statisticalPlotBounds,statisticalTicks,statisticalY,type StatisticalPlotBounds,type StatisticalRect}from"./statistical-geometry";
export interface StatisticalChartProps{label:string;title?:string;subtitle?:string;className?:string;height?:number;motion?:boolean;activeId?:string|null;defaultActiveId?:string|null;onActiveChange?:(id:string|null)=>void;formatValue?:(value:number)=>string;}
/** Read-only chart controls are presentation choices, separate from admitted numeric models. */
export function useStatisticalPlot(ids:readonly string[],props:StatisticalChartProps,stride=1){
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(640),environment=useNativeChartEnvironment(ref as RefObject<HTMLElement|null>,{motion:props.motion}),[activeId,select]=useNativeChartSelection(ids,props.activeId,props.defaultActiveId,props.onActiveChange);
 const height=props.height===undefined?300:statNumber(props.height,"Chart height",4096),bounds=statisticalPlotBounds(width,height);
 useEffect(()=>{const node=ref.current;if(!node)return;const measure=()=>setWidth(Math.min(16384,Math.max(0,node.clientWidth)));measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[]);
 const keydown=(event:KeyboardEvent<HTMLDivElement>)=>{const index=activeId===null?-1:ids.indexOf(activeId);let next:number|undefined;if(event.key==="Home")next=0;else if(event.key==="End")next=ids.length-1;else if(event.key==="ArrowRight")next=index+1;else if(event.key==="ArrowLeft")next=index<0?0:index-1;else if(event.key==="ArrowDown")next=index<0?0:index+stride;else if(event.key==="ArrowUp")next=index<0?0:index-stride;else if(event.key==="Escape"){event.preventDefault();select(null);return;}if(next!==undefined){event.preventDefault();select(ids[Math.max(0,Math.min(ids.length-1,next))]??null);}};
 const activate=(id:string)=>({onPointerEnter:(event:PointerEvent<SVGGElement>)=>{if(event.pointerType==="mouse")select(id);},onPointerDown:(event:PointerEvent<SVGGElement>)=>{if(event.pointerType!=="mouse"){event.preventDefault();select(activeId===id?null:id);}}});
 const stageProps={ref,tabIndex:0,role:"group",onKeyDown:keydown,onFocus:()=>{if(ref.current?.matches(":focus-visible")&&activeId===null)select(ids[0]??null);},onBlur:()=>select(null),onPointerLeave:(event:PointerEvent<HTMLDivElement>)=>{if(event.pointerType==="mouse"&&ref.current?.ownerDocument.activeElement!==ref.current)select(null);},"aria-label":props.label+". Arrow keys inspect marks; Home and End jump; Escape clears."};
 return{bounds,environment,activeId,select,activate,stageProps,format:props.formatValue??formatNativeChartNumber,transition:environment.reduced?{duration:0}:NATIVE_CHART_MOTION.morph};
}
/** Reveal/lifecycle wrapper for native statistical marks; morph springs are canceled by instant reduced/hidden transitions. */
export function StatisticalReveal({ready,reduced,children}:{ready:boolean;reduced:boolean;children:ReactNode}){return<motion.g initial={false} animate={{opacity:ready||reduced?1:0,y:ready||reduced?0:8}} transition={{duration:reduced?0:NATIVE_CHART_MOTION.reveal}}>{children}</motion.g>;}
/** Quiet numeric grid shared by histogram, box, waterfall and OHLC charts. */
export function StatisticalGrid({bounds,domain,format}:{bounds:StatisticalPlotBounds;domain:readonly[number,number];format:(value:number)=>string}){return<g aria-hidden="true" className="zero-native-statistical-grid">{statisticalTicks(domain).map(value=>{const y=statisticalY(value,domain,bounds);return<g key={value}><line x1={bounds.left}x2={bounds.width-bounds.right}y1={y}y2={y}/><text x={bounds.left-7}y={y+4}textAnchor="end">{format(value)}</text></g>;})}</g>;}
/** Animated owned SVG rectangle, never an underlying chart-library mark. */
export function StatisticalBar({rect,color,active,transition}:{rect:StatisticalRect;color:string;active:boolean;transition:ReturnType<typeof useStatisticalPlot>["transition"]}){return<motion.rect className="zero-native-statistical-bar" data-active={active||undefined}initial={false}animate={{attrX:rect.x,attrY:rect.y,width:rect.width,height:rect.height}}transition={transition}rx={2}style={{"--statistical-color":color}as CSSProperties}/>;}
export function StatisticalInspectorRows({title,value,rows}:{title:string;value?:ReactNode;rows:readonly(readonly[string,ReactNode])[]}){return<><div className="zero-native-statistical-tip-title">{title}</div>{value!==undefined&&<div className="zero-native-statistical-tip-value">{value}</div>}<div className="zero-native-statistical-tip-rows">{rows.map(([label,content])=><div key={label}><span>{label}</span><b>{content}</b></div>)}</div></>;}
