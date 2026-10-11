'use client';
/** Owns ID-based controlled/uncontrolled inspection intent. No model math, browser clocks or transport. */
import { useLayoutEffect, useRef, useState, type SetStateAction } from 'react';

/** Preserve accepted stable IDs across reorder; controlled requests never mutate rejected selection. */
export function useCartesianSelection<T>(data: readonly T[], idOf: (datum:T,index:number)=>string, controlled: string|null|undefined, initial: string|null|undefined, onChange?: (index:number|null,datum:T|null)=>void) {
 const [own,setOwn]=useState<string|null>(initial??null);
 const state=useRef({data,idOf,controlled,own,onChange});
 useLayoutEffect(()=>{state.current={data,idOf,controlled,own,onChange};});
 const selected=controlled===undefined?own:controlled;
 const at=selected===null?-1:data.findIndex((datum,index)=>idOf(datum,index)===selected);
 const index=at<0?null:at;
 const setIndex=(request:SetStateAction<number|null>)=>{
  const current=state.current,selected=current.controlled===undefined?current.own:current.controlled;
  const found=selected===null?-1:current.data.findIndex((datum,index)=>current.idOf(datum,index)===selected);
  const previous=found<0?null:found;
  const candidate=typeof request==='function'?request(previous):request;
  const next=candidate!==null && Number.isInteger(candidate) && candidate>=0 && candidate<current.data.length?candidate:null;
  const id=next===null?null:current.idOf(current.data[next]!,next);
  if(current.controlled===undefined){current.own=id;setOwn(id);}
  if(next!==previous) current.onChange?.(next,next===null?null:current.data[next]!);
 };
 return [index,setIndex] as const;
}
