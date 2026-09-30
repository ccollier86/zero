/** Public, credential-free readiness state for the caller's active data realm. */
export const DATA_REALM_READINESS_STATUSES = Object.freeze([
  'not-required',
  'provisioning',
  'retrying',
  'ready',
  'failed',
] as const);

export type DataRealmReadinessStatus =
  (typeof DATA_REALM_READINESS_STATUSES)[number];

export type DataRealmReadinessScope = 'application' | 'tenant' | 'named';

/**
 * Safe browser projection of server-owned realm provisioning.
 *
 * Target identifiers, database paths, SQL errors, and identity details are
 * deliberately absent. The authenticated request determines the target.
 */
export interface DataRealmReadinessSnapshot {
  readonly status: DataRealmReadinessStatus;
  readonly scope: DataRealmReadinessScope | null;
  readonly pendingOperations: number;
  readonly retryable: boolean;
  readonly errorCode: string | null;
  readonly updatedAt: number | null;
  readonly pollAfterMs: number | null;
}

/** Browser SDK methods for the active, server-derived realm only. */
export interface DataRealmReadinessSdkSurface {
  getReadiness(signal?: AbortSignal): Promise<DataRealmReadinessSnapshot>;
  retry(signal?: AbortSignal): Promise<DataRealmReadinessSnapshot>;
}

export const DATA_REALM_READINESS_DEFAULT_POLL_MS = 1_500;
export const DATA_REALM_READINESS_MIN_POLL_MS = 250;
export const DATA_REALM_READINESS_MAX_POLL_MS = 30_000;

/** Stable validation failure for malformed readiness adapters or responses. */
export class DataRealmReadinessContractError extends Error {
  readonly code = 'DATA_REALM_READINESS_INVALID';

  constructor() {
    super('Data realm readiness response is invalid');
    this.name = 'DataRealmReadinessContractError';
  }
}

/**
 * Validate and freeze a public readiness response at the server/client seam.
 * No caller-controlled identifiers are accepted by this contract.
 */
export function parseDataRealmReadinessSnapshot(
  input: unknown,
): DataRealmReadinessSnapshot {
  if (!isRecord(input)) throw new DataRealmReadinessContractError();
  const status = input.status;
  const scope = input.scope;
  const pendingOperations = input.pendingOperations;
  const retryable = input.retryable;
  const errorCode = input.errorCode;
  const updatedAt = input.updatedAt;
  const pollAfterMs = input.pollAfterMs;

  if (!isReadinessStatus(status)
    || !isReadinessScopeOrNull(scope)
    || !isBoundedCount(pendingOperations)
    || typeof retryable !== 'boolean'
    || !isErrorCodeOrNull(errorCode)
    || !isTimestampOrNull(updatedAt)
    || !isPollIntervalOrNull(pollAfterMs)) {
    throw new DataRealmReadinessContractError();
  }

  if (status === 'not-required') {
    if (scope !== null || pendingOperations !== 0 || retryable
      || errorCode !== null || pollAfterMs !== null) {
      throw new DataRealmReadinessContractError();
    }
  } else if (scope === null) {
    throw new DataRealmReadinessContractError();
  }

  const pending = status === 'provisioning' || status === 'retrying';
  if (pending) {
    if (retryable || errorCode !== null) throw new DataRealmReadinessContractError();
  } else if (pollAfterMs !== null) {
    throw new DataRealmReadinessContractError();
  }

  if (status === 'failed') {
    if (errorCode === null) throw new DataRealmReadinessContractError();
  } else if (errorCode !== null || retryable) {
    throw new DataRealmReadinessContractError();
  }

  return Object.freeze({
    status,
    scope,
    pendingOperations,
    retryable,
    errorCode,
    updatedAt,
    pollAfterMs,
  });
}

export function dataRealmReadinessAllowsApplicationData(
  readiness: Pick<DataRealmReadinessSnapshot, 'status'>,
): boolean {
  return readiness.status === 'ready' || readiness.status === 'not-required';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isReadinessStatus(value: unknown): value is DataRealmReadinessStatus {
  return typeof value === 'string'
    && (DATA_REALM_READINESS_STATUSES as readonly string[]).includes(value);
}

function isReadinessScopeOrNull(
  value: unknown,
): value is DataRealmReadinessScope | null {
  return value === null || value === 'application' || value === 'tenant'
    || value === 'named';
}

function isBoundedCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0;
}

function isErrorCodeOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string'
    && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value));
}

function isTimestampOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0);
}

function isPollIntervalOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= DATA_REALM_READINESS_MIN_POLL_MS
    && value <= DATA_REALM_READINESS_MAX_POLL_MS);
}
