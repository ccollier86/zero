/**
 * Parses the room HTTP metadata field before domain-service admission.
 * Owns input errors only; membership, authorization and persistence stay separate.
 */
import { AuthError } from '../auth/types';

/** Decode optional JSON-object metadata without exposing parser/source details. */
export function parseRoomMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AuthError('metadata must contain valid JSON', 'BAD_REQUEST', 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AuthError('metadata must encode an object', 'BAD_REQUEST', 400);
  }
  return parsed as Record<string, unknown>;
}
