/** Honest proportional/range geometry. Angles use SVG clockwise degrees from the positive X axis. */
import { numberValue } from '../shared/admission';
import { POLAR_CHART_LIMITS,assertPolarModel } from './polar-model';
import type { RadarModel,RadarLayout,RadialBarModel,RadialBarLayout,PieModel,PieLayout,PolarPoint,SunburstModel,SunburstLayout,SunburstSector,SunburstNodeModel } from './polar-types';
const freeze=Object.freeze;
export function polarDimensions(width=480,height=380):readonly[number,number]{return freeze([numberValue(width,'width',{min:160,max:POLAR_CHART_LIMITS.dimensions}),numberValue(height,'height',{min:160,max:POLAR_CHART_LIMITS.dimensions})]as const);}
export function polarPoint(cx:number,cy:number,radius:number,angle:number):PolarPoint{numberValue(cx,'cx');numberValue(cy,'cy');numberValue(radius,'radius',{min:0,max:POLAR_CHART_LIMITS.dimensions});numberValue(angle,'angle',{min:-7200,max:7200});const radians=angle*Math.PI/180;return freeze({x:cx+Math.cos(radians)*radius,y:cy+Math.sin(radians)*radius});}
/** A solid sector when inner=0. A full turn uses two arcs, avoiding SVG's identical-endpoint empty-arc trap. */
export function polarSectorPath(cx:number,cy:number,inner:number,outer:number,start:number,end:number):string{
 numberValue(inner,'innerRadius',{min:0,max:POLAR_CHART_LIMITS.dimensions});numberValue(outer,'outerRadius',{min:inner,max:POLAR_CHART_LIMITS.dimensions});numberValue(start,'startAngle',{min:-7200,max:7200});numberValue(end,'endAngle',{min:-7200,max:7200});if(!(outer>0)||!(end>start))return '';const span=Math.min(360,end-start),large=span>180?1:0,stop=start+span,a=polarPoint(cx,cy,outer,start),b=polarPoint(cx,cy,outer,stop);
 if(span>=360-1e-9){const mid=polarPoint(cx,cy,outer,start+180),outside=`M${a.x},${a.y}A${outer},${outer} 0 1 1 ${mid.x},${mid.y}A${outer},${outer} 0 1 1 ${a.x},${a.y}`;if(inner===0)return outside+'Z';const ia=polarPoint(cx,cy,inner,start),im=polarPoint(cx,cy,inner,start+180);return`${outside}L${ia.x},${ia.y}A${inner},${inner} 0 1 0 ${im.x},${im.y}A${inner},${inner} 0 1 0 ${ia.x},${ia.y}Z`;}
 if(inner===0)return`M${cx},${cy}L${a.x},${a.y}A${outer},${outer} 0 ${large} 1 ${b.x},${b.y}Z`;
 const ia=polarPoint(cx,cy,inner,start),ib=polarPoint(cx,cy,inner,stop);return`M${a.x},${a.y}A${outer},${outer} 0 ${large} 1 ${b.x},${b.y}L${ib.x},${ib.y}A${inner},${inner} 0 ${large} 0 ${ia.x},${ia.y}Z`;
}
export function computeRadarLayout(model:RadarModel,width=480,height=380,levels=4):RadarLayout{
 assertPolarModel(model,'radar');
 const[w,h]=polarDimensions(width,height);numberValue(levels,'levels',{min:1,max:10,integer:true});const cx=w/2,cy=h/2,radius=Math.max(20,Math.min(w,h)/2-64);
 const axes=model.axes.map((axis,index)=>{const angle=-90+index/model.axes.length*360;return freeze({...polarPoint(cx,cy,radius+22,angle),id:axis.id,end:polarPoint(cx,cy,radius,angle)});});
 const polygon=(fraction:number)=>model.axes.map((_,index)=>polarPoint(cx,cy,radius*fraction,-90+index/model.axes.length*360));const path=(points:readonly PolarPoint[])=>points.map((p,index)=>`${index?'L':'M'}${p.x},${p.y}`).join('')+'Z';
 return freeze({width:w,height:h,cx,cy,radius,axes:freeze(axes),levels:freeze(Array.from({length:levels},(_,index)=>path(polygon((index+1)/levels)))),profiles:freeze(model.visibleProfiles.map(profile=>{const points=freeze(profile.values.map((measurement,index)=>freeze({...polarPoint(cx,cy,radius*measurement.ratio,-90+index/model.axes.length*360),axisId:measurement.id})));return freeze({id:profile.id,path:path(points),points});}))});
}
export function computeRadialBarLayout(model:RadialBarModel,width=480,height=380,startAngle=-90,endAngle=270,innerRadius=.25,ringGap=4):RadialBarLayout{
 assertPolarModel(model,'radial-bar');
 const[w,h]=polarDimensions(width,height);numberValue(startAngle,'startAngle',{min:-3600,max:3600});numberValue(endAngle,'endAngle',{min:-3600,max:3600});if(endAngle<=startAngle||endAngle-startAngle>360)throw new RangeError('Radial angle span must be in (0, 360]');numberValue(innerRadius,'innerRadius',{min:0,max:.8});numberValue(ringGap,'ringGap',{min:0,max:16});const cx=w/2,cy=h/2,outer=Math.min(w,h)/2-18,inner=outer*innerRadius,count=model.data.length,thickness=count?(outer-inner-ringGap*(count-1))/count:0;if(count&&thickness<1)throw new RangeError('Rings and gaps do not fit the requested geometry');
 return freeze({width:w,height:h,cx,cy,sectors:freeze(model.data.map((item,index)=>{const outerRadius=outer-index*(thickness+ringGap);return freeze({id:item.id,item,inner:outerRadius-thickness,outer:outerRadius,start:startAngle,end:startAngle+(endAngle-startAngle)*item.ratio,trackEnd:endAngle});}))});
}
export function computePieLayout(model:PieModel,width=480,height=380,startAngle=-90):PieLayout{
 assertPolarModel(model,'pie');
 const[w,h]=polarDimensions(width,height);numberValue(startAngle,'startAngle',{min:-3600,max:3600});let angle=startAngle;const cx=w/2,cy=h/2,outer=Math.min(w,h)/2-18;return freeze({width:w,height:h,cx,cy,sectors:freeze(model.slices.map((slice,index)=>{const start=angle;angle=index===model.slices.length-1?startAngle+360:angle+slice.share*360;return freeze({id:slice.id,slice,start,end:angle,inner:0,outer});}))});
}
export function computeSunburstLayout(model:SunburstModel,rootId:string|null=null,outerRadius=160,startAngle=-90):SunburstLayout{
 assertPolarModel(model,'sunburst');
 numberValue(outerRadius,'outerRadius',{min:20,max:POLAR_CHART_LIMITS.dimensions});numberValue(startAngle,'startAngle',{min:-3600,max:3600});
 const byId=new Map(model.nodes.map(node=>[node.id,node])),found=rootId===null?model.root:byId.get(rootId);if(!found)throw new TypeError('Unknown Sunburst rootId');const root:SunburstNodeModel=found;
 const ancestors:SunburstNodeModel[]=[];let cursor=root;while(cursor.parentId!==null){cursor=byId.get(cursor.parentId)!;ancestors.unshift(cursor);}
 const depth=(node:SunburstNodeModel):number=>1+(node.children.length?Math.max(...node.children.map(depth)):0),layers=depth(root),thickness=outerRadius/layers,sectors:SunburstSector[]=[];
 // A drilled view retains the original branch palette and inherited overrides, rather than recoloring surviving IDs.
 const paints=new Map<string,{colorIndex:number;color:string|undefined}>();
 function assignPaint(node:SunburstNodeModel,colorIndex:number,inherited:string|undefined){const color=node.color??inherited;paints.set(node.id,{colorIndex,color});node.children.forEach((child,index)=>assignPaint(child,node===model.root?index:colorIndex,color));}
 assignPaint(model.root,0,undefined);
 function walk(node:SunburstNodeModel,start:number,end:number,level:number){const paint=paints.get(node.id)!,parent=node.parentId===null?undefined:byId.get(node.parentId);sectors.push(freeze({id:node.id,node,start,end,inner:level*thickness,outer:(level+1)*thickness,share:root.value>0?node.value/root.value:0,parentShare:parent?(parent.value>0?node.value/parent.value:0):1,...paint}));let angle=start;const children=node.children.filter(child=>child.value>0);children.forEach((child,index)=>{const next=index===children.length-1?end:angle+(end-start)*child.value/node.value;walk(child,angle,next,level+1);angle=next;});}
 if(root.value>0)walk(root,startAngle,startAngle+360,0);return freeze({root,sectors:freeze(sectors),ancestors:freeze(ancestors),depth:layers});
}
