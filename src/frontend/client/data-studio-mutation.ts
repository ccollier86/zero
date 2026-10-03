/**
 * data-studio-mutation.ts
 *
 * Data Studio mutation transport semantics: operation IDs, ambiguous-outcome
 * errors, and response verification. It contains no React or cache policy.
 */

import type { DataStudioErrorCode } from '../../data-studio/data-studio-error';
import { isDataStudioErrorCode } from '../../data-studio/data-studio-error';
import type { FetchInit } from './sdk';
import type {
  DataStudioMutationFailureBody,
  DataStudioMutationOptions,
} from './data-studio-client-types';

type DataStudioFetch = <T = unknown>(path: string, init?: FetchInit) => Promise<T>;

/** A failed mutation retaining the operation id needed for a safe retry. */
export class DataStudioMutationError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly code: DataStudioErrorCode | null;
  readonly retryable: boolean;
  readonly requiresSameIdempotencyKey: boolean;

  constructor(
    message: string,
    operationId: string,
    options: {
      status?: number | null;
      code?: DataStudioErrorCode | null;
      retryable?: boolean;
      requiresSameIdempotencyKey?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DataStudioMutationError';
    this.operationId = operationId;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
    this.requiresSameIdempotencyKey = options.requiresSameIdempotencyKey ?? false;
  }
}

/** Generate an opaque idempotency key in browsers, workers, Bun, and SSR tests. */
export function createDataStudioOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }
  return `data-studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isDataStudioMutationError(value: unknown): value is DataStudioMutationError {
  return value instanceof DataStudioMutationError;
}

export function isDataStudioRevisionConflict(value: unknown): boolean {
  return value instanceof DataStudioMutationError
    && value.code === 'DATA_STUDIO_REVISION_CONFLICT';
}

export async function mutate<T>(
  fetch: DataStudioFetch,
  path: string,
  method: string,
  input: Readonly<object>,
  options: DataStudioMutationOptions,
): Promise<T> {
  const operationId = options.operationId ?? createDataStudioOperationId();
  try {
    return await fetch<T>(path, {
      method,
      signal: options.signal,
      body: { ...input, operationId },
    });
  } catch (cause) {
    throw toMutationError(cause, operationId);
  }
}

export function verifyMutationResponse<T>(operationId: string, consume: () => T): T {
  try {
    return consume();
  } catch (cause) {
    if (cause instanceof DataStudioMutationError) throw cause;
    throw new DataStudioMutationError(
      'Data Studio committed a mutation but returned an unverifiable response.',
      operationId,
      { requiresSameIdempotencyKey: true, cause },
    );
  }
}

function toMutationError(cause: unknown, operationId: string): DataStudioMutationError {
  const candidate = cause as {
    readonly message?: unknown;
    readonly status?: unknown;
    readonly body?: unknown;
  };
  const body = isRecord(candidate?.body)
    ? candidate.body as DataStudioMutationFailureBody
    : {};
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const code = isDataStudioErrorCode(body.code) ? body.code : null;
  const message = typeof body.error === 'string'
    ? body.error
    : typeof candidate?.message === 'string'
      ? candidate.message
      : 'Data Studio mutation failed.';
  const explicitSameKey = body.requiresSameIdempotencyKey === true;
  // A missing HTTP response or 5xx response is outcome-ambiguous. Retaining
  // the id is always safe and prevents an accidental duplicate on retry.
  const ambiguousTransport = status === null || status >= 500;
  return new DataStudioMutationError(message, operationId, {
    status,
    code,
    retryable: body.retryable === true,
    requiresSameIdempotencyKey: explicitSameKey || ambiguousTransport,
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
