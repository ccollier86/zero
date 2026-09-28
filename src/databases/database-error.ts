/**
 * database-error.ts
 *
 * Defines the stable database execution error contract used across local and
 * IPC-backed executors. This file owns safe error shape and serialization only;
 * it does not log, schedule work, or expose backend-specific process details.
 */

/** Wire discriminator for serialized database errors. */
export const DATABASE_ERROR_ENVELOPE_KIND = 'zero.database-error' as const;

/** Current version of the serialized database error contract. */
export const DATABASE_ERROR_ENVELOPE_VERSION = 1 as const;

/** Maximum number of privacy-safe detail fields carried across an IPC boundary. */
export const DATABASE_ERROR_DETAILS_MAX_ENTRIES = 24;

/** Maximum length of one serialized detail key. */
export const DATABASE_ERROR_DETAIL_KEY_MAX_LENGTH = 64;

/** Maximum length of one serialized string detail value. */
export const DATABASE_ERROR_DETAIL_STRING_MAX_LENGTH = 256;

/** Maximum length of a serialized database error message. */
export const DATABASE_ERROR_MESSAGE_MAX_LENGTH = 1_024;

/** Stable database error codes shared by every execution backend. */
export const DATABASE_ERROR_CODES = Object.freeze([
  'DATABASE_CONFIG_INVALID',
  'DATABASE_DISABLED',
  'DATABASE_NOT_READY',
  'DATABASE_CLOSED',
  'DATABASE_BACKPRESSURE',
  'DATABASE_QUEUE_TIMEOUT',
  'DATABASE_OPERATION_TIMEOUT',
  'DATABASE_EXECUTOR_START_FAILED',
  'DATABASE_EXECUTOR_FAILED',
  'DATABASE_PROTOCOL_ERROR',
  'DATABASE_OPEN_FAILED',
  'DATABASE_MIGRATION_FAILED',
  'DATABASE_SCHEMA_MISMATCH',
  'DATABASE_AUTHORITY_CHANGED',
  'DATABASE_CONFLICT',
  'DATABASE_HISTORY_GAP',
  'DATABASE_PAYLOAD_INVALID',
  'DATABASE_PAYLOAD_LIMIT',
  'DATABASE_RESULT_LIMIT',
  'DATABASE_OPERATION_UNSUPPORTED',
  'DATABASE_TRANSACTION_EXPIRED',
  'DATABASE_TRANSACTION_STALE',
  'DATABASE_OUTCOME_UNKNOWN',
] as const);

/** Closed union of stable database error codes. */
export type DatabaseErrorCode = (typeof DATABASE_ERROR_CODES)[number];

/**
 * What the executor can assert about a failed operation's commit boundary.
 *
 * `null` means the failure does not make a commit assertion, such as a history
 * read gap. An `unknown` outcome must never be marked retryable because blindly
 * replaying a mutation could duplicate an already committed effect.
 */
export type DatabaseOperationOutcome =
  | 'not-started'
  | 'not-committed'
  | 'unknown';

/** Scalar values allowed in privacy-safe database error details. */
export type DatabaseErrorDetailValue = string | number | boolean | null;

/**
 * Bounded operational metadata safe to carry across an executor boundary.
 *
 * Callers must still avoid secrets, SQL, bind values, paths, tenant names, and
 * record content. Nested values are deliberately unsupported.
 */
export type DatabaseErrorDetails = Readonly<
  Record<string, DatabaseErrorDetailValue>
>;

/** Constructor options for a database-domain error. */
export interface DatabaseErrorOptions extends ErrorOptions {
  readonly retryable?: boolean;
  readonly outcome?: DatabaseOperationOutcome | null;
  readonly details?: DatabaseErrorDetails;
}

/** Versioned structured-clone-safe database error envelope. */
export interface SerializedDatabaseError {
  readonly kind: typeof DATABASE_ERROR_ENVELOPE_KIND;
  readonly version: typeof DATABASE_ERROR_ENVELOPE_VERSION;
  readonly code: DatabaseErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly outcome: DatabaseOperationOutcome | null;
  readonly details: DatabaseErrorDetails;
}

interface DatabaseErrorDefaults {
  readonly retryable: boolean;
  readonly outcome: DatabaseOperationOutcome | null;
}

const DATABASE_ERROR_CODE_SET: ReadonlySet<string> = new Set(DATABASE_ERROR_CODES);
const OPERATION_OUTCOMES: ReadonlySet<string> = new Set([
  'not-started',
  'not-committed',
  'unknown',
]);
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;
const RESERVED_DETAIL_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'version',
  'code',
  'message',
  'retryable',
  'outcome',
  'details',
]);

