'use client';
/** Signed balance SVG organism. Contribution/total/subtotal marks share exact model semantics and Zero inspectors. */
import{useMemo,type ReactNode}from"react";
import{motion}from"motion/react";
import{NativeChartFrame,NativeChartInspector,NativeChartDataTable,nativeColor}from"../shared/native-chart";
import{buildWaterfallModel,type WaterfallStep,type WaterfallRow,type WaterfallModel}from"./waterfall-model";
import{statisticalBar,statisticalY}from"./statistical-geometry";
import{useStatisticalPlot,StatisticalGrid,StatisticalReveal,StatisticalBar,StatisticalInspectorRows,type StatisticalChartProps}from"./statistical-plot";
export interface WaterfallTooltipContext{row:WaterfallRow;model:WaterfallModel}
export interface WaterfallChartProps extends StatisticalChartProps{steps:readonly WaterfallStep[];startingValue?:number;renderTooltip?:(context:WaterfallTooltipContext)=>ReactNode}
/** Subtotals snapshot the running balance; absolute totals reset it. Signed contributions remain signed in every readout. */
export function WaterfallChart(props:WaterfallChartProps){
 const model=useMemo(()=>buildWaterfallModel(props.steps,props.startingValue),[props.steps,props.startingValue]),plot=useStatisticalPlot(model.rows.map(row=>row.id),props),{bounds,activeId,format}=plot,active=model.rows.find(row=>row.id===activeId),index=active?model.rows.indexOf(active):-1,rect=active?statisticalBar(active.start,active.end,index,model.rows.length,model.domain,bounds):null,custom=active?props.renderTooltip?.({row:active,model}):undefined;
 const content=active?(custom===undefined?<StatisticalInspectorRows title={active.label}value={format(active.value)}rows={[["Kind",active.kind],["From / to",format(active.start)+" / "+format(active.end)],["Running balance",format(active.balance)]]}/>:custom):null;
 return<NativeChartFrame label={props.label}title={props.title}subtitle={props.subtitle}className={props.className}motion={props.motion}summary={`Balance starts at ${format(model.startingValue)} and ends at ${format(model.endingValue)}; totals explicitly reset balance.`}footer={<span>Opening {format(model.startingValue)} · Closing {format(model.endingValue)}</span>}>
  <div {...plot.stageProps}className="zero-native-statistical-plot"data-statistical-chart="waterfall"data-motion={plot.environment.reduced?"off":"on"}>
   <svg width="100%"height={bounds.height}viewBox={`0 0 ${bounds.width} ${bounds.height}`}aria-hidden="true"><StatisticalGrid bounds={bounds}domain={model.domain}format={format}/><StatisticalReveal ready={plot.environment.inView}reduced={plot.environment.reduced}>{model.rows.map((row,i)=>{const r=statisticalBar(row.start,row.end,i,model.rows.length,model.domain,bounds),color=row.kind==="total"?nativeColor(1):row.kind==="subtotal"?nativeColor(0):row.value>=0?"var(--zero-chart-positive, var(--success, #0f9c86))":"var(--zero-chart-negative, var(--destructive, #d9485f))",next=model.rows[i+1];return<g key={row.id}data-mark-id={row.id}data-step-kind={row.kind}{...plot.activate(row.id)}><StatisticalBar rect={r}color={color}active={row.id===activeId}transition={plot.transition}/><motion.line className="zero-native-statistical-edge"initial={false}animate={{x1:r.x,x2:r.x+r.width,y1:statisticalY(row.end,model.domain,bounds),y2:statisticalY(row.end,model.domain,bounds)}}transition={plot.transition}style={{stroke:color}}/>{next&&next.kind==="contribution"&&<motion.line className="zero-native-statistical-connector"initial={false}animate={{x1:r.x+r.width,x2:statisticalBar(next.start,next.end,i+1,model.rows.length,model.domain,bounds).x,y1:statisticalY(row.balance,model.domain,bounds),y2:statisticalY(row.balance,model.domain,bounds)}}transition={plot.transition}/>}<rect className="zero-native-statistical-hit"x={r.x}y={bounds.top}width={r.width}height={bounds.innerHeight}/><text className="zero-native-statistical-label"x={r.x+r.width/2}y={bounds.height-12}textAnchor="middle">{row.label.slice(0,Math.max(1,Math.floor((bounds.innerWidth/model.rows.length)/7)))}</text></g>;})}</StatisticalReveal></svg>
   {!model.rows.length&&<div className="zero-native-statistical-empty">No balance changes yet</div>}
   <NativeChartInspector open={!!active&&bounds.innerWidth>0&&plot.environment.visible}point={rect?[rect.x+rect.width/2,rect.y]:[0,0]}content={content}onDismiss={()=>plot.select(null)}/>
   <span className="zero-native-statistical-sr"aria-live="polite">{active?`${active.label}, ${active.kind}, ${format(active.value)}, balance ${format(active.balance)}`:""}</span>
  </div>
  {<NativeChartDataTable label={props.label}columns={["Step","Kind","Value","From","To","Balance"]}rows={model.rows.map(row=>[row.label,row.kind,row.value,row.start,row.end,row.balance])}/>}
 </NativeChartFrame>;
}
