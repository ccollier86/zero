/**
 * Private adapter from a coordinator-owned lease to the host delivery source.
 *
 * The generic worker receives no database selector, actor handle, or raw
 * coordinator entry. Releasing the underlying lease closes every later call.
 */

import type { DatabaseAutomationDeliverySource } from '../database-automations/database-automation-delivery-contracts';
import type {
  ClaimedDatabaseAutomationDelivery,
  DatabaseAutomationDeliveryLease,
  DatabaseAutomationOutboxCompletionResult,
  DatabaseAutomationOutboxCounts,
  DatabaseAutomationOutboxDeadResult,
  DatabaseAutomationOutboxRecoveryResult,
  DatabaseAutomationOutboxRetryResult,
} from '../database-automations/automation-outbox-contracts';
import type { DatabaseCoordinatorLease } from './database-coordinator-contract';
import {
  CoordinatorLease,
  executeCoordinatorAutomationDelivery,
} from './database-coordinator-capability';
import { DatabaseError } from './database-error';

/** @internal Convert only a genuine coordinator lease into a delivery source. */
export function createCoordinatorDatabaseAutomationDeliverySource(
  lease: DatabaseCoordinatorLease,
): DatabaseAutomationDeliverySource {
  if (!(lease instanceof CoordinatorLease)) {
    throw invalidCoordinatorLease();
  }
  const source = new CoordinatorAutomationDeliverySource(lease);
  return Object.freeze(source);
}

class CoordinatorAutomationDeliverySource
implements DatabaseAutomationDeliverySource {
  constructor(private readonly lease: DatabaseCoordinatorLease) {}

  claim(
    leaseOwner: string,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'claim',
      leaseOwner,
      now,
      leaseMs,
    });
  }

  renew(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'renew',
      lease: claim,
      now,
      leaseMs,
    });
  }

  complete(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
  ): Promise<DatabaseAutomationOutboxCompletionResult> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'complete',
      lease: claim,
      now,
    });
  }

  retry(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    retryAt: number,
    now: number,
  ): Promise<DatabaseAutomationOutboxRetryResult> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'retry',
      lease: claim,
      errorCode,
      retryAt,
      now,
    });
  }

  dead(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    now: number,
  ): Promise<DatabaseAutomationOutboxDeadResult> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'dead',
      lease: claim,
      errorCode,
      now,
    });
  }

  recoverExpired(now: number): Promise<DatabaseAutomationOutboxRecoveryResult> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'recover-expired',
      now,
    });
  }

  counts(): Promise<DatabaseAutomationOutboxCounts> {
    return executeCoordinatorAutomationDelivery(this.lease, {
      action: 'counts',
    });
  }
}

function invalidCoordinatorLease(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database automation delivery requires a coordinator-owned binding.',
  );
}
