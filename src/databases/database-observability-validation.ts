/**
 * database-observability-validation.ts
 *
 * Validates untrusted event objects against the closed observability contract
 * and produces bounded, privacy-safe platform metadata.
 */

import type { PlatformCodeDefinition } from '../observability/types';
import {
  DATABASE_CAPACITY_TYPES,
  normalizeDatabaseError,
  type DatabaseCapacityType,
} from './database-error';
import { normalizeDatabaseRef } from './database-file';
import type {
  DatabaseHotDurability,
  DatabasePlacement,
} from './database-placement';
import {
  DATABASE_EXECUTOR_ROLES,
  DATABASE_OBSERVABILITY_MAX_COUNT,
  DATABASE_OBSERVABILITY_MAX_DURATION_MS,
  DATABASE_OBSERVABILITY_MAX_SEQUENCE,
  DATABASE_OBSERVABILITY_MAX_SLOT,
  DATABASE_OBSERVABILITY_PHASES,
  DATABASE_OBSERVABILITY_REASONS,
  DATABASE_OPERATION_FAILURE_REASONS,
  DATABASE_OPERATION_CLASSES,
  type DatabaseExecutorRole,
  type DatabaseObservabilityEvent,
  type DatabaseObservabilityEventType,
  type DatabaseObservabilityInputMetadataKey,
  type DatabaseObservabilityMetadata,
  type DatabaseObservabilityPhase,
  type DatabaseObservabilityReason,
  type DatabaseOperationClass,
  type DatabaseOperationFailureReason,
} from './database-observability-contract';
import { DATABASE_OBSERVABILITY_EVENT_SPECS } from './database-observability-spec';
import { normalizeDatabaseFailureCodeSummary } from './database-failure-code-summary';

const DATABASE_EXECUTOR_ROLE_SET: ReadonlySet<DatabaseExecutorRole> =
  new Set(DATABASE_EXECUTOR_ROLES);
const DATABASE_PHASE_SET: ReadonlySet<DatabaseObservabilityPhase> =
  new Set(DATABASE_OBSERVABILITY_PHASES);
const DATABASE_REASON_SET: ReadonlySet<DatabaseObservabilityReason> =
  new Set(DATABASE_OBSERVABILITY_REASONS);
const DATABASE_OPERATION_CLASS_SET: ReadonlySet<DatabaseOperationClass> =
  new Set(DATABASE_OPERATION_CLASSES);
const DATABASE_OPERATION_FAILURE_REASON_SET:
  ReadonlySet<DatabaseOperationFailureReason> =
    new Set(DATABASE_OPERATION_FAILURE_REASONS);
const DATABASE_PLACEMENT_SET: ReadonlySet<DatabasePlacement> =
  new Set(['file', 'hot']);
const DATABASE_DURABILITY_SET: ReadonlySet<DatabaseHotDurability> =
  new Set(['on-write', 'periodic', 'final']);
const DATABASE_CAPACITY_TYPE_SET: ReadonlySet<DatabaseCapacityType> =
  new Set(DATABASE_CAPACITY_TYPES);

export interface PreparedDatabaseObservabilityEvent {
  readonly definition: PlatformCodeDefinition;
  readonly metadata: DatabaseObservabilityMetadata;
}

/** Validate and normalize one event before it reaches an app-local sink. */
export function prepareDatabaseObservabilityEvent(
  event: DatabaseObservabilityEvent,
): PreparedDatabaseObservabilityEvent {
  const descriptors = ownDataDescriptors(event);
  if (!descriptors) {
    throw new TypeError('Invalid database observability event.');
  }
  const type = descriptors.type?.value;
  if (typeof type !== 'string'
    || !Object.hasOwn(DATABASE_OBSERVABILITY_EVENT_SPECS, type)) {
    throw new TypeError('Invalid database observability event.');
  }

  const eventType = type as DatabaseObservabilityEventType;
  const spec = DATABASE_OBSERVABILITY_EVENT_SPECS[eventType];
  const allowed = new Set<string>(['type', ...spec.metadata]);
  if (spec.failure) allowed.add('error');

  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowed.has(key))) {
    throw new TypeError(
      'Database observability event contains unsupported fields.',
    );
  }
  if (spec.required.some((key) => !Object.hasOwn(descriptors, key))
    || (spec.failure && !Object.hasOwn(descriptors, 'error'))) {
    throw new TypeError(
      'Database observability event is missing required fields.',
    );
  }

  const metadata: Record<string, unknown> = {};
  for (const key of spec.metadata) {
    if (!Object.hasOwn(descriptors, key)) continue;
    metadata[key] = normalizeMetadataValue(key, descriptors[key]!.value);
  }

  assertSequenceRange(metadata);
  assertCoordinatorFailureAggregate(eventType, metadata);

  if (spec.failure) {
    const error = normalizeCaughtDatabaseError(descriptors.error!.value);
    metadata.errorCode = error.code;
    metadata.retryable = error.retryable;
    metadata.outcome = error.outcome;
    if (metadata.failureReason === 'hot-max-bytes'
      && (eventType !== 'operation-failed'
        || metadata.placement !== 'hot'
        || error.code !== 'DATABASE_PAYLOAD_LIMIT'
        || error.outcome !== 'not-committed'
        || error.details.reason !== 'max-bytes')) {
      throw new TypeError(
        'Invalid database observability operation failure reason.',
      );
    }
  }

  if (isHotDurabilityEvent(eventType)
    && (metadata.placement !== 'hot'
      || metadata.durability !== 'periodic')) {
    throw new TypeError(
      'Invalid hot database durability observability event.',
    );
  }

  return Object.freeze({
    definition: spec.definition,
    metadata: Object.freeze(metadata) as DatabaseObservabilityMetadata,
  });
}

