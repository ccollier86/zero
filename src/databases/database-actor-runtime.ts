/**
 * database-actor-runtime.ts
 *
 * Actor-local binding and dispatch for exactly one database file at a time.
 * The parent supplies a physical path only to the trusted bind operation; all
 * later commands are authorized solely by the opaque bound database reference.
 */

import { createPlatformSQLiteService } from '../persistence';
import { DatabaseError, type DatabaseErrorCode, type DatabaseErrorDetails } from './database-error';
import {
  DATABASE_ACTOR_OPERATIONS,
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  validateDatabaseActorExecutePayload,
  validateDatabaseActorReplayPayload,
  validateDatabaseActorUnbindPayload,
  type DatabaseActorBindPayload,
  type DatabaseActorBindResult,
  type DatabaseActorRole,
} from './database-actor-protocol';
import type { DatabaseRef } from './database-file';
import {
  createDatabaseSequenceToken,
  type DatabaseOperation,
} from './database-operations';
import {
  validateDatabaseActorExecuteResult,
  validateDatabaseActorReplayResult,
} from './database-actor-result-validation';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import { DatabaseReaderRuntime } from './database-reader-runtime';
import { DatabaseRuntime } from './database-runtime';
import {
  DatabaseWriterOperationEngine,
  type DatabaseChangeReplayResult,
} from './database-writer-engine';
import type {
  DatabaseExecutorOperationKind,
  DatabaseExecutorValue,
} from './database-executor';
import { isDatabaseExecutorValue } from './database-executor-validation';
import {
  SubprocessDatabaseServer,
  type DatabaseExecutorServerRequest,
  type SubprocessDatabaseServerOptions,
} from './subprocess-database-server';

const REALM_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SCHEMA_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

export type DatabaseActorRuntimeState =
  | 'unbound'
  | 'bound'
  | 'closing'
  | 'failed'
  | 'closed';

export interface DatabaseActorRuntimeOptions {
  /** Capability class fixed by the child entrypoint, never by request data. */
  readonly role: DatabaseActorRole;
  /** Realm imported independently inside this actor process. */
  readonly realm: DatabaseRealm;
}

export interface DatabaseActorRuntimeDiagnostics {
  readonly state: DatabaseActorRuntimeState;
  readonly role: DatabaseActorRole;
  readonly databaseRef: DatabaseRef | null;
  readonly realmFingerprint: string;
}

export interface DatabaseActorServerOptions extends DatabaseActorRuntimeOptions {
  readonly slot: number;
  readonly maxInFlight?: number;
  /** Test/embedding seam. Production actors use Bun process IPC. */
  readonly transport?: SubprocessDatabaseServerOptions['transport'];
}

export interface DatabaseActorServer {
  readonly actor: DatabaseActorRuntime;
  readonly server: SubprocessDatabaseServer;
}

interface WriterBinding {
  readonly role: 'writer';
  readonly databaseRef: DatabaseRef;
  readonly runtime: DatabaseRuntime;
  readonly engine: DatabaseWriterOperationEngine;
}

interface ReaderBinding {
  readonly role: 'reader';
  readonly databaseRef: DatabaseRef;
  readonly runtime: DatabaseReaderRuntime;
}

type DatabaseActorBinding = WriterBinding | ReaderBinding;

/**
 * Synchronous database-specific handler hosted behind SubprocessDatabaseServer.
 *
 * SQLite operations intentionally remain synchronous so a request cannot
 * interleave a bind, operation, or unbind transition on this actor's handle.
 */
export class DatabaseActorRuntime implements Disposable {
  readonly role: DatabaseActorRole;
  readonly realm: DatabaseRealm;

  private readonly catalog;
  private binding: DatabaseActorBinding | null = null;
  private state: DatabaseActorRuntimeState = 'unbound';
  private closeRequested = false;

  constructor(options: DatabaseActorRuntimeOptions) {
    if (options.role !== 'writer' && options.role !== 'reader') {
      throw new TypeError('Database actor role must be writer or reader.');
    }
    if (!options.realm
      || !REALM_FINGERPRINT_PATTERN.test(options.realm.fingerprint)
      || !SCHEMA_CHECKSUM_PATTERN.test(options.realm.schemaChecksum)) {
      throw new TypeError('Database actor realm must be a defined database realm.');
    }
    this.role = options.role;
    this.realm = options.realm;
    this.catalog = createDatabaseRealmOperationCatalog(options.realm);
  }

