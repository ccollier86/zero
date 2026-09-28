/**
 * database-observability.ts
 *
 * Emits database lifecycle and operation events through an explicitly
 * app-bound observability runtime. The boundary accepts a closed event union
 * and builds its own bounded metadata; callers cannot attach arbitrary data.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCodeTo } from '../observability/sink';
import type {
  PlatformCodeDefinition,
  PlatformEvent,
  PlatformObservabilityRuntime,
} from '../observability/types';
import {
  normalizeDatabaseError,
  type DatabaseErrorCode,
  type DatabaseOperationOutcome,
} from './database-error';
import { normalizeDatabaseRef, type DatabaseRef } from './database-file';

/** Highest executor slot accepted in telemetry. */
export const DATABASE_OBSERVABILITY_MAX_SLOT = 65_535;

/** Highest generation, count, or configured limit accepted in telemetry. */
export const DATABASE_OBSERVABILITY_MAX_COUNT = 2_147_483_647;

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
  'sync',
  'shutdown',
  'protocol',
] as const);

export type DatabaseOperationClass =
  (typeof DATABASE_OPERATION_CLASSES)[number];

interface DatabaseActorEventContext {
  readonly databaseRef: DatabaseRef;
  readonly role?: DatabaseExecutorRole;
  readonly slot?: number;
  readonly generation?: number;
}

interface DatabaseExecutorEventContext {
  readonly databaseRef?: DatabaseRef;
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
      readonly type: 'executor-started';
      readonly durationMs: number;
    } & DatabaseExecutorEventContext)
  | ({
      readonly type: 'executor-ready';
      readonly durationMs: number;
    } & DatabaseExecutorEventContext)
  | ({
      readonly type: 'executor-exited';
      readonly reason: DatabaseObservabilityReason;
    } & DatabaseExecutorEventContext)
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
      readonly type: 'migration-started';
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'migration-completed';
      readonly durationMs: number;
      readonly migrationCount: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'migration-failed';
      readonly phase: DatabaseObservabilityPhase;
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'queue-saturated';
      readonly operation: DatabaseOperationClass;
      readonly queueDepth: number;
      readonly queueLimit: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'queue-timeout';
      readonly operation: DatabaseOperationClass;
      readonly queueDepth: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'operation-slow';
      readonly operation: DatabaseOperationClass;
      readonly durationMs: number;
      readonly slowLimitMs: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'operation-failed';
      readonly operation: DatabaseOperationClass;
      readonly durationMs: number;
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
      readonly type: 'replay-started';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'replay-completed';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext)
  | ({
      readonly type: 'replay-failed';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly durationMs: number;
    } & DatabaseActorEventContext & DatabaseFailureEvent)
  | ({
      readonly type: 'history-gap';
      readonly sequenceStart: number;
      readonly sequenceEnd: number;
      readonly reason: DatabaseObservabilityReason;
    } & DatabaseActorEventContext)
  | {
      readonly type: 'shutdown-graceful-started';
      readonly activeCount: number;
      readonly queueDepth: number;
    }
  | {
      readonly type: 'shutdown-graceful-completed';
      readonly durationMs: number;
    }
  | ({
      readonly type: 'shutdown-graceful-failed';
      readonly phase: DatabaseObservabilityPhase;
      readonly durationMs: number;
    } & DatabaseFailureEvent)
  | {
      readonly type: 'shutdown-forced';
      readonly reason: DatabaseObservabilityReason;
      readonly activeCount: number;
      readonly queueDepth: number;
    }
  | ({
      readonly type: 'shutdown-forced-failed';
      readonly reason: DatabaseObservabilityReason;
      readonly durationMs: number;
    } & DatabaseFailureEvent);

export type DatabaseObservabilityEventType =
  DatabaseObservabilityEvent['type'];

/** Exact metadata shape emitted by the database observability boundary. */
export interface DatabaseObservabilityMetadata {
  readonly databaseRef?: DatabaseRef;
  readonly role?: DatabaseExecutorRole;
  readonly slot?: number;
  readonly generation?: number;
  readonly phase?: DatabaseObservabilityPhase;
  readonly reason?: DatabaseObservabilityReason;
  readonly operation?: DatabaseOperationClass;
  readonly durationMs?: number;
  readonly slowLimitMs?: number;
  readonly writerCount?: number;
  readonly readerCount?: number;
  readonly runtimeCount?: number;
  readonly activeCount?: number;
  readonly migrationCount?: number;
  readonly queueDepth?: number;
  readonly retryCount?: number;
  readonly writerLimit?: number;
  readonly readerLimit?: number;
  readonly runtimeLimit?: number;
  readonly queueLimit?: number;
  readonly sequenceStart?: number;
  readonly sequenceEnd?: number;
  readonly errorCode?: DatabaseErrorCode;
  readonly retryable?: boolean;
  readonly outcome?: DatabaseOperationOutcome | null;
}

type InputMetadataKey = Exclude<
  keyof DatabaseObservabilityMetadata,
  'errorCode' | 'retryable' | 'outcome'
>;

