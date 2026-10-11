/** Exact largest-remainder allocation and physical-cell identity; synthetic parts only. */
import { expect, test } from "bun:test";
import { buildWaffleModel, reassignWaffleCells } from "./waffle-chart-model";
test("Waffle largest remainders allocate every cell and preserve deterministic ties",()=>{
 const model=buildWaffleModel([{id:"a",label:"A",value:1},{id:"b",label:"B",value:1},{id:"c",label:"C",value:1}],10,10);expect(model.counts).toEqual([34,33,33]);expect(model.total).toBe(3);
 for(let size=1;size<=64;size++){const m=buildWaffleModel([{id:"a",label:"A",value:size},{id:"b",label:"B",value:65-size}],size,1);expect(m.counts.reduce((a,b)=>a+b,0)).toBe(size);}
});
test("Waffle retargets minimal physical cells, stable IDs and slot partition",()=>{
 const data=[{id:"a",label:"A",value:1},{id:"b",label:"B",value:1}];const base=Array.from({length:10},(_,id)=>({id,categoryId:null,slot:id}));
 const first=reassignWaffleCells(base,data,[5,5]),next=reassignWaffleCells(first,data,[4,6]);expect(next.filter((c,i)=>c.categoryId!==first[i]!.categoryId).length).toBe(1);expect(new Set(next.map(x=>x.id)).size).toBe(10);expect(new Set(next.map(x=>x.slot)).size).toBe(10);
});
test("Waffle rejects malformed and unbounded inputs without mutating source",()=>{
 const data=[{id:"a",label:"A",value:3}];const model=buildWaffleModel(data);data[0]!.value=8;expect(model.data[0]!.value).toBe(3);expect(Object.isFrozen(model.counts)).toBe(true);
 for(const [rows,cols] of [[0,10],[1.5,10],[65,64],[Infinity,1]])expect(()=>buildWaffleModel([],rows,cols)).toThrow("Waffle");
 for(const value of [-1,NaN,Infinity,1e13])expect(()=>buildWaffleModel([{id:"a",label:"A",value}])).toThrow("Waffle");expect(()=>buildWaffleModel(data,10,10,7)).toThrow("Waffle");
 expect(buildWaffleModel([{id:"a",label:"A",value:0}]).counts).toEqual([0]);
});
