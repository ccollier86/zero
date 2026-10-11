/** Arbitrary matrix measures with explicit missing cells. Pure own-data admission; no date/calendar assumptions. */
import{STATISTICAL_LIMITS as L,statArray,statRecord,statNumber,statText,statId,statExtent}from"./statistical-admission";
export interface MatrixAxis{id:string;label:string}
export interface MatrixCell{id:string;rowId:string;columnId:string;value:number|null}
export interface MatrixHeatmapInput{rows:readonly MatrixAxis[];columns:readonly MatrixAxis[];cells:readonly MatrixCell[]}
export interface MatrixHeatmapCell extends Readonly<MatrixCell>{readonly row:number;readonly column:number;readonly present:boolean}
export interface MatrixHeatmapModel{readonly rows:readonly Readonly<MatrixAxis>[];readonly columns:readonly Readonly<MatrixAxis>[];readonly cells:readonly MatrixHeatmapCell[];readonly domain:readonly[number,number];readonly present:number;readonly missing:number}
/** Null and absent are missing, while finite zero is an actual measured value. Duplicate row/column pairs are rejected. */
export function buildMatrixHeatmapModel(input:MatrixHeatmapInput):MatrixHeatmapModel{
 const r=statRecord(input,"Matrix heatmap",["rows","columns","cells"]);
 const admitAxis=(values:unknown,label:string)=>{const ids=new Set<string>();return statArray(values,L.series,label).map(value=>{const axis=statRecord(value,label,["id","label"]);return Object.freeze({id:statId(axis.id,ids,label+" id"),label:statText(axis.label,label+" label")});});};
 const rows=admitAxis(r.rows,"Matrix rows"),columns=admitAxis(r.columns,"Matrix columns"),rowIndex=new Map(rows.map((v,i)=>[v.id,i])),columnIndex=new Map(columns.map((v,i)=>[v.id,i])),ids=new Set<string>(),pairs=new Map<string,MatrixCell>();
 for(const value of statArray(r.cells,L.cells,"Matrix cells")){const cell=statRecord(value,"Matrix cell",["id","rowId","columnId","value"]),id=statId(cell.id,ids,"Matrix cell id"),rowId=statText(cell.rowId,"Matrix row id",256),columnId=statText(cell.columnId,"Matrix column id",256);if(!rowIndex.has(rowId)||!columnIndex.has(columnId))throw new TypeError("Matrix cell references an unknown axis id");const key=JSON.stringify([rowId,columnId]);if(pairs.has(key))throw new TypeError("Matrix row/column pair must be unique");pairs.set(key,Object.freeze({id,rowId,columnId,value:cell.value===null?null:statNumber(cell.value,"Matrix measure")}));}
 const cells:MatrixHeatmapCell[]=[];for(let row=0;row<rows.length;row++)for(let column=0;column<columns.length;column++){const rowId=rows[row]!.id,columnId=columns[column]!.id,cell=pairs.get(JSON.stringify([rowId,columnId]));let id=cell?.id??"missing:"+JSON.stringify([rowId,columnId]);if(!cell){while(ids.has(id))id="missing:"+id;ids.add(id);}cells.push(Object.freeze({...cell,id,rowId,columnId,value:cell?.value??null,row,column,present:cell?.value!==null&&cell?.value!==undefined}));}
 const values=cells.filter(cell=>cell.present).map(cell=>cell.value!),domain=Object.freeze(statExtent(values));return Object.freeze({rows:Object.freeze(rows),columns:Object.freeze(columns),cells:Object.freeze(cells),domain,present:values.length,missing:cells.length-values.length});
}
