/** Bounded descriptor-based Cartesian admission. Detached own records/arrays only; no getters, coercion or resource paints. */
import{ownRecord,ownArray,chartId,chartText,numberValue,chartColor}from'../shared/admission';
export const CARTESIAN_NATIVE_LIMITS=Object.freeze({points:4096,series:16,cells:65536,axes:2,references:64,magnitude:1e12,text:4096});
export function record(value:unknown,label:string,keys:readonly string[]):Record<string,unknown>{
 return ownRecord(value,label,keys);
}
export function list(value:unknown,label:string,max:number):unknown[]{
 return ownArray(value,label,max);
}
export function text(value:unknown,label:string,id=false):string{return id?chartId(value,label):chartText(value,label,true);}
export function number(value:unknown,label:string,bound:number=CARTESIAN_NATIVE_LIMITS.magnitude):number{return numberValue(value,label,{min:-bound,max:bound});}
export function flag(value:unknown,label:string,fallback=false):boolean{if(value===undefined)return fallback;if(typeof value!=='boolean')throw new TypeError(`${label} must be boolean`);return value;}
export function choice<T extends string>(value:unknown,label:string,choices:readonly T[],fallback:T):T{if(value===undefined)return fallback;if(typeof value!=='string'||!choices.includes(value as T))throw new TypeError(`${label} is unsupported`);return value as T;}
export function domain(value:unknown,label:string,bound:number=CARTESIAN_NATIVE_LIMITS.magnitude):[number,number]{const values=list(value,label,2);if(values.length!==2)throw new TypeError(`${label} needs two bounds`);const low=number(values[0],label,bound),high=number(values[1],label,bound);if(low>high)throw new TypeError(`${label} must be ordered`);return[low,high];}
export function color(value:unknown,label:string):string{return chartColor(value,label);}
export function unique(value:unknown,label:string,ids:Set<string>):string{const id=text(value,label,true);if(ids.has(id))throw new TypeError(`${label} must be unique`);ids.add(id);return id;}
