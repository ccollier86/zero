import { IdentityProjectionError } from '../../auth/identity-projection-error';
import {
  isDatabaseError,
  normalizeDatabaseError,
} from '../../databases/database-error';
import type {
  IdentityAnchorState,
  IdentityProjectionTargetState,
} from '../../auth/identity-projection-types';
import type { DataRealmReadinessService } from '../../auth/data-realm-readiness.plugin';
import {
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  type DataRealmReadinessSnapshot,
} from '../../auth/data-realm-readiness-types';

/** Authenticated fallback used when the app schema needs no identity anchors. */
export const NOT_REQUIRED_DATA_REALM_READINESS: DataRealmReadinessService =
  Object.freeze({
    inspect: () => notRequiredDataRealmReadiness(),
    retry: () => notRequiredDataRealmReadiness(),
  });

export function identityProjectionReadinessFromState(
  state: IdentityProjectionTargetState | null,
  scope: 'application' | 'tenant',
): DataRealmReadinessSnapshot {
  if (!state) {
    return Object.freeze({
      status: 'provisioning',
      scope,
      pendingOperations: 0,
      retryable: false,
      errorCode: null,
      updatedAt: null,
      pollAfterMs: DATA_REALM_READINESS_DEFAULT_POLL_MS,
    });
  }
  if (state.status === 'quarantined') {
    return Object.freeze({
      status: 'failed',
      scope,
      pendingOperations: state.pendingDeliveries,
      retryable: false,
      errorCode: state.lastErrorCode ?? 'IDENTITY_PROJECTION_QUARANTINED',
      updatedAt: state.updatedAt,
      pollAfterMs: null,
    });
  }
  if (state.status === 'ready' && state.pendingDeliveries === 0) {
    return Object.freeze({
      status: 'ready',
      scope,
      pendingOperations: 0,
      retryable: false,
      errorCode: null,
      updatedAt: state.updatedAt,
      pollAfterMs: null,
    });
  }
  return Object.freeze({
    status: state.lastErrorCode ? 'retrying' : 'provisioning',
    scope,
    pendingOperations: state.pendingDeliveries,
    retryable: false,
    errorCode: null,
    updatedAt: state.updatedAt,
    pollAfterMs: DATA_REALM_READINESS_DEFAULT_POLL_MS,
  });
}

/** Require matching durable state on both the Guardian journal and target. */
export function identityProjectionReadinessFromTarget(
  source: IdentityProjectionTargetState | null,
  target: IdentityAnchorState | null,
  expected: Readonly<{
    installationId: string;
    targetId: string;
    scope: 'application' | 'tenant';
  }>,
): DataRealmReadinessSnapshot {
  const sourceReadiness = identityProjectionReadinessFromState(
    source,
    expected.scope,
  );
  if (sourceReadiness.status !== 'ready' || !source) return sourceReadiness;
  if (!target) return targetPendingReadiness(source, expected.scope, null);
  if (target.installationId !== expected.installationId
    || target.targetId !== expected.targetId) {
    return targetFailureReadiness(
      source,
      expected.scope,
      'IDENTITY_PROJECTION_TARGET_MISMATCH',
      target.updatedAt,
    );
  }
  if (target.status === 'quarantined') {
    return targetFailureReadiness(
      source,
      expected.scope,
      safeProjectionErrorCode(target.quarantineCode),
      target.updatedAt,
    );
  }
  if (target.status !== 'ready'
    || target.watermark < source.acknowledgedSequence) {
    return targetPendingReadiness(source, expected.scope, target);
  }
  return Object.freeze({
    ...sourceReadiness,
    updatedAt: Math.max(source.updatedAt, target.updatedAt),
  });
}

/** Keep target inspection failures privacy-safe while failing closed. */
export function identityProjectionReadinessFromTargetError(
  source: IdentityProjectionTargetState | null,
  scope: 'application' | 'tenant',
  error: unknown,
): DataRealmReadinessSnapshot {
  const sourceReadiness = identityProjectionReadinessFromState(source, scope);
  if (sourceReadiness.status !== 'ready' || !source) return sourceReadiness;
  try {
    if (error instanceof IdentityProjectionError && !error.retryable) {
      return targetFailureReadiness(source, scope, error.code, source.updatedAt);
    }
  } catch {
    // Hostile values and infrastructure failures remain an unverified target.
  }
  if (isDatabaseError(error)) {
    const databaseError = normalizeDatabaseError(error);
    if (!databaseError.retryable) {
      return targetFailureReadiness(
        source,
        scope,
        databaseError.code,
        source.updatedAt,
      );
    }
  }
  return targetPendingReadiness(source, scope, null);
}

export function notRequiredDataRealmReadiness(): DataRealmReadinessSnapshot {
  return Object.freeze({
    status: 'not-required',
    scope: null,
    pendingOperations: 0,
    retryable: false,
    errorCode: null,
    updatedAt: null,
    pollAfterMs: null,
  });
}

export function assertDataRealmReadinessRequestNotAborted(
  signal: AbortSignal,
): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}

function targetPendingReadiness(
  source: IdentityProjectionTargetState,
  scope: 'application' | 'tenant',
  target: IdentityAnchorState | null,
): DataRealmReadinessSnapshot {
  const targetLag = target
    ? Math.max(0, source.acknowledgedSequence - target.watermark)
    : 0;
  return Object.freeze({
    status: 'provisioning',
    scope,
    pendingOperations: Math.max(source.pendingDeliveries, targetLag),
    retryable: false,
    errorCode: null,
    updatedAt: target?.updatedAt ?? source.updatedAt,
    pollAfterMs: DATA_REALM_READINESS_DEFAULT_POLL_MS,
  });
}

function targetFailureReadiness(
  source: IdentityProjectionTargetState,
  scope: 'application' | 'tenant',
  errorCode: string,
  updatedAt: number,
): DataRealmReadinessSnapshot {
  return Object.freeze({
    status: 'failed',
    scope,
    pendingOperations: source.pendingDeliveries,
    retryable: false,
    errorCode,
    updatedAt,
    pollAfterMs: null,
  });
}

function safeProjectionErrorCode(value: string | null): string {
  return value && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value)
    ? value
    : 'IDENTITY_PROJECTION_QUARANTINED';
}
