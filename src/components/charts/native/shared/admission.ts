/** Own-data admission for Zero's handmade chart families; no browser, renderer, query or transport authority. */
import { isChartCssColor } from '../../chart-color';
export const NATIVE_CHART_LIMITS = Object.freeze({ points: 4096, series: 32, cells: 65536, nodes: 2048, depth: 16, magnitude: 1e12, text: 4096 });

/** Detach ordinary own data without invoking getters, inherited methods or unknown fields. */
export function ownRecord(input: unknown, path: string, allowedKeys?: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${path} must be an own-data record`);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError(`${path} must be an ordinary record`);
  const out = Object.create(null) as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(input) as Record<PropertyKey, PropertyDescriptor>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw new TypeError(`${path} cannot contain symbols`);
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor)) throw new TypeError(`${path}.${key} must not be an accessor`);
    if (allowedKeys && !allowedKeys.includes(key)) throw new TypeError(`${path}.${key} is unsupported`);
    out[key] = descriptor.value;
  }
  return out;
}

/** Admit a dense bounded ordinary array and return detached own indexed values. */
export function ownArray(input: unknown, path: string, max: number = NATIVE_CHART_LIMITS.points): unknown[] {
  if (!Number.isSafeInteger(max) || max < 0 || max > NATIVE_CHART_LIMITS.cells) throw new RangeError(`${path} has an invalid work budget`);
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw new TypeError(`${path} must be an ordinary array`);
  const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<PropertyKey, PropertyDescriptor>;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) throw new RangeError(`${path} exceeds its ${max} entry budget`);
  if (Reflect.ownKeys(descriptors).length !== length + 1) throw new TypeError(`${path} must be dense and have no extra properties`);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) throw new TypeError(`${path}[${index}] must be own data`);
    result.push(descriptor.value);
  }
  return result;
}

/** Reject coercion and nonfinite or out-of-envelope measurements before geometry. */
export function numberValue(input: unknown, path: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  const min = options.min ?? -NATIVE_CHART_LIMITS.magnitude, max = options.max ?? NATIVE_CHART_LIMITS.magnitude;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new RangeError(`${path} has an invalid numeric envelope`);
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max || (options.integer && !Number.isSafeInteger(input))) throw new RangeError(`${path} must be ${options.integer ? 'an integer' : 'finite'} within ${min}..${max}`);
  return input;
}

/** Labels are escaped by React; required labels cannot be blank and work remains bounded. */
export function chartText(input: unknown, path: string, required = false): string {
  if (typeof input !== 'string' || input.length > NATIVE_CHART_LIMITS.text || (required && !input.trim())) throw new TypeError(`${path} must be ${required ? 'nonempty ' : ''}bounded text`);
  return input;
}

/** Stable identities are short explicit strings, not array indices or display names. */
export function chartId(input: unknown, path: string): string {
  const id = chartText(input, path, true);
  if (id.length > 256) throw new RangeError(`${path} exceeds the identity budget`);
  return id;
}

/** Admit bounded absolute CSS colors and trusted theme-token references, never images or SVG resource paints. */
export function chartColor(input: unknown, path: string): string {
  const color = chartText(input, path, true);
  if (!isChartCssColor(color)) throw new TypeError(`${path} must be a supported resource-free CSS color`);
  return color;
}

/** Admit explicit presentation selectors without string coercion. */
export function enumValue<T extends string>(input: unknown, path: string, choices: readonly T[]): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) throw new TypeError(`${path} must be one of ${choices.join(', ')}`);
  return input as T;
}
