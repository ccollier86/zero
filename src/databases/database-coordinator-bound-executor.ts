/** Runtime guard for coordinator-owned executor implementations. */

import {
  DatabaseError,
  isDatabaseErrorCode,
} from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorValue,
} from './database-executor';

const EXECUTOR_STATES = new Set<DatabaseExecutorDiagnostics['state']>([
  'created',
  'starting',
  'ready',
  'draining',
  'closing',
  'failed',
  'quarantined',
  'closed',
]);

/**
 * Pins the slot/generation identity returned by an injected executor and
 * revalidates every later diagnostics read. The raw executor never enters a
 * coordinator entry directly.
 */
export class DatabaseCoordinatorBoundExecutor implements DatabaseExecutor {
  readonly #executor: DatabaseExecutor;
  readonly #assignedSlot: number;
  readonly #start: DatabaseExecutor['start'];
  readonly #execute: DatabaseExecutor['execute'];
  readonly #settled: DatabaseExecutor['settled'];
  readonly #close: DatabaseExecutor['close'];
  readonly #diagnostics: DatabaseExecutor['diagnostics'];
  #identity: Readonly<{ slot: number; generation: number }> | null = null;

  constructor(
    executor: DatabaseExecutor,
    assignedSlot: number,
    methods: CapturedDatabaseExecutorMethods,
  ) {
    this.#executor = executor;
    this.#assignedSlot = assignedSlot;
    this.#start = methods.start;
    this.#execute = methods.execute;
    this.#settled = methods.settled;
    this.#close = methods.close;
    this.#diagnostics = methods.diagnostics;
  }

  get pinnedGeneration(): number | null {
    return this.#identity?.generation ?? null;
  }

