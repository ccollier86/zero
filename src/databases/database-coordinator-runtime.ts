/** Closed coordinator configuration and operation helpers. */

import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';
import type { DatabaseExecutionOptions } from './database-coordinator-contract';
import { DatabaseError } from './database-error';
import type { DatabaseExecutor, DatabaseExecutorEvent } from './database-executor';
import { normalizeDatabaseId, type DatabaseId } from './database-file';
import type {
  DatabaseOperation,
  DatabaseWriteOperation,
} from './database-operations';

export type DatabaseWriterLaneOperationClass =
  | 'query'
  | 'mutation'
  | 'replay'
  | 'snapshot'
  | 'receipt';

export function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must be a positive safe integer.`,
    );
  }
  return value as number;
}

export function observablePositiveInteger(value: unknown, field: string): number {
  const normalized = positiveInteger(value, field);
  if (normalized > DATABASE_OBSERVABILITY_COUNT_MAX) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must not exceed ${DATABASE_OBSERVABILITY_COUNT_MAX}.`,
    );
  }
  return normalized;
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must be a non-negative safe integer.`,
    );
  }
  return value as number;
}

export function boundedTimerInterval(value: unknown, field: string): number {
  const normalized = positiveInteger(value, field);
  if (normalized > MAX_RUNTIME_TIMER_INTERVAL_MS) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `Database ${field} must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}.`,
    );
  }
  return normalized;
}

export function queueTimeout(
  options: DatabaseExecutionOptions,
  fallback: number,
): number {
  return boundedTimerInterval(
    options.queueTimeoutMs ?? fallback,
    'queueTimeoutMs',
  );
}

export function operationTimeout(
  options: DatabaseExecutionOptions,
  fallback: number,
): number {
  return boundedTimerInterval(
    options.operationTimeoutMs ?? fallback,
    'operationTimeoutMs',
  );
}

export function isWriteOperation(
  operation: DatabaseOperation,
): operation is DatabaseWriteOperation {
  return operation.type === 'mutate'
    || operation.type === 'batch'
    || operation.type === 'command';
}

export function operationClass(
  operation: DatabaseOperation,
): 'query' | 'mutation' {
  return isWriteOperation(operation) ? 'mutation' : 'query';
}

export function normalizeCoordinatorDatabaseId(input: string): DatabaseId {
  try {
    return normalizeDatabaseId(input);
  } catch {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database identifier is invalid.',
    );
  }
}

export function firstSetValue(values: ReadonlySet<number>): number | null {
  for (const value of values) return value;
  return null;
}

export function compactExecutors(
  writer: DatabaseExecutor | null,
  reader: DatabaseExecutor | null,
): DatabaseExecutor[] {
  return [writer, reader].filter(
    (value): value is DatabaseExecutor => value !== null,
  );
}

export function isExactDatabaseExecutorEvent(
  value: unknown,
): value is DatabaseExecutorEvent {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'type') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    return Boolean(descriptor
      && descriptor.enumerable
      && 'value' in descriptor
      && (descriptor.value === 'hot-periodic-snapshot-started'
        || descriptor.value === 'hot-periodic-snapshot-finished'
        || descriptor.value === 'hot-periodic-durability-dirty'
        || descriptor.value === 'hot-periodic-durability-clean'
        || descriptor.value === 'hot-periodic-durability-failed'));
  } catch {
    return false;
  }
}

export function periodicDurabilityDeadlineRemaining(
  startedAt: number,
  now: number,
  intervalMs: number,
): number {
  const elapsedMs = now - startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return Math.max(0, intervalMs - elapsedMs);
}
