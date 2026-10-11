/** Detached, bounded data admission and truthful domain math. These exports are safe without a DOM. */
import { ownArray, ownRecord, numberValue, chartId, chartText, chartColor, NATIVE_CHART_LIMITS } from '../shared/admission';
import type { RadarModel, RadarProfileModel, RadarAxisModel, RadialBarModel, PieModel, SunburstModel, SunburstNodeModel } from './polar-types';

export const POLAR_CHART_LIMITS = Object.freeze({ axes: 32, profiles: 32, rings: 32, slices: 256, nodes: NATIVE_CHART_LIMITS.nodes, depth: NATIVE_CHART_LIMITS.depth, magnitude: NATIVE_CHART_LIMITS.magnitude, dimensions: 4096 });
type PolarModelKind='radar'|'radial-bar'|'pie'|'sunburst';
const admittedModels:Record<PolarModelKind,WeakSet<object>>={radar:new WeakSet(),'radial-bar':new WeakSet(),pie:new WeakSet(),sunburst:new WeakSet()};
function finish<T extends object>(kind:PolarModelKind,model:T):Readonly<T>{const admitted=Object.freeze(model);admittedModels[kind].add(admitted);return admitted;}
/** Public layout helpers accept only immutable models produced here, before inspecting any supplied property. */
export function assertPolarModel(input:unknown,kind:PolarModelKind):void{if(input===null||typeof input!=='object'||!admittedModels[kind].has(input))throw new TypeError(`Expected a builder-admitted ${kind} model`);}
const freeze = Object.freeze;
function rawRatio(value:number,min:number,max:number):number { const normalized=(value-min)/(max-min);if(!Number.isFinite(normalized))throw new RangeError('Range normalization must remain finite');return normalized; }
const ratio = (value: number, min: number, max: number) => Math.min(1, Math.max(0, rawRatio(value,min,max)));
function unique(input: unknown, path: string, ids: Set<string>): string { const id = chartId(input,path); if(ids.has(id))throw new TypeError(`${path} must be unique`);ids.add(id);return id; }
function paint(value: unknown,path: string): string|undefined { return value === undefined ? undefined : chartColor(value,path); }
/** Neumaier compensation avoids losing small, nonnegative children beside a large sibling. */
function total(values: readonly number[], path: string): number {
 let sum = 0, correction = 0;
 for (const value of values) {
  const next = sum + value;
  correction += sum >= value ? (sum - next) + value : (value - next) + sum;
  sum = next;
 }
 const result = sum + correction;
 // Preserve the magnitude budget even when a positive excess rounds back onto its boundary.
 if (result > POLAR_CHART_LIMITS.magnitude || (sum === POLAR_CHART_LIMITS.magnitude && correction > 0)) {
  throw new RangeError(`${path} exceeds ${POLAR_CHART_LIMITS.magnitude}`);
 }
 return result;
}
const floatBits = new DataView(new ArrayBuffer(8));
/** Spacing of adjacent binary64 values at a nonnegative magnitude, including subnormals. */
function unitInLastPlace(value: number): number {
 floatBits.setFloat64(0, value, false);
 const exponent = (floatBits.getUint32(0, false) >>> 20) & 0x7ff;
 return exponent === 0 ? Number.MIN_VALUE : 2 ** (exponent - 1023 - 52);
}
function matchesChildren(value: number, declared: number): boolean {
 if (value === declared) return true;
 // Zero is an exact domain assertion, not a place to hide a small positive measurement.
 if (value === 0 || declared === 0) return false;
 // Nonnegative subnormal sums are exact integer multiples of MIN_VALUE; no rounding allowance applies.
 if (Math.max(value, declared) <= 2 ** -1022) return false;
 // One final rounding of a compensated sum, e.g. .1 + .2 versus a declared .3.
 return Math.abs(value - declared) <= Math.max(unitInLastPlace(value), unitInLastPlace(declared));
}
export function admitPolarIds(input: unknown,path='hiddenIds'): readonly string[] { const ids=new Set<string>();return freeze(ownArray(input??[],path,POLAR_CHART_LIMITS.nodes).map((value,index)=>unique(value,`${path}[${index}]`,ids))); }
function admittedHidden(input: unknown,ids:Set<string>): readonly string[] { return freeze(admitPolarIds(input).filter(id=>ids.has(id))); }
function domain(entry: Record<string,unknown>,path:string): readonly[number,number] { const min=entry.min===undefined?0:numberValue(entry.min,`${path}.min`),max=numberValue(entry.max,`${path}.max`);if(max<=min)throw new RangeError(`${path}.max must be greater than min`);return freeze([min,max] as const); }

