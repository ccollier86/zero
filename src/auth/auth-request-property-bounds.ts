/** Serialized-size guards for flexible user-property HTTP values. */

import { AUTH_REQUEST_LIMITS as LIMIT } from './auth-request-limits';
import { AuthError } from './types';

export function assertAuthPropertyValueBound(value: unknown): void {
  if (serializedLength(value) > LIMIT.propertyValue) invalidRequest();
}

export function assertAuthPropertiesBound(
  properties: Record<string, unknown> | undefined
): void {
  if (!properties) return;
  const entries = Object.entries(properties);
  if (entries.length > LIMIT.propertyCount) invalidRequest();
  if (entries.some(([key]) => key.length < 1 || key.length > LIMIT.propertyKey)) {
    invalidRequest();
  }
  if (entries.some(([, value]) => serializedLength(value) > LIMIT.propertyValue)) {
    invalidRequest();
  }
  if (serializedLength(properties) > LIMIT.propertiesPayload) invalidRequest();
}

function serializedLength(value: unknown): number {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return (serialized ?? String(value)).length;
  } catch {
    invalidRequest();
  }
}

function invalidRequest(): never {
  throw new AuthError('Invalid auth request', 'AUTH_VALIDATION_FAILED', 422);
}
