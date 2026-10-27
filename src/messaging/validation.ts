/** Closed descriptor-safe domain input validation. No coercion, arbitrary HTML, transport or authority. */
import { AuthError } from '../auth/types';
import { types } from 'node:util';
export function messagingFail(code: string, status = 409): never { throw new AuthError('The messaging operation was not accepted.', code, status); }
export function messagingRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) messagingFail('MESSAGING_INPUT_INVALID', 422);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !keys.includes(key) || !descriptor.enumerable || !('value' in descriptor)) messagingFail('MESSAGING_INPUT_INVALID', 422);
    result[key] = descriptor.value;
  }
  return result;
}
export function messagingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return value;
}
/** Stable configured assistant/group keys, not arbitrary user/resource identifiers. */
export function messagingCatalogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return value;
}
export function messagingText(value: unknown, max = 20000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || !empty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || /\p{Cs}/u.test(value)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return value;
}
export function messagingInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER - 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return value;
}
export function messagingChoice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return value as T;
}
export function messagingArray(value: unknown, max: number): unknown[] {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) messagingFail('MESSAGING_INPUT_INVALID', 422);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return Array.from({ length: value.length }, (_, i) => { const descriptor = descriptors[String(i)]; if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) messagingFail('MESSAGING_INPUT_INVALID', 422); return descriptor.value; });
}
/** Closed, bounded named maps reject proxies and accessors before inspecting their values. */
export function messagingRegistry(value: unknown, maximum: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) messagingFail('MESSAGING_INPUT_INVALID', 422);
  const keys = Reflect.ownKeys(value);
  if (keys.length > maximum || keys.some(key => typeof key !== 'string')) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return messagingRecord(value, keys as string[]);
}
/** Fixed JSON key order is supplied by the caller; this does not execute a generic untrusted serializer. */
export function messagingHash(value: unknown): string { return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex'); }
