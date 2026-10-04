/**
 * Private actor wire contracts for source-local durable automation delivery.
 *
 * This surface deliberately exposes lifecycle operations only. It is not a
 * generic outbox read/write API, and logical database selection remains an
 * opaque, coordinator-owned reference.
 */

import type {
  ClaimedDatabaseAutomationDelivery,
  DatabaseAutomationDeliveryLease,
  DatabaseAutomationOutboxCompletionResult,
  DatabaseAutomationOutboxCounts,
  DatabaseAutomationOutboxDeadResult,
  DatabaseAutomationOutboxRecoveryResult,
  DatabaseAutomationOutboxRetryResult,
} from '../database-automations/automation-outbox-contracts';
import type { DatabaseRef } from './database-file';

/** One private actor operation family for durable automation lifecycle work. */
export const DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION =
  'database.automation-outbox' as const;

/** Closed lifecycle actions accepted by the private operation family. */
export type DatabaseActorAutomationOutboxAction =
  | 'claim'
  | 'renew'
  | 'complete'
  | 'retry'
  | 'dead'
  | 'recover-expired'
  | 'counts';

interface DatabaseActorAutomationOutboxPayloadBase {
  readonly databaseRef: DatabaseRef;
  readonly action: DatabaseActorAutomationOutboxAction;
}

/** Claim the earliest eligible durable delivery for one bounded lease. */
export interface DatabaseActorAutomationOutboxClaimPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'claim';
  readonly leaseOwner: string;
  readonly now: number;
  readonly leaseMs: number;
}

/** Renew an exact active delivery fence without retransmitting handler input. */
export interface DatabaseActorAutomationOutboxRenewPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'renew';
  readonly lease: DatabaseAutomationDeliveryLease;
  readonly now: number;
  readonly leaseMs: number;
}

/** Complete an exact active delivery fence. */
export interface DatabaseActorAutomationOutboxCompletePayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'complete';
  readonly lease: DatabaseAutomationDeliveryLease;
  readonly now: number;
}

/** Requeue or exhaust an exact active delivery fence. */
export interface DatabaseActorAutomationOutboxRetryPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'retry';
  readonly lease: DatabaseAutomationDeliveryLease;
  readonly errorCode: string;
  readonly retryAt: number;
  readonly now: number;
}

/** Explicitly dead-letter an exact active delivery fence. */
export interface DatabaseActorAutomationOutboxDeadPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'dead';
  readonly lease: DatabaseAutomationDeliveryLease;
  readonly errorCode: string;
  readonly now: number;
}

/** Recover every expired lease in one source-local outbox. */
export interface DatabaseActorAutomationOutboxRecoverExpiredPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'recover-expired';
  readonly now: number;
}

/** Read bounded aggregate accounting without exposing delivery records. */
export interface DatabaseActorAutomationOutboxCountsPayload
  extends DatabaseActorAutomationOutboxPayloadBase {
  readonly action: 'counts';
}

/** Exact structured-clone-safe payload union for the private operation family. */
export type DatabaseActorAutomationOutboxPayload =
  | DatabaseActorAutomationOutboxClaimPayload
  | DatabaseActorAutomationOutboxRenewPayload
  | DatabaseActorAutomationOutboxCompletePayload
  | DatabaseActorAutomationOutboxRetryPayload
  | DatabaseActorAutomationOutboxDeadPayload
  | DatabaseActorAutomationOutboxRecoverExpiredPayload
  | DatabaseActorAutomationOutboxCountsPayload;

/** Result union returned only after action-specific actor validation. */
export type DatabaseActorAutomationOutboxResult =
  | ClaimedDatabaseAutomationDelivery
  | DatabaseAutomationOutboxCompletionResult
  | DatabaseAutomationOutboxRetryResult
  | DatabaseAutomationOutboxDeadResult
  | DatabaseAutomationOutboxRecoveryResult
  | DatabaseAutomationOutboxCounts
  | null;

/** Action-specific result type used by internal coordinator adapters. */
export type DatabaseActorAutomationOutboxResultFor<
  TPayload extends DatabaseActorAutomationOutboxPayload,
> = TPayload extends
  | DatabaseActorAutomationOutboxClaimPayload
  | DatabaseActorAutomationOutboxRenewPayload
  ? ClaimedDatabaseAutomationDelivery | null
  : TPayload extends DatabaseActorAutomationOutboxCompletePayload
    ? DatabaseAutomationOutboxCompletionResult
    : TPayload extends DatabaseActorAutomationOutboxRetryPayload
      ? DatabaseAutomationOutboxRetryResult
      : TPayload extends DatabaseActorAutomationOutboxDeadPayload
        ? DatabaseAutomationOutboxDeadResult
        : TPayload extends DatabaseActorAutomationOutboxRecoverExpiredPayload
          ? DatabaseAutomationOutboxRecoveryResult
          : DatabaseAutomationOutboxCounts;
