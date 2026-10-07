/** Descriptor-safe capture of small contact commands; no getter or proof coercion. */
import { types as utilTypes } from 'node:util';
import { canonicalizeEmail, isEmailLoginIdentifier } from './auth-email-identity';
import { AuthError } from './types';
export function captureContactInput(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalidContactInput();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor || !('value' in descriptor)
      || !descriptor.enumerable) throw invalidContactInput();
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}
export function contactRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw invalidContactInput();
  return value;
}
export function contactText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\uD800-\uDFFF]/u.test(value)) throw invalidContactInput();
  return value;
}
export function contactEmail(value: unknown): string {
  const text = contactText(value, 254);
  if (!isEmailLoginIdentifier(text) || /[\u0000-\u0020\u007F]/u.test(text)) throw invalidContactInput();
  return canonicalizeEmail(text);
}
export function contactChallengeId(value: unknown): string {
  const text = contactText(value, 64);
  if (!/^acc_[a-f0-9-]{36}$/.test(text)) throw invalidContactInput();
  return text;
}
export function invalidContactInput(): AuthError {
  return new AuthError('Contact request is invalid', 'AUTH_CONTACT_VALIDATION_FAILED', 422);
}
