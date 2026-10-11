/** Native Cartesian data and configuration contracts. Pure presentation types; no transport or renderer authority. */
export type CartesianMark='line'|'area'|'bar'|'scatter';
export type CartesianCurve='linear'|'smooth'|'step';
export type CartesianStack='none'|'stacked'|'signed'|'percent';
/** Optional exact interval and bubble size accompany a measurement; null is an intentional missing observation. */
export interface CartesianValue {readonly value:number|null;readonly low?:number;readonly high?:number;readonly size?:number}
/** Stable datum identity is separate from its independent coordinate and display label. */
export interface CartesianDatum {readonly id:string;readonly label:string;readonly x?:string|number;readonly values:Readonly<Record<string,number|null|CartesianValue|undefined>>}
/** Series choose a mark and named numeric axis. Stack groups never cross axes. */
export interface CartesianSeries {readonly id:string;readonly label:string;readonly mark?:CartesianMark;readonly axisId?:string;readonly stackId?:string;readonly color?:string;readonly curve?:CartesianCurve;readonly connectNulls?:boolean;readonly baseline?:number;readonly bubble?:boolean;readonly dashed?:boolean}
export interface CartesianXAxis {readonly type?:'category'|'linear'|'time';readonly domain?:readonly[number,number];readonly label?:string}
export interface CartesianYAxis {readonly id:string;readonly side?:'left'|'right';readonly scale?:'linear'|'log';readonly domain?:readonly[number,number];readonly includeZero?:boolean;readonly label?:string}
export interface CartesianReference {readonly id:string;readonly axis:'x'|'y';readonly value:number;readonly axisId?:string;readonly label?:string;readonly color?:string}
export interface CartesianBand {readonly id:string;readonly axis:'x'|'y';readonly from:number;readonly to:number;readonly axisId?:string;readonly label?:string;readonly color?:string}
/** Controlled view coordinates are category indexes or numeric/time X values, never row offsets into a changing dataset. */
export interface CartesianOptions {readonly xAxis?:CartesianXAxis;readonly yAxes?:readonly CartesianYAxis[];readonly layout?:'vertical'|'horizontal';readonly stack?:CartesianStack;readonly missing?:'gap'|'zero';readonly hiddenSeriesIds?:readonly string[];readonly window?:readonly[number,number];readonly references?:readonly CartesianReference[];readonly bands?:readonly CartesianBand[]}
export interface CartesianCell {readonly value:number|null;readonly low:number|null;readonly high:number|null;readonly size:number|null;readonly from:number|null;readonly to:number|null}
export interface CartesianModelDatum {readonly id:string;readonly label:string;readonly x:string|number;readonly coordinate:number;readonly cells:Readonly<Record<string,CartesianCell>>}
export interface CartesianModelSeries {readonly id:string;readonly label:string;readonly mark:CartesianMark;readonly axisId:string;readonly stackId:string|null;readonly color:string|undefined;readonly curve:CartesianCurve;readonly connectNulls:boolean;readonly baseline:number|undefined;readonly bubble:boolean;readonly dashed:boolean}
export interface CartesianAxisModel {readonly id:string;readonly side:'left'|'right';readonly scale:'linear'|'log';readonly domain:readonly[number,number];readonly explicitDomain:boolean;readonly ticks:readonly number[];readonly label:string}
/** Complete admitted data stays separate from the visible, controlled window and hidden series. */
export interface CartesianModel {readonly data:readonly CartesianModelDatum[];readonly series:readonly CartesianModelSeries[];readonly visibleSeries:readonly CartesianModelSeries[];readonly axes:readonly CartesianAxisModel[];readonly xType:'category'|'linear'|'time';readonly xDomain:readonly[number,number];readonly xExplicitDomain:boolean;readonly window:readonly[number,number];readonly xLabel:string;readonly layout:'vertical'|'horizontal';readonly stack:CartesianStack;readonly references:readonly CartesianReference[];readonly bands:readonly CartesianBand[]}
export interface CartesianActive {readonly datumId:string;readonly seriesId?:string}
export interface CartesianPoint {readonly datumId:string;readonly seriesId:string;readonly x:number;readonly y:number;readonly baseX:number;readonly baseY:number;readonly value:number;readonly low:number|null;readonly high:number|null;readonly size:number|null}
export interface CartesianBar {readonly datumId:string;readonly seriesId:string;readonly x:number;readonly y:number;readonly width:number;readonly height:number;readonly cap:'top'|'bottom'|'left'|'right';readonly value:number;readonly from:number;readonly to:number}
/** Area intervals retain absolute measurement bounds; isolated intervals remain readable as whiskers. */
export interface CartesianSeriesGeometry {readonly seriesId:string;readonly line:string;readonly area:string;readonly interval:string;readonly intervalSingles:readonly string[];readonly points:readonly CartesianPoint[];readonly bars:readonly CartesianBar[]}
export interface CartesianLayout {readonly width:number;readonly height:number;readonly left:number;readonly top:number;readonly plotWidth:number;readonly plotHeight:number;readonly scatterRadius:number;readonly maxBubbleRadius:number;readonly independentTicks:readonly {coordinate:number;label:string;position:number}[];readonly axes:readonly {axis:CartesianAxisModel;ticks:readonly {value:number;position:number}[]}[];readonly series:readonly CartesianSeriesGeometry[];readonly mapX:(value:number)=>number;readonly mapY:(value:number,axisId?:string)=>number}
