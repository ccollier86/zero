'use client';
/** Arbitrary-matrix SVG organism, retaining absent/null/zero distinctions. Zero owns portals and presentation lifecycle. */
import{useMemo,type ReactNode,type CSSProperties}from"react";
import{motion}from"motion/react";
import{chartAxisText,sampleChartTicks,fitChartText}from"../shared/chart-text-layout";
import{ChartAxisLabel}from"../shared/chart-axis-text";
import{NativeChartFrame,NativeChartInspector,NativeChartDataTable,nativeColor}from"../shared/native-chart";
import{buildMatrixHeatmapModel,type MatrixHeatmapInput,type MatrixHeatmapCell,type MatrixHeatmapModel}from"./matrix-heatmap-model";
import{statFraction}from"./statistical-admission";
import{useStatisticalPlot,StatisticalCategoryLabels,StatisticalReveal,StatisticalInspectorRows,type StatisticalChartProps}from"./statistical-plot";
export interface MatrixHeatmapTooltipContext{cell:MatrixHeatmapCell;model:MatrixHeatmapModel}
export interface MatrixHeatmapProps extends StatisticalChartProps{data:MatrixHeatmapInput;renderTooltip?:(context:MatrixHeatmapTooltipContext)=>ReactNode}
/** Arrow up/down moves one matrix row. Missing cells remain inspectable and are never painted as measured zero. */
export function MatrixHeatmap(props:MatrixHeatmapProps){
 const model=useMemo(()=>buildMatrixHeatmapModel(props.data),[props.data]),plot=useStatisticalPlot(model.cells.map(cell=>cell.id),props,Math.max(1,model.columns.length)),{bounds,activeId,format}=plot,cellWidth=model.columns.length?bounds.innerWidth/model.columns.length:0,cellHeight=model.rows.length?bounds.innerHeight/model.rows.length:0,active=model.cells.find(cell=>cell.id===activeId),custom=active?props.renderTooltip?.({cell:active,model}):undefined;
 const content=active?(custom===undefined?<StatisticalInspectorRows title={model.rows[active.row]!.label+" · "+model.columns[active.column]!.label}value={active.present?format(active.value!):"No measure"}rows={[["State",active.present?"Measured":"Missing"]]}/>:custom):null;
 return<NativeChartFrame label={props.label}title={props.title}subtitle={props.subtitle}className={props.className}motion={props.motion}summary={`${model.present} measured cells and ${model.missing} missing cells.`}footer={<span>{model.present} measured · {model.missing} missing</span>}>
  <div {...plot.stageProps}className="zero-native-statistical-plot"data-statistical-chart="matrix-heatmap"data-motion={plot.environment.reduced?"off":"on"}>
   <svg width="100%"height={bounds.height}viewBox={`0 0 ${bounds.width} ${bounds.height}`}aria-hidden="true"><StatisticalReveal ready={plot.environment.inView}reduced={plot.environment.reduced}>{model.cells.map(cell=>{const x=bounds.left+cell.column*cellWidth,y=bounds.top+cell.row*cellHeight,percentage=cell.present?12+statFraction(cell.value!,model.domain)*68:0;return<g key={cell.id}data-mark-id={cell.id}data-missing={!cell.present||undefined}{...plot.activate(cell.id)}><motion.rect className="zero-native-statistical-cell"data-active={cell.id===activeId||undefined}initial={false}animate={{attrX:x+1,attrY:y+1,width:Math.max(0,cellWidth-2),height:Math.max(0,cellHeight-2)}}transition={plot.transition}rx={3}style={{"--statistical-color":nativeColor(cell.value!==null&&cell.value<0?1:0),"--statistical-tint":percentage+"%"}as CSSProperties}/>{cellWidth>=45&&cellHeight>=22&&<text className="zero-native-statistical-cell-value"x={x+cellWidth/2}y={y+cellHeight/2+4}textAnchor="middle">{fitChartText(cell.present?format(cell.value!):"—",Math.max(0,cellWidth-8)/1.12,plot.textMetrics)}<title>{cell.present?format(cell.value!):"—"}</title></text>}</g>;})}</StatisticalReveal>{sampleChartTicks(model.rows.map((row,index)=>({row,index})),Math.floor(bounds.innerHeight/(plot.textMetrics.fontSize*1.35+6))+1).map(({row,index})=><ChartAxisLabel key={row.id} className="zero-native-statistical-label" value={chartAxisText(row.label,bounds.left-6,bounds.top+(index+.5)*cellHeight+plot.textMetrics.fontSize*.35,"end",bounds.left-12,plot.textMetrics)}/>)}<StatisticalCategoryLabels bounds={bounds} metrics={plot.textMetrics} values={model.columns.map((column,index)=>({id:column.id,label:column.label,position:(index+.5)*cellWidth}))}/></svg>
   {model.cells.length===0&&<div className="zero-native-statistical-empty">No matrix axes yet</div>}
   <NativeChartInspector open={!!active&&bounds.innerWidth>0&&plot.environment.visible}point={active?[bounds.left+(active.column+.5)*cellWidth,bounds.top+(active.row+.5)*cellHeight]:[0,0]}content={content}onDismiss={()=>plot.select(null)}/>
   <span className="zero-native-statistical-sr"aria-live="polite">{active?`${model.rows[active.row]!.label}, ${model.columns[active.column]!.label}, ${active.present?format(active.value!):"missing"}`:""}</span>
  </div>
  {<NativeChartDataTable label={props.label}columns={["Row","Column","Value","State"]}rows={model.cells.map(cell=>[model.rows[cell.row]!.label,model.columns[cell.column]!.label,cell.present?cell.value:"—",cell.present?"Measured":"Missing"])}/>}
 </NativeChartFrame>;
}
