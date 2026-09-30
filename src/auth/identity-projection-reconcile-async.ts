/** Explicit asynchronous runner for actor-backed identity projection targets. */

import { identityProjectionError } from './identity-projection-error';
import {
  assertIdentityProjectionCanBecomeReady,
  assertIdentityProjectionDeliveryBudget,
  claimNextIdentityProjectionDelivery,
  enqueueIdentityProjectionAnchor,
  isIdentityProjectionVerifiedReady,
  markIdentityProjectionSourceReady,
  recordIdentityProjectionApplied,
  recordIdentityProjectionFailure,
  requireIdentityProjectionTargetState,
  shouldRefreshIdentityProjectionReady,
  type IdentityProjectionReconcileDependencies,
} from './identity-projection-reconcile-support';
import type {
  EnsureIdentityAnchorResult,
  IdentityAnchor,
  IdentityProjectionDelivery,
  IdentityProjectionReceipt,
  IdentityProjectionTarget,
  IdentityProjectionTargetState,
} from './identity-projection-types';

export class AsyncIdentityProjectionReconciler {
  constructor(
    private readonly dependencies: IdentityProjectionReconcileDependencies,
  ) {}

  async ensureAnchor(
    targetId: string,
    anchor: IdentityAnchor,
    target: IdentityProjectionTarget,
  ): Promise<EnsureIdentityAnchorResult> {
    const wanted = enqueueIdentityProjectionAnchor(
      this.dependencies,
      targetId,
      anchor,
    ).delivery;
    const replayed = await this.replayCompletedThrough(
      targetId,
      wanted.sequence,
      target,
    );
    if (wanted.status === 'completed') {
      const targetState = await target.inspect();
      if (targetState.watermark < wanted.sequence) {
        throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
      }
      const receipt = replayed ?? await target.apply(wanted);
      let state = requireIdentityProjectionTargetState(this.dependencies, targetId);
      const refreshedTargetState = await target.inspect();
      if (shouldRefreshIdentityProjectionReady(state, refreshedTargetState)) {
        await target.markReady();
        state = markIdentityProjectionSourceReady(this.dependencies, targetId);
      }
      return { delivery: wanted, receipt };
    }

    while (true) {
      const delivery = claimNextIdentityProjectionDelivery(this.dependencies, targetId);
      if (!delivery) throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
      const receipt = await this.applyClaim(delivery, target);
      if (delivery.eventId === wanted.eventId) {
        await target.markReady();
        markIdentityProjectionSourceReady(this.dependencies, targetId);
        return { delivery, receipt };
      }
    }
  }

  async reconcileTarget(
    targetId: string,
    target: IdentityProjectionTarget,
    maxDeliveries: number,
  ): Promise<{ processed: number; state: IdentityProjectionTargetState }> {
    assertIdentityProjectionDeliveryBudget(maxDeliveries);
    const initialState = requireIdentityProjectionTargetState(
      this.dependencies,
      targetId,
    );
    const initialTargetState = await target.inspect();
    if (isIdentityProjectionVerifiedReady(initialState, initialTargetState)) {
      return { processed: 0, state: initialState };
    }

    this.dependencies.outbox.recoverExpired();
    let processed = await this.replayCompletedBacklog(
      targetId,
      target,
      maxDeliveries,
    );
    while (processed < maxDeliveries) {
      const delivery = claimNextIdentityProjectionDelivery(this.dependencies, targetId);
      if (!delivery) break;
      await this.applyClaim(delivery, target);
      processed += 1;
    }

    let state = requireIdentityProjectionTargetState(this.dependencies, targetId);
    // Reaching the caller's budget is a successful bounded pass, not a target
    // failure. Leave readiness in provisioning so an orchestrator can drain
    // another batch without misclassifying a healthy large backlog.
    if (processed === maxDeliveries) {
      const budgetTargetState = await target.inspect();
      if (state.pendingDeliveries !== 0
        || budgetTargetState.watermark < state.acknowledgedSequence) {
        return { processed, state };
      }
    }
    assertIdentityProjectionCanBecomeReady(state);
    await target.markReady();
    state = markIdentityProjectionSourceReady(this.dependencies, targetId);
    const verifiedTarget = await target.inspect();
    if (!isIdentityProjectionVerifiedReady(state, verifiedTarget)) {
      throw identityProjectionError('IDENTITY_PROJECTION_NOT_READY');
    }
    return { processed, state };
  }

  private async replayCompletedThrough(
    targetId: string,
    throughSequence: number,
    target: IdentityProjectionTarget,
  ): Promise<IdentityProjectionReceipt | null> {
    let wantedReceipt: IdentityProjectionReceipt | null = null;
    let remaining = 10_000;
    while ((await target.inspect()).watermark < throughSequence && remaining > 0) {
      const watermark = (await target.inspect()).watermark;
      const batch = this.dependencies.outbox.listCompletedAfter(
        targetId,
        watermark,
        Math.min(remaining, 100),
      );
      if (batch.length === 0 || batch[0]!.sequence !== watermark + 1) break;
      for (const delivery of batch) {
        if (delivery.sequence > throughSequence) break;
        const receipt = await this.applyClaim(delivery, target);
        if (delivery.sequence === throughSequence) wantedReceipt = receipt;
        remaining -= 1;
      }
    }
    return wantedReceipt;
  }

  private async replayCompletedBacklog(
    targetId: string,
    target: IdentityProjectionTarget,
    budget: number,
  ): Promise<number> {
    let processed = 0;
    while (processed < budget) {
      const watermark = (await target.inspect()).watermark;
      const state = this.dependencies.outbox.getTargetState(targetId);
      if (!state || watermark >= state.acknowledgedSequence) break;
      const batch = this.dependencies.outbox.listCompletedAfter(
        targetId,
        watermark,
        Math.min(100, budget - processed),
      );
      if (batch.length === 0 || batch[0]!.sequence !== watermark + 1) {
        throw identityProjectionError('IDENTITY_PROJECTION_CONFLICT');
      }
      for (const delivery of batch) {
        if (delivery.sequence > state.acknowledgedSequence) break;
        await this.applyClaim(delivery, target);
        processed += 1;
      }
    }
    return processed;
  }

  private async applyClaim(
    delivery: IdentityProjectionDelivery,
    target: IdentityProjectionTarget,
  ): Promise<IdentityProjectionReceipt> {
    try {
      const receipt = await target.apply(delivery);
      recordIdentityProjectionApplied(this.dependencies, delivery, receipt);
      return receipt;
    } catch (error) {
      recordIdentityProjectionFailure(this.dependencies, delivery, error);
      throw error;
    }
  }
}
