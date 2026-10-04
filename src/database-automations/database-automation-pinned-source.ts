/** Async host adapter for one pinned actor-local automation runtime. */

import type {
  DatabaseAutomationDeliverySource,
} from './database-automation-delivery-contracts';
import type { DatabaseAutomationRuntime } from './database-automation-runtime';

export interface PinnedDatabaseAutomationDeliverySourceOptions {
  /**
   * Publish the claimed state before the host may begin an external effect.
   * Hot database owners use this to establish an exact synchronous snapshot.
   */
  readonly establishClaimDurability?: () => void;
}

/**
 * Preserve the same host contract used by Fabric actor sources without
 * exposing the pinned runtime's raw database or interception lifecycle.
 */
export function createPinnedDatabaseAutomationDeliverySource(
  runtime: DatabaseAutomationRuntime,
  options: PinnedDatabaseAutomationDeliverySourceOptions = {},
): DatabaseAutomationDeliverySource {
  if (options.establishClaimDurability !== undefined
    && typeof options.establishClaimDurability !== 'function') {
    throw new TypeError(
      'Pinned database automation claim durability hook must be a function.',
    );
  }
  const source: DatabaseAutomationDeliverySource = {
    async claim(leaseOwner, now, leaseMs) {
      const claim = runtime.claim(leaseOwner, now, leaseMs);
      if (claim) options.establishClaimDurability?.();
      return claim;
    },
    async renew(lease, now, leaseMs) {
      return runtime.renew(lease, now, leaseMs);
    },
    async complete(lease, now) {
      return runtime.complete(lease, now);
    },
    async retry(lease, errorCode, retryAt, now) {
      return runtime.retry(lease, errorCode, retryAt, now);
    },
    async dead(lease, errorCode, now) {
      return runtime.dead(lease, errorCode, now);
    },
    async recoverExpired(now) {
      return runtime.recoverExpired(now);
    },
    async counts() {
      return runtime.status().counts ?? disabledCounts();
    },
  };
  return Object.freeze(source);
}

function disabledCounts() {
  return Object.freeze({
    totalRecords: 0,
    activeRecords: 0,
    activeBytes: 0,
    pendingRecords: 0,
    processingRecords: 0,
    completedRecords: 0,
    deadRecords: 0,
  });
}
