/** Native bounded scales and ticks. Deterministic pure math; no chart-library or browser dependency. */
import {number,domain as admitDomain}from'./cartesian-admission';
/** Expand a constant domain without erasing high-offset small measurements. */
export function expandCartesianDomain(low:number,high:number,includeZero=false):[number,number]{
 number(low,'domain low',8.64e15);number(high,'domain high',8.64e15);if(low>high)throw new RangeError('Domain must be ordered');
 if(includeZero){low=Math.min(0,low);high=Math.max(0,high);}
 if(low===high){const pad=Math.max(Math.abs(low)*.05,Math.abs(low)*Number.EPSILON*4,low===0?1:Number.MIN_VALUE);low-=pad;high+=pad;}
 if(!Number.isFinite(low)||!Number.isFinite(high)||low>=high)throw new RangeError('Cartesian domain cannot be represented');
 return[low,high];
}
/** Integer-indexed ticks carry an explicit work budget and progress guard at extreme offsets. */
export function cartesianTicks(domain:readonly[number,number],scale:'linear'|'log'='linear',count=5):number[]{
 const[low,high]=admitDomain(domain,'tick domain',8.64e15);if(low>=high||!Number.isFinite(count)||count<1||!['linear','log'].includes(scale))throw new RangeError('Tick domain, scale and count must be valid');
 count=Math.max(2,Math.min(12,Math.floor(count)));const result:number[]=[];
 if(scale==='log'){
  if(low<=0)throw new RangeError('Logarithmic domains must be positive');
  const from=Math.max(-323,Math.ceil(Math.log10(low))),to=Math.min(308,Math.floor(Math.log10(high))),stride=Math.max(1,Math.ceil((to-from+1)/count));
  for(let exponent=from;exponent<=to;exponent+=stride){const value=10**exponent;if(value>=low&&value<=high)result.push(value);}
  if(result.length<2)return[low,high];return result;
 }
 const raw=(high-low)/(count-1),power=10**Math.floor(Math.log10(raw));
 const multiplier=raw/power;const ordinary=(multiplier<=1?1:multiplier<=2?2:multiplier<=2.5?2.5:multiplier<=5?5:10)*power;
 const step=Math.max(ordinary||Number.MIN_VALUE,Math.max(Math.abs(low),Math.abs(high))*Number.EPSILON);
 const first=Math.ceil(low/step)*step;
 for(let index=0;index<24;index++){const value=first+index*step;if(value>high||!Number.isFinite(value))break;if(value>=low&&(result.length===0||value>result[result.length-1]!))result.push(value===0?0:value);}
 return result.length?result:[low,high];
}
/** Return a finite unit coordinate. Extreme overflow stays outside the plot at a bounded exterior coordinate, never on its edge. */
export function cartesianScale(value:number,domain:readonly[number,number],scale:'linear'|'log'='linear'):number{
 number(value,'scale value',8.64e15);const admitted=admitDomain(domain,'scale domain',8.64e15);if(admitted[0]===admitted[1]||!['linear','log'].includes(scale))throw new RangeError('Scale domain must increase');domain=admitted;
 // log1p retains a one-ULP interval at high offsets; ordinary log differences
 // retain very wide ratios where direct division itself would overflow.
 const logRatio=(a:number,b:number)=>{const relative=(a-b)/b;return Number.isFinite(relative)&&relative>-1?Math.log1p(relative):Math.log(a)-Math.log(b);};
 let fraction:number;
 if(scale==='log'){if(value<=0||domain[0]<=0)throw new RangeError('Logarithmic values must be positive');fraction=logRatio(value,domain[0])/logRatio(domain[1],domain[0]);}
 else fraction=(value-domain[0])/(domain[1]-domain[0]);
 // Beyond this exterior guard every mark is already clipped. Raw values and
 // exact inspection/table data remain unchanged; do not pin overflow to 0/1.
 if(!Number.isFinite(fraction))return value<domain[0]?-1e6:1e6;
 return Math.max(-1e6,Math.min(1e6,fraction));
}
/** Admit a finite presentation coordinate separately from timestamp admission. */
export function cartesianCoordinate(value:unknown):number{return number(value,'coordinate');}
