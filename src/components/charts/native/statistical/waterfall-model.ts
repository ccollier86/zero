/** Exact signed waterfall balances. Contributions change balance, subtotals snapshot it, totals explicitly reset it. */
import{STATISTICAL_LIMITS as L,statArray,statRecord,statNumber,statId,statText,statExtent}from"./statistical-admission";
export type WaterfallStep={id:string;label:string;kind:"contribution";value:number}|{id:string;label:string;kind:"subtotal"}|{id:string;label:string;kind:"total";value:number};
export interface WaterfallRow{readonly id:string;readonly label:string;readonly kind:WaterfallStep["kind"];readonly value:number;readonly start:number;readonly end:number;readonly balance:number;readonly previousBalance:number}
export interface WaterfallModel{readonly rows:readonly WaterfallRow[];readonly domain:readonly[number,number];readonly startingValue:number;readonly endingValue:number}
/** A total is an absolute balance reset (zero-to-value); a subtotal does not reset the running accumulation. */
export function buildWaterfallModel(input:readonly WaterfallStep[],startingValue=0):WaterfallModel{
 const starting=statNumber(startingValue,"Waterfall starting value"),ids=new Set<string>();let balance=starting;
 const rows=statArray(input,L.steps,"Waterfall steps").map(value=>{const r=statRecord(value,"Waterfall step",["id","label","kind","value"]),id=statId(r.id,ids,"Waterfall id"),label=statText(r.label,"Waterfall label"),kind=r.kind;if(kind!=="contribution"&&kind!=="subtotal"&&kind!=="total")throw new TypeError("Waterfall kind must be contribution/subtotal/total");const previousBalance=balance;let start:number,end:number,amount:number;
 if(kind==="subtotal"){if(r.value!==undefined)throw new TypeError("A subtotal derives its value from the running balance");start=0;end=balance;amount=balance;}
 else{amount=statNumber(r.value,"Waterfall value");start=kind==="total"?0:balance;end=kind==="total"?amount:balance+amount;balance=statNumber(end,"Waterfall running balance");}
 return Object.freeze({id,label,kind,value:amount,start,end,balance,previousBalance});});
 return Object.freeze({rows:Object.freeze(rows),domain:Object.freeze(statExtent([starting,...rows.flatMap(row=>[row.start,row.end])],true)),startingValue:starting,endingValue:balance});
}
