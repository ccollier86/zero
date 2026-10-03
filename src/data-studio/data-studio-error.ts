/**
 * data-studio-error.ts
 *
 * Defines the closed Data Studio failure contract and hostile-error
 * normalization boundary. It does not choose transport payloads or log errors.
 */

/** Stable Data Studio domain error codes. */
export const DATA_STUDIO_ERROR_CODES = Object.freeze([
  'DATA_STUDIO_DISABLED',
  'DATA_STUDIO_NOT_READY',
  'DATA_STUDIO_AUTHORITY_REQUIRED',
  'DATA_STUDIO_AUTHORITY_CHANGED',
  'DATA_STUDIO_TABLE_NOT_FOUND',
  'DATA_STUDIO_TABLE_ARCHIVED',
  'DATA_STUDIO_TABLE_KEY_CONFLICT',
  'DATA_STUDIO_ROW_NOT_FOUND',
  'DATA_STUDIO_SCHEMA_INVALID',
  'DATA_STUDIO_VALUE_INVALID',
  'DATA_STUDIO_LIMIT_EXCEEDED',
  'DATA_STUDIO_REVISION_CONFLICT',
  'DATA_STUDIO_IDEMPOTENCY_CONFLICT',
  'DATA_STUDIO_OPERATION_IN_PROGRESS',
  'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN',
  'DATA_STUDIO_UNAVAILABLE',
  'DATA_STUDIO_INTERNAL_ERROR',
] as const);

export type DataStudioErrorCode = (typeof DATA_STUDIO_ERROR_CODES)[number];

/** Commit-boundary knowledge attached to a failed mutation. */
export type DataStudioOperationOutcome =
  | 'not-started'
  | 'not-committed'
  | 'unknown';

/** Scalar operational metadata allowed on a domain failure. */
export type DataStudioErrorDetailValue = string | number | boolean | null;

/**
 * Bounded operational details. Callers must not include names, row values,
 * SQL, paths, tenant/user ids, request bodies, or idempotency keys.
 */
export type DataStudioErrorDetails = Readonly<
  Record<string, DataStudioErrorDetailValue>
>;

export interface DataStudioErrorOptions extends ErrorOptions {
  readonly retryable?: boolean;
  readonly outcome?: DataStudioOperationOutcome | null;
  readonly details?: DataStudioErrorDetails;
}

interface DataStudioErrorDefaults {
  readonly retryable: boolean;
  readonly outcome: DataStudioOperationOutcome | null;
}

const CODE_SET: ReadonlySet<string> = new Set(DATA_STUDIO_ERROR_CODES);
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DETAIL_ENTRIES = 16;
const MAX_DETAIL_STRING_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 1_024;

const ERROR_DEFAULTS = Object.freeze({
  DATA_STUDIO_DISABLED: defaults(false, 'not-started'),
  DATA_STUDIO_NOT_READY: defaults(true, 'not-started'),
  DATA_STUDIO_AUTHORITY_REQUIRED: defaults(false, 'not-started'),
  DATA_STUDIO_AUTHORITY_CHANGED: defaults(false, 'not-started'),
  DATA_STUDIO_TABLE_NOT_FOUND: defaults(false, 'not-started'),
  DATA_STUDIO_TABLE_ARCHIVED: defaults(false, 'not-started'),
  DATA_STUDIO_TABLE_KEY_CONFLICT: defaults(false, 'not-committed'),
  DATA_STUDIO_ROW_NOT_FOUND: defaults(false, 'not-started'),
  DATA_STUDIO_SCHEMA_INVALID: defaults(false, 'not-started'),
  DATA_STUDIO_VALUE_INVALID: defaults(false, 'not-started'),
  DATA_STUDIO_LIMIT_EXCEEDED: defaults(false, 'not-started'),
  DATA_STUDIO_REVISION_CONFLICT: defaults(false, 'not-committed'),
  DATA_STUDIO_IDEMPOTENCY_CONFLICT: defaults(false, 'not-committed'),
  DATA_STUDIO_OPERATION_IN_PROGRESS: defaults(true, 'not-started'),
  DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN: defaults(false, 'unknown'),
  DATA_STUDIO_UNAVAILABLE: defaults(true, 'not-started'),
  DATA_STUDIO_INTERNAL_ERROR: defaults(false, 'unknown'),
} satisfies Record<DataStudioErrorCode, DataStudioErrorDefaults>);

