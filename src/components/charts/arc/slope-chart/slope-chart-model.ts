/**
 * Pure Arc Free (MIT), copyright 2026 Elia Kuratli, slope model and grouped
 * collision layout. Preserves signed values and stable input-order ties.
 */
import { ARC_DISTRIBUTION_LIMITS as LIMITS, ownArray, ownNumber, ownRecord, ownString, uniqueId, requireKeys, optionNumber } from "../streamgraph/distribution-admission";
export interface SlopeItem {
  /** Stable identity. An item keeps its line across datasets, so switching morphs it. */
  id: string;
  /** Name beside the start value, in the tooltip, and in the table. */
  label: string;
  /** Value in the first period. */
  start: number;
  /** Value in the second period. */
  end: number;
}


export interface SlopeRow { item: SlopeItem; y0:number; y1:number; l0:number; l1:number; rank0:number; rank1:number; order:number }
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
/** Detach bounded signed measurements; delta must also remain representable. */
export function buildSlopeModel(input: readonly SlopeItem[]): SlopeItem[] {
 const ids=new Set<string>(); return Object.freeze(ownArray(input,LIMITS.slopeItems,"Slope data").map(value=>{
 const r=ownRecord(value,"Slope item"); requireKeys(r,["id","label","start","end"],"Slope item");
 const start=ownNumber(r.start,"Slope start"),end=ownNumber(r.end,"Slope end");
 return Object.freeze({id:uniqueId(r.id,ids,"Slope id"),label:ownString(r.label,"Slope label"),start,end});
 })) as unknown as SlopeItem[];
}
/** Moves labels apart just enough to stop overlaps: touching labels form a group centred on where its members want to be. */
export function spreadSlopeLabels(wanted: number[], gap: number, low: number, high: number): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  let groups = order.map(entry => ({ members: [entry], top: entry.y }));
  for (let changed = true; changed;) {
    changed = false;
    const next: typeof groups = [];
    for (const group of groups) {
      const prev = next[next.length - 1];
      if (prev && prev.top + prev.members.length * gap > group.top) {
        const members = [...prev.members, ...group.members];
        next[next.length - 1] = { members, top: members.reduce((sum, member, k) => sum + member.y - k * gap, 0) / members.length };
        changed = true;
      } else next.push(group);
    }
    groups = next.map(group => ({ ...group, top: clamp(group.top, low, Math.max(low, high - (group.members.length - 1) * gap)) }));
  }
  const out = new Array<number>(wanted.length);
  groups.forEach(group => group.members.forEach((member, k) => { out[member.index] = group.top + k * gap; }));
  return out;
}


/** Compute value-aligned dots plus collision-free labels for both moments. */
export function computeSlopeLayout(data: readonly SlopeItem[], options: {width:number;height?:number;ranks?:boolean}) {
 const width=optionNumber(options.width,0,0,16384,"Slope width");
 const plotHeight=optionNumber(options.height,Math.max(200,data.length*44),160,4096,"Slope height");
 const narrow=width<440, leftRoom=narrow?(width<300?116:132):168, rightRoom=options.ranks!==false?(narrow?76:96):(narrow?52:64);
 // Preserve the reference's rooms normally; scale them down in a collapsed/narrow host.
 const scale=Math.min(1,width/(leftRoom+rightRoom+40));
 const x0=leftRoom*scale,x1=Math.max(x0,width-rightRoom*scale);
 const values=data.flatMap(i=>[i.start,i.end]); let lo=Math.min(...values),hi=Math.max(...values);
 if(!Number.isFinite(lo)){lo=0;hi=1;} if(hi===lo){lo-=1;hi+=1;}
 const yOf=(v:number)=>14+(1-(v-lo)/(hi-lo))*(plotHeight-28);
 const rankOf=(field:"start"|"end")=>{const sorted=[...data].sort((a,b)=>b[field]-a[field]);return (i:SlopeItem)=>sorted.indexOf(i)+1;};
 const r0=rankOf("start"),r1=rankOf("end");
 const labelGap=Math.min(20,(plotHeight-16)/Math.max(1,data.length-1));
 const l0=spreadSlopeLabels(data.map(i=>yOf(i.start)),labelGap,8,plotHeight-8),l1=spreadSlopeLabels(data.map(i=>yOf(i.end)),labelGap,8,plotHeight-8);
 const rows:SlopeRow[]=data.map((item,i)=>({item,y0:yOf(item.start),y1:yOf(item.end),l0:l0[i]!,l1:l1[i]!,rank0:r0(item),rank1:r1(item),order:0}));
 const byEnd=[...rows].sort((a,b)=>a.rank1-b.rank1); byEnd.forEach((r,i)=>{r.order=i;});
 return {rows,byEnd,x0,x1,narrow,plotHeight,lo,hi};
}
