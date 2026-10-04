/**
 * automation-outbox-contracts.ts
 *
 * Defines the source-local durable automation delivery contract and its hard
 * storage bounds. This file contains no SQLite access and runs no handlers.
 */

import type { DatabaseAutomationValue } from './database-function';

/** Current private SQLite schema version for automation delivery records. */
export const DATABASE_AUTOMATION_OUTBOX_SCHEMA_VERSION = 1 as const;

/** Hard upper bound for one canonical durable-function input. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES = 1_048_576;

/** Hard upper bound for active deliveries in one source database. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_RECORDS = 100_000;

/** Hard upper bound for active canonical payload bytes in one source database. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_ACTIVE_BYTES = 268_435_456;

/** Hard upper bound for active plus retained terminal delivery records. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_STORED_RECORDS = 1_000_000;

/** Hard upper bound for retained terminal delivery metadata. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_TERMINAL_RECORDS = 900_000;

/** Hard upper bound for physical delivery attempts. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_ATTEMPTS = 100;

/** Longest supported processing lease. */
export const DATABASE_AUTOMATION_OUTBOX_MAX_LEASE_MS = 3_600_000;

/** Lowest supported processing lease. */
export const DATABASE_AUTOMATION_OUTBOX_MIN_LEASE_MS = 1_000;

/** Source mutation operation recorded in a durable invocation. */
export type DatabaseAutomationSourceOperation = 'insert' | 'update' | 'delete';

/** Durable delivery lifecycle owned by the source database. */
export type DatabaseAutomationOutboxStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'dead';

/** Lower-only deployment limits enforced in addition to hard schema limits. */
export interface DatabaseAutomationOutboxLimits {
  readonly maxPayloadBytes: number;
  readonly maxActiveRecords: number;
  readonly maxActiveBytes: number;
  readonly maxStoredRecords: number;
  readonly maxTerminalRecords: number;
  readonly maxAttempts: number;
}

/** Safe production defaults for one physical source database. */
export const DEFAULT_DATABASE_AUTOMATION_OUTBOX_LIMITS = Object.freeze({
  maxPayloadBytes: DATABASE_AUTOMATION_OUTBOX_MAX_PAYLOAD_BYTES,
  maxActiveRecords: 10_000,
  maxActiveBytes: 67_108_864,
  maxStoredRecords: 20_000,
  maxTerminalRecords: 10_000,
  maxAttempts: 20,
}) satisfies DatabaseAutomationOutboxLimits;

/** Immutable command captured atomically beside its source mutation. */
export interface DatabaseAutomationOutboxEnqueueInput {
  /** Stable target idempotency key. */
  readonly deliveryId: string;
  /** Identity shared by the ordered functions fired for one trigger match. */
  readonly invocationId: string;
  readonly triggerIdentity: string;
  readonly functionIdentity: string;
  readonly manifestFingerprint: string;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly sourceSequence: number;
  readonly sourceTable: string;
  readonly sourceOperation: DatabaseAutomationSourceOperation;
  readonly sourceRowId: string;
  readonly input: DatabaseAutomationValue;
  /** First eligible delivery time. Defaults to the enqueue timestamp. */
  readonly availableAt?: number;
}

/** Canonical persisted delivery returned to a host dispatcher. */
export interface DatabaseAutomationOutboxRecord {
  readonly deliveryId: string;
  readonly invocationId: string;
  readonly triggerIdentity: string;
  readonly functionIdentity: string;
  readonly manifestFingerprint: string;
  readonly realmName: string;
  readonly realmFingerprint: string;
  readonly sourceSequence: number;
  readonly sourceTable: string;
  readonly sourceOperation: DatabaseAutomationSourceOperation;
  readonly sourceRowId: string;
  readonly input: DatabaseAutomationValue | null;
  readonly status: DatabaseAutomationOutboxStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
  readonly lastErrorCode: string | null;
  readonly insertionOrdinal: number;
}

/** Minimal processing fence safe to retransmit for lifecycle transitions. */
export interface DatabaseAutomationDeliveryLease {
  readonly deliveryId: string;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly updatedAt: number;
}

/** Processing lease plus the full command returned only by a claim. */
export interface ClaimedDatabaseAutomationDelivery
  extends DatabaseAutomationOutboxRecord, DatabaseAutomationDeliveryLease {
  readonly status: 'processing';
  readonly input: DatabaseAutomationValue;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: number;
}

/** Atomic enqueue result for a stable delivery identity. */
export type DatabaseAutomationOutboxEnqueueResult = Readonly<
  | { readonly status: 'enqueued'; readonly deliveryId: string }
  | { readonly status: 'existing'; readonly deliveryId: string }
>;

/** Fenced terminal-completion result. */
export type DatabaseAutomationOutboxCompletionResult =
  | 'completed'
  | 'stale';

/** Fenced retry decision, including exhaustion at the attempt ceiling. */
export type DatabaseAutomationOutboxRetryResult =
  | 'pending'
  | 'dead'
  | 'stale';

/** Fenced explicit dead-letter result. */
export type DatabaseAutomationOutboxDeadResult = 'dead' | 'stale';

/** Expired-lease recovery counts. */
export interface DatabaseAutomationOutboxRecoveryResult {
  readonly requeued: number;
  readonly dead: number;
}

/** Cheap queue accounting backed by the private singleton state row. */
export interface DatabaseAutomationOutboxCounts {
  readonly totalRecords: number;
  readonly activeRecords: number;
  readonly activeBytes: number;
  readonly pendingRecords: number;
  readonly processingRecords: number;
  readonly completedRecords: number;
  readonly deadRecords: number;
}
