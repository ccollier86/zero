/** Isolated Arc proportions fixtures; synthetic values only, no app config/providers/DB/network. */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { DonutChart } from "../donut-chart/donut-chart";
import { WaffleChart } from "../waffle-chart/waffle-chart";
import { Gauge } from "../gauge/gauge";
import { ActivityHeatmap } from "./activity-heatmap";
const initial=[{id:"alpha",label:"Alpha",value:80},{id:"beta",label:"Beta",value:20}];
const days=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),count:i%9}));
let patch: (kind: string) => void;
const events:string[]=[];
function Fixture(){
 const [data,setData]=React.useState(initial),[calendar,setCalendar]=React.useState(days),[value,setValue]=React.useState(65),[hidden,setHidden]=React.useState<string[]>([]),[selected,setSelected]=React.useState<string|null>(null),[date,setDate]=React.useState<string|null>(null),[custom,setCustom]=React.useState("default"),[enabled,setEnabled]=React.useState(true);
 patch=kind=>flushSync(()=>{if(kind==="empty"){setData([]);setCalendar([]);setValue(0);}else if(kind==="retarget"){setData([{...initial[0]!,value:20},{...initial[1]!,value:80}]);setValue(95);}else if(kind==="retire"){setData([{id:"gamma",label:"Gamma",value:50}]);setCalendar([{date:"2026-04-01",count:0}]);}else if(kind==="custom")setCustom("custom");else if(kind==="hide")setCustom("hide");else if(kind==="motion-off")setEnabled(false);else if(kind==="reset"){setData(initial);setCalendar(days);setValue(65);setCustom("default");}});
 return <main><h1>Arc proportions chart fixture</h1><div className="fixtures">
 <section className="card"><h2>Donut</h2><DonutChart data={data} label="Traffic share" activeId={selected} onActiveChange={id=>{setSelected(id);events.push("select:"+id);}} hiddenIds={hidden} onHiddenIdsChange={ids=>{setHidden(ids);events.push("hidden:"+ids.join(","));}} motion={enabled}/></section>
 <section className="card"><h2>Waffle</h2><WaffleChart data={data} label="Energy sources" onActiveChange={id=>events.push("waffle:"+id)} motion={enabled} renderCategoryTooltip={custom==="default"?undefined:custom==="hide"?()=>null:ctx=><span data-testid="custom-waffle">Custom {ctx.category.label}: {ctx.value}</span>}/></section>
 <section className="card"><h2>Gauge</h2><Gauge value={value} label="Capacity" detail="Synthetic capacity" motion={enabled} thresholds={[{from:50,tone:"warning",label:"Busy"},{from:90,tone:"danger",label:"Full"}]}/></section>
 <section className="card"><h2>Activity</h2><ActivityHeatmap days={calendar} label="Daily activity" period="2026" selectedDate={date} onSelectDate={next=>{setDate(next);events.push("day:"+next);}} motion={enabled} renderDayTooltip={custom==="default"?undefined:custom==="hide"?()=>null:ctx=><span data-testid="custom-day">Custom {ctx.date}: {ctx.count}</span>}/></section>
 </div></main>;
}
const root=createRoot(document.getElementById("root")!);flushSync(()=>root.render(<Fixture/>));
Object.assign(window,{__arcProportions:{patch:(kind:string)=>patch(kind),events,unmount:()=>flushSync(()=>root.unmount())}});
declare global { interface Window { __arcProportions: {patch:(kind:string)=>void;events:string[];unmount:()=>void} } }