const DATABASE_ERROR_DEFAULTS = Object.freeze({
  DATABASE_CONFIG_INVALID: defaults(false, 'not-started'),
  DATABASE_DISABLED: defaults(false, 'not-started'),
  DATABASE_NOT_READY: defaults(true, 'not-started'),
  DATABASE_CLOSED: defaults(false, 'not-started'),
  DATABASE_BACKPRESSURE: defaults(true, 'not-started'),
  DATABASE_QUEUE_TIMEOUT: defaults(true, 'not-started'),
  DATABASE_OPERATION_TIMEOUT: defaults(false, 'unknown'),
  DATABASE_EXECUTOR_START_FAILED: defaults(true, 'not-started'),
  DATABASE_EXECUTOR_FAILED: defaults(false, 'unknown'),
  DATABASE_PROTOCOL_ERROR: defaults(false, 'unknown'),
  DATABASE_OPEN_FAILED: defaults(true, 'not-started'),
  DATABASE_MIGRATION_FAILED: defaults(false, 'unknown'),
  DATABASE_SCHEMA_MISMATCH: defaults(false, 'not-started'),
  DATABASE_AUTHORITY_CHANGED: defaults(false, 'not-started'),
  DATABASE_CONFLICT: defaults(true, 'not-committed'),
  DATABASE_HISTORY_GAP: defaults(false, null),
  DATABASE_PAYLOAD_INVALID: defaults(false, 'not-started'),
  DATABASE_PAYLOAD_LIMIT: defaults(false, 'not-started'),
  DATABASE_RESULT_LIMIT: defaults(false, 'unknown'),
  DATABASE_OPERATION_UNSUPPORTED: defaults(false, 'not-started'),
  DATABASE_TRANSACTION_EXPIRED: defaults(false, 'not-committed'),
  DATABASE_TRANSACTION_STALE: defaults(false, 'not-started'),
  DATABASE_OUTCOME_UNKNOWN: defaults(false, 'unknown'),
} satisfies Record<DatabaseErrorCode, DatabaseErrorDefaults>);

/** Stable database-domain error used by coordinators and executors. */
export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly retryable: boolean;
  readonly outcome: DatabaseOperationOutcome | null;
  readonly details: DatabaseErrorDetails;

  constructor(
    code: DatabaseErrorCode,
    message: string,
    options: DatabaseErrorOptions = {},
  ) {
    assertDatabaseErrorCode(code);
    const fallback = safeMessageForCode(code);
    const safeMessage = normalizeMessage(message, fallback);
    super(safeMessage, options.cause === undefined ? undefined : {
      cause: options.cause,
    });

    const defaultShape = DATABASE_ERROR_DEFAULTS[code];
    const retryable = options.retryable ?? defaultShape.retryable;
    const outcome = options.outcome === undefined
      ? defaultShape.outcome
      : options.outcome;

    assertRetryShape(retryable, outcome);
    if (code === 'DATABASE_OUTCOME_UNKNOWN' && outcome !== 'unknown') {
      throw new TypeError('DATABASE_OUTCOME_UNKNOWN must have an unknown outcome.');
    }

    this.name = 'DatabaseError';
    this.code = code;
    this.retryable = retryable;
    this.outcome = outcome;
    this.details = sanitizeDetails(options.details);
  }
}

/** Return true when a value is one of Zero's stable database error codes. */
export function isDatabaseErrorCode(value: unknown): value is DatabaseErrorCode {
  return typeof value === 'string' && DATABASE_ERROR_CODE_SET.has(value);
}

/** Return true only for a complete, current, privacy-safe wire envelope. */
export function isSerializedDatabaseError(
  value: unknown,
): value is SerializedDatabaseError {
  return parseSerializedDatabaseError(value) !== null;
}

/**
 * Convert a local or unknown failure to the safe database-domain contract.
 *
 * Unknown executor values are intentionally not reflected into the returned
 * message or details because they may contain SQL, paths, secrets, or stacks.
 */
export function normalizeDatabaseError(value: unknown): DatabaseError {
  if (value instanceof DatabaseError) return value;

  const parsed = parseSerializedDatabaseError(value);
  if (parsed) return databaseErrorFromEnvelope(parsed);

  if (hasDatabaseEnvelopeDiscriminator(value)) {
    return protocolFallback();
  }

  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database executor failed.',
  );
}

/** Serialize a failure without transferring its stack, cause, or nested data. */
export function serializeDatabaseError(value: unknown): SerializedDatabaseError {
  const error = normalizeDatabaseError(value);
  const envelope: SerializedDatabaseError = {
    kind: DATABASE_ERROR_ENVELOPE_KIND,
    version: DATABASE_ERROR_ENVELOPE_VERSION,
    code: error.code,
    message: normalizeMessage(error.message, safeMessageForCode(error.code)),
    retryable: error.retryable,
    outcome: error.outcome,
    details: sanitizeDetails(error.details),
  };
  return Object.freeze(envelope);
}

/**
 * Deserialize a current database error envelope.
 *
 * Malformed, outdated, or extended envelopes become a generic protocol error;
 * no untrusted message, detail, stack, or cause is copied into the result.
 */
export function deserializeDatabaseError(value: unknown): DatabaseError {
  const parsed = parseSerializedDatabaseError(value);
  return parsed ? databaseErrorFromEnvelope(parsed) : protocolFallback();
}

function defaults(
  retryable: boolean,
  outcome: DatabaseOperationOutcome | null,
): DatabaseErrorDefaults {
  return Object.freeze({ retryable, outcome });
}

