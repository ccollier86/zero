/**
 * storage-http-error.ts
 *
 * Projects closed Storage failures into privacy-safe HTTP responses. Fixed
 * public messages preserve the `{ error, code, ... }` response contract and
 * never expose provider errors, filesystem paths, object names, or tokens.
 */

import {
  StorageDomainError,
  isStorageDomainError,
  normalizeStorageError,
  type StorageErrorCode,
  type StorageOperationOutcome,
} from './storage-domain-error';
import { ValidationError } from 'elysia';

export type StorageHttpOperation = 'read' | 'write';

export interface StorageHttpFailure {
  readonly ok: false;
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 416 | 500 | 503;
  readonly body: Readonly<{
    error: string;
    code: StorageErrorCode;
    retryable: boolean;
    outcome?: StorageOperationOutcome;
    /** Present only for a write whose commit outcome cannot be established. */
    requiresSameIdempotencyKey?: true;
  }>;
}

export interface StorageHttpProjection {
  readonly error: StorageDomainError;
  readonly failure: StorageHttpFailure;
}

interface PublicStorageError {
  readonly status: StorageHttpFailure['status'];
  readonly message: string;
}

const PUBLIC_ERRORS = Object.freeze({
  STORAGE_DISABLED: publicError(503, 'Storage is disabled.'),
  STORAGE_STUDIO_DISABLED: publicError(503, 'Storage Studio is disabled.'),
  STORAGE_NOT_READY: publicError(503, 'Storage is not ready.'),
  STORAGE_INPUT_INVALID: publicError(400, 'Storage input is invalid.'),
  STORAGE_METADATA_INVALID: publicError(400, 'Storage metadata is invalid.'),
  STORAGE_AUTHENTICATION_REQUIRED: publicError(401, 'Storage authentication is required.'),
  STORAGE_AUTHORITY_REQUIRED: publicError(403, 'Storage access is forbidden.'),
  STORAGE_AUTHORITY_CHANGED: publicError(403, 'Storage authority changed.'),
  STORAGE_NOT_FOUND: publicError(404, 'Storage resource was not found.'),
  STORAGE_DRIVE_NOT_FOUND: publicError(404, 'Storage drive was not found.'),
  STORAGE_OBJECT_NOT_FOUND: publicError(404, 'Storage object was not found.'),
  STORAGE_CONFLICT: publicError(409, 'Storage operation conflicts with current state.'),
  STORAGE_DRIVE_KEY_CONFLICT: publicError(409, 'Storage drive key is already in use.'),
  STORAGE_PATH_CONFLICT: publicError(409, 'Storage path is already in use.'),
  STORAGE_POLICY_VIOLATION: publicError(403, 'Storage policy does not permit this operation.'),
  STORAGE_LIMIT_EXCEEDED: publicError(413, 'Storage input exceeds a limit.'),
  STORAGE_QUOTA_EXCEEDED: publicError(413, 'Storage quota is exceeded.'),
  STORAGE_CONTENT_TYPE_UNSUPPORTED: publicError(415, 'Storage content type is not supported.'),
  STORAGE_RANGE_NOT_SATISFIABLE: publicError(416, 'Storage byte range is not satisfiable.'),
  STORAGE_CAPABILITY_INVALID: publicError(403, 'Storage capability is invalid.'),
  STORAGE_CAPABILITY_EXPIRED: publicError(403, 'Storage capability is expired.'),
  STORAGE_REVISION_CONFLICT: publicError(409, 'Storage revision changed.'),
  STORAGE_IDEMPOTENCY_CONFLICT: publicError(409, 'Storage operation conflicts with an earlier request.'),
  STORAGE_OPERATION_IN_PROGRESS: publicError(409, 'Storage operation is already in progress.'),
  STORAGE_OPERATION_OUTCOME_UNKNOWN: publicError(503, 'Storage mutation outcome is unknown.'),
  STORAGE_PROVIDER_UNAVAILABLE: publicError(503, 'Storage provider is temporarily unavailable.'),
  STORAGE_INTERNAL: publicError(500, 'Storage operation failed.'),
} satisfies Record<StorageErrorCode, PublicStorageError>);

/** Convert any caught value into a stable, privacy-safe HTTP failure. */
export function toStorageHttpFailure(
  error: unknown,
  operation: StorageHttpOperation,
): StorageHttpFailure {
  const normalized = normalizeStorageError(error);
  const publicShape = PUBLIC_ERRORS[normalized.code];
  const ambiguousWrite = operation === 'write' && normalized.outcome === 'unknown';
  const outcome = ambiguousWrite ? 'unknown' as const : normalized.outcome;
  return Object.freeze({
    ok: false,
    status: ambiguousWrite ? 503 : publicShape.status,
    body: Object.freeze({
      error: ambiguousWrite
        ? 'Storage mutation outcome is unknown.'
        : publicShape.message,
      code: normalized.code,
      retryable: normalized.retryable,
      ...(outcome === null ? {} : { outcome }),
      ...(ambiguousWrite ? { requiresSameIdempotencyKey: true as const } : {}),
    }),
  });
}

/**
 * Normalize route-handler, parser, and schema failures without reflecting
 * rejected bodies, schemas, provider messages, or filesystem details.
 */
export function projectStorageHttpFailure(
  transportCode: unknown,
  error: unknown,
  operation: StorageHttpOperation,
): StorageHttpProjection | null {
  let normalized: StorageDomainError;
  if (isStorageDomainError(error)) {
    normalized = normalizeStorageError(error);
  } else if (transportCode === 'PARSE') {
    normalized = new StorageDomainError(
      'STORAGE_INPUT_INVALID',
      'Storage request body could not be parsed.',
    );
  } else if (transportCode === 'VALIDATION') {
    const responseFailure = error instanceof ValidationError
      && error.type === 'response';
    normalized = new StorageDomainError(
      responseFailure ? 'STORAGE_INTERNAL' : 'STORAGE_INPUT_INVALID',
      responseFailure
        ? 'Storage response validation failed.'
        : 'Storage request validation failed.',
    );
  } else if (transportCode === 'UNKNOWN' || transportCode === 'INTERNAL_SERVER_ERROR') {
    normalized = normalizeStorageError(error);
  } else {
    return null;
  }
  return Object.freeze({
    error: normalized,
    failure: toStorageHttpFailure(normalized, operation),
  });
}

function publicError(
  status: PublicStorageError['status'],
  message: string,
): PublicStorageError {
  return Object.freeze({ status, message });
}
