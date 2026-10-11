/** Pure Cartesian keyboard policy over an admitted model. Owns eligible measurement traversal; no hooks, DOM or data transport. */
import{assertAdmittedCartesianModel}from'./cartesian-model';
import type{CartesianActive,CartesianModel,CartesianModelDatum}from'./cartesian-types';

/** Resolve a keyboard request without clearing selection on missing cells. Undefined means the key is not handled. */
export function cartesianKeyboardTarget(model:CartesianModel,active:CartesianActive|null,key:string):CartesianActive|null|undefined{
 assertAdmittedCartesianModel(model);
 if(key==='Escape')return null;
 const horizontal=model.layout==='horizontal',forward=horizontal?'ArrowDown':'ArrowRight',back=horizontal?'ArrowUp':'ArrowLeft',nextSeries=horizontal?'ArrowRight':'ArrowDown',previousSeries=horizontal?'ArrowLeft':'ArrowUp';
 if(![forward,back,nextSeries,previousSeries,'Home','End'].includes(key))return undefined;
 const data=model.data.filter(datum=>datum.coordinate>=model.window[0]&&datum.coordinate<=model.window[1]);
 if(!data.length||!model.visibleSeries.length)return null;
 const index=active?data.findIndex(datum=>datum.id===active.datumId):-1;
 const current=data[index]??data[0]!;
 if(key===nextSeries||key===previousSeries){
  const available=model.visibleSeries.filter(series=>current.cells[series.id]!.value!==null);
  if(!available.length)return{datumId:current.id};
  const at=available.findIndex(series=>series.id===active?.seriesId),delta=key===nextSeries?1:-1;
  const target=at<0?(delta>0?0:available.length-1):(at+delta+available.length)%available.length;
  return{datumId:current.id,seriesId:available[target]!.id};
 }
 const selected=model.visibleSeries.find(series=>series.id===active?.seriesId);
 const eligible=(datum:CartesianModelDatum)=>!selected||datum.cells[selected.id]!.value!==null;
 const candidates=data.map((datum,index)=>({datum,index})).filter(({datum})=>eligible(datum));
 if(!candidates.length)return{datumId:current.id};
 const target=key==='Home'?candidates[0]!:key==='End'?candidates[candidates.length-1]!:key===forward?(candidates.find(candidate=>candidate.index>index)??candidates[candidates.length-1]!):([...candidates].reverse().find(candidate=>index<0||candidate.index<index)??candidates[0]!);
 return{datumId:target.datum.id,...(selected?{seriesId:selected.id}:{})};
}