function assertDatabaseErrorCode(value: unknown): asserts value is DatabaseErrorCode {
  if (!isDatabaseErrorCode(value)) {
    throw new TypeError('Invalid database error code.');
  }
}

function assertRetryShape(
  retryable: unknown,
  outcome: unknown,
): asserts outcome is DatabaseOperationOutcome | null {
  if (typeof retryable !== 'boolean') {
    throw new TypeError('Database error retryable must be a boolean.');
  }
  if (!isOperationOutcome(outcome)) {
    throw new TypeError('Invalid database operation outcome.');
  }
  if (retryable && outcome === 'unknown') {
    throw new TypeError('An operation with an unknown outcome cannot be retryable.');
  }
}

function isOperationOutcome(
  value: unknown,
): value is DatabaseOperationOutcome | null {
  return value === null
    || (typeof value === 'string' && OPERATION_OUTCOMES.has(value));
}

function databaseErrorFromEnvelope(
  envelope: SerializedDatabaseError,
): DatabaseError {
  return new DatabaseError(envelope.code, envelope.message, {
    retryable: envelope.retryable,
    outcome: envelope.outcome,
    details: envelope.details,
  });
}

function protocolFallback(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Invalid database executor response.',
  );
}

function safeMessageForCode(code: DatabaseErrorCode): string {
  switch (code) {
    case 'DATABASE_EXECUTOR_START_FAILED':
      return 'Database executor could not start.';
    case 'DATABASE_EXECUTOR_FAILED':
      return 'Database executor failed.';
    case 'DATABASE_PROTOCOL_ERROR':
      return 'Invalid database executor response.';
    case 'DATABASE_OUTCOME_UNKNOWN':
      return 'Database operation outcome is unknown.';
    default:
      return 'Database operation failed.';
  }
}

function normalizeMessage(value: unknown, fallback: string): string {
  return isSafeMessage(value) ? value : fallback;
}

function isSafeMessage(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= DATABASE_ERROR_MESSAGE_MAX_LENGTH
    && isSafeString(value);
}

function sanitizeDetails(value: unknown): DatabaseErrorDetails {
  const parsed = parseDetails(value);
  return parsed ?? Object.freeze({});
}

function parseDetails(value: unknown): DatabaseErrorDetails | null {
  const descriptors = ownDataDescriptors(value);
  if (!descriptors) return null;

  const entries = Object.entries(descriptors);
  if (entries.length > DATABASE_ERROR_DETAILS_MAX_ENTRIES) return null;

  const details: Record<string, DatabaseErrorDetailValue> = {};
  for (const [key, descriptor] of entries) {
    if (!isSafeDetailKey(key)
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !isSafeDetailValue(descriptor.value)) {
      return null;
    }
    Object.defineProperty(details, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }

  return Object.freeze(details);
}

function isSafeDetailKey(key: string): boolean {
  return key.length > 0
    && key.length <= DATABASE_ERROR_DETAIL_KEY_MAX_LENGTH
    && DETAIL_KEY_PATTERN.test(key)
    && !RESERVED_DETAIL_KEYS.has(key);
}

function isSafeDetailValue(value: unknown): value is DatabaseErrorDetailValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string'
    && value.length <= DATABASE_ERROR_DETAIL_STRING_MAX_LENGTH
    && isSafeString(value);
}

function isSafeString(value: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
    && isWellFormedUnicode(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function parseSerializedDatabaseError(
  value: unknown,
): SerializedDatabaseError | null {
  const descriptors = ownDataDescriptors(value);
  if (!descriptors) return null;

  const keys = Object.keys(descriptors);
  if (keys.length !== ENVELOPE_KEYS.size
    || keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    return null;
  }
  if (keys.some((key) => {
    const descriptor = descriptors[key];
    return !descriptor?.enumerable || !('value' in descriptor);
  })) {
    return null;
  }

  const kind = descriptors.kind?.value;
  const version = descriptors.version?.value;
  const code = descriptors.code?.value;
  const message = descriptors.message?.value;
  const retryable = descriptors.retryable?.value;
  const outcome = descriptors.outcome?.value;
  const details = parseDetails(descriptors.details?.value);

  if (kind !== DATABASE_ERROR_ENVELOPE_KIND
    || version !== DATABASE_ERROR_ENVELOPE_VERSION
    || !isDatabaseErrorCode(code)
    || !isSafeMessage(message)
    || typeof retryable !== 'boolean'
    || !isOperationOutcome(outcome)
    || (retryable && outcome === 'unknown')
    || (code === 'DATABASE_OUTCOME_UNKNOWN' && outcome !== 'unknown')
    || !details) {
    return null;
  }

  return Object.freeze({
    kind,
    version,
    code,
    message,
    retryable,
    outcome,
    details,
  });
}

function ownDataDescriptors(
  value: unknown,
): Record<string, PropertyDescriptor> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
}

function hasDatabaseEnvelopeDiscriminator(value: unknown): boolean {
  const descriptors = ownDataDescriptors(value);
  const descriptor = descriptors?.kind;
  return Boolean(
    descriptor
    && descriptor.enumerable
    && 'value' in descriptor
    && descriptor.value === DATABASE_ERROR_ENVELOPE_KIND,
  );
}
