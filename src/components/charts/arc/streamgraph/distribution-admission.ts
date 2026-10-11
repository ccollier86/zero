/**
 * Bounded own-data admission for distribution/hierarchy charts. Pure client
 * presentation boundary, not database authorization. Rejects coercion, getters,
 * sparse arrays, duplicate identities and unsupported magnitudes before math.
 */
import { isChartCssColor } from '../../chart-color';
export const ARC_DISTRIBUTION_LIMITS = Object.freeze({ magnitude: 1e12, series: 32, points: 1024, cells: 32768, slopeItems: 64, ridges: 64, observations: 16384, treeNodes: 2048, treeDepth: 16 });
export function ownRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(label + " must be a plain own-data object");
  const d = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(d)) if (typeof key !== "string" || !("value" in d[key]!)) throw new TypeError(label + " cannot contain symbols or accessors");
  const own:Record<string,unknown>=Object.create(null);
  for(const [key,descriptor]of Object.entries(d))own[key]=descriptor.value;
  return own;
}
export function ownArray(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(label + " must be an array of at most " + max + " entries");
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    if(key==="length")continue;
    if(typeof key!=="string"||!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=value.length||!("value" in descriptors[key]!))throw new TypeError(label+" cannot contain extra fields, symbols or accessors");
  }
  for (let i = 0; i < value.length; i++) if(!Object.hasOwn(descriptors,String(i)))throw new TypeError(label+" cannot contain sparse entries");
  return Array.from({length:value.length},(_,index)=>descriptors[String(index)]!.value);
}
export function ownString(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new TypeError(label + " must be nonempty text of at most " + max + " characters");
  return value;
}
export function ownNumber(value: unknown, label: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > ARC_DISTRIBUTION_LIMITS.magnitude || (positive && value < 0)) throw new TypeError(label + " must be finite" + (positive ? " and nonnegative" : "") + " within +/-1e12");
  return value;
}
export function uniqueId(value: unknown, ids: Set<string>, label: string): string {
  const id = ownString(value, label, 256); if (ids.has(id)) throw new TypeError(label + " must be unique"); ids.add(id); return id;
}
/** Chart colors share Zero's positive absolute-color grammar rather than a resource denylist. */
export function ownPaintColor(value:unknown,label:string):string {
 const color=ownString(value,label,256);
 if(!isChartCssColor(color))throw new TypeError(label+" must be a supported resource-free CSS color");
 return color;
}
export function optionNumber(value: unknown, fallback: number, low: number, high: number, label: string): number {
  const v = value === undefined ? fallback : ownNumber(value, label); if (v < low || v > high) throw new RangeError(label + " must be between " + low + " and " + high); return v;
}
export function requireKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new TypeError(label + " contains unknown fields");
}
