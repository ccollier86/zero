/**
 * database-observability-spec.ts
 *
 * Maps each closed Fabric observability event to its platform code and exact
 * allowlist of caller-supplied metadata.
 */

import { OBS_CODES } from '../observability/codes';
import type { PlatformCodeDefinition } from '../observability/types';
import type {
  DatabaseObservabilityEventType,
  DatabaseObservabilityInputMetadataKey,
} from './database-observability-contract';

export interface DatabaseObservabilityEventSpec {
  readonly definition: PlatformCodeDefinition;
  readonly metadata: readonly DatabaseObservabilityInputMetadataKey[];
  readonly required: readonly DatabaseObservabilityInputMetadataKey[];
  readonly failure?: boolean;
}

const ACTOR_CONTEXT_KEYS = [
  'databaseRef',
  'placement',
  'role',
  'slot',
  'generation',
] as const satisfies readonly DatabaseObservabilityInputMetadataKey[];

const EXECUTOR_CONTEXT_KEYS = [
  'databaseRef',
  'placement',
  'role',
  'slot',
  'generation',
] as const satisfies readonly DatabaseObservabilityInputMetadataKey[];

export const DATABASE_OBSERVABILITY_EVENT_SPECS = Object.freeze({
  'coordinator-configured': eventSpec(
    OBS_CODES.DATABASE_COORDINATOR_CONFIGURED,
    [
      'writerLimit',
      'readerLimit',
      'runtimeLimit',
      'fileLimit',
      'syncDatabaseLimit',
      'syncBindingLimit',
      'queueLimit',
    ],
  ),
  'coordinator-started': eventSpec(
    OBS_CODES.DATABASE_COORDINATOR_STARTED,
    ['writerCount', 'readerCount', 'runtimeCount'],
  ),
  'coordinator-draining': eventSpec(
    OBS_CODES.DATABASE_COORDINATOR_DRAINING,
    ['reason', 'activeCount', 'queueDepth'],
  ),
  'coordinator-stopped': eventSpec(
    OBS_CODES.DATABASE_COORDINATOR_STOPPED,
    ['durationMs'],
  ),
  'coordinator-failed': failureSpec(
    OBS_CODES.DATABASE_COORDINATOR_FAILED,
    [
      'phase',
      'failedCloseCount',
      'remainingEntryCount',
      'quarantinedSlotCount',
      'availableSlotCount',
      'failureCodeSummary',
    ],
    ['phase'],
  ),
  'executor-restarted': eventSpec(
    OBS_CODES.DATABASE_EXECUTOR_RESTARTED,
    [...EXECUTOR_CONTEXT_KEYS, 'reason', 'retryCount'],
    ['role', 'slot', 'generation', 'reason', 'retryCount'],
  ),
  'executor-failed': failureSpec(
    OBS_CODES.DATABASE_EXECUTOR_FAILED,
    [...EXECUTOR_CONTEXT_KEYS, 'phase'],
    ['role', 'slot', 'generation', 'phase'],
  ),
  'runtime-opened': eventSpec(
    OBS_CODES.DATABASE_RUNTIME_OPENED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs'],
    ['databaseRef', 'durationMs'],
  ),
  'runtime-closed': eventSpec(
    OBS_CODES.DATABASE_RUNTIME_CLOSED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs', 'reason'],
    ['databaseRef', 'durationMs', 'reason'],
  ),
  'runtime-open-failed': failureSpec(
    OBS_CODES.DATABASE_RUNTIME_OPEN_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs'],
    ['databaseRef', 'durationMs'],
  ),
  'runtime-evicted': eventSpec(
    OBS_CODES.DATABASE_RUNTIME_EVICTED,
    [...ACTOR_CONTEXT_KEYS, 'reason'],
    ['databaseRef', 'reason'],
  ),
  'queue-saturated': eventSpec(
    OBS_CODES.DATABASE_QUEUE_SATURATED,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'queueDepth', 'queueLimit'],
    ['databaseRef', 'operation', 'queueDepth', 'queueLimit'],
  ),
  'capacity-exhausted': eventSpec(
    OBS_CODES.DATABASE_CAPACITY_EXHAUSTED,
    [...ACTOR_CONTEXT_KEYS, 'capacityType', 'capacityLimit'],
    ['databaseRef', 'capacityType', 'capacityLimit'],
  ),
  'queue-timeout': eventSpec(
    OBS_CODES.DATABASE_QUEUE_TIMEOUT,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'queueDepth', 'durationMs'],
    ['databaseRef', 'operation', 'queueDepth', 'durationMs'],
  ),
  'operation-failed': failureSpec(
    OBS_CODES.DATABASE_OPERATION_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'durationMs', 'failureReason'],
    ['databaseRef', 'operation', 'durationMs'],
  ),
  'operation-outcome-unknown': failureSpec(
    OBS_CODES.DATABASE_OPERATION_OUTCOME_UNKNOWN,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'durationMs'],
    ['databaseRef', 'operation', 'durationMs'],
  ),
  'change-wakeup': eventSpec(
    OBS_CODES.DATABASE_CHANGE_WAKEUP,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd'],
  ),
  'replay-failed': failureSpec(
    OBS_CODES.DATABASE_REPLAY_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'durationMs'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'durationMs'],
  ),
  'tenant-snapshot-failed': failureSpec(
    OBS_CODES.DATABASE_TENANT_SNAPSHOT_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'durationMs'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'durationMs'],
  ),
  'hot-snapshot-started': eventSpec(
    OBS_CODES.DATABASE_HOT_SNAPSHOT_STARTED,
    [...ACTOR_CONTEXT_KEYS, 'durability'],
    ['databaseRef', 'placement', 'role', 'slot', 'generation', 'durability'],
  ),
  'hot-snapshot-finished': eventSpec(
    OBS_CODES.DATABASE_HOT_SNAPSHOT_FINISHED,
    [...ACTOR_CONTEXT_KEYS, 'durability'],
    ['databaseRef', 'placement', 'role', 'slot', 'generation', 'durability'],
  ),
  'hot-durability-dirty': eventSpec(
    OBS_CODES.DATABASE_HOT_DURABILITY_DIRTY,
    [...ACTOR_CONTEXT_KEYS, 'durability'],
    ['databaseRef', 'placement', 'role', 'slot', 'generation', 'durability'],
  ),
  'hot-durability-clean': eventSpec(
    OBS_CODES.DATABASE_HOT_DURABILITY_CLEAN,
    [...ACTOR_CONTEXT_KEYS, 'durability'],
    ['databaseRef', 'placement', 'role', 'slot', 'generation', 'durability'],
  ),
  'hot-durability-failed': failureSpec(
    OBS_CODES.DATABASE_HOT_DURABILITY_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'durability'],
    ['databaseRef', 'placement', 'role', 'slot', 'generation', 'durability'],
  ),
  'receipt-lookup-failed': failureSpec(
    OBS_CODES.DATABASE_RECEIPT_LOOKUP_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs'],
    ['databaseRef', 'durationMs'],
  ),
  'receipt-expired': failureSpec(
    OBS_CODES.DATABASE_RECEIPT_EXPIRED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs'],
    ['databaseRef', 'durationMs'],
  ),
  'receipt-compacted': eventSpec(
    OBS_CODES.DATABASE_RECEIPT_COMPACTED,
    [
      ...ACTOR_CONTEXT_KEYS,
      'totalKeys',
      'retainedResults',
      'expiredTombstones',
      'retainedResultBytes',
      'keyLimit',
      'prunedCount',
      'prunedResultBytes',
      'retainedLimit',
      'retainedByteLimit',
      'resultByteLimit',
    ],
    [
      'databaseRef',
      'totalKeys',
      'retainedResults',
      'expiredTombstones',
      'retainedResultBytes',
      'keyLimit',
      'prunedCount',
      'prunedResultBytes',
      'retainedLimit',
      'retainedByteLimit',
      'resultByteLimit',
    ],
  ),
  'history-gap': eventSpec(
    OBS_CODES.DATABASE_HISTORY_GAP,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'reason'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'reason'],
  ),
} satisfies Record<
  DatabaseObservabilityEventType,
  DatabaseObservabilityEventSpec
>);

function eventSpec(
  definition: PlatformCodeDefinition,
  metadata: readonly DatabaseObservabilityInputMetadataKey[],
  required: readonly DatabaseObservabilityInputMetadataKey[] = metadata,
): DatabaseObservabilityEventSpec {
  return Object.freeze({ definition, metadata, required });
}

function failureSpec(
  definition: PlatformCodeDefinition,
  metadata: readonly DatabaseObservabilityInputMetadataKey[],
  required: readonly DatabaseObservabilityInputMetadataKey[] = metadata,
): DatabaseObservabilityEventSpec {
  return Object.freeze({ definition, metadata, required, failure: true });
}