interface DatabaseEventSpec {
  readonly definition: PlatformCodeDefinition;
  readonly metadata: readonly InputMetadataKey[];
  readonly required: readonly InputMetadataKey[];
  readonly failure?: boolean;
}

const DATABASE_EXECUTOR_ROLE_SET: ReadonlySet<DatabaseExecutorRole> =
  new Set(DATABASE_EXECUTOR_ROLES);
const DATABASE_PHASE_SET: ReadonlySet<DatabaseObservabilityPhase> =
  new Set(DATABASE_OBSERVABILITY_PHASES);
const DATABASE_REASON_SET: ReadonlySet<DatabaseObservabilityReason> =
  new Set(DATABASE_OBSERVABILITY_REASONS);
const DATABASE_OPERATION_CLASS_SET: ReadonlySet<DatabaseOperationClass> =
  new Set(DATABASE_OPERATION_CLASSES);

const ACTOR_CONTEXT_KEYS = [
  'databaseRef',
  'role',
  'slot',
  'generation',
] as const satisfies readonly InputMetadataKey[];

const EXECUTOR_CONTEXT_KEYS = [
  'databaseRef',
  'role',
  'slot',
  'generation',
] as const satisfies readonly InputMetadataKey[];

const EVENT_SPECS = Object.freeze({
  'coordinator-configured': eventSpec(
    OBS_CODES.DATABASE_COORDINATOR_CONFIGURED,
    ['writerLimit', 'readerLimit', 'runtimeLimit', 'queueLimit'],
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
    ['phase'],
  ),
  'executor-started': eventSpec(
    OBS_CODES.DATABASE_EXECUTOR_STARTED,
    [...EXECUTOR_CONTEXT_KEYS, 'durationMs'],
    ['role', 'slot', 'generation', 'durationMs'],
  ),
  'executor-ready': eventSpec(
    OBS_CODES.DATABASE_EXECUTOR_READY,
    [...EXECUTOR_CONTEXT_KEYS, 'durationMs'],
    ['role', 'slot', 'generation', 'durationMs'],
  ),
  'executor-exited': eventSpec(
    OBS_CODES.DATABASE_EXECUTOR_EXITED,
    [...EXECUTOR_CONTEXT_KEYS, 'reason'],
    ['role', 'slot', 'generation', 'reason'],
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
  'migration-started': eventSpec(
    OBS_CODES.DATABASE_MIGRATION_STARTED,
    ACTOR_CONTEXT_KEYS,
    ['databaseRef'],
  ),
  'migration-completed': eventSpec(
    OBS_CODES.DATABASE_MIGRATION_COMPLETED,
    [...ACTOR_CONTEXT_KEYS, 'durationMs', 'migrationCount'],
    ['databaseRef', 'durationMs', 'migrationCount'],
  ),
  'migration-failed': failureSpec(
    OBS_CODES.DATABASE_MIGRATION_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'phase', 'durationMs'],
    ['databaseRef', 'phase', 'durationMs'],
  ),
  'queue-saturated': eventSpec(
    OBS_CODES.DATABASE_QUEUE_SATURATED,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'queueDepth', 'queueLimit'],
    ['databaseRef', 'operation', 'queueDepth', 'queueLimit'],
  ),
  'queue-timeout': eventSpec(
    OBS_CODES.DATABASE_QUEUE_TIMEOUT,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'queueDepth', 'durationMs'],
    ['databaseRef', 'operation', 'queueDepth', 'durationMs'],
  ),
  'operation-slow': eventSpec(
    OBS_CODES.DATABASE_OPERATION_SLOW,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'durationMs', 'slowLimitMs'],
    ['databaseRef', 'operation', 'durationMs', 'slowLimitMs'],
  ),
  'operation-failed': failureSpec(
    OBS_CODES.DATABASE_OPERATION_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'operation', 'durationMs'],
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
  'replay-started': eventSpec(
    OBS_CODES.DATABASE_REPLAY_STARTED,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd'],
  ),
  'replay-completed': eventSpec(
    OBS_CODES.DATABASE_REPLAY_COMPLETED,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'durationMs'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'durationMs'],
  ),
  'replay-failed': failureSpec(
    OBS_CODES.DATABASE_REPLAY_FAILED,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'durationMs'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'durationMs'],
  ),
  'history-gap': eventSpec(
    OBS_CODES.DATABASE_HISTORY_GAP,
    [...ACTOR_CONTEXT_KEYS, 'sequenceStart', 'sequenceEnd', 'reason'],
    ['databaseRef', 'sequenceStart', 'sequenceEnd', 'reason'],
  ),
  'shutdown-graceful-started': eventSpec(
    OBS_CODES.DATABASE_SHUTDOWN_GRACEFUL_STARTED,
    ['activeCount', 'queueDepth'],
  ),
  'shutdown-graceful-completed': eventSpec(
    OBS_CODES.DATABASE_SHUTDOWN_GRACEFUL_COMPLETED,
    ['durationMs'],
  ),
  'shutdown-graceful-failed': failureSpec(
    OBS_CODES.DATABASE_SHUTDOWN_GRACEFUL_FAILED,
    ['phase', 'durationMs'],
  ),
  'shutdown-forced': eventSpec(
    OBS_CODES.DATABASE_SHUTDOWN_FORCED,
    ['reason', 'activeCount', 'queueDepth'],
  ),
  'shutdown-forced-failed': failureSpec(
    OBS_CODES.DATABASE_SHUTDOWN_FORCED_FAILED,
    ['reason', 'durationMs'],
  ),
} satisfies Record<DatabaseObservabilityEventType, DatabaseEventSpec>);

