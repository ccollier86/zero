/**
 * storage-domain-error.ts
 *
 * Defines Storage's closed domain-failure contract and hostile-error
 * normalization boundary. It does not select HTTP status codes, emit logs, or
 * depend on the legacy `StorageError(status, message)` compatibility class.
 */

/** Stable Storage error codes shared by engine and Studio operations. */
export const STORAGE_ERROR_CODES = Object.freeze([
  'STORAGE_DISABLED',
  'STORAGE_STUDIO_DISABLED',
  'STORAGE_NOT_READY',
  'STORAGE_INPUT_INVALID',
  'STORAGE_METADATA_INVALID',
  'STORAGE_AUTHENTICATION_REQUIRED',
  'STORAGE_AUTHORITY_REQUIRED',
  'STORAGE_AUTHORITY_CHANGED',
  'STORAGE_NOT_FOUND',
  'STORAGE_DRIVE_NOT_FOUND',
  'STORAGE_OBJECT_NOT_FOUND',
  'STORAGE_CONFLICT',
  'STORAGE_DRIVE_KEY_CONFLICT',
  'STORAGE_PATH_CONFLICT',
  'STORAGE_POLICY_VIOLATION',
  'STORAGE_LIMIT_EXCEEDED',
  'STORAGE_QUOTA_EXCEEDED',
  'STORAGE_CONTENT_TYPE_UNSUPPORTED',
  'STORAGE_RANGE_NOT_SATISFIABLE',
  'STORAGE_CAPABILITY_INVALID',
  'STORAGE_CAPABILITY_EXPIRED',
  'STORAGE_REVISION_CONFLICT',
  'STORAGE_IDEMPOTENCY_CONFLICT',
  'STORAGE_OPERATION_IN_PROGRESS',
  'STORAGE_OPERATION_OUTCOME_UNKNOWN',
  'STORAGE_PROVIDER_UNAVAILABLE',
  'STORAGE_INTERNAL',
] as const);

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

/** Commit-boundary knowledge attached to a failed mutation. */
export type StorageOperationOutcome =
  | 'not-started'
  | 'not-committed'
  | 'committed'
  | 'unknown';

/** Scalar operational metadata allowed on a domain failure. */
export type StorageErrorDetailValue = string | number | boolean | null;

/**
 * Bounded diagnostics safe for logs. Do not include paths, object names,
 * tenant/user ids, capability tokens, request bodies, or idempotency keys.
 */
export type StorageErrorDetails = Readonly<
  Record<string, StorageErrorDetailValue>
>;

export interface StorageDomainErrorOptions extends ErrorOptions {
  readonly retryable?: boolean;
  readonly outcome?: StorageOperationOutcome | null;
  readonly details?: StorageErrorDetails;
}

interface StorageErrorDefaults {
  readonly retryable: boolean;
  readonly outcome: StorageOperationOutcome | null;
}

const CODE_SET: ReadonlySet<string> = new Set(STORAGE_ERROR_CODES);
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DETAIL_ENTRIES = 16;
const MAX_DETAIL_STRING_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 1_024;

const ERROR_DEFAULTS = Object.freeze({
  STORAGE_DISABLED: defaults(false, 'not-started'),
  STORAGE_STUDIO_DISABLED: defaults(false, 'not-started'),
  STORAGE_NOT_READY: defaults(true, 'not-started'),
  STORAGE_INPUT_INVALID: defaults(false, 'not-started'),
  STORAGE_METADATA_INVALID: defaults(false, 'not-started'),
  STORAGE_AUTHENTICATION_REQUIRED: defaults(false, 'not-started'),
  STORAGE_AUTHORITY_REQUIRED: defaults(false, 'not-started'),
  STORAGE_AUTHORITY_CHANGED: defaults(false, 'not-started'),
  STORAGE_NOT_FOUND: defaults(false, 'not-started'),
  STORAGE_DRIVE_NOT_FOUND: defaults(false, 'not-started'),
  STORAGE_OBJECT_NOT_FOUND: defaults(false, 'not-started'),
  STORAGE_CONFLICT: defaults(false, 'not-committed'),
  STORAGE_DRIVE_KEY_CONFLICT: defaults(false, 'not-committed'),
  STORAGE_PATH_CONFLICT: defaults(false, 'not-committed'),
  STORAGE_POLICY_VIOLATION: defaults(false, 'not-started'),
  STORAGE_LIMIT_EXCEEDED: defaults(false, 'not-started'),
  STORAGE_QUOTA_EXCEEDED: defaults(false, 'not-committed'),
  STORAGE_CONTENT_TYPE_UNSUPPORTED: defaults(false, 'not-started'),
  STORAGE_RANGE_NOT_SATISFIABLE: defaults(false, 'not-started'),
  STORAGE_CAPABILITY_INVALID: defaults(false, 'not-started'),
  STORAGE_CAPABILITY_EXPIRED: defaults(false, 'not-started'),
  STORAGE_REVISION_CONFLICT: defaults(false, 'not-committed'),
  STORAGE_IDEMPOTENCY_CONFLICT: defaults(false, 'not-committed'),
  STORAGE_OPERATION_IN_PROGRESS: defaults(true, 'not-started'),
  STORAGE_OPERATION_OUTCOME_UNKNOWN: defaults(false, 'unknown'),
  STORAGE_PROVIDER_UNAVAILABLE: defaults(true, 'not-started'),
  STORAGE_INTERNAL: defaults(false, 'unknown'),
} satisfies Record<StorageErrorCode, StorageErrorDefaults>);

