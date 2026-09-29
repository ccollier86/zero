/**
 * database-observability-contract.ts
 *
 * Closed, privacy-safe input and metadata contracts for ReactiveDB Fabric
 * observability. This module owns shapes and bounds only; it does not validate
 * or emit events.
 */

import type {
  DatabaseCapacityType,
  DatabaseErrorCode,
  DatabaseOperationOutcome,
} from './database-error';
import type { DatabaseRef } from './database-file';
import type {
  DatabaseHotDurability,
  DatabasePlacement,
} from './database-placement';
import {
  DATABASE_EXECUTOR_SLOT_MAX,
  DATABASE_OBSERVABILITY_COUNT_MAX,
} from './database-capacity';

/** Highest executor slot accepted in telemetry. */
export const DATABASE_OBSERVABILITY_MAX_SLOT = DATABASE_EXECUTOR_SLOT_MAX;

/** Highest generation, count, or configured limit accepted in telemetry. */
export const DATABASE_OBSERVABILITY_MAX_COUNT = DATABASE_OBSERVABILITY_COUNT_MAX;

/** Highest duration accepted in telemetry (seven days in milliseconds). */
export const DATABASE_OBSERVABILITY_MAX_DURATION_MS = 604_800_000;

/** Highest durable sequence accepted in telemetry. */
export const DATABASE_OBSERVABILITY_MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

/** Executor roles are deliberately independent of the concrete backend. */
export const DATABASE_EXECUTOR_ROLES = Object.freeze([
  'writer',
  'reader',
] as const);

export type DatabaseExecutorRole = (typeof DATABASE_EXECUTOR_ROLES)[number];

/** Bounded lifecycle phases used only for failure correlation. */
export const DATABASE_OBSERVABILITY_PHASES = Object.freeze([
  'configure',
  'start',
  'ready',
  'open',
  'migrate',
  'execute',
  'commit',
  'rollback',
  'replay',
  'drain',
  'close',
  'shutdown',
] as const);

export type DatabaseObservabilityPhase =
  (typeof DATABASE_OBSERVABILITY_PHASES)[number];

/** Low-cardinality lifecycle reasons safe for database telemetry. */
export const DATABASE_OBSERVABILITY_REASONS = Object.freeze([
  'requested',
  'completed',
  'idle',
  'capacity',
  'failure',
  'crash',
  'signal',
  'protocol',
  'timeout',
  'stale-generation',
  'history-gap',
  'deadline-exceeded',
  'unresponsive',
  'shutdown',
] as const);

export type DatabaseObservabilityReason =
  (typeof DATABASE_OBSERVABILITY_REASONS)[number];

/** Coarse operation classes; registered names, SQL, and input never appear. */
export const DATABASE_OPERATION_CLASSES = Object.freeze([
  'open',
  'close',
  'query',
  'mutation',
  'transaction',
  'migration',
  'checkpoint',
  'replay',
  'snapshot',
  'receipt',
  'sync',
  'shutdown',
  'protocol',
] as const);

export type DatabaseOperationClass =
  (typeof DATABASE_OPERATION_CLASSES)[number];

/** Closed, low-cardinality classifications for failed database operations. */
export const DATABASE_OPERATION_FAILURE_REASONS = Object.freeze([
  'hot-max-bytes',
] as const);

export type DatabaseOperationFailureReason =
  (typeof DATABASE_OPERATION_FAILURE_REASONS)[number];

interface DatabaseActorEventContext {
  readonly databaseRef: DatabaseRef;
  readonly placement?: DatabasePlacement;
  readonly role?: DatabaseExecutorRole;
  readonly slot?: number;
  readonly generation?: number;
}

interface DatabaseExecutorEventContext {
  readonly databaseRef?: DatabaseRef;
  readonly placement?: DatabasePlacement;
  readonly role: DatabaseExecutorRole;
  readonly slot: number;
  readonly generation: number;
}

interface DatabaseFailureEvent {
  /** Caught value. It is normalized and is never attached to the event. */
  readonly error: unknown;
}

/**
 * Closed database observability input.
 *
 * The absence of generic metadata, message, path, SQL, query-name, input, and
 * row fields is intentional. Runtime validation also rejects extra fields.
 */
