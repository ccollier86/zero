/**
 * storage-studio-mutation.ts
 *
 * Owns Storage Studio operation IDs and ambiguous mutation failure semantics.
 * It contains no React state, HTTP route construction, or response parsing.
 */

import {
  isStorageErrorCode,
  type StorageErrorCode,
  type StorageOperationOutcome,
} from '../../storage/storage-domain-error';
import type { FetchInit } from './sdk';
import type {
  StorageStudioMutationFailureBody,
  StorageStudioMutationOptions,
} from './storage-studio-client-types';

type StorageStudioFetch = <T = unknown>(path: string, init?: FetchInit) => Promise<T>;

/** Failed mutation retaining the operation ID required for a safe retry. */
export class StorageStudioMutationError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly code: StorageErrorCode | null;
  readonly retryable: boolean;
  readonly outcome: StorageOperationOutcome | null;
  readonly requiresSameIdempotencyKey: boolean;

  constructor(
    message: string,
    operationId: string,
    options: {
      readonly status?: number | null;
      readonly code?: StorageErrorCode | null;
      readonly retryable?: boolean;
      readonly outcome?: StorageOperationOutcome | null;
      readonly requiresSameIdempotencyKey?: boolean;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StorageStudioMutationError';
    this.operationId = operationId;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
    this.outcome = options.outcome ?? null;
    this.requiresSameIdempotencyKey = options.requiresSameIdempotencyKey ?? false;
  }
}

/** Generate a browser/worker/Bun-native opaque idempotency key. */
export function createStorageStudioOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }
  return `storage-studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isStorageStudioMutationError(value: unknown): value is StorageStudioMutationError {
  return value instanceof StorageStudioMutationError;
}

export async function mutateStorageStudio<T>(
  fetch: StorageStudioFetch,
  path: string,
  method: string,
  input: Readonly<object>,
  options: StorageStudioMutationOptions,
): Promise<{ readonly operationId: string; readonly value: T }> {
  const operationId = options.operationId ?? createStorageStudioOperationId();
  try {
    const value = await fetch<T>(path, {
      method,
      signal: options.signal,
      body: { ...input, operationId },
    });
    return Object.freeze({ operationId, value });
  } catch (cause) {
    throw toStorageStudioMutationError(cause, operationId);
  }
}

export function verifyStorageStudioMutationResponse<T>(
  operationId: string,
  consume: () => T,
): T {
  try {
    return consume();
  } catch (cause) {
    if (cause instanceof StorageStudioMutationError) throw cause;
    throw new StorageStudioMutationError(
      'Storage Studio committed a mutation but returned an unverifiable response.',
      operationId,
      { outcome: 'unknown', requiresSameIdempotencyKey: true, cause },
    );
  }
}

function toStorageStudioMutationError(
  cause: unknown,
  operationId: string,
): StorageStudioMutationError {
  const candidate = cause as {
    readonly message?: unknown;
    readonly status?: unknown;
    readonly body?: unknown;
  };
  const body = isRecord(candidate?.body)
    ? candidate.body as StorageStudioMutationFailureBody
    : {};
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const outcome = isStorageOutcome(body.outcome) ? body.outcome : null;
  const explicitSameKey = body.requiresSameIdempotencyKey === true;
  const ambiguousTransport = status === null || status >= 500 || outcome === 'unknown';
  return new StorageStudioMutationError(
    typeof body.error === 'string'
      ? body.error
      : typeof candidate?.message === 'string'
        ? candidate.message
        : 'Storage Studio mutation failed.',
    operationId,
    {
      status,
      code: isStorageErrorCode(body.code) ? body.code : null,
      retryable: body.retryable === true,
      outcome: ambiguousTransport ? 'unknown' : outcome,
      requiresSameIdempotencyKey: explicitSameKey || ambiguousTransport,
      cause,
    },
  );
}

function isStorageOutcome(value: unknown): value is StorageOperationOutcome {
  return value === 'not-started'
    || value === 'not-committed'
    || value === 'committed'
    || value === 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
