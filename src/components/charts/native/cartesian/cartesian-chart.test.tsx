/** Native Cartesian numerical and SSR qualification. Synthetic measurements only; no services or database. */
import{expect,test}from'bun:test';import{createElement}from'react';import{renderToString}from'react-dom/server';
import{buildCartesianModel,fitCartesianWindow}from'./cartesian-model';import{computeCartesianLayout,cartesianLinePath,cartesianSegments,cartesianBubbleRadius,cartesianBubbleMaximum}from'./cartesian-layout';import{cartesianScale,cartesianTicks}from'./cartesian-scales';import{cartesianKeyboardTarget}from'./cartesian-interaction';
import{CartesianChart,XYLineChart,AreaChart,GroupedBarChart,StackedBarChart,HorizontalBarChart,ComposedChart,ScatterChart,BubbleChart,type CartesianChartProps}from'./cartesian-chart';import type{CartesianDatum,CartesianSeries,CartesianOptions}from'./cartesian-types';
const series:CartesianSeries[]=[{id:'a',label:'Alpha',mark:'bar'},{id:'b',label:'Beta',mark:'bar'}];
const data:CartesianDatum[]=[{id:'one',label:'One',values:{a:10,b:20}},{id:'two',label:'Two',values:{a:-8,b:3}},{id:'three',label:'Three',values:{a:null,b:0}}];
test('native model detaches raw values, preserves null gaps versus zero and validates own records',()=>{
 const input=[{id:'one',label:'One',values:{a:1.25}}];const model=buildCartesianModel(input,series);input[0]!.values.a=99;expect(model.data[0]!.cells.a!.value).toBe(1.25);expect(model.data[0]!.cells.b!.value).toBeNull();expect(Object.isFrozen(model.data[0]!.cells)).toBe(true);
 expect(buildCartesianModel(input,series,{missing:'zero'}).data[0]!.cells.b!.value).toBe(0);
 expect(()=>buildCartesianModel([...input,input[0]!],series)).toThrow();expect(()=>buildCartesianModel(input,[...series,series[0]!])).toThrow();expect(()=>buildCartesianModel([{id:'one',label:'One',values:Object.create({a:1})}],series)).toThrow();
 let read=0;expect(()=>buildCartesianModel([{id:'one',label:'One',values:{get a(){read++;return 1;}}}],series)).toThrow();expect(read).toBe(0);
});
test('own-array method, indexed and prototype accessors never execute; colors cannot fetch resources',()=>{
 let reads=0;for(const field of['map','some',Symbol.iterator]){const input=[1];Object.defineProperty(input,field,{get(){reads++;return()=>[];}});expect(()=>buildCartesianModel(input as unknown as CartesianDatum[],series)).toThrow();}
 const input=[data[0]!];const proto=Object.create(Array.prototype);Object.defineProperty(proto,Symbol.iterator,{get(){reads++;return()=>[];}});Object.setPrototypeOf(input,proto);expect(()=>buildCartesianModel(input,series)).toThrow();
 const window=[0,1];Object.defineProperty(window,'0',{get(){reads++;return 0;}});expect(()=>fitCartesianWindow(window as[number,number],[0,2])).toThrow();expect(reads).toBe(0);
 const forged={get axes(){reads++;return[];}};expect(()=>computeCartesianLayout(forged as never)).toThrow();expect(()=>computeCartesianLayout({...buildCartesianModel(data,series)})).toThrow();expect(reads).toBe(0);
 const path=[[0,0],[1,1]];Object.defineProperty(path,'map',{get(){reads++;return()=>[];}});expect(()=>cartesianLinePath(path as[number,number][])).toThrow();expect(reads).toBe(0);
 for(const paint of['url(https://invalid.example/a.svg)','u\\72l(https://invalid.example/a.svg)','red;stroke:black'])expect(()=>buildCartesianModel([], [{id:'a',label:'A',color:paint}])).toThrow();
});
test('signed stacks use separate accumulators, percent uses exact raw values and zero totals stay zero',()=>{
 const model=buildCartesianModel(data,series,{stack:'signed'});expect(model.data[0]!.cells.b).toMatchObject({value:20,from:10,to:30});expect(model.data[1]!.cells.a).toMatchObject({value:-8,from:0,to:-8});expect(model.data[1]!.cells.b).toMatchObject({value:3,from:0,to:3});
 const percent=buildCartesianModel([data[0]!,data[2]!],series,{stack:'percent'});expect(percent.data[0]!.cells.a!.to).toBeCloseTo(1/3);expect(percent.data[0]!.cells.b).toMatchObject({value:20,to:1});expect(percent.data[1]!.cells.b).toMatchObject({value:0,from:0,to:0});expect(percent.axes[0]!.domain).toEqual([0,1]);
 expect(()=>buildCartesianModel(data,series,{stack:'percent'})).toThrow();expect(buildCartesianModel(data,series,{stack:'signed',hiddenSeriesIds:['a']}).data[0]!.cells.b!.from).toBe(0);
 const intervalData=[{id:'bounded',label:'Bounded',values:{a:{value:10,low:8,high:12},b:20}}];expect(()=>buildCartesianModel(intervalData,series,{stack:'percent'})).toThrow('Percent stacks cannot use raw measurement intervals');for(const stack of['none','stacked','signed']as const)expect(buildCartesianModel(intervalData,series,{stack}).data[0]!.cells.a).toMatchObject({value:10,low:8,high:12});
 expect(()=>buildCartesianModel([{id:'one',label:'One',values:{a:1e12,b:1e12}}],series,{stack:'signed'})).toThrow();
});
test('grouped bars do not overlap and signed horizontal bars retain truthful directions',()=>{
 const geometry=computeCartesianLayout(buildCartesianModel(data,series),640,300);const a=geometry.series[0]!.bars[0]!,b=geometry.series[1]!.bars[0]!;expect(a.x+a.width).toBeLessThanOrEqual(b.x);expect(a.height).toBeGreaterThan(0);
 const horizontal=computeCartesianLayout(buildCartesianModel(data,series,{stack:'signed',layout:'horizontal'}),640,300);expect(horizontal.series[0]!.bars[1]!.cap).toBe('left');expect(horizontal.series[1]!.bars[1]!.cap).toBe('right');expect(horizontal.series[0]!.bars[1]!.width).toBeGreaterThan(0);
});
test('automatic numeric and time ranges preserve complete endpoint bar groups without changing X units',()=>{
 const fullSeries=Array.from({length:16},(_,index)=>({id:`s${index}`,label:`Series ${index}`,mark:'bar' as const}));
 for(const count of[1,2,16])for(const layout of['vertical','horizontal']as const)for(const type of['linear','time']as const)for(const[width,height]of[[640,300],[230,300],[120,120]])for(const stack of['none','signed']as const){
  const lines=fullSeries.slice(0,count),observations=[0,10,100].map((coordinate,index)=>({id:`p${index}`,label:`Point ${index}`,x:type==='time'?Date.UTC(2026,0,1)+coordinate*1000:coordinate,values:Object.fromEntries(lines.map(line=>[line.id,10]))}));
  const model=buildCartesianModel(observations,lines,{xAxis:{type},layout,stack}),geometry=computeCartesianLayout(model,width,height),extent=layout==='horizontal'?geometry.plotHeight:geometry.plotWidth;
  expect(model.xDomain).toEqual([observations[0]!.x,observations[2]!.x]);
  for(const shape of geometry.series)for(const bar of shape.bars){const start=layout==='horizontal'?bar.y:bar.x,size=layout==='horizontal'?bar.height:bar.width;expect(size).toBeGreaterThan(0);expect(start-1.5).toBeGreaterThanOrEqual(-1e-9);expect(start+size+1.5).toBeLessThanOrEqual(extent+1e-9);}
  expect((geometry.mapX(model.data[1]!.coordinate)-geometry.mapX(model.data[0]!.coordinate))/(geometry.mapX(model.data[2]!.coordinate)-geometry.mapX(model.data[0]!.coordinate))).toBeCloseTo(.1);
 }
 const observations=[{id:'a',label:'A',x:0,values:{a:10,b:20}},{id:'b',label:'B',x:100,values:{a:10,b:20}}],explicit=computeCartesianLayout(buildCartesianModel(observations,series,{xAxis:{type:'linear',domain:[0,100]}}));
 expect(explicit.mapX(0)).toBe(0);expect(explicit.mapX(100)).toBe(explicit.plotWidth);expect(explicit.series[0]!.bars[0]!.x+explicit.series[0]!.bars[0]!.width).toBeLessThan(0);expect(explicit.series[1]!.bars[1]!.x).toBeGreaterThan(explicit.plotWidth);
});
test('numeric/time X use genuine spacing, detached unordered scatter values are sorted and windows keep exact full data',()=>{
 const points=[{id:'c',label:'C',x:100,values:{a:3}},{id:'a',label:'A',x:0,values:{a:1}},{id:'b',label:'B',x:10,values:{a:2}}];const model=buildCartesianModel(points,[{id:'a',label:'A',mark:'scatter'}],{xAxis:{type:'linear'}});expect(model.data.map(datum=>datum.id)).toEqual(['a','b','c']);const layout=computeCartesianLayout(model),painted=layout.series[0]!.points;expect((painted[1]!.x-painted[0]!.x)/(painted[2]!.x-painted[0]!.x)).toBeCloseTo(.1);
 const zoom=buildCartesianModel(points,[{id:'a',label:'A'}],{xAxis:{type:'linear'},window:[5,15]});expect(zoom.data.length).toBe(3);expect(computeCartesianLayout(zoom).series[0]!.points).toHaveLength(1);expect(fitCartesianWindow([-10,1000],model.xDomain)).toEqual([0,100]);
 const date=Date.UTC(2026,0,1);const time=buildCartesianModel([{id:'a',label:'Day',x:date,values:{a:1}}],[{id:'a',label:'A'}],{xAxis:{type:'time'}});expect(time.data[0]!.coordinate).toBe(date);expect(computeCartesianLayout(time).series[0]!.points[0]!.x).toBeCloseTo(computeCartesianLayout(time).plotWidth/2);
 for(const epoch of[-8.64e15,8.64e15]){const endpoint=buildCartesianModel([{id:'a',label:'Endpoint',x:epoch,values:{a:1}}],[{id:'a',label:'A'}],{xAxis:{type:'time'},window:[epoch,epoch]});expect(()=>computeCartesianLayout(endpoint)).not.toThrow();}
});
test('named dual axes and positive logarithmic domains retain units and reject impossible stacks',()=>{
 const model=buildCartesianModel([{id:'one',label:'One',x:1,values:{a:10,b:1000}},{id:'two',label:'Two',x:2,values:{a:100,b:2000}}],[{id:'a',label:'A',axisId:'power'},{id:'b',label:'B',axisId:'load'}],{xAxis:{type:'linear'},yAxes:[{id:'power',scale:'log',domain:[1,100]},{id:'load',side:'right',domain:[0,2000]}]});expect(model.axes).toHaveLength(2);expect(cartesianScale(10,[1,100],'log')).toBeCloseTo(.5);expect(computeCartesianLayout(model).axes[1]!.axis.id).toBe('load');
 expect(()=>buildCartesianModel(data,series,{yAxes:[{id:'y',scale:'log'}]})).toThrow();expect(()=>buildCartesianModel([data[0]!],series,{stack:'signed',yAxes:[{id:'y',scale:'log'}]})).toThrow();expect(()=>buildCartesianModel(data,[{id:'a',label:'A',axisId:'unknown'}])).toThrow();
});
test('domains clip presentation only; references, bands and exact intervals contribute to automatic domains',()=>{
 const model=buildCartesianModel([{id:'one',label:'One',values:{a:{value:100,low:80,high:120,size:25}}}],[{id:'a',label:'A',mark:'scatter',bubble:true}],{yAxes:[{id:'y',domain:[0,10]}],references:[{id:'goal',axis:'y',value:500}],bands:[{id:'range',axis:'y',from:200,to:300}]});expect(model.axes[0]!.domain).toEqual([0,10]);expect(model.data[0]!.cells.a).toMatchObject({value:100,low:80,high:120,size:25});expect(computeCartesianLayout(model).series[0]!.points[0]!.y).toBeLessThan(0);
 const auto=buildCartesianModel([{id:'one',label:'One',values:{a:5}}],[{id:'a',label:'A'}],{references:[{id:'goal',axis:'y',value:10}]});expect(auto.axes[0]!.domain[1]).toBe(10);expect(cartesianBubbleRadius(25,100)/cartesianBubbleRadius(100,100)).toBe(.5);expect(cartesianBubbleRadius(0,100)).toBe(0);
 for(const[size,max]of[[-1,1],[1,0],[1,Number.MIN_VALUE],[NaN,1],[1,Infinity]])expect(()=>cartesianBubbleRadius(size!,max!)).toThrow();
});
test('path kernels honor missing segments, connected gaps and step curves',()=>{
 expect(cartesianSegments([1,null,2])).toEqual([[1],[2]]);expect(cartesianSegments([1,null,2],true)).toEqual([[1,2]]);expect(cartesianLinePath([[0,0],[10,10]],'step')).toContain('L5,0L5,10');expect(cartesianLinePath([[0,0],[10,10]],'smooth')).toContain('C');
 const points=[{id:'a',label:'A',values:{a:1}},{id:'b',label:'B',values:{a:null}},{id:'c',label:'C',values:{a:3}}];expect(computeCartesianLayout(buildCartesianModel(points,[{id:'a',label:'A'}])).series[0]!.line.match(/M/g)).toHaveLength(2);
});
test('smooth curves remain finite and segment-bounded at subnormal or duplicate independent coordinates',()=>{
 for(const horizontal of[false,true])for(const coordinates of[[0,Number.MIN_VALUE,1],[0,0,1],[1,1-Number.EPSILON,0],[0,1e-308,2e-308]]){
  const raw=coordinates.map((coordinate,index)=>horizontal?[index===1?10:0,coordinate]:[coordinate,index===1?10:0])as[number,number][];
  const path=cartesianLinePath(raw,'smooth',horizontal);expect(path).not.toMatch(/NaN|Infinity/);if(coordinates[0]===coordinates[1]||coordinates[1]===Number.MIN_VALUE||coordinates[1]===1e-308)expect(path).toContain('L');
 }
 const path=cartesianLinePath([[0,0],[1e-307,10],[2e-307,20]],'smooth');expect(path).not.toMatch(/NaN|Infinity/);
 const extremes=computeCartesianLayout(buildCartesianModel([{id:'a',label:'A',x:0,values:{a:0}},{id:'b',label:'B',x:Number.MIN_VALUE,values:{a:10}},{id:'c',label:'C',x:1,values:{a:0}}],[{id:'a',label:'A',mark:'area'}],{xAxis:{type:'linear'}}));expect(extremes.series[0]!.line+extremes.series[0]!.area).not.toMatch(/NaN|Infinity/);
 // Bezier control ordinates stay within the two adjacent observed endpoints.
 const ordinary=cartesianLinePath([[0,0],[10,8],[20,10],[30,-4]],'smooth');const segments=[...ordinary.matchAll(/C([^CMLZ]+)/g)].map(match=>match[1]!.trim().split(/[ ,]+/).map(Number));
 for(const[index,segment]of segments.entries()){const values=[0,8,10,-4],low=Math.min(values[index]!,values[index+1]!),high=Math.max(values[index]!,values[index+1]!);for(const at of[1,3,5]){expect(segment[at]).toBeGreaterThanOrEqual(low);expect(segment[at]).toBeLessThanOrEqual(high);}}
});
test('keyboard traversal skips null cells within a selected series and chooses only available series',()=>{
 const observations=[{id:'one',label:'One',values:{a:10,b:null}},{id:'two',label:'Two',values:{a:null,b:20}},{id:'three',label:'Three',values:{a:30,b:null}},{id:'four',label:'Four',values:{a:null,b:null}}];
 for(const layout of['vertical','horizontal']as const){const model=buildCartesianModel(observations,series,{layout}),forward=layout==='horizontal'?'ArrowDown':'ArrowRight',back=layout==='horizontal'?'ArrowUp':'ArrowLeft',cross=layout==='horizontal'?'ArrowRight':'ArrowDown';
  expect(cartesianKeyboardTarget(model,{datumId:'one',seriesId:'a'},forward)).toEqual({datumId:'three',seriesId:'a'});expect(cartesianKeyboardTarget(model,{datumId:'three',seriesId:'a'},back)).toEqual({datumId:'one',seriesId:'a'});
  expect(cartesianKeyboardTarget(model,{datumId:'three',seriesId:'a'},forward)).toEqual({datumId:'three',seriesId:'a'});expect(cartesianKeyboardTarget(model,{datumId:'one',seriesId:'a'},'End')).toEqual({datumId:'three',seriesId:'a'});
  expect(cartesianKeyboardTarget(model,{datumId:'one',seriesId:'a'},cross)).toEqual({datumId:'one',seriesId:'a'});expect(cartesianKeyboardTarget(model,{datumId:'two'},cross)).toEqual({datumId:'two',seriesId:'b'});expect(cartesianKeyboardTarget(model,{datumId:'four'},cross)).toEqual({datumId:'four'});
  expect(cartesianKeyboardTarget(model,{datumId:'one'},forward)).toEqual({datumId:'two'});expect(cartesianKeyboardTarget(model,null,'Escape')).toBeNull();expect(cartesianKeyboardTarget(model,null,'q')).toBeUndefined();
 }
 const hidden=buildCartesianModel(observations,series,{hiddenSeriesIds:['a'],window:[1,2]});expect(cartesianKeyboardTarget(hidden,null,'Home')).toEqual({datumId:'two'});expect(cartesianKeyboardTarget(hidden,{datumId:'two'},'ArrowDown')).toEqual({datumId:'two',seriesId:'b'});
});
test('only visible bubble series define the area domain in a mixed composer',()=>{
 const observations=[{id:'a',label:'A',x:0,values:{a:{value:10,size:100},b:{value:20,size:10000},c:{value:30,size:1000000}}}],lines=[{id:'a',label:'Bubble',mark:'scatter',bubble:true},{id:'b',label:'Ordinary point',mark:'scatter'},{id:'c',label:'Line',mark:'line'}]as CartesianSeries[];
 const model=buildCartesianModel(observations,lines,{xAxis:{type:'linear'}});expect(cartesianBubbleMaximum(model)).toBe(100);expect(cartesianBubbleMaximum(buildCartesianModel(observations,lines,{xAxis:{type:'linear'},hiddenSeriesIds:['a']}))).toBe(0);
 const html=renderToString(createElement(ComposedChart,{label:'Mixed size metadata',data:observations,series:lines,xAxis:{type:'linear'},motion:false}));expect(html).toMatch(/r="16" data-bubble="true"/);
 const visible=[...lines,{id:'d',label:'Hidden bubble',mark:'scatter',bubble:true}]as CartesianSeries[];const hidden=buildCartesianModel([{...observations[0]!,values:{...observations[0]!.values,d:{value:20,size:1000}}}],visible,{xAxis:{type:'linear'},hiddenSeriesIds:['d']});expect(cartesianBubbleMaximum(hidden)).toBe(100);
});
test('area interval bands preserve absolute low/high bounds, gaps, orientation, clipping and stack rules',()=>{
 const observations=[{id:'a',label:'A',x:0,values:{a:{value:10,low:7,high:13},b:20}},{id:'b',label:'B',x:1,values:{a:{value:11,low:8,high:14},b:25}},{id:'c',label:'C',x:2,values:{a:12,b:30}},{id:'d',label:'D',x:3,values:{a:{value:13,low:10,high:16},b:35}},{id:'e',label:'E',x:4,values:{a:{value:14,low:11,high:17},b:40}}];
 const areas=series.map(line=>({...line,mark:'area' as const}));
 for(const layout of['vertical','horizontal']as const)for(const curve of['linear','smooth','step']as const)for(const stack of['none','stacked','signed']as const){
  const model=buildCartesianModel(observations,areas.map(line=>({...line,curve})),{xAxis:{type:'linear'},layout,stack}),geometry=computeCartesianLayout(model),shape=geometry.series[0]!;expect(shape.interval.match(/M/g)).toHaveLength(2);expect(shape.interval.match(/Z/g)).toHaveLength(2);expect(shape.intervalSingles).toEqual([]);expect(shape.interval).not.toMatch(/NaN|Infinity/);
  const firstX=geometry.mapX(0),firstHigh=geometry.mapY(13,'y');expect(shape.interval).toStartWith(layout==='horizontal'?`M${Number(firstHigh.toFixed(3))},${Number(firstX.toFixed(3))}`:`M${Number(firstX.toFixed(3))},${Number(firstHigh.toFixed(3))}`);expect(model.data[0]!.cells.a!.high).toBe(13);
 }
 const connected=computeCartesianLayout(buildCartesianModel(observations,areas.map(line=>({...line,connectNulls:true})),{xAxis:{type:'linear'}}));expect(connected.series[0]!.interval.match(/M/g)).toHaveLength(1);
 const isolated=computeCartesianLayout(buildCartesianModel([observations[0]!,observations[2]!],areas,{xAxis:{type:'linear'}}));expect(isolated.series[0]!.interval).toBe('');expect(isolated.series[0]!.intervalSingles).toEqual(['a']);
 const explicit=buildCartesianModel(observations,areas,{xAxis:{type:'linear',domain:[0,4]},yAxes:[{id:'y',domain:[0,10]}]});expect(computeCartesianLayout(explicit).series[0]!.interval).toContain('-');expect(explicit.data[0]!.cells.a!.high).toBe(13);
 const late=buildCartesianModel([{id:'one',label:'One',x:0,values:{a:10,b:{value:20,low:18,high:22}}},{id:'two',label:'Two',x:1,values:{a:15,b:{value:25,low:23,high:27}}}],areas,{xAxis:{type:'linear'},stack:'signed'}),lateGeometry=computeCartesianLayout(late);expect(late.data[0]!.cells.b!.to).toBe(30);expect(lateGeometry.series[1]!.interval).toStartWith(`M0,${Number(lateGeometry.mapY(22,'y').toFixed(3))}`);expect(late.data[0]!.cells.b!.high).toBe(22);
 const missing=computeCartesianLayout(buildCartesianModel([{...observations[0]!},{id:'missing',label:'Missing',x:1,values:{a:null,b:10}},{...observations[4]!}],areas,{xAxis:{type:'linear'}}));expect(missing.series[0]!.interval).toBe('');expect(missing.series[0]!.intervalSingles).toEqual(['a','e']);
 const invertedRisk=computeCartesianLayout(buildCartesianModel([{id:'one',label:'One',values:{a:{value:0,low:-1,high:1}}},{id:'two',label:'Two',values:{a:{value:100,low:99,high:101}}},{id:'three',label:'Three',values:{a:{value:1,low:0,high:2}}}],[areas[0]!])).series[0]!.interval;
 const boundaries=invertedRisk.split('L'),upper=[...boundaries[0]!.matchAll(/C([^CMLZ]+)/g)].map(match=>match[1]!.trim().split(/[ ,]+/).map(Number)),lower=[...boundaries[1]!.matchAll(/C([^CMLZ]+)/g)].map(match=>match[1]!.trim().split(/[ ,]+/).map(Number));
 expect(upper).toHaveLength(2);expect(lower).toHaveLength(2);for(let index=0;index<upper.length;index++){const high=upper[index]!,low=lower[lower.length-1-index]!;expect(high[1]).toBeLessThanOrEqual(low[3]!);expect(high[3]).toBeLessThanOrEqual(low[1]!);}
 const html=renderToString(createElement(AreaChart,{label:'Measured area',data:observations,series:areas,xAxis:{type:'linear'},motion:false}));expect(html).toContain('zero-native-cartesian__interval');expect(html).not.toContain('zero-native-cartesian__error');expect(html).toContain('Alpha low');expect(html).toContain('Alpha high');expect(html).toContain('clip-path="url(#native-cartesian-');
 expect(()=>buildCartesianModel(observations,areas,{stack:'percent'})).toThrow('Percent stacks cannot use raw measurement intervals');
});
test('automatic XY point ranges preserve full circles, align ticks/inspection, and leave explicit domain clipping authoritative',()=>{
 const observations=[{id:'a',label:'Low',x:0,values:{a:{value:0,size:100}}},{id:'b',label:'High',x:10,values:{a:{value:10,size:100}}}];const points:CartesianSeries[]=[{id:'a',label:'Points',mark:'scatter',bubble:true}];
 for(const[width,height]of[[640,300],[230,300],[120,120]]){const model=buildCartesianModel(observations,points,{xAxis:{type:'linear'},yAxes:[{id:'y'},{id:'secondary',side:'right'}]}),geometry=computeCartesianLayout(model,width,height);for(const point of geometry.series[0]!.points){const radius=cartesianBubbleRadius(point.size,100,Math.min(3,geometry.maxBubbleRadius),geometry.maxBubbleRadius);expect(point.x-radius).toBeGreaterThanOrEqual(0);expect(point.x+radius).toBeLessThanOrEqual(geometry.plotWidth);expect(point.y-radius).toBeGreaterThanOrEqual(0);expect(point.y+radius).toBeLessThanOrEqual(geometry.plotHeight);expect(point.x).toBe(geometry.mapX(model.data.find(datum=>datum.id===point.datumId)!.coordinate));expect(point.y).toBe(geometry.mapY(point.value,'y'));}for(const tick of geometry.axes[0]!.ticks)expect(tick.position).toBe(geometry.mapY(tick.value,'y'));}
 const explicit=computeCartesianLayout(buildCartesianModel(observations,points,{xAxis:{type:'linear',domain:[0,10]},yAxes:[{id:'y',domain:[0,10]}]}));expect(explicit.series[0]!.points[0]!.x).toBe(0);expect(explicit.series[0]!.points[0]!.y).toBe(explicit.plotHeight);expect(explicit.series[0]!.points[1]!.x).toBe(explicit.plotWidth);expect(explicit.series[0]!.points[1]!.y).toBe(0);
});
test('extreme finite tick loops progress with explicit budgets; malformed selectors and domains reject',()=>{
 for(const domain of[[1e12-.0001220703125,1e12],[-1e12,-1e12+.0001220703125],[Number.MIN_VALUE,Number.MIN_VALUE*4]]as const){const ticks=cartesianTicks(domain);expect(ticks.length).toBeLessThanOrEqual(24);expect(ticks.every(Number.isFinite)).toBe(true);expect(new Set(ticks).size).toBe(ticks.length);}
 for(const options of[{layout:'diagonal'},{stack:'expand'},{missing:'ignore'},{xAxis:{type:'log'}},{yAxes:null},{xAxis:null},{references:null},{bands:null},{window:[2,1]}])expect(()=>buildCartesianModel(data,series,options as CartesianOptions)).toThrow();
 expect(cartesianScale(1e12,[1e12-.0001220703125,1e12],'log')).toBe(1);expect(cartesianScale(1,[Number.MIN_VALUE,Number.MIN_VALUE*2],'linear')).toBe(1e6);
 const tiny=buildCartesianModel([{id:'one',label:'One',values:{a:1}}],[{id:'a',label:'A',mark:'bar'}],{yAxes:[{id:'y',domain:[Number.MIN_VALUE,Number.MIN_VALUE*2]}]});const layout=computeCartesianLayout(tiny);expect(layout.series[0]!.bars.every(bar=>[bar.x,bar.y,bar.width,bar.height].every(Number.isFinite))).toBe(true);expect(tiny.data[0]!.cells.a!.value).toBe(1);expect(layout.series[0]!.bars[0]!.y).toBeLessThan(0);
});
test('maximum cell budget positive log intervals do not overflow an argument-spread operation',()=>{
 const fullSeries=Array.from({length:16},(_,index)=>({id:`s${index}`,label:`Series ${index}`,mark:'bar' as const}));const values=Object.fromEntries(fullSeries.map(line=>[line.id,{value:2,low:1,high:3}]));const observations=Array.from({length:4096},(_,index)=>({id:`p${index}`,label:`Point ${index}`,values}));const model=buildCartesianModel(observations,fullSeries,{yAxes:[{id:'y',scale:'log'}]});expect(model.data).toHaveLength(4096);expect(model.axes[0]!.domain).toEqual([1,3]);
});
test('all nine public organisms SSR exact missing/signed/interval/size measurements without renderer dependencies',()=>{
 for(const component of[CartesianChart,XYLineChart,AreaChart,GroupedBarChart,StackedBarChart,HorizontalBarChart,ComposedChart]){const html=renderToString(createElement(component,{label:'Exact',data,series,motion:false}));expect(html).toContain('<table');expect(html).toContain('-8');expect(html).toContain('Alpha');expect(html).toContain('—');expect(html).not.toContain('NaN');}
 for(const component of[ScatterChart,BubbleChart]){const html=renderToString(createElement(component,{label:'XY',data:[{id:'one',label:'One',x:12,values:{a:{value:1.234567890123,low:1,high:2,size:100}}}],series:[{id:'a',label:'A'}],motion:false}));expect(html).toContain('1.234567890123');expect(html).toContain('A size');expect(html).toContain('A low');}
 expect(()=>renderToString(createElement(CartesianChart,{label:' ',data,series}))).toThrow();expect(()=>renderToString(createElement(XYLineChart,{label:'A',data,series:[{id:'a',label:'A',mark:'invalid'}as unknown as CartesianSeries]}))).toThrow();
 for(const malformed of[{height:null},{hiddenSeriesIds:null}])expect(()=>renderToString(createElement(CartesianChart,{label:'A',data,series,...malformed}as unknown as CartesianChartProps))).toThrow();
});
