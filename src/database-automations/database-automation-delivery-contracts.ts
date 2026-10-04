/**
 * Host-side contracts for draining one source-local durable automation outbox.
 * Implementations may be actor-backed or pinned, but never expose a raw DB.
 */

import type {
  ClaimedDatabaseAutomationDelivery,
  DatabaseAutomationDeliveryLease,
  DatabaseAutomationOutboxCompletionResult,
  DatabaseAutomationOutboxCounts,
  DatabaseAutomationOutboxDeadResult,
  DatabaseAutomationOutboxRecoveryResult,
  DatabaseAutomationOutboxRetryResult,
} from './automation-outbox-contracts';

/** Narrow capability used after the writer lane has released its DB authority. */
export interface DatabaseAutomationDeliverySource {
  claim(
    leaseOwner: string,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null>;
  renew(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
    leaseMs: number,
  ): Promise<ClaimedDatabaseAutomationDelivery | null>;
  complete(
    claim: DatabaseAutomationDeliveryLease,
    now: number,
  ): Promise<DatabaseAutomationOutboxCompletionResult>;
  retry(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    retryAt: number,
    now: number,
  ): Promise<DatabaseAutomationOutboxRetryResult>;
  dead(
    claim: DatabaseAutomationDeliveryLease,
    errorCode: string,
    now: number,
  ): Promise<DatabaseAutomationOutboxDeadResult>;
  recoverExpired(now: number): Promise<DatabaseAutomationOutboxRecoveryResult>;
  counts(): Promise<DatabaseAutomationOutboxCounts>;
}

/** Scope-fenced services created only after one durable command is claimed. */
export interface DatabaseAutomationExecutionServiceLease<TServices> {
  readonly zero: TServices;
  /** Revalidate immediately before the handler and before recording success. */
  assertCurrentAuthority(): void;
  close(): void | Promise<void>;
}

export interface DatabaseAutomationExecutionServiceProvider<TServices> {
  create(
    delivery: ClaimedDatabaseAutomationDelivery,
    signal: AbortSignal,
  ): DatabaseAutomationExecutionServiceLease<TServices>
    | Promise<DatabaseAutomationExecutionServiceLease<TServices>>;
}

/** Low-cardinality lifecycle events; never include inputs, IDs, or exceptions. */
export type DatabaseAutomationDeliveryEvent = Readonly<
  | { readonly type: 'recovered'; readonly requeued: number; readonly dead: number }
  | { readonly type: 'claimed'; readonly attempt: number }
  | { readonly type: 'completed'; readonly attempt: number }
  | { readonly type: 'retry-scheduled'; readonly attempt: number }
  | { readonly type: 'dead-lettered'; readonly attempt: number; readonly reason: string }
  | { readonly type: 'lease-lost'; readonly attempt: number }
  | { readonly type: 'manifest-drift'; readonly attempt: number }
  | { readonly type: 'execution-abandoned'; readonly attempt: number; readonly reason: 'shutdown' | 'timeout' }
  | { readonly type: 'service-cleanup-failed'; readonly attempt: number }
>;

export type DatabaseAutomationDeliveryEventSink = (
  event: DatabaseAutomationDeliveryEvent,
) => void;

/** Aggregate drain result safe for metrics and Doctor health adapters. */
export interface DatabaseAutomationDrainResult {
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly dead: number;
  readonly leaseLost: number;
  readonly abandoned: number;
  readonly recovered: DatabaseAutomationOutboxRecoveryResult;
}
