/** Cartesian chart admission only. Detaches bounded own plain data; never reads browser or transport state. */
import { isChartCssColor } from '../../chart-color';
export const CARTESIAN_LIMITS = Object.freeze({ points: 4096, series: 16, cells: 65536, brushPoints: 32768, annotations: 128, valueMagnitude: 1e12, text: 4096 });
/** Read an own plain data record without invoking accessors. */
export function ownChartRecord(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError(`${path} must be a plain record`);
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${path} has an unknown field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new TypeError(`${path}.${key} must be an own data field`);
    out[key] = descriptor.value;
  }
  return out;
}
/** Admit an own dense bounded array, without evaluating holes or accessor entries. */
export function ownChartArray(value: unknown, path: string, limit: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError(`${path} must contain at most ${limit} entries`);
  for(const key of Reflect.ownKeys(value)) if(key!=='length' && (typeof key!=='string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key)>=value.length)) throw new TypeError(`${path} must not have additional fields`);
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new TypeError(`${path} must be a dense own data array`);
    out.push(descriptor.value);
  }
  return out;
}
/** Admit finite chart values within the documented derivative-safe numeric envelope. */
export function chartNumber(value: unknown, path: string, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > CARTESIAN_LIMITS.valueMagnitude || (nonnegative && value < 0)) throw new TypeError(`${path} must be finite${nonnegative ? ' and nonnegative' : ''}, with magnitude at most ${CARTESIAN_LIMITS.valueMagnitude}`);
  return value;
}
/** Admit bounded plain text; IDs are nonempty and limited to 256 characters. */
export function chartText(value: unknown, path: string, id = false): string {
  if (typeof value !== 'string' || value.length > (id ? 256 : CARTESIAN_LIMITS.text) || (id && !value.trim())) throw new TypeError(`${path} must be bounded${id ? ' nonempty' : ''} text`);
  return value;
}
/** Chart colors share Zero's positive absolute-color grammar; theme tokens remain unresolved, never resource paints. */
export function chartColor(value:unknown,path:string):string {
 const color=chartText(value,path);
 if(!isChartCssColor(color))throw new TypeError(`${path} must be a supported resource-free CSS color`);
 return color;
}
/** User-facing names are required, but retain the larger text envelope rather than the ID limit. */
export function chartLabel(value:unknown,path:string):string {
 const label=chartText(value,path);
 if(!label.trim())throw new TypeError(`${path} must be nonempty text`);
 return label;
}
/** Stable selection identity is optional; unknown but valid IDs are retired by the renderer. */
export function chartSelectionId(value:unknown,path:string):string|null|undefined {
 return value===undefined||value===null?value:chartText(value,path,true);
}
/** Admit a selector rather than silently accepting misspelled settings. */
export function chartSelector(value:unknown,path:string,choices:readonly string[]):void {
 if(value!==undefined && (typeof value!=='string'||!choices.includes(value)))throw new TypeError(`${path} must be one of ${choices.join(', ')}`);
}
/** Chart motion and appearance flags do not use truthy coercion. */
export function chartFlag(value:unknown,path:string):void {
 if(value!==undefined&&typeof value!=='boolean')throw new TypeError(`${path} must be boolean`);
}
/** Finite epochs use the complete JavaScript Date envelope without executing custom Date methods. */
export function chartEpoch(value:unknown,path:string):number {
 const epoch=value instanceof Date?Date.prototype.getTime.call(value):value;
 if(typeof epoch!=='number'||!Number.isFinite(epoch)||Math.abs(epoch)>8.64e15)throw new TypeError(`${path} must be a valid date or epoch milliseconds`);
 return epoch;
}
/** Detach exactly two own finite ordered epoch values, including a truthful zero-width window. */
export function chartWindow(value:unknown,path:string):[number,number] {
 const values=ownChartArray(value,path,2);
 if(values.length!==2)throw new TypeError(`${path} must contain exactly two bounds`);
 const start=chartEpoch(values[0],`${path}[0]`),end=chartEpoch(values[1],`${path}[1]`);
 if(start>end)throw new TypeError(`${path} bounds must be ordered`);
 return[start,end];
}
/** Admit finite CSS-pixel dimensions; bounds protect canvas/SVG work and readable geometry. */
export function chartDimension(value: number, path: string, minimum = 32): number {
  if (!Number.isFinite(value) || value < minimum || value > 4096) throw new TypeError(`${path} must be between ${minimum} and 4096 pixels`);
  return value;
}
