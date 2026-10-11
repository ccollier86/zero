/** Pure/SSR qualification for synthetic distribution and hierarchy data only. */
import { describe,expect,test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildStreamgraphModel,resampleStreamgraph,computeStreamgraphBaseline,stackStreamgraphOrder } from "./streamgraph-model";
import { buildSlopeModel,computeSlopeLayout } from "../slope-chart/slope-chart-model";
import { buildRidgelineModel,inspectRidgeline,ridgelineDensity,ridgelineStats,ridgelineQuantile,computeRidgelineTicks } from "../ridgeline/ridgeline-model";
import { buildTreemapModel,computeTreemapLayout,squarifyTreemap,normalizeTreemapFocus } from "../treemap/treemap-model";
import { Streamgraph } from "./streamgraph";
import { SlopeChart } from "../slope-chart/slope-chart";
import { Ridgeline } from "../ridgeline/ridgeline";
import { Treemap } from "../treemap/treemap";
const series=[{id:"a",label:"Alpha"},{id:"b",label:"Beta"}];
const stream=[{id:"week1",label:"Week one",values:{a:2,b:5}},{id:"week2",label:"Week two",values:{a:6,b:1}}];
const slope=[{id:"a",label:"Alpha",start:-2,end:5},{id:"b",label:"Beta",start:4,end:1}];
const ridges=[{id:"a",label:"Alpha",values:[1,2,3,4]},{id:"b",label:"Beta",values:[-2,-1,0,1]}];
const tree={id:"root",label:"All",children:[{id:"a",label:"Alpha",children:[{id:"a1",label:"One",value:60,color:2},{id:"a2",label:"Two",value:40,color:4}]},{id:"b",label:"Beta",value:100,color:3}]};
describe("Arc distribution admission and genuine math",()=>{
 test("stream values detach, own-missing counts are zero and delimiter identities stay distinct",()=>{
  const model=buildStreamgraphModel(stream,series);stream[0]!.values.a=3;expect(model.data[0]!.values.a).toBe(2);stream[0]!.values.a=2;
  expect(buildStreamgraphModel([{id:"a,b",label:"Delimiter",values:{a:1}}],series).data[0]!.values.b).toBe(0);
  expect(Object.isFrozen(model.data)).toBe(true);
 });
 test("stream rejects negatives, nonfinite, unknown series, duplicates, getters, sparse and excessive cells",()=>{
  for(const value of [-1,NaN,Infinity,1e13,"2"])expect(()=>buildStreamgraphModel([{id:"x",label:"X",values:{a:value as number}}],series)).toThrow();
  expect(()=>buildStreamgraphModel([{id:"x",label:"X",values:{ghost:3}}],series)).toThrow();
  expect(()=>buildStreamgraphModel(stream,[series[0]!,series[0]!])).toThrow();
  let reads=0;const values=Object.defineProperty({},"a",{get(){reads++;return 4;}});expect(()=>buildStreamgraphModel([{id:"x",label:"X",values}],series)).toThrow();expect(reads).toBe(0);
  expect(()=>buildStreamgraphModel(new Array(2),series)).toThrow();
  const custom=[...stream];let methods=0;Object.setPrototypeOf(custom,Object.defineProperty(Object.create(Array.prototype),"map",{get(){methods++;throw new Error("Inherited map called");}}));expect(buildStreamgraphModel(custom,series).data.length).toBe(2);expect(methods).toBe(0);
  for(const color of ['url(https://example.invalid/tracking.svg)','red;fill:blue','red/* comment */','var(--x)\\'])expect(()=>buildStreamgraphModel(stream,[{id:"a",label:"A",color}])).toThrow();
 });
 test("monotone resampling remains within each supplied interval without overshoot",()=>{
  const sampled=resampleStreamgraph([0,10,2,8]);expect(sampled).toHaveLength(161);expect(sampled[0]).toBe(0);expect(sampled[160]).toBe(8);
  sampled.forEach((value,index)=>{const cell=Math.min(2,Math.floor(index/160*3));expect(value).toBeGreaterThanOrEqual(Math.min([0,10,2,8][cell]!,[0,10,2,8][cell+1]!));expect(value).toBeLessThanOrEqual(Math.max([0,10,2,8][cell]!,[0,10,2,8][cell+1]!));});
  expect(()=>resampleStreamgraph([-1])).toThrow();
 });
 test("zero/silhouette/wiggle offsets are finite and retain reference center-out order",()=>{
  const layers=[resampleStreamgraph([2,3,8]),resampleStreamgraph([3,4,1])];
  expect(stackStreamgraphOrder(4,"wiggle")).toEqual([2,0,1,3]);expect(stackStreamgraphOrder(4,"zero")).toEqual([0,1,2,3]);
  expect(computeStreamgraphBaseline(layers,"zero").every(v=>v===0)).toBe(true);
  expect(computeStreamgraphBaseline(layers,"silhouette")[0]).toBe(-2.5);
  expect(computeStreamgraphBaseline(layers,"wiggle").every(Number.isFinite)).toBe(true);
 });
 test("stream baseline consumes detached readonly layers without inherited methods or indexed getters",()=>{
  let reads=0;
  const hostile=()=>{const prototype=Object.create(Array.prototype);for(const key of ["map","reduce",Symbol.iterator])Object.defineProperty(prototype,key,{get(){reads++;throw new Error("Caller array method evaluated");}});return prototype;};
  const first=new Array<number>(161).fill(2),second=new Array<number>(161).fill(3);
  Object.setPrototypeOf(first,hostile());Object.setPrototypeOf(second,hostile());
  const layers=[first,second];Object.setPrototypeOf(layers,hostile());
  expect(computeStreamgraphBaseline(layers,"silhouette").every(value=>value===-2.5)).toBe(true);
  expect(computeStreamgraphBaseline(layers,"wiggle").every(Number.isFinite)).toBe(true);expect(reads).toBe(0);
  const readonlyLayers=Object.freeze([Object.freeze(new Array<number>(161).fill(2)),Object.freeze(new Array<number>(161).fill(3))]);
  expect(computeStreamgraphBaseline(readonlyLayers,"silhouette")[160]).toBe(-2.5);expect(readonlyLayers[0]![0]).toBe(2);
  const indexed=new Array<number>(161).fill(2);Object.defineProperty(indexed,"0",{get(){reads++;return 2;}});
  expect(()=>computeStreamgraphBaseline([indexed],"zero")).toThrow();expect(reads).toBe(0);
  const outer=[first];Object.defineProperty(outer,"0",{get(){reads++;return first;}});
  expect(()=>computeStreamgraphBaseline(outer,"zero")).toThrow();expect(reads).toBe(0);
 });
 test("slope preserves signed values, end ordering and input-order ties",()=>{
  const data=buildSlopeModel(slope),layout=computeSlopeLayout(data,{width:640});
  expect(layout.byEnd.map(r=>r.item.id)).toEqual(["a","b"]);expect(layout.rows[0]!.rank0-layout.rows[0]!.rank1).toBe(1);
  const tied=computeSlopeLayout(buildSlopeModel([{id:"x",label:"X",start:1,end:1},{id:"y",label:"Y",start:1,end:1}]),{width:360});
  expect(tied.byEnd.map(r=>r.item.id)).toEqual(["x","y"]);expect(tied.rows[1]!.l0-tied.rows[0]!.l0).toBeGreaterThanOrEqual(19.9);
 });
 test("slope layout stays within a collapsed or tiny host and dense explicit height",()=>{
  for(const width of [0,1,50,240,640]){const layout=computeSlopeLayout(buildSlopeModel(slope),{width});expect(layout.x0).toBeLessThanOrEqual(width);expect(layout.x1).toBeLessThanOrEqual(width);}
  expect(()=>computeSlopeLayout(buildSlopeModel(slope),{width:100,height:Infinity})).toThrow();
  expect(()=>buildSlopeModel([...slope,slope[0]!])).toThrow();
 });
 test("ridgeline quantiles and empirical shares describe actual signed observations",()=>{
  const model=buildRidgelineModel(ridges),stats=model.stats.get("a")!;
  expect(stats.q1).toBe(1.75);expect(stats.median).toBe(2.5);expect(stats.q3).toBe(3.25);expect(stats.n).toBe(4);expect(inspectRidgeline(stats,2)).toBe(.5);
  expect(inspectRidgeline(ridgelineStats([]),2)).toBeNull();expect(model.stats.get("b")!.min).toBe(-2);
  expect(ridgelineStats([]).median).toBeNull();expect(ridgelineQuantile([],.5)).toBeNull();expect(()=>ridgelineQuantile([3,1],.5)).toThrow();expect(inspectRidgeline(stats,3e12)).toBe(1);
 });
 test("KDE is finite, nonnegative and peaks normalize honestly at large magnitudes",()=>{
  const model=buildRidgelineModel([{id:"large",label:"Large",values:[1e11,2e11,3e11]}]);
  expect(Math.max(...model.shapes.get("large")!.ys)).toBeCloseTo(1);expect(model.shapes.get("large")!.ys.every(v=>Number.isFinite(v)&&v>=0)).toBe(true);
  expect(()=>ridgelineDensity(ridgelineStats([1]),0,2,0)).toThrow();
  expect(()=>buildRidgelineModel(ridges,{domain:[4,1]})).toThrow();
  expect(()=>buildRidgelineModel([{id:"bad",label:"Bad",values:[NaN]}])).toThrow();
 });
 test("narrow high-magnitude domains have bounded progressing ticks and complete SSR",()=>{
  for(const [lo,hi]of [[999999999999.9999,1e12],[-1e12,-999999999999.9999],[0,Number.MIN_VALUE],[1e-300,1.0000000000000002e-300]]as const){const {ticks,step}=computeRidgelineTicks(lo,hi,32);expect(ticks.length).toBeLessThanOrEqual(64);expect(ticks.every((v,i)=>Number.isFinite(v)&&v>=lo&&v<=hi&&(i===0||v>ticks[i-1]!))).toBe(true);expect(step).toBeGreaterThan(0);}
  const html=renderToStaticMarkup(createElement(Ridgeline,{label:"Narrow large domain",series:[{id:"large",label:"Large",values:[1e12]}],domain:[999999999999.9999,1e12]}));expect(html).toContain("Narrow large domain");expect(html).not.toContain("NaN");
 });
 test("treemap branches sum leaves and shade is a size-weighted mean",()=>{
  const model=buildTreemapModel(tree);expect(model.get("root")!.value).toBe(200);expect(model.get("a")!.color).toBeCloseTo(2.8);expect(normalizeTreemapFocus(model,"a1").id).toBe("root");expect(normalizeTreemapFocus(model,"a").id).toBe("a");
 });
 test("treemap rejects cycles, duplicate IDs, signed leaves, accessor fields and ambiguous branch values",()=>{
  const cycle:any={id:"root",label:"Root",children:[]};cycle.children.push(cycle);expect(()=>buildTreemapModel(cycle)).toThrow();
  expect(()=>buildTreemapModel({id:"x",label:"X",children:[{id:"y",label:"Y",value:1},{id:"y",label:"Again",value:2}]})).toThrow();
  expect(()=>buildTreemapModel({id:"x",label:"X",value:-1})).toThrow();
  expect(()=>buildTreemapModel({...tree,value:1})).toThrow();
  let reads=0;const node=Object.defineProperty({id:"x",label:"X"},"value",{get(){reads++;return 2;}});expect(()=>buildTreemapModel(node)).toThrow();expect(reads).toBe(0);
 });
 test("treemap squarification conserves area before visual gaps and keeps nested geometry finite",()=>{
  const rects=new Map();squarifyTreemap([{id:"a",value:60},{id:"b",value:40}],{x:0,y:0,w:100,h:60},rects);expect([...rects.values()].reduce((n,r)=>n+r.w*r.h,0)).toBeCloseTo(6000);
  const model=buildTreemapModel(tree);for(const width of [0,1,390,800]){const layout=computeTreemapLayout(model,"root",{x:0,y:0,w:width,h:420});expect([...layout.values()].every(r=>Object.values(r).every(v=>Number.isFinite(v))&&r.w>=0&&r.h>=0)).toBe(true);}
  const extreme=new Map();squarifyTreemap([{id:"large",value:1e12},{id:"tiny",value:Number.MIN_VALUE}],{x:0,y:0,w:100,h:60},extreme);expect([...extreme.values()].every(r=>Object.values(r).every(Number.isFinite))).toBe(true);
 });
 test("treemap layout admits own records and detached readonly items without evaluating caller getters",()=>{
  let reads=0;const rect=Object.freeze({x:0,y:0,w:100,h:60});
  for(const field of ["id","value"]){const item=Object.defineProperty({id:"a",value:60},field,{get(){reads++;return field==="id"?"a":60;}});expect(()=>squarifyTreemap([item],rect,new Map())).toThrow();expect(reads).toBe(0);}
  const getterRect=Object.defineProperty({...rect},"w",{get(){reads++;return 100;}});expect(()=>squarifyTreemap([{id:"a",value:1}],getterRect,new Map())).toThrow();expect(reads).toBe(0);
  const items=[Object.freeze({id:"a",value:60}),Object.freeze({id:"b",value:40})];
  const prototype=Object.create(Array.prototype);for(const key of ["map","filter","reduce",Symbol.iterator])Object.defineProperty(prototype,key,{get(){reads++;throw new Error("Caller layout method evaluated");}});
  Object.setPrototypeOf(items,prototype);Object.freeze(items);
  const output=new Map<string,{x:number;y:number;w:number;h:number}>();const mapPrototype=Object.create(Map.prototype);
  for(const key of ["set","has"])Object.defineProperty(mapPrototype,key,{get(){reads++;throw new Error("Caller output override evaluated");}});Object.setPrototypeOf(output,mapPrototype);
  squarifyTreemap(items,rect,output);
  expect([...Map.prototype.values.call(output)].reduce((sum,r)=>sum+r.w*r.h,0)).toBeCloseTo(6000);expect(reads).toBe(0);expect(items[0]!.value).toBe(60);
  expect(()=>squarifyTreemap([{id:"a",value:1,extra:2}as {id:string;value:number}],rect,new Map())).toThrow();
 });
});
describe("Arc distribution SSR exact companions",()=>{
 test("all four render safe exact tables without browser or provider initialization",()=>{
  const fixtures=[createElement(Streamgraph,{label:"Stream",data:stream,series}),createElement(SlopeChart,{label:"Slope",data:slope,startLabel:"Before",endLabel:"After"}),createElement(Ridgeline,{label:"Ridges",series:ridges}),createElement(Treemap,{label:"Tree",data:tree})];
  for(const fixture of fixtures){const html=renderToStaticMarkup(fixture);expect(html).toContain("<table>");expect(html).toContain("Alpha");expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");}
 });
 test("all-zero/empty inputs provide explicit empty messages",()=>{
  expect(renderToStaticMarkup(createElement(Streamgraph,{label:"Stream",data:[],series}))).toContain("No data for this range");
  expect(renderToStaticMarkup(createElement(SlopeChart,{label:"Slope",data:[],startLabel:"Before",endLabel:"After"}))).toContain("No data");
  expect(renderToStaticMarkup(createElement(Ridgeline,{label:"Ridges",series:[]}))).toContain("No data yet");
  expect(renderToStaticMarkup(createElement(Treemap,{label:"Tree",data:{id:"root",label:"Root",value:0}}))).toContain("No data yet");
 });
});
