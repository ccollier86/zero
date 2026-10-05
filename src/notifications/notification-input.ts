/**
 * Parses JSON-encoded notification HTTP fields before service admission.
 * Owns safe input shape errors only; it does not authorize or persist notices.
 */
import { AuthError } from '../auth/types';

/** Decode optional metadata as an object, never exposing parser diagnostics. */
export function parseNotificationMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const parsed = parseJson(value, 'metadata');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidInput('metadata must encode an object');
  }
  return parsed as Record<string, unknown>;
}

/** Decode the nonempty exact-user audience required by the users target mode. */
export function parseNotificationUserIds(value: string): string[] {
  const parsed = parseJson(value, 'targetValue');
  if (!Array.isArray(parsed) || parsed.length === 0
    || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    throw invalidInput('targetValue must encode a nonempty array of user IDs');
  }
  return parsed;
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw invalidInput(`${field} must contain valid JSON`);
  }
}

function invalidInput(message: string): AuthError {
  return new AuthError(message, 'BAD_REQUEST', 400);
}