  /** Validate and execute one already-framed server request. */
  handle(request: DatabaseExecutorServerRequest): DatabaseExecutorValue {
    try {
      this.assertAccepting();
      switch (request.operation) {
        case DATABASE_ACTOR_OPERATIONS.bindWriter:
          return asExecutorValue(this.bind(request, 'writer'));
        case DATABASE_ACTOR_OPERATIONS.bindReader:
          return asExecutorValue(this.bind(request, 'reader'));
        case DATABASE_ACTOR_OPERATIONS.execute:
          return this.execute(request);
        case DATABASE_ACTOR_OPERATIONS.replay:
          return asExecutorValue(this.replay(request));
        case DATABASE_ACTOR_OPERATIONS.unbind:
          return this.unbind(request);
        default:
          throw new DatabaseError(
            'DATABASE_OPERATION_UNSUPPORTED',
            'Database actor operation is unsupported.',
          );
      }
    } catch (error) {
      throw privacySafeActorError(error);
    }
  }

  /** Close the current binding once; a failed cleanup never becomes closed. */
  close(): void {
    if (this.state === 'closed') return;
    this.closeRequested = true;
    this.state = 'closing';
    try {
      if (this.binding) {
        closeBinding(this.binding);
        this.binding = null;
      }
      this.state = 'closed';
    } catch {
      this.state = 'failed';
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  diagnostics(): DatabaseActorRuntimeDiagnostics {
    return Object.freeze({
      state: this.state,
      role: this.role,
      databaseRef: this.binding?.databaseRef ?? null,
      realmFingerprint: this.realm.fingerprint,
    });
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private bind(
    request: DatabaseExecutorServerRequest,
    requestedRole: DatabaseActorRole,
  ): DatabaseActorBindResult {
    const payload = validateDatabaseActorBindPayload(request.payload);
    if (requestedRole !== this.role) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database actor cannot change roles.',
      );
    }
    requireOperationKind(
      request.kind,
      requestedRole === 'writer' ? 'write' : 'read',
    );
    if (this.binding) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database actor is already bound.',
      );
    }
    if (payload.realmFingerprint !== this.realm.fingerprint) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database actor realm fingerprint does not match.',
      );
    }

    let candidate: DatabaseActorBinding | null = null;
    try {
      candidate = this.role === 'writer'
        ? openWriterBinding(payload, this.realm)
        : openReaderBinding(payload, this.realm);
      const result = validateBindResult(() => validateDatabaseActorBindResult({
        databaseRef: candidate!.databaseRef,
        role: candidate!.role,
        realmFingerprint: this.realm.fingerprint,
        schemaChecksum: this.realm.schemaChecksum,
        sequence: createDatabaseSequenceToken(bindingSequence(candidate!)),
        syncEpoch: candidate!.role === 'writer'
          ? candidate!.runtime.db.syncEpoch
          : null,
      }));
      if (result.databaseRef !== payload.databaseRef
        || result.role !== this.role
        || result.realmFingerprint !== payload.realmFingerprint
        || result.schemaChecksum !== this.realm.schemaChecksum) {
        throw new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Database actor readiness proof is invalid.',
          { retryable: false, outcome: 'unknown' },
        );
      }
      this.binding = candidate;
      this.state = 'bound';
      return result;
    } catch (error) {
      if (candidate) {
        try {
          closeBinding(candidate);
        } catch {
          // Retain ownership so a later close hook can retry cleanup. Never
          // discard a possibly-live SQLite authority after a failed bind.
          this.binding = candidate;
          this.closeRequested = true;
          this.state = 'failed';
          throw new DatabaseError(
            'DATABASE_EXECUTOR_FAILED',
            'Database actor failed to clean up an incomplete binding.',
            { retryable: false, outcome: 'unknown' },
          );
        }
      }
      throw error;
    }
  }

  private execute(
    request: DatabaseExecutorServerRequest,
  ): DatabaseExecutorValue {
    const payload = validateDatabaseActorExecutePayload(
      request.payload,
      this.catalog,
    );
    const binding = this.requireBinding(payload.databaseRef);
    const expectedKind = operationKind(payload.operation);
    requireOperationKind(request.kind, expectedKind);

    const value = binding.role === 'reader'
      ? binding.runtime.execute(payload.operation)
      : binding.engine.execute(payload.operation);
    return asExecutorValue(validateDatabaseActorExecuteResult(
      value,
      payload.operation,
      this.catalog,
    ));
  }

  private replay(
    request: DatabaseExecutorServerRequest,
  ): DatabaseChangeReplayResult {
    const payload = validateDatabaseActorReplayPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'read');
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not replay writer changes.',
      );
    }
    return validateDatabaseActorReplayResult(
      binding.engine.replayChanges(payload.afterSeq, payload.limit),
      payload,
    );
  }

  private unbind(request: DatabaseExecutorServerRequest): null {
    const payload = validateDatabaseActorUnbindPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'read');
    try {
      closeBinding(binding);
      this.binding = null;
      this.state = 'unbound';
      return null;
    } catch {
      this.closeRequested = true;
      this.state = 'failed';
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor could not release its binding.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  private requireBinding(databaseRef: DatabaseRef): DatabaseActorBinding {
    if (!this.binding) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database actor is not bound.',
      );
    }
    if (this.binding.databaseRef !== databaseRef) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database actor capability does not match its binding.',
      );
    }
    return this.binding;
  }

  private assertAccepting(): void {
    if (this.closeRequested || this.state === 'closed') {
      throw new DatabaseError('DATABASE_CLOSED', 'Database actor is closed.');
    }
    if (this.state === 'closing' || this.state === 'failed') {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor is unavailable.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }
}