export function buildRadarModel(axesInput: unknown,profilesInput: unknown,hiddenInput: unknown=[]): RadarModel {
 const axisIds=new Set<string>();const axes=ownArray(axesInput,'axes',POLAR_CHART_LIMITS.axes).map((input,index)=>{const path=`axes[${index}]`,entry=ownRecord(input,path,['id','label','min','max']);const [min,max]=domain(entry,path);return freeze({id:unique(entry.id,`${path}.id`,axisIds),label:chartText(entry.label,`${path}.label`,true),min,max});});
 if(axes.length<3)throw new RangeError('Radar requires at least three axes');
 const profileIds=new Set<string>();const profiles=ownArray(profilesInput,'profiles',POLAR_CHART_LIMITS.profiles).map((input,index)=>{const path=`profiles[${index}]`,entry=ownRecord(input,path,['id','label','values','color']),seen=new Set<string>();const values=new Map(ownArray(entry.values,`${path}.values`,POLAR_CHART_LIMITS.axes).map((input,vi)=>{const vp=`${path}.values[${vi}]`,value=ownRecord(input,vp,['id','value']),id=unique(value.id,`${vp}.id`,seen);if(!axisIds.has(id))throw new TypeError(`${vp}.id is not an axis`);return[id,numberValue(value.value,`${vp}.value`)]as const;}));
  if(values.size!==axes.length)throw new TypeError(`${path}.values must contain every axis exactly once`);
  return freeze({id:unique(entry.id,`${path}.id`,profileIds),label:chartText(entry.label,`${path}.label`,true),color:paint(entry.color,`${path}.color`),index,values:freeze(axes.map(axis=>{const value=values.get(axis.id)!;return freeze({id:axis.id,value,ratio:ratio(value,axis.min,axis.max),clipped:value<axis.min||value>axis.max});}))}) satisfies RadarProfileModel;
 });
 const hiddenIds=admittedHidden(hiddenInput,profileIds),hidden=new Set(hiddenIds);return finish('radar',{axes:freeze(axes),profiles:freeze(profiles),visibleProfiles:freeze(profiles.filter(profile=>!hidden.has(profile.id))),hiddenIds});
}
export function buildRadialBarModel(input:unknown): RadialBarModel {
 const ids=new Set<string>();const data=ownArray(input,'data',POLAR_CHART_LIMITS.rings).map((input,index)=>{const path=`data[${index}]`,entry=ownRecord(input,path,['id','label','value','min','max','color']);const[min,max]=domain(entry,path),value=numberValue(entry.value,`${path}.value`);return freeze({id:unique(entry.id,`${path}.id`,ids),label:chartText(entry.label,`${path}.label`,true),value,min,max,rawRatio:rawRatio(value,min,max),ratio:ratio(value,min,max),clipped:value<min||value>max,color:paint(entry.color,`${path}.color`),index});});return finish('radial-bar',{data:freeze(data)});
}
export function buildPieModel(input:unknown,hiddenInput:unknown=[]): PieModel {
 const ids=new Set<string>();const admitted=ownArray(input,'data',POLAR_CHART_LIMITS.slices).map((input,index)=>{const path=`data[${index}]`,entry=ownRecord(input,path,['id','label','value','color']);return freeze({id:unique(entry.id,`${path}.id`,ids),label:chartText(entry.label,`${path}.label`,true),value:numberValue(entry.value,`${path}.value`,{min:0}),color:paint(entry.color,`${path}.color`),index});});
 const hiddenIds=admittedHidden(hiddenInput,ids),hidden=new Set(hiddenIds),fullTotal=total(admitted.map(slice=>slice.value),'total'),visibleTotal=total(admitted.filter(slice=>!hidden.has(slice.id)).map(slice=>slice.value),'visible total');
 const data=freeze(admitted.map(slice=>freeze({...slice,share:!hidden.has(slice.id)&&visibleTotal>0?slice.value/visibleTotal:0,hidden:hidden.has(slice.id)})));return finish('pie',{data,slices:freeze(data.filter(slice=>!slice.hidden&&slice.value>0)),total:visibleTotal,fullTotal,hiddenIds});
}
export function buildSunburstModel(input:unknown): SunburstModel {
 const ids=new Set<string>(),seen=new Set<object>();let count=0,maxDepth=0;const nodes:SunburstNodeModel[]=[];
 function walk(input:unknown,parentId:string|null,depth:number):SunburstNodeModel {
  if(depth>=POLAR_CHART_LIMITS.depth)throw new RangeError(`Sunburst depth exceeds ${POLAR_CHART_LIMITS.depth}`);if(++count>POLAR_CHART_LIMITS.nodes)throw new RangeError('Sunburst has too many nodes');
  if(input&&typeof input==='object'){if(seen.has(input))throw new TypeError('Sunburst cannot contain cycles or reused nodes');seen.add(input);}
  const path=`node[${count-1}]`,entry=ownRecord(input,path,['id','label','value','color','children']),id=unique(entry.id,`${path}.id`,ids),index=nodes.length;nodes.push(null as unknown as SunburstNodeModel);maxDepth=Math.max(maxDepth,depth);
  const children=entry.children===undefined?[]:ownArray(entry.children,`${path}.children`,POLAR_CHART_LIMITS.nodes).map(child=>walk(child,id,depth+1));
  const declaredValue=entry.value===undefined?null:numberValue(entry.value,`${path}.value`,{min:0});if(!children.length&&declaredValue===null)throw new TypeError(`${path} leaf requires a value`);
  const value=children.length?total(children.map(child=>child.value),`${path} total`):declaredValue!;
  if(children.length&&declaredValue!==null&&!matchesChildren(value,declaredValue))throw new RangeError(`${path}.value must equal the sum of its children`);
  const node=freeze({id,label:chartText(entry.label,`${path}.label`,true),value,declaredValue,color:paint(entry.color,`${path}.color`),parentId,depth,index,children:freeze(children)});nodes[index]=node;return node;
 }
 const root=walk(input,null,0);return finish('sunburst',{root,nodes:freeze(nodes),total:root.value,depth:maxDepth+1});
}
