/** Shared durable state, failure, and telemetry rules for projection runners. */

import {
  normalizeDatabaseError,
  type DatabaseOperationOutcome,
} from '../databases/database-error';
import { OBS_CODES } from '../observability/codes';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import {
  IdentityProjectionError,
  identityProjectionError,
} from './identity-projection-error';
import type { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import type {
  IdentityAnchor,
  IdentityAnchorState,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTargetState,
} from './identity-projection-types';

export interface IdentityProjectionReconcileDependencies {
  readonly outbox: IdentityProjectionOutboxStore;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly retryDelayMs: number;
  readonly now: () => number;
  readonly emitCode: AuthPlatformCodeEmitter;
}

export function assertIdentityProjectionDeliveryBudget(maxDeliveries: number): void {
  if (!Number.isSafeInteger(maxDeliveries)
    || maxDeliveries < 1
    || maxDeliveries > 10_000) {
    throw new TypeError('maxDeliveries must be between 1 and 10000');
  }
}

export function enqueueIdentityProjectionAnchor(
  dependencies: IdentityProjectionReconcileDependencies,
  targetId: string,
  anchor: IdentityAnchor,
): ReturnType<IdentityProjectionOutboxStore['enqueueWithDisposition']> {
  const enqueued = dependencies.outbox.enqueueWithDisposition(targetId, anchor);
  if (enqueued.inserted) {
    emitDelivery(
      dependencies,
      OBS_CODES.AUTH_IDENTITY_PROJECTION_ENQUEUED,
      enqueued.delivery,
    );
  }
  return enqueued;
}

export function claimNextIdentityProjectionDelivery(
  dependencies: IdentityProjectionReconcileDependencies,
  targetId: string,
): IdentityProjectionDelivery | null {
  return dependencies.outbox.claimNext(
    targetId,
    dependencies.workerId,
    dependencies.leaseMs,
  );
}

export function requireIdentityProjectionTargetState(
  dependencies: IdentityProjectionReconcileDependencies,
  targetId: string,
): IdentityProjectionTargetState {
  const state = dependencies.outbox.getTargetState(targetId);
  if (!state) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
  return state;
}

/** A live lease or remaining backlog always keeps admission fail-closed. */
export function assertIdentityProjectionCanBecomeReady(
  state: IdentityProjectionTargetState,
): void {
  if (state.status === 'quarantined') {
    throw identityProjectionError('IDENTITY_PROJECTION_QUARANTINED');
  }
  if (state.pendingDeliveries !== 0) {
    throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
  }
}

export function isIdentityProjectionVerifiedReady(
  source: IdentityProjectionTargetState,
  target: IdentityAnchorState,
): boolean {
  return source.status === 'ready'
    && source.pendingDeliveries === 0
    && target.status === 'ready'
    && target.targetId === source.targetId
    && target.watermark === source.acknowledgedSequence;
}

export function shouldRefreshIdentityProjectionReady(
  source: IdentityProjectionTargetState,
  target: IdentityAnchorState,
): boolean {
  return source.pendingDeliveries === 0
    && !isIdentityProjectionVerifiedReady(source, target);
}

export function markIdentityProjectionSourceReady(
  dependencies: IdentityProjectionReconcileDependencies,
  targetId: string,
): IdentityProjectionTargetState {
  const state = dependencies.outbox.markReady(targetId);
  emitIdentityProjectionCode(dependencies, OBS_CODES.AUTH_IDENTITY_PROJECTION_READY, {
    metadata: safeTargetMetadata(state),
  });
  return state;
}

export function recordIdentityProjectionApplied(
  dependencies: IdentityProjectionReconcileDependencies,
  delivery: IdentityProjectionDelivery,
  receipt: IdentityProjectionReceipt,
): void {
  dependencies.outbox.acknowledge(delivery, receipt);
  emitDelivery(
    dependencies,
    OBS_CODES.AUTH_IDENTITY_PROJECTION_APPLIED,
    delivery,
    { duplicate: receipt.duplicate },
  );
}

/** Persist one stable failure disposition without logging private error data. */
export function recordIdentityProjectionFailure(
  dependencies: IdentityProjectionReconcileDependencies,
  delivery: IdentityProjectionDelivery,
  error: unknown,
): void {
  const failure = classifyIdentityProjectionFailure(error);
  if (failure.retryable) {
    // Completed history is replayed into a rebuilt target without a source
    // lease. Leave that immutable source receipt completed and retry only the
    // lagging target; generation-fenced release is reserved for live claims.
    if (delivery.status !== 'completed') {
      dependencies.outbox.release(
        delivery,
        dependencies.now() + dependencies.retryDelayMs,
        failure.code,
      );
    }
    emitDelivery(
      dependencies,
      OBS_CODES.AUTH_IDENTITY_PROJECTION_RETRY,
      delivery,
      { code: failure.code, attempt: delivery.attempts },
    );
    return;
  }

  const state = dependencies.outbox.quarantine(delivery, failure.code);
  emitIdentityProjectionCode(
    dependencies,
    OBS_CODES.AUTH_IDENTITY_PROJECTION_QUARANTINED,
    {
      metadata: {
        ...safeTargetMetadata(state),
        code: failure.code,
        sequence: delivery.sequence,
      },
    },
  );
}

interface ProjectionFailureDisposition {
  readonly code: string;
  readonly retryable: boolean;
}

function classifyIdentityProjectionFailure(
  error: unknown,
): ProjectionFailureDisposition {
  if (error instanceof IdentityProjectionError) {
    return Object.freeze({
      code: error.code,
      retryable: error.retryable,
    });
  }

  const databaseError = normalizeDatabaseError(error);
  return Object.freeze({
    code: databaseError.code,
    retryable: databaseError.retryable
      && permitsSafeProjectionReplay(databaseError.outcome),
  });
}

function permitsSafeProjectionReplay(outcome: DatabaseOperationOutcome | null): boolean {
  return outcome === 'not-started' || outcome === 'not-committed';
}

function emitDelivery(
  dependencies: IdentityProjectionReconcileDependencies,
  definition: PlatformCodeDefinition,
  delivery: IdentityProjectionDelivery,
  metadata: Record<string, string | number | boolean> = {},
): void {
  try {
    const state = dependencies.outbox.getTargetState(delivery.targetId);
    emitIdentityProjectionCode(dependencies, definition, {
      metadata: {
        scope: state?.scope ?? 'unknown',
        sequence: delivery.sequence,
        anchorKind: delivery.anchor.kind,
        ...metadata,
      },
    });
  } catch {
    // Projection durability and admission never depend on telemetry delivery.
  }
}

function emitIdentityProjectionCode(
  dependencies: IdentityProjectionReconcileDependencies,
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions,
): void {
  try {
    dependencies.emitCode(definition, options);
  } catch {
    // Custom app-local emitters must obey the platform's best-effort contract.
  }
}

function safeTargetMetadata(state: IdentityProjectionTargetState) {
  return {
    scope: state.scope,
    status: state.status,
    acknowledgedSequence: state.acknowledgedSequence,
    pendingDeliveries: state.pendingDeliveries,
  };
}
