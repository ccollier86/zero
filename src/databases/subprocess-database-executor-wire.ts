/**
 * subprocess-database-executor-wire.ts
 *
 * Owns the strict parent-side IPC boundary for subprocess database actors.
 * It validates exact envelopes and protocol identity before the executor state
 * machine is allowed to observe a child message.
 */

import {
  deserializeDatabaseError,
  isSerializedDatabaseError,
  type DatabaseError,
} from './database-error';
import type {
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
} from './database-executor';
import {
  hasExactDatabaseExecutorKeys,
  isDatabaseExecutorOperationName,
  isDatabaseExecutorValue,
  readDatabaseExecutorDataRecord,
} from './database-executor-validation';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  type DatabaseExecutorProtocolIdentity,
  type DatabaseExecutorTelemetryMessage,
} from './subprocess-database-protocol';

export type ParsedSubprocessDatabaseExecutorEvent =
  | { readonly type: 'ready' }
  | {
      readonly type: 'success';
      readonly requestId: number;
      readonly value: DatabaseExecutorValue;
    }
  | {
      readonly type: 'failure';
      readonly requestId: number;
      readonly error: DatabaseError;
    }
  | {
      readonly type: 'telemetry';
      readonly signal: DatabaseExecutorTelemetryMessage['signal'];
    }
  | { readonly type: 'shutdown-ack' };

const IDENTITY_KEYS = [
  'protocol',
  'version',
  'type',
  'nonce',
  'role',
  'slot',
  'generation',
] as const;
const READY_KEYS = new Set(IDENTITY_KEYS);
const SHUTDOWN_ACK_KEYS = new Set(IDENTITY_KEYS);
const TELEMETRY_KEYS = new Set([
  ...IDENTITY_KEYS,
  'signal',
]);
const SUCCESS_KEYS = new Set([
  ...IDENTITY_KEYS,
  'requestId',
  'ok',
  'value',
]);
const FAILURE_KEYS = new Set([
  ...IDENTITY_KEYS,
  'requestId',
  'ok',
  'error',
]);

/** Validate and detach an application request before transport allocation. */
export function normalizeSubprocessDatabaseExecutorRequest<
  Payload extends DatabaseExecutorValue,
>(
  request: DatabaseExecutorRequest<Payload>,
): DatabaseExecutorRequest<Payload> {
  const record = readDatabaseExecutorDataRecord(request);
  if (!record) {
    throw new TypeError('Database executor request must be an object.');
  }
  if (!isDatabaseExecutorOperationName(record.operation)) {
    throw new TypeError('Database executor operation must be a bounded identifier.');
  }
  if (record.kind !== 'read' && record.kind !== 'write') {
    throw new TypeError('Database executor request kind must be read or write.');
  }
  if (!isDatabaseExecutorValue(record.payload)) {
    throw new TypeError('Database executor payload must be a portable value.');
  }
  return Object.freeze({
    operation: record.operation,
    kind: record.kind,
    payload: record.payload as Payload,
  });
}

/**
 * Parse one exact child event for the expected actor identity.
 *
 * `null` deliberately carries no rejected payload details: callers collapse
 * every malformed or foreign envelope to the standard protocol error.
 */
export function parseSubprocessDatabaseExecutorEvent(
  message: unknown,
  expectedIdentity: DatabaseExecutorProtocolIdentity,
): ParsedSubprocessDatabaseExecutorEvent | null {
  const record = readDatabaseExecutorDataRecord(message);
  if (!record || !hasExpectedIdentity(record, expectedIdentity)) return null;

  switch (record.type) {
    case 'ready':
      return hasExactDatabaseExecutorKeys(record, READY_KEYS)
        ? { type: 'ready' }
        : null;
    case 'response':
      return parseResponse(record);
    case 'telemetry':
      return parseTelemetry(record);
    case 'shutdown-ack':
      return hasExactDatabaseExecutorKeys(record, SHUTDOWN_ACK_KEYS)
        ? { type: 'shutdown-ack' }
        : null;
    default:
      return null;
  }
}

function parseResponse(
  record: Record<string, unknown>,
): ParsedSubprocessDatabaseExecutorEvent | null {
  const requestId = record.requestId;
  if (!Number.isSafeInteger(requestId) || (requestId as number) <= 0) {
    return null;
  }

  if (record.ok === true
    && hasExactDatabaseExecutorKeys(record, SUCCESS_KEYS)
    && isDatabaseExecutorValue(record.value)) {
    return {
      type: 'success',
      requestId: requestId as number,
      value: record.value,
    };
  }
  if (record.ok === false
    && hasExactDatabaseExecutorKeys(record, FAILURE_KEYS)
    && isSerializedDatabaseError(record.error)) {
    return {
      type: 'failure',
      requestId: requestId as number,
      error: deserializeDatabaseError(record.error),
    };
  }
  return null;
}

function parseTelemetry(
  record: Record<string, unknown>,
): ParsedSubprocessDatabaseExecutorEvent | null {
  if (!hasExactDatabaseExecutorKeys(record, TELEMETRY_KEYS)) return null;
  switch (record.signal) {
    case 'hot-periodic-snapshot-started':
    case 'hot-periodic-snapshot-finished':
    case 'hot-periodic-durability-dirty':
    case 'hot-periodic-durability-clean':
    case 'hot-periodic-durability-failed':
      return { type: 'telemetry', signal: record.signal };
    default:
      return null;
  }
}

function hasExpectedIdentity(
  record: Record<string, unknown>,
  expected: DatabaseExecutorProtocolIdentity,
): boolean {
  return record.protocol === DATABASE_EXECUTOR_PROTOCOL_KIND
    && record.version === DATABASE_EXECUTOR_PROTOCOL_VERSION
    && record.nonce === expected.nonce
    && record.role === expected.role
    && record.slot === expected.slot
    && record.generation === expected.generation;
}
