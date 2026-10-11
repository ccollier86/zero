/** Native statistical own-data admission. Pure presentation validation, never authorization or transport. */
import{ownRecord,ownArray,numberValue,chartText,chartId}from"../shared/admission";
export const STATISTICAL_LIMITS=Object.freeze({magnitude:1e12,observations:16384,bins:128,series:64,cells:4096,steps:1024});
/** Detach plain descriptor values; accessors and symbolic fields are rejected without invocation. */
export function statRecord(value:unknown,label:string,keys:readonly string[]):Record<string,unknown>{
 return ownRecord(value,label,keys);
}
/** Detach bounded dense arrays without using caller iterators or inherited methods. */
export function statArray(value:unknown,max:number,label:string):unknown[]{
 return ownArray(value,label,max);
}
/** Admit finite numbers without coercion. */
export function statNumber(value:unknown,label:string,max:number=STATISTICAL_LIMITS.magnitude):number{return numberValue(value,label,{min:-max,max});}
export function statInteger(value:unknown,label:string,low:number,high:number):number{return numberValue(value,label,{min:low,max:high,integer:true});}
export function statText(value:unknown,label:string,max=4096):string{const text=chartText(value,label,true);if(text.length>max)throw new RangeError(label+" exceeds its text bound");return text;}
export function statId(value:unknown,ids:Set<string>,label:string):string{const id=chartId(value,label);if(ids.has(id))throw new TypeError(label+" must be unique");ids.add(id);return id;}
export function statDomain(value:unknown,label:string):readonly[number,number]{const pair=statArray(value,2,label);if(pair.length!==2)throw new TypeError(label+" requires two endpoints");const lo=statNumber(pair[0],label),hi=statNumber(pair[1],label);if(!(lo<hi))throw new RangeError(label+" must increase");return Object.freeze([lo,hi])as readonly[number,number];}
/** A bounded auto-domain includes zero only when requested; constant data receives representable padding. */
export function statExtent(values:readonly number[],zero=false):readonly[number,number]{let lo=zero?0:Infinity,hi=zero?0:-Infinity;for(const n of values){lo=Math.min(lo,n);hi=Math.max(hi,n);}if(lo===Infinity)return[0,1];if(lo===hi){const padding=Math.max(Math.abs(lo)*.05,Number.MIN_VALUE)||(lo===0?1:0);if(lo===0)return[-1,1];lo=Math.max(-STATISTICAL_LIMITS.magnitude,lo-padding);hi=Math.min(STATISTICAL_LIMITS.magnitude,hi+padding);}return[lo,hi];}
/** Normalize a value without overflow-prone domain addition; geometry alone may clamp. */
export function statFraction(value:number,input:readonly[number,number]):number{const domain=statArray(input,2,"Fraction domain");if(domain.length!==2)throw new TypeError("Fraction domain requires two endpoints");const low=statNumber(domain[0],"Fraction domain low",8.64e15),high=statNumber(domain[1],"Fraction domain high",8.64e15),measurement=statNumber(value,"Fraction value",8.64e15);if(low>high)throw new RangeError("Fraction domain must be ordered");const span=high-low;return span>0?Math.min(1,Math.max(0,(measurement-low)/span)):.5;}
