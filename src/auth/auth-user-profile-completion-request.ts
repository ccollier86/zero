/** Capture identity-only completion commands without evaluating untrusted getters. */
import { types as utilTypes } from 'node:util';
import { AuthError } from './types';

export function captureProfileCompletionInput(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalidCompletionInput();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor || !('value' in descriptor)
      || !descriptor.enumerable) throw invalidCompletionInput();
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

export function profileCompletionToken(value: unknown): string {
  if (typeof value !== 'string' || value.length < 40 || value.length > 200
    || !/^zct_[A-Za-z0-9_-]+$/.test(value)) throw invalidCompletionInput();
  return value;
}

function invalidCompletionInput(): AuthError {
  return new AuthError('Profile completion request is invalid', 'AUTH_PROFILE_COMPLETION_VALIDATION_FAILED', 422);
}
