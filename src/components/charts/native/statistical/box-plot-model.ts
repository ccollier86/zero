/** Exact box plots from observed samples or explicitly supplied summaries. Pure statistical data, no invented observations. */
import{STATISTICAL_LIMITS as L,statArray,statRecord,statNumber,statInteger,statId,statText,statExtent}from"./statistical-admission";
export interface BoxPlotSummary{n:number;min:number|null;q1:number|null;median:number|null;q3:number|null;max:number|null;whiskerLow:number|null;whiskerHigh:number|null;outliers:readonly number[]}
export interface BoxPlotSeries{id:string;label:string;values?:readonly number[];summary?:BoxPlotSummary}
export type BoxPlotWhiskers="tukey"|"min-max";
export interface BoxPlotRow extends Readonly<BoxPlotSummary>{readonly id:string;readonly label:string;readonly source:"observations"|"summary";readonly observations:readonly number[]|null}
export interface BoxPlotModel{readonly rows:readonly BoxPlotRow[];readonly domain:readonly[number,number];readonly whiskers:BoxPlotWhiskers}
/** Type-7 sample quantiles, interpolated only between actual sorted observations. Empty input has no quantile. */
export function boxPlotQuantile(sorted:readonly number[],probability:number):number|null{
 const values=statArray(sorted,L.observations,"Quantile observations").map(value=>statNumber(value,"Quantile value")),p=statNumber(probability,"Quantile probability");if(p<0||p>1)throw new RangeError("Quantile probability must be in [0,1]");for(let i=1;i<values.length;i++)if(values[i]!<values[i-1]!)throw new TypeError("Quantile observations must be sorted");if(!values.length)return null;const at=(values.length-1)*p,index=Math.floor(at);return values[index]!+(values[Math.min(index+1,values.length-1)]!-values[index]!)*(at-index);
}
const EMPTY=Object.freeze({n:0,min:null,q1:null,median:null,q3:null,max:null,whiskerLow:null,whiskerHigh:null,outliers:Object.freeze([])}) satisfies BoxPlotSummary;
/** Admit supplied summaries without inferring additional samples; bounds/order and stated extrema must agree. */
function admitSummary(input:unknown):BoxPlotSummary{
 const r=statRecord(input,"Box plot summary",["n","min","q1","median","q3","max","whiskerLow","whiskerHigh","outliers"]),n=statInteger(r.n,"Box plot count",0,L.observations),outliers=statArray(r.outliers,L.observations,"Box plot outliers").map(value=>statNumber(value,"Box plot outlier"));
 const keys=["min","whiskerLow","q1","median","q3","whiskerHigh","max"]as const;
 if(!n){if(outliers.length||keys.some(key=>r[key]!==null))throw new TypeError("Empty box plot summaries require null statistics and no outliers");return EMPTY;}
 const values=keys.map(key=>statNumber(r[key],"Box plot "+key));for(let i=1;i<values.length;i++)if(values[i]!<values[i-1]!)throw new TypeError("Box plot summary statistics must be ordered");
 const[min,whiskerLow,q1,median,q3,whiskerHigh,max]=values as[number,number,number,number,number,number,number];
 if(outliers.length>n||outliers.some(value=>value<min||value>max||(value>=whiskerLow&&value<=whiskerHigh)))throw new TypeError("Box plot outliers must lie beyond whiskers within stated extrema");
 if(Math.min(whiskerLow,...outliers)!==min||Math.max(whiskerHigh,...outliers)!==max)throw new TypeError("Box plot extrema must agree with whiskers and outliers");
 if(n===1&&values.some(value=>value!==min))throw new TypeError("A one-observation box plot has identical statistics");
 return Object.freeze({n,min,q1,median,q3,max,whiskerLow,whiskerHigh,outliers:Object.freeze(outliers)});
}
/** Quartiles use type-7; Tukey whiskers stop at actual observations inside 1.5 IQR, never at fabricated fence values. */
export function buildBoxPlotModel(input:readonly BoxPlotSeries[],whiskers:BoxPlotWhiskers="tukey"):BoxPlotModel{
 if(whiskers!=="tukey"&&whiskers!=="min-max")throw new TypeError("Unknown box plot whisker policy");let count=0;const ids=new Set<string>();
 const rows=statArray(input,L.series,"Box plot series").map(value=>{const r=statRecord(value,"Box plot series",["id","label","values","summary"]),id=statId(r.id,ids,"Box plot id"),label=statText(r.label,"Box plot label");if((r.values===undefined)===(r.summary===undefined))throw new TypeError("Box plot requires exactly one of values or summary");
  if(r.summary!==undefined){const summary=admitSummary(r.summary);count+=summary.n;if(count>L.observations)throw new RangeError("Box plot population exceeds 16384");return Object.freeze({...summary,id,label,source:"summary"as const,observations:null});}
  const observations=statArray(r.values,L.observations,"Box plot observations").map(v=>statNumber(v,"Box plot value")).sort((a,b)=>a-b);count+=observations.length;if(count>L.observations)throw new RangeError("Box plot population exceeds 16384");
  if(!observations.length)return Object.freeze({...EMPTY,id,label,source:"observations"as const,observations:Object.freeze(observations)});
  const min=observations[0]!,max=observations.at(-1)!,q1=boxPlotQuantile(observations,.25)!,median=boxPlotQuantile(observations,.5)!,q3=boxPlotQuantile(observations,.75)!,iqr=q3-q1,low=q1-1.5*iqr,high=q3+1.5*iqr,inside=whiskers==="min-max"?observations:observations.filter(v=>v>=low&&v<=high),whiskerLow=inside[0]!,whiskerHigh=inside.at(-1)!,outliers=observations.filter(v=>v<whiskerLow||v>whiskerHigh);
  return Object.freeze({id,label,source:"observations"as const,observations:Object.freeze(observations),n:observations.length,min,q1,median,q3,max,whiskerLow,whiskerHigh,outliers:Object.freeze(outliers)});
 });
 return Object.freeze({rows:Object.freeze(rows),domain:Object.freeze(statExtent(rows.flatMap(row=>row.n?[row.min!,row.max!]:[]))),whiskers});
}