/**
 * App-local emitter that never falls back to process-global observability.
 *
 * Executor children should relay this closed event shape to their parent. They
 * must not configure or emit through ambient process-global observability,
 * which would bypass the owning app runtime and can duplicate console output.
 */
export class DatabaseObservability {
  readonly #runtime: PlatformObservabilityRuntime;

  constructor(runtime: PlatformObservabilityRuntime) {
    assertObservabilityRuntime(runtime);
    this.#runtime = runtime;
  }

  /** Emit one validated database event to this app's runtime. */
  emit(event: DatabaseObservabilityEvent): PlatformEvent {
    return emitDatabaseObservabilityEvent(this.#runtime, event);
  }
}

/** Create an emitter bound to exactly one application's observability runtime. */
export function createDatabaseObservability(
  runtime: PlatformObservabilityRuntime,
): DatabaseObservability {
  return new DatabaseObservability(runtime);
}

/** Emit one database event through an explicit app-local runtime. */
export function emitDatabaseObservabilityEvent(
  runtime: PlatformObservabilityRuntime,
  event: DatabaseObservabilityEvent,
): PlatformEvent {
  assertObservabilityRuntime(runtime);
  const prepared = prepareEvent(event);
  return emitPlatformCodeTo(runtime, prepared.definition, {
    metadata: { ...prepared.metadata },
  });
}

function eventSpec(
  definition: PlatformCodeDefinition,
  metadata: readonly InputMetadataKey[],
  required: readonly InputMetadataKey[] = metadata,
): DatabaseEventSpec {
  return Object.freeze({ definition, metadata, required });
}

function failureSpec(
  definition: PlatformCodeDefinition,
  metadata: readonly InputMetadataKey[],
  required: readonly InputMetadataKey[] = metadata,
): DatabaseEventSpec {
  return Object.freeze({ definition, metadata, required, failure: true });
}

function prepareEvent(event: DatabaseObservabilityEvent): {
  readonly definition: PlatformCodeDefinition;
  readonly metadata: DatabaseObservabilityMetadata;
} {
  const descriptors = ownDataDescriptors(event);
  if (!descriptors) {
    throw new TypeError('Invalid database observability event.');
  }
  const type = descriptors.type?.value;
  if (typeof type !== 'string' || !Object.hasOwn(EVENT_SPECS, type)) {
    throw new TypeError('Invalid database observability event.');
  }

  const spec = EVENT_SPECS[type as DatabaseObservabilityEventType];
  const allowed = new Set<string>(['type', ...spec.metadata]);
  if (spec.failure) allowed.add('error');

  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowed.has(key))) {
    throw new TypeError('Database observability event contains unsupported fields.');
  }
  if (spec.required.some((key) => !Object.hasOwn(descriptors, key))
    || (spec.failure && !Object.hasOwn(descriptors, 'error'))) {
    throw new TypeError('Database observability event is missing required fields.');
  }

  const metadata: Record<string, unknown> = {};
  for (const key of spec.metadata) {
    if (!Object.hasOwn(descriptors, key)) continue;
    metadata[key] = normalizeMetadataValue(key, descriptors[key]!.value);
  }

  assertSequenceRange(metadata);

  if (spec.failure) {
    const error = normalizeCaughtDatabaseError(descriptors.error!.value);
    metadata.errorCode = error.code;
    metadata.retryable = error.retryable;
    metadata.outcome = error.outcome;
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
  key: InputMetadataKey,
  value: unknown,
): DatabaseObservabilityMetadata[InputMetadataKey] {
  switch (key) {
    case 'databaseRef':
      return normalizeDatabaseRef(value as string);
    case 'role':
      return enumValue(value, DATABASE_EXECUTOR_ROLE_SET, 'executor role');
    case 'phase':
      return enumValue(value, DATABASE_PHASE_SET, 'lifecycle phase');
    case 'reason':
      return enumValue(value, DATABASE_REASON_SET, 'lifecycle reason');
    case 'operation':
      return enumValue(value, DATABASE_OPERATION_CLASS_SET, 'operation class');
    case 'slot':
      return boundedInteger(value, 0, DATABASE_OBSERVABILITY_MAX_SLOT, 'executor slot');
    case 'durationMs':
    case 'slowLimitMs':
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
    case 'migrationCount':
    case 'queueDepth':
    case 'retryCount':
    case 'writerLimit':
    case 'readerLimit':
    case 'runtimeLimit':
    case 'queueLimit':
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

function assertObservabilityRuntime(
  runtime: PlatformObservabilityRuntime,
): void {
  if (!runtime
    || typeof runtime !== 'object'
    || !runtime.sink
    || typeof runtime.sink.emit !== 'function') {
    throw new TypeError('A valid app-local observability runtime is required.');
  }
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