/** Stable Storage domain failure used below the transport boundary. */
export class StorageDomainError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  readonly outcome: StorageOperationOutcome | null;
  readonly details: StorageErrorDetails;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: StorageDomainErrorOptions = {},
  ) {
    if (!isStorageErrorCode(code)) {
      throw new TypeError('Storage error code is not recognized.');
    }
    super(normalizeMessage(message), options.cause === undefined
      ? undefined
      : { cause: options.cause });
    const codeDefaults = ERROR_DEFAULTS[code];
    const retryable = options.retryable ?? codeDefaults.retryable;
    const outcome = options.outcome === undefined
      ? codeDefaults.outcome
      : options.outcome;
    if (outcome === 'unknown' && retryable) {
      throw new TypeError('A Storage error with unknown outcome cannot be retryable.');
    }
    if (code === 'STORAGE_OPERATION_OUTCOME_UNKNOWN' && outcome !== 'unknown') {
      throw new TypeError(
        'STORAGE_OPERATION_OUTCOME_UNKNOWN must have an unknown outcome.',
      );
    }

    this.name = 'StorageDomainError';
    this.code = code;
    this.retryable = retryable;
    this.outcome = outcome;
    this.details = sanitizeDetails(options.details);
  }
}

/** True when a value is a stable Storage code. */
export function isStorageErrorCode(value: unknown): value is StorageErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Recognize only a local, canonical Storage domain failure. */
export function isStorageDomainError(value: unknown): value is StorageDomainError {
  try {
    return value instanceof StorageDomainError;
  } catch {
    return false;
  }
}

/**
 * Normalize a caught value without reflecting its message, stack, or fields.
 * Canonical failures are copied so later mutation cannot alter the result.
 */
export function normalizeStorageError(value: unknown): StorageDomainError {
  if (isStorageDomainError(value)) {
    try {
      return new StorageDomainError(value.code, value.message, {
        retryable: value.retryable,
        outcome: value.outcome,
        details: value.details,
      });
    } catch {
      // A mutated or crafted instance becomes an opaque internal failure.
    }
  }
  return new StorageDomainError(
    'STORAGE_INTERNAL',
    'Storage operation failed.',
  );
}

function defaults(
  retryable: boolean,
  outcome: StorageOperationOutcome | null,
): StorageErrorDefaults {
  return Object.freeze({ retryable, outcome });
}

function normalizeMessage(message: string): string {
  if (typeof message !== 'string') return 'Storage operation failed.';
  const trimmed = message.trim();
  return (trimmed || 'Storage operation failed.').slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeDetails(
  details: StorageErrorDetails | undefined,
): StorageErrorDetails {
  if (details === undefined) return Object.freeze({});
  if (!isPlainRecord(details)) {
    throw new TypeError('Storage error details must be a plain object.');
  }
  const entries = Object.entries(details);
  if (entries.length > MAX_DETAIL_ENTRIES) {
    throw new TypeError('Storage error details exceed the entry limit.');
  }
  const result: Record<string, StorageErrorDetailValue> = Object.create(null);
  for (const [key, value] of entries) {
    if (!DETAIL_KEY_PATTERN.test(key) || BLOCKED_KEYS.has(key)) {
      throw new TypeError('Storage error detail key is invalid.');
    }
    if (value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'boolean') {
      throw new TypeError('Storage error details must contain scalar values only.');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Storage error detail numbers must be finite.');
    }
    result[key] = typeof value === 'string'
      ? value.slice(0, MAX_DETAIL_STRING_LENGTH)
      : value;
  }
  return Object.freeze(result);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
