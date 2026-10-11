/** Isolated numerical/SSR qualification; no app configuration, provider, query or real database. */
import { expect,test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { buildLineChartModel,computeLineChartCurve,computeLineChartScale,lineChartValueAt } from './line-chart-model';
import { buildBarChartModel,computeBarChartScale,computeBarChartPath } from '../bar-chart/bar-chart-model';
import { buildSparklineModel,computeSparklineCurve,computeSparklineGeometry } from '../sparkline/sparkline-model';
import { buildBrushChartModel,fitBrushChartRange,computeBrushChartTimeTicks,computeBrushChartLinePath } from '../brush-chart/brush-chart-model';
import { LineChart } from './line-chart';
import { BarChart } from '../bar-chart/bar-chart';
import { Sparkline } from '../sparkline/sparkline';
import { BrushChart } from '../brush-chart/brush-chart';
import { ownChartArray,chartWindow } from './cartesian-admission';
const series=[{id:'one',label:'One'},{id:'two',label:'Two'}];
const dates=Array.from({length:12},(_,index)=>({date:Date.UTC(2026,0,index+1),value:index+10}));
test('line model detaches values and explicitly fills own missing observations with zero',()=>{
 const data=[{id:'a',label:'A',values:{one:3}}];const model=buildLineChartModel(data,series);data[0]!.values.one=99;
 expect(model.data[0]!.values).toEqual({one:3,two:0});expect(Object.isFrozen(model.data[0]!.values)).toBe(true);expect(Object.isFrozen(model.series)).toBe(true);
});
test('line admission rejects duplicate IDs, inherited values and accessor execution',()=>{
 expect(()=>buildLineChartModel([{id:'a',label:'A',values:{}}],[...series,series[0]!])).toThrow();
 expect(()=>buildLineChartModel([{id:'a',label:'A',values:Object.create({one:1})}],series)).toThrow();
 let read=0;expect(()=>buildLineChartModel([{id:'a',label:'A',values:{get one(){read++;return 1;}}}],series)).toThrow();expect(read).toBe(0);
 for(const color of ['url(https://invalid.example/image.svg)','u\\72l(https://invalid.example/image.svg)','red;fill:url(x)'])expect(()=>buildLineChartModel([],[{id:'one',label:'One',color}])).toThrow();
 expect(buildLineChartModel([],[{id:'one',label:'One',color:'color-mix(in oklab, var(--zero-chart-blue) 70%, transparent)'}]).series[0]!.color).toContain('color-mix');
});
test('presentation domain bounds reject coercion, nonfinite values, work amplification and malformed records',()=>{
 for(const value of [NaN,Infinity,1e13,'1'])expect(()=>buildBarChartModel([{id:'a',label:'A',value:value as number}])).toThrow();
 expect(()=>buildSparklineModel(new Array(2))).toThrow();expect(()=>buildSparklineModel(Array(4097).fill(0))).toThrow();expect(()=>buildLineChartModel([{id:'a',label:'A',values:{unknown:1}}],series)).toThrow();
});
test('own arrays reject method and iterator accessors without execution and detach custom prototypes',()=>{
 let reads=0;
 for(const field of ['map','some',Symbol.iterator]){
  const input=[1,2];Object.defineProperty(input,field,{get(){reads++;throw new Error('accessor executed');}});
  expect(()=>buildSparklineModel(input)).toThrow(TypeError);
 }
 const input=[1,2];const proto=Object.create(Array.prototype);
 for(const field of ['map','some',Symbol.iterator])Object.defineProperty(proto,field,{get(){reads++;throw new Error('prototype accessor executed');}});
 Object.setPrototypeOf(input,proto);
 const model=buildSparklineModel(input);expect(model.data).toEqual([1,2]);expect(Object.getPrototypeOf(model.data)).toBe(Array.prototype);expect(model.data).not.toBe(input);
 const admitted=ownChartArray(input,'values',2);expect(admitted).toEqual([1,2]);expect(reads).toBe(0);
 const window=[0,100];Object.setPrototypeOf(window,proto);expect(chartWindow(window,'range')).toEqual([0,100]);expect(fitBrushChartRange(window as [number,number],[0,200],20)).toEqual([0,100]);expect(reads).toBe(0);
});
test('brush tuple and calendar admission rejects malformed bounds without running array getters',()=>{
 for(const window of [[0],[0,1,2],[2,1],[0,NaN],[0,'1']])expect(()=>chartWindow(window,'range')).toThrow();
 let reads=0;const window=[0,100];Object.defineProperty(window,'1',{get(){reads++;return 100;}});expect(()=>chartWindow(window,'range')).toThrow();expect(reads).toBe(0);
 for(const[start,end,width]of [[NaN,0,100],[100,0,100],[0,100,Infinity],[0,100,0]])expect(()=>computeBrushChartTimeTicks(start!,end!,width!)).toThrow();
 const start=new Date(0);start.setUTCFullYear(12,0,1);const end=new Date(0);end.setUTCFullYear(12,3,1);
 const ticks=computeBrushChartTimeTicks(start.getTime(),end.getTime(),400);expect(ticks.length).toBeGreaterThan(0);expect(ticks.every(tick=>new Date(tick.t).getUTCFullYear()===12)).toBe(true);
});
test('SSR rejects absent labels, malformed presentation selectors and coercive controls before paint',()=>{
 const render=(component:typeof LineChart|typeof BarChart|typeof Sparkline|typeof BrushChart,props:unknown)=>renderToString(createElement(component as typeof LineChart,props as Parameters<typeof LineChart>[0]));
 const cases:[[typeof LineChart|typeof BarChart|typeof Sparkline|typeof BrushChart,Record<string,unknown>],...Array<[typeof LineChart|typeof BarChart|typeof Sparkline|typeof BrushChart,Record<string,unknown>]>]=[[LineChart,{data:[],series}],[BarChart,{data:[],period:'Current'}],[Sparkline,{data:[]}],[BrushChart,{data:[]}]];
 for(const[component,props]of cases){for(const label of [undefined,null,2,'','  '])expect(()=>render(component,{...props,label})).toThrow();expect(()=>render(component,{...props,label:'Valid',motion:'false'})).toThrow();}
 expect(()=>render(BarChart,{data:[],label:'Bars'})).toThrow();expect(()=>render(BarChart,{data:[],label:'Bars',period:123})).toThrow();
 expect(()=>render(LineChart,{data:[],series,label:'Lines',curve:'splines'})).toThrow();expect(()=>render(LineChart,{data:[],series,label:'Lines',activeDatumId:42})).toThrow();
 expect(()=>render(Sparkline,{data:[],label:'Mini',tone:'blue'})).toThrow();expect(()=>render(Sparkline,{data:[],label:'Mini',activeIndex:1.25})).toThrow();
 expect(()=>render(BrushChart,{data:[],label:'History',range:[10,0]})).toThrow();expect(()=>render(BrushChart,{data:[],label:'History',activeDate:Infinity})).toThrow();
});
test('monotone line geometry reaches every value and never swings past adjacent data',()=>{
 const values=[0,10,2,-5,8];const points=computeLineChartCurve(values,true);
 for(const[x,value]of points){const index=Math.min(values.length-2,Math.floor(x*(values.length-1)));expect(value).toBeGreaterThanOrEqual(Math.min(values[index]!,values[index+1]!)-1e-8);expect(value).toBeLessThanOrEqual(Math.max(values[index]!,values[index+1]!)+1e-8);}
 for(let index=0;index<values.length;index++)expect(lineChartValueAt(points,index/(values.length-1))).toBeCloseTo(values[index]!);
 expect(computeLineChartCurve([4],true)).toEqual([[0,4],[1,4]]);expect(computeLineChartScale(-5,8).ticks.every(Number.isFinite)).toBe(true);
 for(const[low,high]of [[1e12-0.0001220703125,1e12],[-1e12,-1e12+0.0001220703125],[-1e12,1e12],[0,Number.MIN_VALUE]]){const scale=computeLineChartScale(low!,high!);expect(scale.ticks.length).toBeLessThanOrEqual(5);expect(scale.ticks.every(Number.isFinite)).toBe(true);}
});
test('bar model retains exact noninteger averages and bounded column geometry',()=>{
 const model=buildBarChartModel([{id:'a',label:'A',value:1.2},{id:'b',label:'B',value:2.4}]);expect(model.average).toBeCloseTo(1.8);expect(model.total).toBeCloseTo(3.6);expect(computeBarChartScale(0).top).toBeGreaterThan(0);
 expect(computeBarChartPath(0,28,100,176)).not.toMatch(/NaN|Infinity/);expect(()=>buildBarChartModel([{id:'a',label:'A',value:-1}])).toThrow();
});
test('sparkline preserves empty/single/flat datasets without synthesizing observations',()=>{
 expect(buildSparklineModel([]).data).toEqual([]);expect(computeSparklineCurve([])).toEqual([]);expect(computeSparklineGeometry([],160,52,0).fill).toBe('');expect(computeSparklineCurve([9])).toEqual([[0,.5],[1,.5]]);
 expect(computeSparklineCurve([4,4,4]).every(([,y])=>y===.5)).toBe(true);expect(()=>buildSparklineModel([1,2],['onlyone'])).toThrow();
});
test('brush admission copies mutable Dates, rejects unsorted/duplicate epochs and bounds event work',()=>{
 const date=new Date(dates[0]!.date);const model=buildBrushChartModel([{date,value:3},{date:dates[1]!.date,value:4}]);date.setUTCFullYear(1990);expect(model.data[0]!.date).toBe(dates[0]!.date);
 expect(()=>buildBrushChartModel([dates[1]!,dates[0]!])).toThrow();expect(()=>buildBrushChartModel([dates[0]!,dates[0]!])).toThrow();expect(()=>buildBrushChartModel([{date:new Date(NaN),value:1}])).toThrow();
 expect(()=>buildBrushChartModel(dates,[{date:dates[0]!.date,label:'A'},{date:dates[0]!.date,label:'B'}])).toThrow();
});
test('brush windows clamp to actual bounds and extreme calendar tick work remains bounded',()=>{
 expect(fitBrushChartRange([-100,40],[0,100],20)).toEqual([0,100]);expect(fitBrushChartRange([90,92],[0,100],20)).toEqual([80,100]);expect(fitBrushChartRange([0,1],[0,0],7)).toEqual([0,0]);
 expect(computeBrushChartTimeTicks(-8e15,8e15,400).length).toBeLessThanOrEqual(6);
});
test('brush minmax decimation preserves spikes from dense observations',()=>{
 const points=Array.from({length:1000},(_,t)=>({t,value:t===455?100:1}));const path=computeBrushChartLinePath(points,0,points.length,t=>t/100,value=>value,10);expect(path).toContain('100.0');expect(path.split('L').length).toBeLessThan(30);
});
test('all four SSR companions contain exact accessible observations and no browser-only boot',()=>{
 const line=renderToString(createElement(LineChart,{data:[{id:'a',label:'Day A',values:{one:1.25}}],series,label:'Trend'}));expect(line).toContain('Day A');expect(line).toContain('1.3');expect(line).toContain('<table');
 const bar=renderToString(createElement(BarChart,{data:[{id:'a',label:'Day A',value:1.25}],label:'Bars',period:'Current',formatValue:String}));expect(bar).toContain('1.25');
 const spark=renderToString(createElement(Sparkline,{data:[1.25,2.5],labels:['First','Second'],label:'Mini',formatValue:String}));expect(spark).toContain('First');expect(spark).toContain('1.25');expect(spark).toContain('<table');
 const brush=renderToString(createElement(BrushChart,{data:dates,label:'History'}));expect(brush).toContain('History');expect(brush).toContain('Jan');expect(brush).toContain('<table');
});
