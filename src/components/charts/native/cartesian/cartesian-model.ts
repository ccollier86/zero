/** Native Cartesian admission, signed/percent stacking and axis domains. Owns exact presentation math, never queries or persistence. */
import{CARTESIAN_NATIVE_LIMITS as LIMITS,record,list,text,number,flag,choice,domain,color,unique}from'./cartesian-admission';
import{expandCartesianDomain,cartesianTicks}from'./cartesian-scales';
import type{CartesianDatum,CartesianSeries,CartesianOptions,CartesianModel,CartesianModelSeries,CartesianModelDatum,CartesianCell,CartesianAxisModel,CartesianReference,CartesianBand}from'./cartesian-types';
type MutableCell={value:number|null;low:number|null;high:number|null;size:number|null;from:number|null;to:number|null};
const pair=(value:unknown,path:string,time=false)=>domain(value,path,time?8.64e15:LIMITS.magnitude);
const admittedModels=new WeakSet<object>();
/** Layout authority belongs to the detached model builder, not arbitrary or serialized model-shaped records. */
export function assertAdmittedCartesianModel(value:unknown):asserts value is CartesianModel{if(typeof value!=='object'||value===null||!admittedModels.has(value))throw new TypeError('Cartesian geometry requires a model returned by buildCartesianModel');}
/** Stable hidden identities are detached, bounded and masked when a series retires. */
export function admitCartesianHidden(value:readonly string[]|undefined):string[]{return value===undefined?[]:list(value,'hiddenSeriesIds',LIMITS.series).map(id=>text(id,'hidden series ID',true));}
/** Window is ordered, detached coordinate space; clamping never changes supplied observations. */
export function fitCartesianWindow(value:readonly[number,number]|undefined,whole:readonly[number,number]):[number,number]{
 if(value===undefined)return[...whole];const[low,high]=pair(value,'window',true);return[Math.max(whole[0],Math.min(whole[1],low)),Math.max(whole[0],Math.min(whole[1],high))];
}
/** Admit identified series/observations, then compute exact stacks and named independent numeric domains. */
export function buildCartesianModel(dataInput:readonly CartesianDatum[],seriesInput:readonly CartesianSeries[],optionsInput:CartesianOptions={}):CartesianModel{
 const options=record(optionsInput,'options',['xAxis','yAxes','layout','stack','missing','hiddenSeriesIds','window','references','bands']);
 const layout=choice(options.layout,'layout',['vertical','horizontal'],'vertical'),stack=choice(options.stack,'stack',['none','stacked','signed','percent'],'none'),missing=choice(options.missing,'missing',['gap','zero'],'gap');
 const x=record(options.xAxis===undefined?{}:options.xAxis,'xAxis',['type','domain','label']);const xType=choice(x.type,'xAxis.type',['category','linear','time'],'category');
 const axisIds=new Set<string>();
 const axisInputs=list(options.yAxes===undefined?[{id:'y'}]:options.yAxes,'yAxes',LIMITS.axes).map((value,index)=>{
  const item=record(value,'y axis',['id','side','scale','domain','includeZero','label']);const id=unique(item.id,'axis ID',axisIds),scale=choice(item.scale,'axis.scale',['linear','log'],'linear');
  const requested=item.domain===undefined?undefined:pair(item.domain,'axis.domain');if(requested&&requested[0]===requested[1])throw new TypeError('Explicit numeric domains must increase');if(scale==='log'&&requested&&requested[0]<=0)throw new TypeError('Log domains must be positive');
  return{id,scale,side:choice(item.side,'axis.side',['left','right'],index?'right':'left'),domain:requested,includeZero:flag(item.includeZero,'includeZero',scale==='linear'),label:item.label===undefined?'':text(item.label,'axis.label')};
 });
 if(!axisInputs.length)throw new TypeError('A Cartesian chart requires a numeric axis');if(new Set(axisInputs.map(axis=>axis.side)).size!==axisInputs.length)throw new TypeError('Numeric axes must have distinct sides');
 const seriesIds=new Set<string>();
 const series=list(seriesInput,'series',LIMITS.series).map(value=>{
  const item=record(value,'series',['id','label','mark','axisId','stackId','color','curve','connectNulls','baseline','bubble','dashed']);const id=unique(item.id,'series.id',seriesIds),axisId=item.axisId===undefined?axisInputs[0]!.id:text(item.axisId,'series.axisId',true);
  if(!axisIds.has(axisId))throw new TypeError('Series names an unknown axis');const mark=choice(item.mark,'series.mark',['line','area','bar','scatter'],'line');
  if(item.stackId!==undefined&&mark!=='bar'&&mark!=='area')throw new TypeError('Only bar and area marks can stack');
  return Object.freeze({id,label:text(item.label,'series.label'),mark,axisId,stackId:item.stackId===undefined?null:text(item.stackId,'stackId',true),color:item.color===undefined?undefined:color(item.color,'series.color'),curve:choice(item.curve,'curve',['linear','smooth','step'],'smooth'),connectNulls:flag(item.connectNulls,'connectNulls'),baseline:item.baseline===undefined?undefined:number(item.baseline,'baseline'),bubble:flag(item.bubble,'bubble'),dashed:flag(item.dashed,'dashed')}) as CartesianModelSeries;
 });
 const hidden=new Set(admitCartesianHidden(options.hiddenSeriesIds as readonly string[]|undefined));const visibleSeries=series.filter(item=>!hidden.has(item.id));
 const datumIds=new Set<string>();
 const raw=list(dataInput,'data',LIMITS.points);if(raw.length*series.length>LIMITS.cells)throw new TypeError('Cartesian cell budget exceeded');
 const data=raw.map((value,index)=>{
  const item=record(value,'datum',['id','label','x','values']);const id=unique(item.id,'datum.id',datumIds),label=text(item.label,'datum.label');
  const independent=xType==='category'?(item.x===undefined?id:typeof item.x==='number'?number(item.x,'datum.x'):text(item.x,'datum.x')):number(item.x,'datum.x',xType==='time'?8.64e15:LIMITS.magnitude);
  const coordinate=xType==='category'?index:independent as number;
  const values=record(item.values,'datum.values',[...seriesIds]);const cells=Object.create(null) as Record<string,MutableCell>;
  for(const line of series){let raw=values[line.id],low:null|number=null,high:null|number=null,size:null|number=null;if(raw!==null&&raw!==undefined&&typeof raw==='object'){const supplied=record(raw,'measurement',['value','low','high','size']);raw=supplied.value;low=supplied.low===undefined?null:number(supplied.low,'measurement.low');high=supplied.high===undefined?null:number(supplied.high,'measurement.high');size=supplied.size===undefined?null:number(supplied.size,'measurement.size');if((low===null)!==(high===null)||low!==null&&high!==null&&low>high)throw new TypeError('Intervals need ordered low and high values');if(size!==null&&size<0)throw new TypeError('Bubble size must be nonnegative');}
   const measurement=raw===null||raw===undefined?(missing==='zero'?0:null):number(raw,'measurement.value');if(measurement===null&&(low!==null||size!==null))throw new TypeError('An absent measurement cannot own an interval or bubble size');if(measurement!==null&&low!==null&&high!==null&&(measurement<low||measurement>high))throw new TypeError('Intervals must contain their measured value');
   const axis=axisInputs.find(axis=>axis.id===line.axisId)!;if(axis.scale==='log'&&measurement!==null&&(measurement<=0||low!==null&&low<=0||line.baseline!==undefined&&line.baseline<=0))throw new TypeError('Log axes require positive measurements, intervals and baselines');
   cells[line.id]={value:measurement,low,high,size,from:measurement===null?null:line.baseline??0,to:measurement};
  }
  return{id,label,x:independent,coordinate,cells};
 });
 if(xType!=='category')data.sort((a,b)=>a.coordinate-b.coordinate);
 const groups=new Map<string,CartesianModelSeries[]>();
 for(const line of visibleSeries)if(stack!=='none'&&(line.mark==='bar'||line.mark==='area')){const axis=axisInputs.find(axis=>axis.id===line.axisId)!;if(axis.scale==='log')throw new TypeError('Stacking logarithmic axes is undefined');if(line.baseline!==undefined&&line.baseline!==0)throw new TypeError('Stacked marks use a zero baseline');const key=JSON.stringify([line.axisId,line.stackId??'default']);const group=groups.get(key)??[];group.push(line);groups.set(key,group);}
 for(const datum of data)for(const group of groups.values()){
  const total=group.reduce((sum,line)=>sum+(datum.cells[line.id]!.value??0),0);if(!Number.isFinite(total)||Math.abs(total)>LIMITS.magnitude)throw new RangeError('Stack aggregate exceeds magnitude budget');
  let positive=0,negative=0,accumulator=0;
  for(const line of group){const cell=datum.cells[line.id]!;if(cell.value===null)continue;let value=cell.value;if(stack==='percent'){if(cell.low!==null||cell.high!==null)throw new TypeError('Percent stacks cannot use raw measurement intervals');if(value<0)throw new TypeError('Percent stacks require nonnegative values');value=total?value/total:0;}
   if(stack==='signed'){cell.from=value<0?negative:positive;cell.to=cell.from+value;if(value<0)negative=cell.to;else positive=cell.to;}else{cell.from=accumulator;cell.to=accumulator+value;accumulator=cell.to;}
   if(Math.abs(cell.to!)>LIMITS.magnitude)throw new RangeError('Stack aggregate exceeds magnitude budget');
  }
 }
 const referenceIds=new Set<string>();const references=list(options.references===undefined?[]:options.references,'references',LIMITS.references).map(value=>{const item=record(value,'reference',['id','axis','value','axisId','label','color']);const axis=choice(item.axis,'reference.axis',['x','y'],'y'),axisId=item.axisId===undefined?axisInputs[0]!.id:text(item.axisId,'reference.axisId',true);if(axis==='y'&&!axisIds.has(axisId))throw new TypeError('Reference has an unknown axis');return Object.freeze({id:unique(item.id,'reference.id',referenceIds),axis,value:number(item.value,'reference.value',axis==='x'&&xType==='time'?8.64e15:LIMITS.magnitude),axisId,...(item.label===undefined?{}:{label:text(item.label,'reference.label')}),...(item.color===undefined?{}:{color:color(item.color,'reference.color')})}) as CartesianReference;});
 const bandIds=new Set<string>();const bands=list(options.bands===undefined?[]:options.bands,'bands',LIMITS.references).map(value=>{const item=record(value,'band',['id','axis','from','to','axisId','label','color']);const axis=choice(item.axis,'band.axis',['x','y'],'y'),axisId=item.axisId===undefined?axisInputs[0]!.id:text(item.axisId,'band.axisId',true);if(axis==='y'&&!axisIds.has(axisId))throw new TypeError('Band has an unknown axis');const from=number(item.from,'band.from',axis==='x'&&xType==='time'?8.64e15:LIMITS.magnitude),to=number(item.to,'band.to',axis==='x'&&xType==='time'?8.64e15:LIMITS.magnitude);if(from>to)throw new TypeError('Band bounds must be ordered');return Object.freeze({id:unique(item.id,'band.id',bandIds),axis,from,to,axisId,...(item.label===undefined?{}:{label:text(item.label,'band.label')}),...(item.color===undefined?{}:{color:color(item.color,'band.color')})}) as CartesianBand;});
 const axes=axisInputs.map(axis=>{
  const measures:number[]=[];for(const datum of data)for(const line of visibleSeries)if(line.axisId===axis.id){const cell=datum.cells[line.id]!;if(cell.value===null)continue;measures.push(cell.to!,...(line.mark==='area'||line.mark==='bar'?[cell.from!]:[]));if(cell.low!==null)measures.push(cell.low,cell.high!);}
  for(const reference of references)if(reference.axis==='y'&&reference.axisId===axis.id)measures.push(reference.value);for(const band of bands)if(band.axis==='y'&&band.axisId===axis.id)measures.push(band.from,band.to);
  if(axis.scale==='log'&&measures.some(value=>value<=0)){const measured=data.flatMap(datum=>visibleSeries.filter(line=>line.axisId===axis.id).map(line=>datum.cells[line.id]!.value)).filter((value):value is number=>value!==null);if(measured.some(value=>value<=0)||references.some(value=>value.axis==='y'&&value.axisId===axis.id&&value.value<=0)||bands.some(value=>value.axis==='y'&&value.axisId===axis.id&&value.from<=0))throw new TypeError('Log references and measurements must be positive');let accepted=0;for(const value of measures)if(value>0)measures[accepted++]=value;measures.length=accepted;}
  let low=axis.scale==='log'?1:0,high=axis.scale==='log'?10:1;if(measures.length){low=Infinity;high=-Infinity;for(const value of measures){low=Math.min(low,value);high=Math.max(high,value);}}
  const requested=axis.domain??(stack==='percent'&&visibleSeries.some(line=>line.axisId===axis.id&&(line.mark==='bar'||line.mark==='area'))?[0,1] as [number,number]:expandCartesianDomain(low,high,axis.includeZero&&axis.scale==='linear'));
  const actual=axis.scale==='log'&&requested[0]<=0?[low>0?low:1,requested[1]] as [number,number]:requested;
  const numericDomain=actual[0]===actual[1]?axis.scale==='log'?[actual[0]/10,actual[1]*10] as [number,number]:expandCartesianDomain(...actual):actual;
  return Object.freeze({id:axis.id,side:axis.side,scale:axis.scale,domain:Object.freeze(numericDomain),explicitDomain:axis.domain!==undefined,ticks:Object.freeze(cartesianTicks(numericDomain,axis.scale)),label:axis.label}) as CartesianAxisModel;
 });
 // Unstacked marks use the nearest representable zero/domain edge as baseline, including positive logarithmic axes.
 for(const datum of data)for(const line of series){const cell=datum.cells[line.id]!;if(cell.value===null)continue;if(stack==='none'||line.mark!=='area'&&line.mark!=='bar'||hidden.has(line.id)){const axis=axes.find(axis=>axis.id===line.axisId)!;const[low,high]=axis.domain;cell.from=line.baseline??(low<=0&&high>=0?0:high<0?high:low);}}
 const rawDomain=x.domain===undefined?undefined:pair(x.domain,'xAxis.domain',xType==='time');const natural:[number,number]=data.length?[data[0]!.coordinate,data[data.length-1]!.coordinate]:[0,1];
 const xDomain=rawDomain??(natural[0]===natural[1]?xType==='time'?[Math.max(-8.64e15,natural[0]-1),Math.min(8.64e15,natural[1]+1)] as [number,number]:expandCartesianDomain(...natural):natural);if(xDomain[0]===xDomain[1])throw new TypeError('Explicit X domains must increase');
 const window=fitCartesianWindow(options.window as readonly[number,number]|undefined,xDomain);
 const admittedData=data.map(datum=>{const cells=Object.create(null) as Record<string,CartesianCell>;for(const line of series)cells[line.id]=Object.freeze(datum.cells[line.id]!);return Object.freeze({...datum,cells:Object.freeze(cells)}) as CartesianModelDatum;});
 const model=Object.freeze({data:Object.freeze(admittedData),series:Object.freeze(series),visibleSeries:Object.freeze(visibleSeries),axes:Object.freeze(axes),xType,xDomain:Object.freeze(xDomain),xExplicitDomain:rawDomain!==undefined,window:Object.freeze(window),xLabel:x.label===undefined?'':text(x.label,'xAxis.label'),layout,stack,references:Object.freeze(references),bands:Object.freeze(bands)});admittedModels.add(model);return model;
}