export type DatabaseObservabilityEvent =
  | {
      readonly type: 'coordinator-configured';
      readonly writerLimit: number;
      readonly readerLimit: number;
      readonly runtimeLimit: number;
      readonly fileLimit: number;
      readonly syncDatabaseLimit: number;
      readonly syncBindingLimit: number;
      readonly queueLimit: number;
    }
  | {
      readonly type: 'coordinator-started';
      readonly writerCount: number;
      readonly readerCount: number;
      readonly runtimeCount: number;
    }
  | {
      readonly type: 'coordinator-draining';
      readonly reason: DatabaseObservabilityReason;
      readonly activeCount: number;
      readonly queueDepth: number;
    }
  | {
      readonly type: 'coordinator-stopped';
      readonly durationMs: number;
    }
  | ({
      readonly type: 'coordinator-failed';
      readonly phase: DatabaseObservabilityPhase;
    } & DatabaseFailureEvent)
  | ({
      readonly type: 'executor-restarted';
      readonly reason: DatabaseObservabilityReason;
      readonly retryCount: number;
    } & DatabaseExecutorEventContext)
  | ({
      readonly type: 'executor-failed';
      readonly phase: DatabaseObservabilityPhase;
    } & DatabaseExecutorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'runtime-opened';
      readonly durationMs: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'runtime-closed';
      readonly durationMs: number;
      readonly reason: DatabaseObservabilityReason;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'runtime-open-failed';
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'runtime-evicted';
      readonly reason: DatabaseObservabilityReason;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'queue-saturated';
      readonly operation: DatabaseOperationClass;
      readonly queueDepth: number;
      readonly queueLimit: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'capacity-exhausted';
      readonly capacityType: DatabaseCapacityType;
      readonly capacityLimit: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'queue-timeout';
      readonly operation: DatabaseOperationClass;
      readonly queueDepth: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'operation-failed';
      readonly operation: DatabaseOperationClass;
      readonly durationMs: number;
      readonly failureReason?: DatabaseOperationFailureReason;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'operation-outcome-unknown';
      readonly operation: DatabaseOperationClass;
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'change-wakeup';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'replay-failed';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'tenant-snapshot-failed';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type:
        | 'hot-snapshot-started'
        | 'hot-snapshot-finished'
        | 'hot-durability-dirty'
        | 'hot-durability-clean';
      readonly placement: 'hot';
      readonly durability: 'periodic';
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'hot-durability-failed';
      readonly placement: 'hot';
      readonly durability: 'periodic';
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'receipt-lookup-failed';
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'receipt-expired';
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'receipt-compacted';
      readonly totalKeys: number;
      readonly retainedResults: number;
      readonly expiredTombstones: number;
      readonly retainedResultBytes: number;
      readonly keyLimit: number;
      readonly prunedCount: number;
      readonly prunedResultBytes: number;
      readonly retainedLimit: number;
      readonly retainedByteLimit: number;
      readonly resultByteLimit: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'history-gap';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly reason: DatabaseObservabilityReason;
    } & DatabaseActorEventContext);

export type DatabaseObservabilityEventType =
  DatabaseObservabilityEvent['type'];

/** Exact metadata shape emitted by the database observability boundary. */
export interface DatabaseObservabilityMetadata {
  readonly databaseRef?: DatabaseRef;
  readonly placement?: DatabasePlacement;
  readonly durability?: DatabaseHotDurability;
  readonly role?: DatabaseExecutorRole;
  readonly slot?: number;
  readonly generation?: number;
  readonly phase?: DatabaseObservabilityPhase;
  readonly reason?: DatabaseObservabilityReason;
  readonly operation?: DatabaseOperationClass;
  readonly failureReason?: DatabaseOperationFailureReason;
  readonly durationMs?: number;
  readonly writerCount?: number;
  readonly readerCount?: number;
  readonly runtimeCount?: number;
  readonly activeCount?: number;
  readonly queueDepth?: number;
  readonly retryCount?: number;
  readonly writerLimit?: number;
  readonly readerLimit?: number;
  readonly runtimeLimit?: number;
  readonly fileLimit?: number;
  readonly syncDatabaseLimit?: number;
  readonly syncBindingLimit?: number;
  readonly queueLimit?: number;
  readonly capacityType?: DatabaseCapacityType;
  readonly capacityLimit?: number;
  readonly sequenceStart?: number;
  readonly sequenceEnd?: number;
  readonly totalKeys?: number;
  readonly retainedResults?: number;
  readonly expiredTombstones?: number;
  readonly retainedResultBytes?: number;
  readonly keyLimit?: number;
  readonly prunedCount?: number;
  readonly prunedResultBytes?: number;
  readonly retainedLimit?: number;
  readonly retainedByteLimit?: number;
  readonly resultByteLimit?: number;
  readonly errorCode?: DatabaseErrorCode;
  readonly retryable?: boolean;
  readonly outcome?: DatabaseOperationOutcome | null;
}

/** Metadata keys accepted from callers before normalized failure fields. */
export type DatabaseObservabilityInputMetadataKey = Exclude<
  keyof DatabaseObservabilityMetadata,
  'errorCode' | 'retryable' | 'outcome'
>;
