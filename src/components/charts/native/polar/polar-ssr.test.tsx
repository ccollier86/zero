import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {RadarChart} from './radar-chart';import {RadialBarChart} from './radial-bar-chart';import {PieChart} from './pie-chart';import {SunburstChart} from './sunburst-chart';
test('Every polar keyboard focus owner describes a persistent exact live readout independently of custom tooltips',()=>{
 const elements=[
  <PieChart label="Pie" data={[{id:'a',label:'Alpha',value:.125}]} defaultActiveId="a" renderTooltip={()=>null}/>,
  <RadialBarChart label="Ring" data={[{id:'a',label:'Alpha',value:.125,max:.1}]} defaultActiveId="a" renderTooltip={()=>null}/>,
  <RadarChart label="Radar" axes={[{id:'a',label:'First axis',max:.1},{id:'b',label:'Second axis',max:1},{id:'c',label:'Third axis',max:1}]} profiles={[{id:'a',label:'Alpha',values:[{id:'a',value:.125},{id:'b',value:.25},{id:'c',value:.75}]}]} defaultActiveId="a" renderTooltip={()=>null}/>,
  <SunburstChart label="Tree" data={{id:'root',label:'Whole',children:[{id:'a',label:'Alpha',value:.125}]}} defaultActiveId="a" renderTooltip={()=>null}/>,
 ];
 for(const element of elements){
  const html=renderToStaticMarkup(element);
  const readout=html.match(/<div id="([^"]+)" class="zero-native-chart__sr" aria-live="polite" aria-atomic="true" data-polar-readout="true">([^<]*)<\/div>/);
  expect(readout).not.toBeNull();expect(html).toContain(`aria-describedby="${readout![1]}"`);
  expect(readout![2]).toContain('Alpha');expect(readout![2]).toContain(': 0.125');expect(html).toContain('>0.125<');
  expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
 }
 const empty=renderToStaticMarkup(<RadialBarChart label="Empty" data={[]} renderTooltip={()=>null}/>);
 expect(empty).toContain('data-polar-readout="true">No range data.</div>');
});
test('Native polar organisms SSR real solid geometry and exact full data companions without a browser',()=>{
 const pie=renderToStaticMarkup(<PieChart label="Revenue share" data={[{id:'a',label:'Alpha',value:65},{id:'b',label:'Beta',value:35}]} hiddenIds={['a']} motion={false}/>);expect(pie).toContain('Revenue share: exact values');expect(pie).toContain('Alpha');expect(pie).toContain('>65<');expect(pie).toContain('data-polar-kind="pie"');expect(pie).toContain('Hidden');expect(pie).not.toMatch(/NaN|Infinity/);
 const rings=renderToStaticMarkup(<RadialBarChart label="Ranges" data={[{id:'a',label:'Alpha',value:30,min:10,max:20}]} motion={false}/>);expect(rings).toContain('Clipped to range');expect(rings).toContain('>30<');expect(rings).toContain('Raw fraction of range');
 const radar=renderToStaticMarkup(<RadarChart label="Profiles" axes={[{id:'a',label:'A',max:10},{id:'b',label:'B',max:20},{id:'c',label:'C',max:30}]} profiles={[{id:'one',label:'One',values:[{id:'a',value:12},{id:'b',value:4},{id:'c',value:5}]}]} motion={false}/>);expect(radar).toContain('Clipped to axis range');expect(radar).toContain('>12<');
 const hierarchy=renderToStaticMarkup(<SunburstChart label="Hierarchy" data={{id:'root',label:'Whole',children:[{id:'a',label:'Alpha',value:3},{id:'b',label:'Beta',value:7}]}} rootId="a" motion={false}/>);expect(hierarchy).toContain('complete exact hierarchy');expect(hierarchy).toContain('Derived from children');expect(hierarchy).toContain('>Beta<');expect(hierarchy).toContain('aria-current="location"');expect(hierarchy).not.toMatch(/NaN|Infinity/);
});