/** Stable Data Studio domain failure. */
export class DataStudioError extends Error {
  readonly code: DataStudioErrorCode;
  readonly retryable: boolean;
  readonly outcome: DataStudioOperationOutcome | null;
  readonly details: DataStudioErrorDetails;

  constructor(
    code: DataStudioErrorCode,
    message: string,
    options: DataStudioErrorOptions = {},
  ) {
    if (!isDataStudioErrorCode(code)) {
      throw new TypeError('Data Studio error code is not recognized.');
    }
    const normalizedMessage = normalizeMessage(message);
    super(normalizedMessage, options.cause === undefined ? undefined : {
      cause: options.cause,
    });

    const codeDefaults = ERROR_DEFAULTS[code];
    const retryable = options.retryable ?? codeDefaults.retryable;
    const outcome = options.outcome === undefined
      ? codeDefaults.outcome
      : options.outcome;
    if (outcome === 'unknown' && retryable) {
      throw new TypeError('A Data Studio error with unknown outcome cannot be retryable.');
    }
    if (code === 'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN' && outcome !== 'unknown') {
      throw new TypeError(
        'DATA_STUDIO_OPERATION_OUTCOME_UNKNOWN must have an unknown outcome.',
      );
    }

    this.name = 'DataStudioError';
    this.code = code;
    this.retryable = retryable;
    this.outcome = outcome;
    this.details = sanitizeDetails(options.details);
  }
}

/** True when a value is one of the stable Data Studio error codes. */
export function isDataStudioErrorCode(value: unknown): value is DataStudioErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Safely recognize a local Data Studio error, including hostile proxies. */
export function isDataStudioError(value: unknown): value is DataStudioError {
  try {
    return value instanceof DataStudioError;
  } catch {
    return false;
  }
}

/**
 * Normalize a caught value without reflecting its message, stack, or fields.
 * Local errors are copied so later mutation cannot change the observed shape.
 */
export function normalizeDataStudioError(value: unknown): DataStudioError {
  if (isDataStudioError(value)) {
    try {
      return new DataStudioError(value.code, value.message, {
        retryable: value.retryable,
        outcome: value.outcome,
        details: value.details,
      });
    } catch {
      // A mutated/crafted instance is treated as an unknown internal failure.
    }
  }
  return new DataStudioError(
    'DATA_STUDIO_INTERNAL_ERROR',
    'Data Studio operation failed.',
  );
}

function defaults(
  retryable: boolean,
  outcome: DataStudioOperationOutcome | null,
): DataStudioErrorDefaults {
  return Object.freeze({ retryable, outcome });
}

function normalizeMessage(message: string): string {
  if (typeof message !== 'string') return 'Data Studio operation failed.';
  const trimmed = message.trim();
  return (trimmed || 'Data Studio operation failed.').slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeDetails(
  details: DataStudioErrorDetails | undefined,
): DataStudioErrorDetails {
  if (details === undefined) return Object.freeze({});
  if (!isPlainRecord(details)) {
    throw new TypeError('Data Studio error details must be a plain object.');
  }
  const entries = Object.entries(details);
  if (entries.length > MAX_DETAIL_ENTRIES) {
    throw new TypeError('Data Studio error details exceed the entry limit.');
  }
  const result: Record<string, DataStudioErrorDetailValue> = Object.create(null);
  for (const [key, value] of entries) {
    if (!DETAIL_KEY_PATTERN.test(key) || BLOCKED_KEYS.has(key)) {
      throw new TypeError('Data Studio error detail key is invalid.');
    }
    if (value !== null
      && typeof value !== 'string'
      && typeof value !== 'number'
      && typeof value !== 'boolean') {
      throw new TypeError('Data Studio error details must contain scalar values only.');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Data Studio error detail numbers must be finite.');
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
