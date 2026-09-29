/**
 * resource-crud-results.ts
 *
 * Owns stable generated Resource CRUD response construction. It centralizes
 * transport-safe failure contracts but does not classify database exceptions,
 * emit telemetry, evaluate policy, or access persistence.
 */

import type {
  ResourceCrudFailure,
  ResourceCrudSuccess,
} from './resource-crud-contracts';

/** Build a successful generated Resource result. */
export function resourceSuccess<TBody>(
  status: number,
  body: TBody,
): ResourceCrudSuccess<TBody> {
  return { ok: true, status, body };
}

/** Build a stable generated Resource failure. */
export function resourceFailure(
  status: number,
  error: string,
  code?: string,
  retryable?: boolean,
): ResourceCrudFailure {
  return {
    ok: false,
    status,
    body: retryable === undefined
      ? { error, code }
      : { error, code, retryable },
  };
}

/** Build an ambiguous-write failure which requires the original receipt key. */
export function sameIdempotencyKeyFailure(
  status: number,
  error: string,
  code: string,
): ResourceCrudFailure {
  return {
    ok: false,
    status,
    body: {
      error,
      code,
      retryable: false,
      requiresSameIdempotencyKey: true,
    },
  };
}

/** Project a declarative policy denial into the generated Resource contract. */
export function resourcePolicyFailure(
  status = 403,
  message = 'Forbidden',
  reason?: string,
): ResourceCrudFailure {
  return resourceFailure(status, message, reason);
}

/** Stable failure returned when live authority differs from its capture. */
export function resourceAuthorityChangedFailure(): ResourceCrudFailure {
  return resourceFailure(
    403,
    'Resource authorization changed during the request',
    'resource-authority-changed',
  );
}

/** Stable optimistic-concurrency failure for an authorized row snapshot. */
export function resourceRowChangedFailure(): ResourceCrudFailure {
  return resourceFailure(
    409,
    'Resource row changed during authorization; retry the operation',
    'resource-row-changed',
  );
}

/** Stable generic constraint/conflict response. */
export function resourceConflictFailure(): ResourceCrudFailure {
  return resourceFailure(
    409,
    'Resource mutation conflicts with current state',
    'resource-conflict',
  );
}

/** Stable response when a verified physical tenant plane cannot be reached. */
export function tenantDatabaseUnavailableFailure(): ResourceCrudFailure {
  return resourceFailure(
    503,
    'Tenant database is temporarily unavailable',
    'database-unavailable',
  );
}
