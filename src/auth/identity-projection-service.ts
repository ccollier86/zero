/** Public identity-projection facade over explicit async and sync runners. */

import { emitPlatformCode } from '../observability/sink';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { AsyncIdentityProjectionReconciler } from './identity-projection-reconcile-async';
import type { IdentityProjectionReconcileDependencies } from './identity-projection-reconcile-support';
import { SynchronousIdentityProjectionReconciler } from './identity-projection-reconcile-sync';
import type { IdentityProjectionOutboxStore } from './identity-projection-outbox-store';
import type {
  EnsureIdentityAnchorResult,
  IdentityAnchor,
  IdentityProjectionTarget,
  IdentityProjectionTargetState,
  SynchronousIdentityProjectionTarget,
} from './identity-projection-types';

export interface IdentityProjectionServiceOptions {
  workerId?: string;
  leaseMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  emitCode?: AuthPlatformCodeEmitter;
}

/** Coordinates durable system deliveries with any declared database target. */
export class IdentityProjectionService {
  private readonly asynchronous: AsyncIdentityProjectionReconciler;
  private readonly synchronous: SynchronousIdentityProjectionReconciler;

  constructor(
    outbox: IdentityProjectionOutboxStore,
    options: IdentityProjectionServiceOptions = {},
  ) {
    const dependencies: IdentityProjectionReconcileDependencies = Object.freeze({
      outbox,
      workerId: options.workerId ?? `ipw_${crypto.randomUUID()}`,
      leaseMs: options.leaseMs ?? 30_000,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      now: options.now ?? Date.now,
      emitCode: options.emitCode ?? emitPlatformCode,
    });
    this.asynchronous = new AsyncIdentityProjectionReconciler(dependencies);
    this.synchronous = new SynchronousIdentityProjectionReconciler(dependencies);
  }

  /**
   * Enqueue and durably apply one anchor, draining older target work first.
   * Callers use this as the barrier before committing an FK to a new subject.
   */
  ensureAnchor(
    targetId: string,
    anchor: IdentityAnchor,
    target: IdentityProjectionTarget,
  ): Promise<EnsureIdentityAnchorResult> {
    return this.asynchronous.ensureAnchor(targetId, anchor, target);
  }

  /**
   * Commit an application-plane FK anchor before a Guardian transaction's
   * synchronous afterCommit queue returns. Actor-backed targets use the async
   * variant above.
   */
  ensureAnchorSync(
    targetId: string,
    anchor: IdentityAnchor,
    target: SynchronousIdentityProjectionTarget,
  ): EnsureIdentityAnchorResult {
    return this.synchronous.ensureAnchor(targetId, anchor, target);
  }

  /** Drain an in-process target without yielding past a request/startup barrier. */
  reconcileTargetSync(
    targetId: string,
    target: SynchronousIdentityProjectionTarget,
    maxDeliveries = 10_000,
  ): { processed: number; state: IdentityProjectionTargetState } {
    return this.synchronous.reconcileTarget(targetId, target, maxDeliveries);
  }

  /** Drain a bounded target backlog during startup or actor reconciliation. */
  reconcileTarget(
    targetId: string,
    target: IdentityProjectionTarget,
    maxDeliveries = 100,
  ): Promise<{ processed: number; state: IdentityProjectionTargetState }> {
    return this.asynchronous.reconcileTarget(targetId, target, maxDeliveries);
  }
}
