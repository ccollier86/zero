/** Pure admission and faithful rounded-sector math; synthetic parts only. */
import { expect, test } from "bun:test";
import { buildDonutModel, computeDonutLayout, donutSectorPath, validateDonutGeometry } from "./donut-chart-model";
test("Donut preserves exact total, input order and collision-free Other identities", () => {
 const data=[{id:"@zero/other",label:"Primary",value:90},{id:"b",label:"Beta",value:5},{id:"c",label:"Gamma",value:5}];
 const model=buildDonutModel(data,.1,6); expect(model.total).toBe(100);expect(model.slices.length).toBe(2);expect(model.otherId).not.toBe(data[0]!.id);expect(model.slices[1]!.members!.map(x=>x.id)).toEqual(["b","c"]);
 data[0]!.value=1;expect(model.data[0]!.value).toBe(90);expect(Object.isFrozen(model.data)).toBe(true);
});
test("Donut only groups multiple small parts and visible turns sum to one", () => {
 const model=buildDonutModel([{id:"a",label:"A",value:99},{id:"b",label:"B",value:1}],.04);expect(model.slices.length).toBe(2);
 const arcs=computeDonutLayout(model.slices,new Set(["a"]));expect(arcs.get("a")).toEqual({start:0,end:0});expect(arcs.get("b")).toEqual({start:0,end:1});
 expect([...computeDonutLayout(model.slices,new Set(["a","b"])).values()]).toEqual([{start:0,end:0},{start:0,end:0}]);
});
test("Donut rejects inherited, accessor, duplicate, negative, oversized and overflowing input",()=>{
 const valid={id:"a",label:"A",value:1};
 for(const data of [[{...valid,value:NaN}],[{...valid,value:-1}],[valid,valid],[{...valid,value:1e13}],[Object.create(valid)],[{...valid,get value(){throw Error("accessor ran");}}]]) expect(()=>buildDonutModel(data)).toThrow("Donut");
 expect(()=>buildDonutModel([{...valid,value:1e12},{id:"b",label:"B",value:1}])).toThrow("Donut");expect(()=>buildDonutModel([],NaN)).toThrow("Donut");expect(()=>validateDonutGeometry(20,24)).toThrow("Donut");
});
test("rounded annular geometry closes a complete ring and fades hairline sectors without nonfinite paths",()=>{
 for(const end of [0,1e-8,.01,.2,.5,.999,1]) {const path=donutSectorPath(104,97,73,0,end,3,4);expect(path).not.toMatch(/NaN|Infinity/);if(end===0)expect(path).toBe("");if(end===1)expect(path.match(/A/g)?.length).toBe(4);}
});