function normalizeCaughtDatabaseError(value: unknown) {
  try {
    return normalizeDatabaseError(value);
  } catch {
    // Hostile proxy traps and exotic Error prototypes must not escape the
    // telemetry boundary or reveal their thrown values.
    return normalizeDatabaseError(undefined);
  }
}

function normalizeMetadataValue(
  key: DatabaseObservabilityInputMetadataKey,
  value: unknown,
): DatabaseObservabilityMetadata[DatabaseObservabilityInputMetadataKey] {
  switch (key) {
    case 'databaseRef':
      return normalizeDatabaseRef(value as string);
    case 'role':
      return enumValue(value, DATABASE_EXECUTOR_ROLE_SET, 'executor role');
    case 'placement':
      return enumValue(value, DATABASE_PLACEMENT_SET, 'placement');
    case 'durability':
      return enumValue(value, DATABASE_DURABILITY_SET, 'durability');
    case 'phase':
      return enumValue(value, DATABASE_PHASE_SET, 'lifecycle phase');
    case 'reason':
      return enumValue(value, DATABASE_REASON_SET, 'lifecycle reason');
    case 'operation':
      return enumValue(value, DATABASE_OPERATION_CLASS_SET, 'operation class');
    case 'failureReason':
      return enumValue(
        value,
        DATABASE_OPERATION_FAILURE_REASON_SET,
        'operation failure reason',
      );
    case 'capacityType':
      return enumValue(value, DATABASE_CAPACITY_TYPE_SET, 'capacity type');
    case 'failureCodeSummary':
      return normalizeDatabaseFailureCodeSummary(value);
    case 'slot':
      return boundedInteger(
        value,
        0,
        DATABASE_OBSERVABILITY_MAX_SLOT,
        'executor slot',
      );
    case 'durationMs':
      return boundedInteger(
        value,
        0,
        DATABASE_OBSERVABILITY_MAX_DURATION_MS,
        'duration',
      );
    case 'generation':
      return boundedInteger(
        value,
        1,
        DATABASE_OBSERVABILITY_MAX_COUNT,
        'executor generation',
      );
    case 'writerCount':
    case 'readerCount':
    case 'runtimeCount':
    case 'activeCount':
    case 'failedCloseCount':
    case 'remainingEntryCount':
    case 'quarantinedSlotCount':
    case 'availableSlotCount':
    case 'queueDepth':
    case 'retryCount':
    case 'writerLimit':
    case 'readerLimit':
    case 'runtimeLimit':
    case 'fileLimit':
    case 'syncDatabaseLimit':
    case 'syncBindingLimit':
    case 'queueLimit':
    case 'capacityLimit':
    case 'totalKeys':
    case 'retainedResults':
    case 'expiredTombstones':
    case 'retainedResultBytes':
    case 'keyLimit':
    case 'prunedCount':
    case 'prunedResultBytes':
    case 'retainedLimit':
    case 'retainedByteLimit':
    case 'resultByteLimit':
      return boundedInteger(
        value,
        0,
        DATABASE_OBSERVABILITY_MAX_COUNT,
        'count or limit',
      );
    case 'sequenceStart':
    case 'sequenceEnd':
      return boundedInteger(
        value,
        0,
        DATABASE_OBSERVABILITY_MAX_SEQUENCE,
        'database sequence',
      );
  }
}

function assertCoordinatorFailureAggregate(
  eventType: DatabaseObservabilityEventType,
  metadata: Record<string, unknown>,
): void {
  if (eventType !== 'coordinator-failed') return;
  const countKeys = [
    'failedCloseCount',
    'remainingEntryCount',
    'quarantinedSlotCount',
    'availableSlotCount',
  ] as const;
  const suppliedCount = countKeys.filter((key) => key in metadata).length;
  if (suppliedCount !== 0 && suppliedCount !== countKeys.length) {
    throw new TypeError(
      'Database coordinator aggregate failure counts are incomplete.',
    );
  }
  if ('failureCodeSummary' in metadata) {
    if (suppliedCount === 0 || metadata.failedCloseCount === 0) {
      throw new TypeError(
        'Database coordinator failure-code summary has no close failures.',
      );
    }
    const summarizedCount = (metadata.failureCodeSummary as string)
      .split(',')
      .reduce((total, entry) => total + Number(entry.slice(
        entry.lastIndexOf(':') + 1,
      )), 0);
    if (summarizedCount > (metadata.failedCloseCount as number)) {
      throw new TypeError(
        'Database coordinator failure-code summary exceeds close failures.',
      );
    }
  }
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new TypeError(`Invalid database observability ${label}.`);
  }
  return value as T;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum) {
    throw new TypeError(`Invalid database observability ${label}.`);
  }
  return value as number;
}

function assertSequenceRange(metadata: Record<string, unknown>): void {
  const start = metadata.sequenceStart;
  const end = metadata.sequenceEnd;
  if (typeof start === 'number'
    && typeof end === 'number'
    && start > end) {
    throw new TypeError('Database observability sequence range is reversed.');
  }
}

function isHotDurabilityEvent(type: DatabaseObservabilityEventType): boolean {
  return type === 'hot-snapshot-started'
    || type === 'hot-snapshot-finished'
    || type === 'hot-durability-dirty'
    || type === 'hot-durability-clean'
    || type === 'hot-durability-failed';
}

function ownDataDescriptors(
  value: unknown,
): Record<string, PropertyDescriptor> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => (
      !descriptor.enumerable || !('value' in descriptor)
    ))) {
      return null;
    }
    return descriptors;
  } catch {
    return null;
  }
}
