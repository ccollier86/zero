/** Strict UTC calendar and bounded exact activity counts; no wall clock or data transport. */
import { expect,test } from "bun:test";
import { buildActivityHeatmapModel,parseActivityDate,activityDateISO } from "./activity-heatmap-model";
test("strict Gregorian UTC dates reject rollover and ambiguous inputs",()=>{
 expect(activityDateISO(parseActivityDate("2024-02-29"))).toBe("2024-02-29");
 for(const date of ["2025-02-29","2026-02-30","2026-13-01","2026-01-32","2026-1-01","2026-01-01T01:00Z","0000-01-01"])expect(()=>parseActivityDate(date)).toThrow("Activity Heatmap");
});
test("missing days are zero, duplicate observations sum, and UTC weeks remain exact across DST",()=>{
 const model=buildActivityHeatmapModel([{date:"2026-03-07",count:2},{date:"2026-03-09",count:3},{date:"2026-03-07",count:1}],1);expect(model.length).toBe(3);expect(model.counts).toEqual([3,0,3]);expect(model.total).toBe(6);expect(model.perLevel.reduce((a,b)=>a+b,0)).toBe(3);expect(Object.isFrozen(model.counts)).toBe(true);
});
test("all-zero and empty calendars are truthful and deterministic",()=>{
 const empty=buildActivityHeatmapModel([]);expect(empty.length).toBe(0);expect(empty.weeks).toBe(0);expect(empty.total).toBe(0);expect(activityDateISO(empty.start)).toBe("2025-01-01");
 const model=buildActivityHeatmapModel([{date:"2026-01-01",count:0}]);expect(model.levels).toEqual([0]);expect(model.thresholds).toEqual([1,2,3]);
});
test("calendar bounds reject excessive ranges, nonintegral counts, bad thresholds and accessor objects",()=>{
 expect(()=>buildActivityHeatmapModel([{date:"2000-01-01",count:1},{date:"2026-01-01",count:1}])).toThrow("Activity Heatmap");
 for(const count of [-1,.5,Infinity,NaN,1e13])expect(()=>buildActivityHeatmapModel([{date:"2026-01-01",count}])).toThrow("Activity Heatmap");
 expect(()=>buildActivityHeatmapModel([],0,[3,2,1])).toThrow("Activity Heatmap");
 expect(()=>buildActivityHeatmapModel([{date:"2026-01-01",get count(): number {throw Error("getter ran");}}])).toThrow("Activity Heatmap");
});
