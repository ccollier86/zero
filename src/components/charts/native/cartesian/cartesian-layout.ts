/** Native SVG geometry for Cartesian marks. Scales, signed rectangles, monotone curves and intervals; no renderer or chart-library dependency. */
import{cartesianScale,cartesianTicks}from'./cartesian-scales';
import{list,number,flag,choice}from'./cartesian-admission';
import{assertAdmittedCartesianModel}from'./cartesian-model';
import type{CartesianModel,CartesianModelSeries,CartesianLayout,CartesianCurve,CartesianPoint,CartesianBar,CartesianSeriesGeometry}from'./cartesian-types';
type Point=readonly[number,number];
const rounded=(value:number)=>Number(value.toFixed(3));
const pair=(point:Point)=>`${rounded(point[0])},${rounded(point[1])}`;
/** Build one continuous polyline/step/monotone cubic segment without overshooting adjacent values. */
export function cartesianLinePath(points:readonly Point[],curve:CartesianCurve='smooth',horizontal=false):string{
 points=list(points,'path points',4096).map(point=>{const pair=list(point,'path point',2);if(pair.length!==2)throw new TypeError('Path points require two coordinates');return[number(pair[0],'path x'),number(pair[1],'path y')] as Point;});curve=choice(curve,'path curve',['linear','smooth','step'],'smooth');horizontal=flag(horizontal,'path horizontal');
 if(!points.length)return'';let path=`M${pair(points[0]!)}`;if(points.length===1)return path;
 if(curve==='linear'){for(const point of points.slice(1))path+=`L${pair(point)}`;return path;}
 if(curve==='step'){for(let index=1;index<points.length;index++){const previous=points[index-1]!,current=points[index]!,middle=((horizontal?previous[1]:previous[0])+(horizontal?current[1]:current[0]))/2;path+=horizontal?`L${rounded(previous[0])},${rounded(middle)}L${rounded(current[0])},${rounded(middle)}L${pair(current)}`:`L${rounded(middle)},${rounded(previous[1])}L${rounded(middle)},${rounded(current[1])}L${pair(current)}`;}return path;}
 const independent=(point:Point)=>horizontal?point[1]:point[0],dependent=(point:Point)=>horizontal?point[0]:point[1];
 // A finite coordinate pair can still overflow dy/dx at subnormal spacing.
 // Such segments are linear and adjacent tangents flatten, avoiding NaN or
 // Infinity while keeping all control points inside each segment's bounds.
 const slopes=points.slice(1).map((point,index)=>{const dx=independent(point)-independent(points[index]!),slope=dx?(dependent(point)-dependent(points[index]!))/dx:NaN;return Number.isFinite(slope)?slope:null;});
 const tangents=points.map((_,index)=>{if(index===0)return slopes[0]??0;if(index===points.length-1)return slopes[slopes.length-1]??0;const before=slopes[index-1],after=slopes[index];return before!==null&&after!==null&&Math.sign(before!)===Math.sign(after!)?Math.sign(after!)*Math.min(Math.abs(before!),Math.abs(after!)):0;});
 for(let index=1;index<points.length;index++){const previous=points[index-1]!,point=points[index]!,dx=(independent(point)-independent(previous))/3;if(!dx||slopes[index-1]===null){path+=`L${pair(point)}`;continue;}const a:Point=horizontal?[dependent(previous)+tangents[index-1]!*dx,independent(previous)+dx]:[independent(previous)+dx,dependent(previous)+tangents[index-1]!*dx];const b:Point=horizontal?[dependent(point)-tangents[index]!*dx,independent(point)-dx]:[independent(point)-dx,dependent(point)-tangents[index]!*dx];if(!a.every(Number.isFinite)||!b.every(Number.isFinite)){path+=`L${pair(point)}`;continue;}path+=`C${pair(a)} ${pair(b)} ${pair(point)}`;}
 return path;
}
/** Split null observations unless the series explicitly requests connected gaps. */
export function cartesianSegments<T>(points:readonly(T|null)[],connectNulls=false):T[][]{
 points=list(points,'segment points',4096) as Array<T|null>;connectNulls=flag(connectNulls,'connectNulls');
 if(connectNulls){const connected=points.filter((point):point is T=>point!==null);return connected.length?[connected]:[];}
 const segments:T[][]=[];let segment:T[]=[];for(const point of points){if(point===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(point);}if(segment.length)segments.push(segment);return segments;
}
/** Paired smooth boundaries use the same convex interpolation, so an interval can never invert between samples. */
function intervalBoundary(points:readonly Point[],curve:CartesianCurve,horizontal:boolean):string{
 if(curve!=='smooth'||points.length<2)return cartesianLinePath(points,curve,horizontal);
 let path=`M${pair(points[0]!)}`;for(let index=1;index<points.length;index++){const previous=points[index-1]!,current=points[index]!,axis=horizontal?1:0,cross=horizontal?0:1,step=(current[axis]-previous[axis])/3;
  const a:Point=horizontal?[previous[cross],previous[axis]+step]:[previous[axis]+step,previous[cross]],b:Point=horizontal?[current[cross],current[axis]-step]:[current[axis]-step,current[cross]];
  path+=step?`C${pair(a)} ${pair(b)} ${pair(current)}`:`L${pair(current)}`;
 }return path;
}
/** Only visible bubble marks define the shared size domain; other marks may retain size metadata without affecting bubble area. */
export function cartesianBubbleMaximum(model:CartesianModel):number{
 assertAdmittedCartesianModel(model);const series=model.visibleSeries.filter(line=>line.mark==='scatter'&&line.bubble);let maximum=0;for(const datum of model.data)for(const line of series)maximum=Math.max(maximum,datum.cells[line.id]!.size??0);return maximum;
}
/** Convert only a detached buildCartesianModel result into a clipped plot; serialized/forged records cannot grant geometry authority. */
export function computeCartesianLayout(model:CartesianModel,width=640,height=300):CartesianLayout{
 assertAdmittedCartesianModel(model);
 if(!Number.isFinite(width)||width<120||width>16384||!Number.isFinite(height)||height<120||height>4096)throw new RangeError('Cartesian geometry needs finite 120–16384px width and 120–4096px height');
 const horizontal=model.layout==='horizontal',left=horizontal?Math.min(116,width*.28):52,right=horizontal?18:model.axes.length>1?52:18,top=horizontal&&model.axes.length>1?30:12,bottom=32;
 const plotWidth=Math.max(1,width-left-right),plotHeight=Math.max(1,height-top-bottom),independentExtent=horizontal?plotHeight:plotWidth,numericExtent=horizontal?plotWidth:plotHeight;
 const hasBars=model.visibleSeries.some(series=>series.mark==='bar');const[windowLow,windowHigh]=model.window,windowSpan=windowHigh-windowLow;
 const categorySpan=windowSpan+1;
 const visibleData=model.data.filter(datum=>datum.coordinate>=windowLow&&datum.coordinate<=windowHigh);
 const groups:string[]=[];const groupOf=(seriesId:string)=>{const series=model.visibleSeries.find(series=>series.id===seriesId)!;return model.stack==='none'?JSON.stringify([series.axisId,series.id]):JSON.stringify([series.axisId,series.stackId??'default']);};
 for(const series of model.visibleSeries)if(series.mark==='bar'){const group=groupOf(series.id);if(!groups.includes(group))groups.push(group);}
 // Automatic point plots reserve a shared inner range rather than changing raw
 // axis domains. Explicit domains retain their authoritative clipping edges.
 const availableRadius=Math.max(0,Math.min(plotWidth,plotHeight)/2-1.5),scatterRadius=Math.min(4,availableRadius),maxBubbleRadius=Math.min(16,availableRadius);
 const pointGutter=(series:readonly CartesianModelSeries[],extent:number)=>Math.min(extent/2,series.some(line=>line.mark==='scatter'&&line.bubble)?maxBubbleRadius+1.5:series.some(line=>line.mark==='scatter')?scatterRadius+1.5:0);
 // Solve range padding and bar width together: the full group's half-width is
 // at most .76 * relativeBand * (extent - 2*gutter) / 2, plus cap stroke.
 // This keeps every
 // automatic endpoint group visible even at narrow widths or sixteen series,
 // without changing the raw domain, relative spacing, or explicit clipping.
 let relativeBand=1/Math.max(1,visibleData.length);if(windowSpan)for(let index=1;index<visibleData.length;index++){const spacing=cartesianScale(visibleData[index]!.coordinate,model.window)-cartesianScale(visibleData[index-1]!.coordinate,model.window);if(spacing>0)relativeBand=Math.min(relativeBand,spacing);}
 const barRatio=.76*relativeBand,capMargin=Math.min(1.5,independentExtent/2),barGutter=groups.length?model.xType==='category'?capMargin:Math.min(groups.length*18+capMargin,(independentExtent*barRatio/2+capMargin)/(1+barRatio)):0;
 const independentGutter=model.xExplicitDomain?0:Math.max(barGutter,pointGutter(model.visibleSeries,independentExtent)),numericGutters=new Map(model.axes.map(axis=>[axis.id,axis.explicitDomain?0:pointGutter(model.visibleSeries.filter(series=>series.axisId===axis.id),numericExtent)]));
 const independentRange=Math.max(0,independentExtent-2*independentGutter);
 const mapX=(value:number)=>{const fraction=model.xType==='category'&&hasBars?(value-windowLow+.5)/categorySpan:windowSpan?cartesianScale(value,model.window):.5;return independentGutter+fraction*independentRange;};
 const mapY=(value:number,axisId=model.axes[0]!.id)=>{const axis=model.axes.find(axis=>axis.id===axisId);if(!axis)throw new TypeError('Unknown numeric axis');const fraction=cartesianScale(value,axis.domain,axis.scale),gutter=numericGutters.get(axis.id)!;return gutter+(horizontal?fraction:1-fraction)*Math.max(0,numericExtent-2*gutter);};
 const project=(independent:number,value:number,axisId:string):Point=>horizontal?[mapY(value,axisId),mapX(independent)]:[mapX(independent),mapY(value,axisId)];
 let band=model.xType==='category'?independentRange/categorySpan:independentRange/Math.max(1,visibleData.length);
 if(model.xType!=='category'){for(let index=1;index<visibleData.length;index++){const gap=Math.abs(mapX(visibleData[index]!.coordinate)-mapX(visibleData[index-1]!.coordinate));if(gap>0)band=Math.min(band,gap);}}
 const slot=Math.max(0,Math.min(36,band*.76/Math.max(1,groups.length))),gap=Math.min(3,slot*.12),barWidth=Math.max(0,slot-gap);
 const geometries:CartesianSeriesGeometry[]=model.visibleSeries.map(series=>{
  const points:Array<CartesianPoint|null>=[];const bars:CartesianBar[]=[];
  for(const datum of visibleData){const cell=datum.cells[series.id]!;if(cell.value===null||cell.to===null||cell.from===null){points.push(null);continue;}const point=project(datum.coordinate,cell.to,series.axisId),base=project(datum.coordinate,cell.from,series.axisId);
   const exact:CartesianPoint=Object.freeze({datumId:datum.id,seriesId:series.id,x:point[0],y:point[1],baseX:base[0],baseY:base[1],value:cell.value,low:cell.low,high:cell.high,size:cell.size});points.push(exact);
   if(series.mark==='bar'){const offset=(groups.indexOf(groupOf(series.id))-(groups.length-1)/2)*slot;const negative=cell.to<cell.from;bars.push(Object.freeze({datumId:datum.id,seriesId:series.id,x:horizontal?Math.min(point[0],base[0]):point[0]+offset-barWidth/2,y:horizontal?point[1]+offset-barWidth/2:Math.min(point[1],base[1]),width:horizontal?Math.abs(point[0]-base[0]):barWidth,height:horizontal?barWidth:Math.abs(point[1]-base[1]),cap:horizontal?negative?'left':'right':negative?'bottom':'top',value:cell.value,from:cell.from,to:cell.to}));}
  }
  const segments=cartesianSegments(points,series.connectNulls);let line='',area='',interval='';const intervalSingles:string[]=[];for(const segment of segments){const path=cartesianLinePath(segment.map(point=>[point.x,point.y] as Point),series.curve,horizontal);line+=path;if(series.mark==='area'){const base=cartesianLinePath([...segment].reverse().map(point=>[point.baseX,point.baseY] as Point),series.curve,horizontal);area+=path+(base?`L${base.slice(1)}Z`:'');}}
  if(series.mark==='area')for(const segment of cartesianSegments(points.map(point=>point!==null&&point.low!==null&&point.high!==null?point:null),series.connectNulls)){
   if(segment.length===1){intervalSingles.push(segment[0]!.datumId);continue;}
   // Intervals are absolute observed bounds, not shifted/normalized stack
   // coordinates. Missing bounds split the band just like missing values.
   const bounds=(point:CartesianPoint,value:number):Point=>horizontal?[mapY(value,series.axisId),point.y]:[point.x,mapY(value,series.axisId)];
   const high=intervalBoundary(segment.map(point=>bounds(point,point.high!)),series.curve,horizontal),low=intervalBoundary([...segment].reverse().map(point=>bounds(point,point.low!)),series.curve,horizontal);interval+=high+`L${low.slice(1)}Z`;
  }
  return Object.freeze({seriesId:series.id,line,area,interval,intervalSingles:Object.freeze(intervalSingles),points:Object.freeze(points.filter((point):point is CartesianPoint=>point!==null)),bars:Object.freeze(bars)});
 });
 const tickRoom=Math.max(2,Math.floor(independentRange/80));let independentTicks:Array<{coordinate:number;label:string;position:number}>;
 if(model.xType==='category'){const count=Math.min(visibleData.length,tickRoom),indices=new Set(Array.from({length:count},(_,index)=>count===1?0:Math.round(index*(visibleData.length-1)/(count-1))));independentTicks=visibleData.filter((_,index)=>indices.has(index)).map(datum=>({coordinate:datum.coordinate,label:datum.label,position:mapX(datum.coordinate)}));}
 else{const actual=windowLow===windowHigh?[Math.max(-8.64e15,windowLow-1),Math.min(8.64e15,windowHigh+1)] as [number,number]:model.window;independentTicks=cartesianTicks(actual,'linear',tickRoom).map(coordinate=>({coordinate,label:model.xType==='time'?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(coordinate):new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(coordinate),position:mapX(coordinate)}));}
 return Object.freeze({width,height,left,top,plotWidth,plotHeight,scatterRadius,maxBubbleRadius,independentTicks:Object.freeze(independentTicks),axes:Object.freeze(model.axes.map(axis=>Object.freeze({axis,ticks:Object.freeze(axis.ticks.map(value=>Object.freeze({value,position:mapY(value,axis.id)})))}))),series:Object.freeze(geometries),mapX,mapY});
}
/** Bubble area is proportional to its nonnegative size; zero size draws no pretend population. */
export function cartesianBubbleRadius(size:number|null,maxSize:number,minRadius=3,maxRadius=16):number{number(maxSize,'bubble maximum');number(minRadius,'bubble minimum radius',4096);number(maxRadius,'bubble maximum radius',4096);if(maxSize<0||minRadius<0||maxRadius<minRadius)throw new RangeError('Bubble sizes and ordered radii must be nonnegative');if(size===null)return minRadius;number(size,'bubble size');if(size<0||size>maxSize)throw new RangeError('Bubble size must lie within its nonnegative size domain');if(size===0)return 0;return Math.sqrt(size/maxSize)*maxRadius;}
