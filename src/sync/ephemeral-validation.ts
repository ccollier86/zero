import type { JsonValue } from './types';
import type { EphemeralErrorCode } from './ephemeral-policy';

export const EPHEMERAL_LIMITS = {
  maxTopicLength: 256,
  maxKeyLength: 256,
  maxNamespaceLength: 512,
  maxValueSize: 65_536,
  maxTTL: 300_000,
  maxTopicsPerSocket: 64,
  /** Bounds one principal even when it writes without subscribing first. */
  maxEntriesPerActor: 256,
  maxBytesPerActor: 8 * 1_024 * 1_024,
  /** Bounds a shared namespace independently of the number of writers. */
  maxEntriesPerNamespace: 1_024,
  maxBytesPerNamespace: 16 * 1_024 * 1_024,
  /** Last-resort process-local bound for all ephemeral values in one app. */
  maxEntriesTotal: 4_096,
  maxBytesTotal: 64 * 1_024 * 1_024,
} as const;

interface EphemeralValidationFailure {
  ok: false;
  code: EphemeralErrorCode;
  reason: string;
}

const VALID = { ok: true } as const;

export function validateEphemeralTopic(
  topic: unknown,
): typeof VALID | EphemeralValidationFailure {
  if (typeof topic !== 'string'
    || topic.length === 0
    || topic.length > EPHEMERAL_LIMITS.maxTopicLength
    || topic.trim() !== topic
    || hasControlCharacter(topic)) {
    return {
      ok: false,
      code: 'EPHEMERAL_INVALID_TOPIC',
      reason: `Topic must be 1-${EPHEMERAL_LIMITS.maxTopicLength} characters without surrounding whitespace or controls`,
    };
  }
  return VALID;
}

export function validateEphemeralKey(
  key: unknown,
): typeof VALID | EphemeralValidationFailure {
  if (typeof key !== 'string'
    || key.length === 0
    || key.length > EPHEMERAL_LIMITS.maxKeyLength
    || hasControlCharacter(key)) {
    return {
      ok: false,
      code: 'EPHEMERAL_INVALID_KEY',
      reason: `Key must be 1-${EPHEMERAL_LIMITS.maxKeyLength} characters without controls`,
    };
  }
  return VALID;
}

export function validateEphemeralTTL(
  ttl: unknown,
): typeof VALID | EphemeralValidationFailure {
  if (ttl === undefined) return VALID;
  if (!Number.isSafeInteger(ttl) || (ttl as number) < 1
    || (ttl as number) > EPHEMERAL_LIMITS.maxTTL) {
    return {
      ok: false,
      code: 'EPHEMERAL_INVALID_TTL',
      reason: `TTL must be an integer between 1 and ${EPHEMERAL_LIMITS.maxTTL} milliseconds`,
    };
  }
  return VALID;
}

export function validateEphemeralValue(
  value: unknown,
): typeof VALID | EphemeralValidationFailure {
  const size = measureEphemeralValue(value);
  if (size === null) {
    return {
      ok: false,
      code: 'EPHEMERAL_VALUE_TOO_LARGE',
      reason: 'Value must be JSON serializable',
    };
  }
  if (size > EPHEMERAL_LIMITS.maxValueSize) {
    return {
      ok: false,
      code: 'EPHEMERAL_VALUE_TOO_LARGE',
      reason: `Value exceeds ${EPHEMERAL_LIMITS.maxValueSize} bytes`,
    };
  }
  return VALID;
}

/** Return the UTF-8 wire size of a JSON value, or null when it cannot serialize. */
export function measureEphemeralValue(value: unknown): number | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  return serialized === undefined
    ? null
    : new TextEncoder().encode(serialized).byteLength;
}

export function validateEphemeralNamespace(
  namespace: unknown,
): typeof VALID | EphemeralValidationFailure {
  if (typeof namespace !== 'string'
    || namespace.length === 0
    || namespace.length > EPHEMERAL_LIMITS.maxNamespaceLength
    || namespace.trim() !== namespace
    || hasControlCharacter(namespace)) {
    return {
      ok: false,
      code: 'EPHEMERAL_POLICY_INVALID',
      reason: 'Ephemeral policy returned an invalid internal namespace',
    };
  }
  return VALID;
}

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
