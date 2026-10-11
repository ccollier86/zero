/** Honest bounded histogram binning. Own observations in, exact memberships/counts out; no synthetic samples. */
import{STATISTICAL_LIMITS as L,statArray,statRecord,statNumber,statInteger,statId,statDomain,statExtent}from"./statistical-admission";
export interface HistogramObservation{id:string;value:number}
export interface HistogramBinning{count?:number;edges?:readonly number[];domain?:readonly[number,number];closed?:"left"|"right"}
export type HistogramMeasure="count"|"proportion"|"density";
export interface HistogramBin{readonly id:string;readonly start:number;readonly end:number;readonly count:number;readonly value:number;readonly observationIds:readonly string[];readonly includesStart:boolean;readonly includesEnd:boolean}
export interface HistogramModel{readonly observations:readonly Readonly<HistogramObservation>[];readonly bins:readonly HistogramBin[];readonly domain:readonly[number,number];readonly measure:HistogramMeasure;readonly closed:"left"|"right";readonly underflow:number;readonly overflow:number;readonly total:number;readonly included:number}
/** Equal-width or explicit ordered bins: left-closed includes the final endpoint; right-closed includes the initial endpoint. */
export function buildHistogramModel(input:readonly HistogramObservation[],binning:HistogramBinning={},measure:HistogramMeasure="count"):HistogramModel{
 if(!["count","proportion","density"].includes(measure))throw new TypeError("Unknown histogram measure");
 const ids=new Set<string>(),observations=statArray(input,L.observations,"Histogram observations").map(value=>{const r=statRecord(value,"Histogram observation",["id","value"]);return Object.freeze({id:statId(r.id,ids,"Observation id"),value:statNumber(r.value,"Observation value")});});
 const options=statRecord(binning,"Histogram binning",["count","edges","domain","closed"]),closed=options.closed??"left";
 if(closed!=="left"&&closed!=="right")throw new TypeError("Histogram closed must be left or right");
 let edges:number[];
 if(options.edges!==undefined){if(options.count!==undefined||options.domain!==undefined)throw new TypeError("Explicit edges cannot be combined with count/domain");edges=statArray(options.edges,L.bins+1,"Histogram edges").map(v=>statNumber(v,"Histogram edge"));if(edges.length<2)throw new RangeError("Histogram needs at least two edges");}
 else{const domain=options.domain===undefined?statExtent(observations.map(o=>o.value)):statDomain(options.domain,"Histogram domain"),count=options.count===undefined?Math.min(32,Math.max(1,Math.ceil(Math.sqrt(observations.length)))):statInteger(options.count,"Histogram bin count",1,L.bins);edges=Array.from({length:count+1},(_,i)=>i===count?domain[1]:domain[0]+(domain[1]-domain[0])*i/count);}
 for(let i=1;i<edges.length;i++)if(!(edges[i]!>edges[i-1]!))throw new RangeError("Histogram edges must strictly increase at representable precision");
 const domain=Object.freeze([edges[0]!,edges.at(-1)!])as readonly[number,number],members=Array.from({length:edges.length-1},()=>[]as string[]);let underflow=0,overflow=0;
 for(const observation of observations){const v=observation.value;if(v<domain[0]){underflow++;continue;}if(v>domain[1]){overflow++;continue;}let lo=0,hi=edges.length-1;while(lo+1<hi){const mid=Math.floor((lo+hi)/2);if(v>edges[mid]!||(closed==="left"&&v===edges[mid]!))lo=mid;else hi=mid;}members[lo]!.push(observation.id);}
 const bins=members.map((observationIds,i)=>{const start=edges[i]!,end=edges[i+1]!,count=observationIds.length,value=measure==="count"?count:measure==="proportion"?(observations.length?count/observations.length:0):(observations.length?count/observations.length/(end-start):0);if(!Number.isFinite(value)||value>L.magnitude)throw new RangeError("Histogram density exceeds the 1e12 presentation envelope");return Object.freeze({id:JSON.stringify([start,end,closed]),start,end,count,value,observationIds:Object.freeze(observationIds),includesStart:closed==="left"||i===0,includesEnd:closed==="right"||i===members.length-1});});
 return Object.freeze({observations:Object.freeze(observations),bins:Object.freeze(bins),domain,measure,closed,underflow,overflow,total:observations.length,included:observations.length-underflow-overflow});
}