/** Compose the database handler and strict IPC server without starting either. */
export function createDatabaseActorServer(
  options: DatabaseActorServerOptions,
): DatabaseActorServer {
  const actor = new DatabaseActorRuntime(options);
  const server = new SubprocessDatabaseServer({
    role: options.role,
    slot: options.slot,
    // One synchronous SQLite lane per actor. Cross-file concurrency comes from
    // separate actor processes, not overlapping work on one connection.
    maxInFlight: options.maxInFlight ?? 1,
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
    handle: (request) => actor.handle(request),
    close: () => actor.close(),
  });
  return Object.freeze({ actor, server });
}

function openWriterBinding(
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
): WriterBinding {
  const { ringBufferDepth, ...sqliteOptions } = payload.sqlite;
  const sqlite = createPlatformSQLiteService({
    mode: 'file',
    path: payload.filePath,
    ...sqliteOptions,
  });
  let runtime: DatabaseRuntime | null = null;
  let engine: DatabaseWriterOperationEngine | null = null;
  try {
    runtime = DatabaseRuntime.open({
      id: payload.databaseRef,
      role: 'named',
      sqlite,
      ownsSQLite: true,
      ...(ringBufferDepth === undefined
        ? {}
        : { reactive: { ringBufferDepth } }),
      migrations: realm.migrations,
      migrate: true,
      tables: realm.tables,
    });
    engine = new DatabaseWriterOperationEngine({ runtime, realm });
    runtime.start();
    return {
      role: 'writer',
      databaseRef: payload.databaseRef,
      runtime,
      engine,
    };
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    if (engine) attemptClose(() => engine!.close(), cleanupFailures);
    if (runtime) {
      attemptClose(() => runtime!.close(), cleanupFailures);
    } else {
      // DatabaseRuntime.open owns startup cleanup. This idempotent fallback
      // also covers a future validation failure before ownership transfer.
      attemptClose(() => sqlite.close(), cleanupFailures);
    }
    if (cleanupFailures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database writer actor startup cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    throw error;
  }
}

function openReaderBinding(
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
): ReaderBinding {
  return {
    role: 'reader',
    databaseRef: payload.databaseRef,
    runtime: DatabaseReaderRuntime.open({
      filePath: payload.filePath,
      realm,
      ...(payload.sqlite.busyTimeout === undefined
        ? {}
        : { busyTimeoutMs: payload.sqlite.busyTimeout }),
    }),
  };
}

function closeBinding(binding: DatabaseActorBinding): void {
  const failures: unknown[] = [];
  if (binding.role === 'writer') {
    attemptClose(() => binding.engine.close(), failures);
    attemptClose(() => binding.runtime.close(), failures);
  } else {
    attemptClose(() => binding.runtime.close(), failures);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Database actor binding cleanup failed.');
  }
}

function attemptClose(close: () => void, failures: unknown[]): void {
  try {
    close();
  } catch (error) {
    failures.push(error);
  }
}

function bindingSequence(binding: DatabaseActorBinding): number {
  return binding.role === 'writer'
    ? binding.runtime.db.currentSeq
    : binding.runtime.currentSeq;
}

function operationKind(operation: DatabaseOperation): DatabaseExecutorOperationKind {
  return operation.type === 'get'
    || operation.type === 'list'
    || operation.type === 'find'
    || operation.type === 'query'
    ? 'read'
    : 'write';
}

function requireOperationKind(
  actual: DatabaseExecutorOperationKind,
  expected: DatabaseExecutorOperationKind,
): void {
  if (actual !== expected) {
    throw new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Database actor operation classification is invalid.',
      { retryable: false, outcome: 'unknown' },
    );
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidActorResult(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor returned an invalid result.',
    { retryable: false, outcome: 'unknown' },
  );
}

function asExecutorValue(value: unknown): DatabaseExecutorValue {
  if (!isDatabaseExecutorValue(value)) throw invalidActorResult();
  return value;
}

function validateBindResult<T>(validate: () => T): T {
  try {
    return validate();
  } catch (error) {
    if (error instanceof DatabaseError && error.code === 'DATABASE_PAYLOAD_LIMIT') {
      throw new DatabaseError(
        'DATABASE_RESULT_LIMIT',
        'Database actor result is outside the supported contract.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    throw invalidActorResult();
  }
}

function privacySafeActorError(error: unknown): DatabaseError {
  if (!(error instanceof DatabaseError)) {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database actor operation failed.',
      { retryable: false, outcome: 'unknown' },
    );
  }
  return new DatabaseError(error.code, safeActorMessage(error.code), {
    retryable: error.retryable,
    outcome: error.outcome,
    details: safeActorDetails(error.code, error.details),
  });
}

function safeActorMessage(code: DatabaseErrorCode): string {
  switch (code) {
    case 'DATABASE_CONFIG_INVALID':
      return 'Database actor configuration is invalid.';
    case 'DATABASE_DISABLED':
      return 'Database actor is disabled.';
    case 'DATABASE_NOT_READY':
      return 'Database actor is not ready.';
    case 'DATABASE_CLOSED':
      return 'Database actor is closed.';
    case 'DATABASE_BACKPRESSURE':
    case 'DATABASE_QUEUE_TIMEOUT':
      return 'Database actor capacity is unavailable.';
    case 'DATABASE_OPERATION_TIMEOUT':
      return 'Database actor operation timed out.';
    case 'DATABASE_EXECUTOR_START_FAILED':
    case 'DATABASE_OPEN_FAILED':
      return 'Database actor could not open its database.';
    case 'DATABASE_MIGRATION_FAILED':
      return 'Database actor migration failed.';
    case 'DATABASE_SCHEMA_MISMATCH':
      return 'Database actor schema does not match its realm.';
    case 'DATABASE_AUTHORITY_CHANGED':
      return 'Database actor capability changed.';
    case 'DATABASE_CONFLICT':
      return 'Database operation conflicted.';
    case 'DATABASE_HISTORY_GAP':
      return 'Database change history cannot satisfy the requested cursor.';
    case 'DATABASE_PAYLOAD_INVALID':
    case 'DATABASE_PAYLOAD_LIMIT':
      return 'Database actor request is invalid.';
    case 'DATABASE_RESULT_LIMIT':
      return 'Database actor result is outside the supported contract.';
    case 'DATABASE_OPERATION_UNSUPPORTED':
      return 'Database actor operation is unsupported.';
    case 'DATABASE_TRANSACTION_EXPIRED':
    case 'DATABASE_TRANSACTION_STALE':
      return 'Database operation snapshot is unavailable.';
    case 'DATABASE_PROTOCOL_ERROR':
      return 'Database actor protocol validation failed.';
    case 'DATABASE_OUTCOME_UNKNOWN':
      return 'Database operation outcome is unknown.';
    case 'DATABASE_EXECUTOR_FAILED':
      return 'Database actor operation failed.';
  }
}

function safeActorDetails(
  code: DatabaseErrorCode,
  details: DatabaseErrorDetails,
): DatabaseErrorDetails | undefined {
  if (code === 'DATABASE_OPEN_FAILED') {
    const result: Record<string, string> = {};
    if (details.phase === 'open'
      || details.phase === 'configure'
      || details.phase === 'schema'
      || details.phase === 'sequence'
      || details.phase === 'schema-version') {
      result.phase = details.phase;
    }
    if (typeof details.sqliteCode === 'string'
      && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(details.sqliteCode)) {
      result.sqliteCode = details.sqliteCode;
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  }
  const allowed = code === 'DATABASE_HISTORY_GAP'
    ? new Set(['afterSeq', 'currentSeq'])
    : code === 'DATABASE_TRANSACTION_STALE' || code === 'DATABASE_NOT_READY'
      ? new Set(['currentSeq', 'requiredSeq', 'minSeq'])
      : null;
  if (!allowed) return undefined;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (allowed.has(key) && isNonNegativeSafeInteger(value)) result[key] = value;
  }
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}
