/** SSR-safe chart organisms expose exact complete accessible data; no browser/data clients are required. */
import { expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DonutChart } from "../donut-chart/donut-chart";
import { WaffleChart } from "../waffle-chart/waffle-chart";
import { Gauge } from "../gauge/gauge";
import { ActivityHeatmap } from "./activity-heatmap";
import { buildActivityHeatmapModel } from "./activity-heatmap-model";
import { buildDonutModel } from "../donut-chart/donut-chart-model";
import { buildWaffleModel } from "../waffle-chart/waffle-chart-model";
import { buildGaugeModel } from "../gauge/gauge-model";
const parts=[{id:"a",label:"Alpha",value:80},{id:"b",label:"Beta",value:20}];
test("Donut SSR includes exact unfolded data and stable legend actions",()=>{
 const html=renderToStaticMarkup(<DonutChart data={parts} label="Parts" motion={false}/>);expect(html).toContain('data-slot="donut-chart"');expect(html).toContain("<caption>Parts</caption>");expect(html).toContain("Alpha, 80, 80%");expect(html).not.toContain("<script");
 const other=renderToStaticMarkup(<DonutChart data={[...parts,{id:"c",label:"Gamma",value:1},{id:"d",label:"Delta",value:1}]} label="Grouped"/>);expect(other).toContain("Gamma (Other)");expect(other).toContain("Delta (Other)");
});
test("Waffle SSR keeps complete exact allocation table and keyboard grid before measurements",()=>{
 const html=renderToStaticMarkup(<WaffleChart data={parts} label="Sources" motion={false}/>);expect(html).toContain('data-slot="waffle-chart"');expect(html).toContain('aria-roledescription="waffle chart"');expect(html).toContain("<caption>Sources</caption>");expect(html).toContain("<td>80</td>");expect(html).toContain("<td>20</td>");expect(html).not.toContain("NaN");
});
test("Gauge SSR meter names actual raw range, clipped percent and threshold",()=>{
 const html=renderToStaticMarkup(<Gauge label="Capacity" value={150} thresholds={[{from:80,tone:"danger",label:"High"}]} motion={false}/>);expect(html).toContain('role="meter"');expect(html).toContain('aria-valuenow="100"');expect(html).toContain('aria-valuetext="100%, High"');expect(html).toContain("Capacity: 150 of 100, High");
});
test("UTC heatmap SSR includes missing-date zeros and a complete accessible table",()=>{
 const html=renderToStaticMarkup(<ActivityHeatmap days={[{date:"2026-03-07",count:2},{date:"2026-03-09",count:3}]} label="Activity" period="March" motion={false}/>);expect(html).toContain('data-slot="activity-heatmap"');expect(html).toContain("<caption>Activity</caption>");expect(html).toContain("2026-03-08");expect(html).toContain("No contributions");expect(html).toContain("5 contributions in March");expect(html).not.toContain("Invalid Date");
});
test("chart names/labels are escaped and empty data remains a truthful named region",()=>{
 const html=renderToStaticMarkup(<DonutChart data={[{id:"x",label:"<script>bad</script>",value:2}]} label="Safe"/>);expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");expect(html).not.toContain("<script>");
 expect(renderToStaticMarkup(<WaffleChart data={[]} label="Empty"/>)).toContain("No data");expect(renderToStaticMarkup(<DonutChart data={[]} label="Empty"/>)).toContain("No data yet");
});
test("all four array admissions reject accessor methods, own symbols and custom prototypes without execution",()=>{
 for(const [name,run] of [["Donut",(x:unknown[])=>buildDonutModel(x as any)],["Waffle",(x:unknown[])=>buildWaffleModel(x as any)],["Gauge",(x:unknown[])=>buildGaugeModel(0,0,100,x as any)],["Activity Heatmap",(x:unknown[])=>buildActivityHeatmapModel(x as any)]] as const){
  let calls=0;const accessor:unknown[]=[];Object.defineProperty(accessor,"map",{get(){calls++;throw Error("must not run");}});expect(()=>run(accessor)).toThrow(name);expect(calls).toBe(0);
  const custom:unknown[]=[];Object.setPrototypeOf(custom,Object.create(Array.prototype,{map:{get(){calls++;throw Error("must not run");}}}));expect(()=>run(custom)).toThrow(name);expect(calls).toBe(0);
  const symbol:unknown[]=[];Object.defineProperty(symbol,Symbol.iterator,{get(){calls++;throw Error("must not run");}});expect(()=>run(symbol)).toThrow(name);expect(calls).toBe(0);
 }
});
