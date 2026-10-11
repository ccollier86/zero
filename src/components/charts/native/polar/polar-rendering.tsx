'use client';
/** Renderer-only motion, selection, and coordinate helpers shared by the four polar organisms. */
import * as React from 'react';
import { animate,motion,useMotionValue,useTransform } from 'motion/react';
import { NATIVE_CHART_MOTION,useNativeChartEnvironment } from '../shared/native-chart';
import { formatNativeChartNumber } from '../shared/native-format';
import { admitPolarIds,POLAR_CHART_LIMITS } from './polar-model';
import { polarPoint,polarSectorPath } from './polar-layout';
import type { PolarPoint,PolarSector } from './polar-types';

export function usePolarFrame(forwardedRef:React.Ref<HTMLElement>|undefined,motionEnabled?:boolean){const ref=React.useRef<HTMLElement>(null);React.useImperativeHandle(forwardedRef,()=>ref.current!,[]);const environment=useNativeChartEnvironment(ref,{motion:motionEnabled});return{ref,environment};}
export function usePolarHidden(ids:readonly string[],controlled:readonly string[]|undefined,initial:readonly string[]|undefined,onChange:((ids:string[])=>void)|undefined){
 const[local,setLocal]=React.useState<readonly string[]>(()=>admitPolarIds(initial??[]));const admitted=admitPolarIds(controlled??local),accepted=admitted.filter(id=>ids.includes(id));const signature=JSON.stringify(ids);
 React.useEffect(()=>{if(controlled===undefined)setLocal(previous=>{const next=previous.filter(id=>ids.includes(id));return next.length===previous.length?previous:next;});},[controlled,signature]);
 return[accepted,(id:string)=>{if(!ids.includes(id))return;const next=accepted.includes(id)?accepted.filter(item=>item!==id):[...accepted,id];if(controlled===undefined)setLocal(next);onChange?.(next);}]as const;
}
/** Inspection points remain in CSS pixels even when the SVG viewBox is responsively scaled. */
export function usePolarPoint(svg:React.RefObject<SVGSVGElement|null>,width:number,height:number,point:PolarPoint|undefined):readonly[number,number]{
 const[size,setSize]=React.useState<readonly[number,number]>([width,height]);React.useEffect(()=>{const element=svg.current;if(!element)return;const observer=new ResizeObserver(()=>{const bounds=element.getBoundingClientRect();element.style.setProperty('--zero-native-polar-font-scale',String(bounds.width>0?width/bounds.width:1));setSize(previous=>previous[0]===bounds.width&&previous[1]===bounds.height?previous:[bounds.width,bounds.height]);});observer.observe(element);return()=>observer.disconnect();},[svg,width,height]);return point?[point.x/width*size[0],point.y/height*size[1]]:[0,0];
}
export function sectorAnchor(sector:PolarSector,cx:number,cy:number):PolarPoint{return polarPoint(cx,cy,(sector.inner+sector.outer)/2,(sector.start+sector.end)/2);}
export function usePolarPreview(ids:readonly string[],activeId:string|null,request:(id:string|null)=>void){const[preview,setPreview]=React.useState<string|null>(null);const signature=JSON.stringify(ids);React.useEffect(()=>{if(preview!==null&&!ids.includes(preview))setPreview(null);},[signature,preview]);const acceptedPreview=preview!==null&&ids.includes(preview)?preview:null;
 const inspected=acceptedPreview??activeId;
 const keydown=(event:React.KeyboardEvent)=>{if(!ids.length)return;const index=ids.indexOf(inspected??ids[0]!);let target:string|null|undefined;if(event.key==='ArrowRight'||event.key==='ArrowDown')target=ids[(index+1)%ids.length];else if(event.key==='ArrowLeft'||event.key==='ArrowUp')target=ids[(index-1+ids.length)%ids.length];else if(event.key==='Home')target=ids[0];else if(event.key==='End')target=ids[ids.length-1];else if(event.key==='Enter'||event.key===' '){const target=inspected??ids[0]!;request(target===activeId?null:target);event.preventDefault();return;}else if(event.key==='Escape'){if(acceptedPreview!==null||activeId!==null){setPreview(null);request(null);event.preventDefault();event.stopPropagation();}return;}if(target!==undefined){setPreview(target);event.preventDefault();}};
 return{preview:acceptedPreview,setPreview,inspected,keyDown:keydown,onFocus:()=>setPreview(previous=>previous??activeId??ids[0]??null),onBlur:(event:React.FocusEvent)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setPreview(null);}};
}
/** A persistent live description connects visual inspection to the plot's keyboard focus owner. */
export function PolarReadout({id,children}:{id:string;children:React.ReactNode}){
 return <div id={id} className="zero-native-chart__sr" aria-live="polite" aria-atomic="true" data-polar-readout>{children}</div>;
}
/** Each numeric sector retains current physical state on retarget; stopping controls owns teardown/suspension. */
export function AnimatedPolarSector({sector,cx,cy,reduced,revealed,...props}:{sector:PolarSector;cx:number;cy:number;reduced:boolean;revealed:boolean}&Omit<React.ComponentProps<typeof motion.path>,'d'>){
 const start=useMotionValue(sector.start),end=useMotionValue(sector.end),inner=useMotionValue(sector.inner),outer=useMotionValue(sector.outer);const started=React.useRef(false);
 // The shared morph is intentionally underdamped. Clip only transient decorative radii, never raw measurements.
 const d=useTransform([start,end,inner,outer],([s,e,i,o])=>{const visibleOuter=Math.max(0,Math.min(POLAR_CHART_LIMITS.dimensions,o as number)),visibleInner=Math.max(0,Math.min(visibleOuter,i as number));return polarSectorPath(cx,cy,visibleInner,visibleOuter,s as number,e as number);});
 React.useEffect(()=>{const values=[start,end,inner,outer],targets=[sector.start,sector.end,sector.inner,sector.outer];if(reduced){values.forEach((value,index)=>value.set(targets[index]!));started.current=true;return;}if(!revealed)return;if(!started.current){start.set(sector.start);end.set(sector.start);inner.set(sector.inner);outer.set(sector.outer);started.current=true;}const controls=values.map((value,index)=>animate(value,targets[index]!,NATIVE_CHART_MOTION.morph));return()=>controls.forEach(control=>control.stop());},[sector.start,sector.end,sector.inner,sector.outer,reduced,revealed,start,end,inner,outer]);
 return <motion.path {...props} d={d} />;
}
export function PolarEmpty({message='No data'}:{message?:string}){return<div className="zero-native-polar__empty">{message}</div>;}
export const defaultPolarFormat=formatNativeChartNumber;
export function polarPercent(value:number):string{return new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(value);}
