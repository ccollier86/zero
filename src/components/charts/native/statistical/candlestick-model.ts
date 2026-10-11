/** Financial OHLC presentation with ordered timestamps and coherent ranges. No market transport or investment decisions. */
import{STATISTICAL_LIMITS as L,statArray,statRecord,statNumber,statId,statText,statExtent}from"./statistical-admission";
export interface CandlestickDatum{id:string;label:string;time:number;open:number;high:number;low:number;close:number;volume?:number}
export interface CandlestickRow extends Readonly<CandlestickDatum>{readonly direction:"up"|"down"|"flat";readonly change:number}
export interface CandlestickModel{readonly rows:readonly CandlestickRow[];readonly domain:readonly[number,number];readonly timeDomain:readonly[number,number]|null;readonly maxVolume:number}
/** Input order must strictly increase in numeric time; high/low contain open/close and optional volume is nonnegative. */
export function buildCandlestickModel(input:readonly CandlestickDatum[]):CandlestickModel{
 let previous=-Infinity,maxVolume=0;const ids=new Set<string>();
 const rows=statArray(input,L.steps,"Candlesticks").map(value=>{const r=statRecord(value,"Candlestick",["id","label","time","open","high","low","close","volume"]),id=statId(r.id,ids,"Candlestick id"),label=statText(r.label,"Candlestick label"),time=statNumber(r.time,"Candlestick time",8.64e15);if(time<=previous)throw new TypeError("Candlestick timestamps must strictly increase");previous=time;
 const open=statNumber(r.open,"Candlestick open"),high=statNumber(r.high,"Candlestick high"),low=statNumber(r.low,"Candlestick low"),close=statNumber(r.close,"Candlestick close");if(low>high||open<low||open>high||close<low||close>high)throw new TypeError("Candlestick OHLC range is inconsistent");let volume:number|undefined;if(r.volume!==undefined){volume=statNumber(r.volume,"Candlestick volume");if(volume<0)throw new TypeError("Candlestick volume must be nonnegative");maxVolume=Math.max(maxVolume,volume);}
 return Object.freeze({id,label,time,open,high,low,close,...(volume===undefined?{}:{volume}),direction:close>open?"up"as const:close<open?"down"as const:"flat"as const,change:close-open});
 });
 return Object.freeze({rows:Object.freeze(rows),domain:Object.freeze(statExtent(rows.flatMap(row=>[row.low,row.high]))),timeDomain:rows.length?Object.freeze([rows[0]!.time,rows.at(-1)!.time])as readonly[number,number]:null,maxVolume});
}