  /** Install the optional raw callback before actor startup. */
  installEventListener(listener: DatabaseExecutorEventListener): boolean {
    let setter: DatabaseExecutor['setEventListener'];
    try {
      setter = this.#executor.setEventListener;
    } catch {
      throw executorStartFailure('Database executor event boundary is invalid.');
    }
    if (setter === undefined) return false;
    if (typeof setter !== 'function') {
      throw executorStartFailure('Database executor event boundary is invalid.');
    }
    try {
      setter.call(this.#executor, listener);
    } catch {
      throw executorStartFailure('Database executor event boundary failed.');
    }
    return true;
  }

  /** Validate and permanently pin the first slot/generation claim. */
  pinIdentity(previousGeneration: number): DatabaseExecutorDiagnostics {
    const diagnostics = readExecutorDiagnostics(
      () => this.#diagnostics.call(this.#executor),
      'startup',
    );
    if (diagnostics.slot !== this.#assignedSlot
      || diagnostics.generation <= previousGeneration) {
      throw executorStartFailure(
        'Database executor identity was stale or did not match its assigned slot.',
      );
    }
    this.#identity = Object.freeze({
      slot: diagnostics.slot,
      generation: diagnostics.generation,
    });
    return diagnostics;
  }

  start(): Promise<void> {
    return this.#start.call(this.#executor);
  }

  execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result> {
    return this.#execute.call(
      this.#executor,
      request,
      options,
    ) as Promise<Result>;
  }

  settled(): Promise<void> {
    return this.#settled.call(this.#executor);
  }

  close(): Promise<void> {
    return this.#close.call(this.#executor);
  }

  diagnostics(): DatabaseExecutorDiagnostics {
    const phase = this.#identity ? 'runtime' : 'startup';
    const diagnostics = readExecutorDiagnostics(
      () => this.#diagnostics.call(this.#executor),
      phase,
    );
    const identity = this.#identity;
    if (identity
      && (diagnostics.slot !== identity.slot
        || diagnostics.generation !== identity.generation)) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor identity changed after assignment.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    return diagnostics;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/** Return a complete executor only after its required surface is callable. */
export function bindDatabaseCoordinatorExecutor(
  value: unknown,
  assignedSlot: number,
): DatabaseCoordinatorBoundExecutor {
  let executor: DatabaseExecutor;
  let methods: CapturedDatabaseExecutorMethods;
  try {
    const candidate = value as Partial<DatabaseExecutor> | null;
    const start = candidate?.start;
    const execute = candidate?.execute;
    const close = candidate?.close;
    const settled = candidate?.settled;
    const diagnostics = candidate?.diagnostics;
    if (!candidate
      || typeof start !== 'function'
      || typeof execute !== 'function'
      || typeof close !== 'function'
      || typeof settled !== 'function'
      || typeof diagnostics !== 'function') {
      throw executorStartFailure(
        'Database executor factory returned an invalid executor.',
      );
    }
    executor = candidate as DatabaseExecutor;
    methods = Object.freeze({
      start,
      execute,
      close,
      settled,
      diagnostics,
    }) as CapturedDatabaseExecutorMethods;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw executorStartFailure(
      'Database executor factory returned an invalid executor.',
    );
  }
  return new DatabaseCoordinatorBoundExecutor(executor, assignedSlot, methods);
}

function readExecutorDiagnostics(
  read: () => unknown,
  phase: 'startup' | 'runtime',
): DatabaseExecutorDiagnostics {
  let value: unknown;
  try {
    value = read();
  } catch {
    throw diagnosticsFailure(phase);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosticsFailure(phase);
  }
  const diagnostics = value as Record<string, unknown>;
  let state: unknown;
  let slot: unknown;
  let generation: unknown;
  let inFlight: unknown;
  let maxInFlight: unknown;
  let disconnectObserved: unknown;
  let exitObserved: unknown;
  let settled: unknown;
  let exitCode: unknown;
  let signalCode: unknown;
  let lastFailureCode: unknown;
  try {
    state = diagnostics.state;
    slot = diagnostics.slot;
    generation = diagnostics.generation;
    inFlight = diagnostics.inFlight;
    maxInFlight = diagnostics.maxInFlight;
    disconnectObserved = diagnostics.disconnectObserved;
    exitObserved = diagnostics.exitObserved;
    settled = diagnostics.settled;
    exitCode = diagnostics.exitCode;
    signalCode = diagnostics.signalCode;
    lastFailureCode = diagnostics.lastFailureCode;
  } catch {
    throw diagnosticsFailure(phase);
  }
  if (!EXECUTOR_STATES.has(state as DatabaseExecutorDiagnostics['state'])
    || !isNonNegativeSafeInteger(slot)
    || !isPositiveSafeInteger(generation)
    || !isNonNegativeSafeInteger(inFlight)
    || !isPositiveSafeInteger(maxInFlight)
    || inFlight > maxInFlight
    || typeof disconnectObserved !== 'boolean'
    || typeof exitObserved !== 'boolean'
    || typeof settled !== 'boolean'
    || !isNullableSafeInteger(exitCode)
    || !isSignalCode(signalCode)
    || (lastFailureCode !== null
      && !isDatabaseErrorCode(lastFailureCode))) {
    throw diagnosticsFailure(phase);
  }
  return Object.freeze({
    state: state as DatabaseExecutorDiagnostics['state'],
    slot,
    generation,
    inFlight,
    maxInFlight,
    disconnectObserved,
    exitObserved,
    settled,
    exitCode,
    signalCode,
    lastFailureCode: lastFailureCode as
      DatabaseExecutorDiagnostics['lastFailureCode'],
  });
}

interface CapturedDatabaseExecutorMethods {
  readonly start: DatabaseExecutor['start'];
  readonly execute: DatabaseExecutor['execute'];
  readonly settled: DatabaseExecutor['settled'];
  readonly close: DatabaseExecutor['close'];
  readonly diagnostics: DatabaseExecutor['diagnostics'];
}

function diagnosticsFailure(
  phase: 'startup' | 'runtime',
): DatabaseError {
  return phase === 'startup'
    ? executorStartFailure('Database executor diagnostics are invalid.')
    : new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor diagnostics are invalid.',
        { retryable: false, outcome: 'unknown' },
      );
}

function executorStartFailure(message: string): DatabaseError {
  return new DatabaseError(
    'DATABASE_EXECUTOR_START_FAILED',
    message,
    { retryable: false, outcome: 'not-started' },
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function isSignalCode(value: unknown): value is string | number | null {
  return value === null
    || typeof value === 'string'
    || Number.isSafeInteger(value);
}
