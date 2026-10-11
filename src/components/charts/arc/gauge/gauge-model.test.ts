/** Gauge truthful domain, named bands and arc geometry; no DOM globals. */
import { expect,test } from "bun:test";
import { buildGaugeModel,gaugeArcPath } from "./gauge-model";
test("Gauge uses genuine range and exact threshold identity, clipping only visible sweep",()=>{
 const model=buildGaugeModel(75,0,100,[{from:50,tone:"warning",label:"Busy"},{from:90,tone:"danger",label:"Full"}]);expect(model.percentage).toBe(.75);expect(model.band?.label).toBe("Busy");expect(model.value).toBe(75);
 expect(buildGaugeModel(150).percentage).toBe(1);expect(buildGaugeModel(-50).percentage).toBe(0);expect(buildGaugeModel(0,-100,100).percentage).toBe(.5);
 expect(gaugeArcPath(1)).toContain("A 42 42 0 1 1");expect(gaugeArcPath(.5)).not.toMatch(/NaN|Infinity/);
});
test("Gauge rejects invented/invalid ranges, duplicate bands and unsafe values",()=>{
 for(const [value,min,max]of [[NaN,0,100],[1,10,10],[Infinity,0,100],[1,5,3],[1e13,0,100]])expect(()=>buildGaugeModel(value!,min!,max!)).toThrow("Gauge");
 expect(()=>buildGaugeModel(10,0,100,[{from:50,tone:"warning",label:"A"},{from:50,tone:"danger",label:"B"}])).toThrow("Gauge");
 expect(()=>buildGaugeModel(10,0,100,[{from:-1,tone:"warning",label:"A"}])).toThrow("Gauge");
});
