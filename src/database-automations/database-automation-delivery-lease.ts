/** Exact lifecycle fence projection shared by host delivery paths. */

import type {
  DatabaseAutomationDeliveryLease,
} from './automation-outbox-contracts';

/**
 * Strip handler input and persisted delivery metadata before a lifecycle fence
 * crosses a strict source adapter such as the Fabric actor protocol.
 */
export function databaseAutomationDeliveryLease(
  delivery: DatabaseAutomationDeliveryLease,
): DatabaseAutomationDeliveryLease {
  return Object.freeze({
    deliveryId: delivery.deliveryId,
    leaseOwner: delivery.leaseOwner,
    leaseToken: delivery.leaseToken,
    updatedAt: delivery.updatedAt,
  });
}
