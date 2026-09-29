/**
 * subprocess-database-server.ts
 *
 * Strict child-side counterpart to SubprocessDatabaseExecutor. It owns only
 * IPC framing and lifecycle; database opening, routing, and operation dispatch
 * remain the responsibility of the supplied handler and close hook.
 */

import {
  DatabaseError,
  serializeDatabaseError,
  type SerializedDatabaseError,
} from './database-error';
import type {
  DatabaseExecutorOperationKind,
  DatabaseExecutorValue,
} from './database-executor';
import {
  hasExactDatabaseExecutorKeys,
  isDatabaseExecutorOperationName,
  isDatabaseExecutorRole,
  isDatabaseExecutorValue,
  readDatabaseExecutorDataRecord,
} from './database-executor-validation';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  type DatabaseExecutorFailureMessage,
  type DatabaseExecutorHandshakeMessage,
  type DatabaseExecutorReadyMessage,
  type DatabaseExecutorShutdownAckMessage,
  type DatabaseExecutorSuccessMessage,
  type DatabaseExecutorTelemetryMessage,
  type SubprocessDatabaseExecutorEvent,
} from './subprocess-database-executor';

const DEFAULT_MAX_IN_FLIGHT = 64;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const IDENTITY_KEYS = [
  'protocol',
  'version',
  'type',
  'nonce',
  'role',
  'slot',
  'generation',
] as const;
const HANDSHAKE_KEYS = new Set(IDENTITY_KEYS);
const SHUTDOWN_KEYS = new Set(IDENTITY_KEYS);
const REQUEST_KEYS = new Set([
  ...IDENTITY_KEYS,
  'requestId',
  'operation',
  'operationKind',
  'payload',
]);

type ServerSession = Omit<DatabaseExecutorHandshakeMessage, 'type'>;

export type SubprocessDatabaseServerState =
  | 'created'
  | 'handshaking'
  | 'ready'
  | 'draining'
  | 'closing'
  | 'failed'
  | 'closed';

/** Application request delivered only after strict wire validation. */
export interface DatabaseExecutorServerRequest<
  Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
> {
  readonly operation: string;
  readonly kind: DatabaseExecutorOperationKind;
  readonly payload: Payload;
}

export type DatabaseExecutorServerHandler = (
  request: DatabaseExecutorServerRequest,
) => DatabaseExecutorValue | Promise<DatabaseExecutorValue>;

/** Minimal IPC surface used by the server and injectable in focused tests. */
export interface SubprocessDatabaseServerTransport {
  send(message: SubprocessDatabaseExecutorEvent): void;
  disconnect(): void;
  onMessage(listener: (message: unknown) => void): void;
  offMessage(listener: (message: unknown) => void): void;
  onDisconnect(listener: () => void): void;
  offDisconnect(listener: () => void): void;
}

export interface SubprocessDatabaseServerOptions {
  /** Expected non-secret actor role supplied independently of the handshake. */
  readonly role: string;
  /** Expected pool slot supplied independently of the handshake. */
  readonly slot: number;
  readonly maxInFlight?: number;
  readonly handle: DatabaseExecutorServerHandler;
  readonly close?: () => void | Promise<void>;
  /** Test/embedding seam. Production actors omit this to use process IPC. */
  readonly transport?: SubprocessDatabaseServerTransport;
}

export interface SubprocessDatabaseServerDiagnostics {
  readonly state: SubprocessDatabaseServerState;
  readonly inFlight: number;
  readonly maxInFlight: number;
  readonly handshakeAccepted: boolean;
  readonly closeHookInvoked: boolean;
  readonly shutdownAckSent: boolean;
  readonly disconnectObserved: boolean;
  readonly lastFailureCode: DatabaseError['code'] | null;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: DatabaseError) => void;
}

/** Reusable, fail-closed server for one Bun subprocess IPC session. */
export class SubprocessDatabaseServer implements AsyncDisposable {
  private readonly role: string;
  private readonly slot: number;
  private readonly maxInFlight: number;
  private readonly handle: DatabaseExecutorServerHandler;
  private readonly closeHook: () => void | Promise<void>;
  private readonly transport: SubprocessDatabaseServerTransport;
  private readonly readyDeferred = createDeferred<void>();
  private readonly finishedDeferred = createDeferred<void>();
  private readonly active = new Set<Promise<void>>();
  private state: SubprocessDatabaseServerState = 'created';
  private session: ServerSession | null = null;
  private cleanupTask: Promise<void> | null = null;
  private drainDeferred: Deferred<void> | null = null;
  private listenersAttached = false;
  private lastRequestId = 0;
  private closeHookInvoked = false;
  private shutdownAckRequested = false;
  private shutdownAckSent = false;
  private hotDurabilityFailureSent = false;
  private disconnectInitiated = false;
  private disconnectObserved = false;
  private lastFailure: DatabaseError | null = null;

  private readonly messageListener = (message: unknown): void => {
    try {
      this.acceptMessage(message);
    } catch {
      this.failClosed(this.protocolError());
    }
  };

  private readonly disconnectListener = (): void => {
    this.disconnectObserved = true;
    if (this.disconnectInitiated || this.state === 'closed') return;
    this.failClosed(new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor parent disconnected.',
      { retryable: false, outcome: 'unknown' },
    ));
  };

  constructor(options: SubprocessDatabaseServerOptions) {
    if (!isDatabaseExecutorRole(options.role)) {
      throw new TypeError('role must be a bounded executor identifier.');
    }
    if (!Number.isSafeInteger(options.slot) || options.slot < 0) {
      throw new TypeError('slot must be a non-negative safe integer.');
    }
    const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight <= 0) {
      throw new TypeError('maxInFlight must be a positive safe integer.');
    }
    if (typeof options.handle !== 'function') {
      throw new TypeError('handle must be a function.');
    }
    if (options.close !== undefined && typeof options.close !== 'function') {
      throw new TypeError('close must be a function when provided.');
    }

    this.role = options.role;
    this.slot = options.slot;
    this.maxInFlight = maxInFlight;
    this.handle = options.handle;
    this.closeHook = options.close ?? (() => undefined);
    this.transport = options.transport ?? createProcessTransport();

    // A caller may choose not to await one of these lifecycle promises. Keep
    // fatal cleanup from becoming a process-global unhandled rejection while
    // preserving the original rejecting promises for explicit awaiters.
    void this.readyDeferred.promise.catch(() => undefined);
    void this.finishedDeferred.promise.catch(() => undefined);
  }

  /** Attach IPC listeners and resolve after the one accepted handshake. */
  start(): Promise<void> {
    if (this.state === 'created') {
      this.state = 'handshaking';
      this.listenersAttached = true;
      try {
        this.transport.onMessage(this.messageListener);
        this.transport.onDisconnect(this.disconnectListener);
      } catch {
        this.failClosed(new DatabaseError(
          'DATABASE_EXECUTOR_START_FAILED',
          'Database executor server could not attach IPC.',
          { retryable: false, outcome: 'not-started' },
        ));
      }
    } else if (this.state === 'closed') {
      return Promise.reject(this.closedError());
    } else if (this.state === 'failed') {
      return Promise.reject(this.lastFailure ?? this.protocolError());
    }
    return this.readyDeferred.promise;
  }

  /** Resolve on graceful shutdown and reject after fail-closed cleanup. */
  finished(): Promise<void> {
    return this.finishedDeferred.promise;
  }

  /** Start, handshake, and remain alive until the IPC session terminates. */
  async run(): Promise<void> {
    await this.start();
    await this.finished();
  }

  /** Locally stop admission and clean up without emitting a shutdown ack. */
  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    if (this.state === 'failed') return this.finishedDeferred.promise;
    if (this.state === 'created' || this.state === 'handshaking') {
      this.readyDeferred.reject(this.closedError());
    }
    if (this.state !== 'draining' && this.state !== 'closing') {
      this.state = 'draining';
    }
    this.requestCleanup(false);
    return this.finishedDeferred.promise;
  }

  diagnostics(): SubprocessDatabaseServerDiagnostics {
    return Object.freeze({
      state: this.state,
      inFlight: this.active.size,
      maxInFlight: this.maxInFlight,
      handshakeAccepted: this.session !== null,
      closeHookInvoked: this.closeHookInvoked,
      shutdownAckSent: this.shutdownAckSent,
      disconnectObserved: this.disconnectObserved,
      lastFailureCode: this.lastFailure?.code ?? null,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Relay the one closed actor-fatal signal to the owning parent generation. */
  reportHotPeriodicDurabilityFailure(): void {
    if (this.hotDurabilityFailureSent
      || (this.state !== 'ready'
        && this.state !== 'draining'
        && this.state !== 'closing')) return;
    this.hotDurabilityFailureSent = true;
    this.reportHotPeriodicSignal('hot-periodic-durability-failed');
  }

  /** Arm the parent-side watchdog before periodic image serialization. */
  reportHotPeriodicSnapshotStarted(): void {
    if (this.state !== 'ready' && this.state !== 'draining') return;
    this.reportHotPeriodicSignal('hot-periodic-snapshot-started');
  }

  /** Disarm the parent-side watchdog after durable publication. */
  reportHotPeriodicSnapshotFinished(): void {
    if (this.state !== 'ready'
      && this.state !== 'draining'
      && this.state !== 'closing') return;
    this.reportHotPeriodicSignal('hot-periodic-snapshot-finished');
  }

  /** Start the maximum acknowledged-write loss window before its response. */
  reportHotPeriodicDurabilityDirty(): void {
    if (this.state !== 'ready' && this.state !== 'draining') return;
    this.reportHotPeriodicSignal('hot-periodic-durability-dirty');
  }

  /** Close the acknowledged-write loss window after covering publication. */
  reportHotPeriodicDurabilityClean(): void {
    if (this.state !== 'ready'
      && this.state !== 'draining'
      && this.state !== 'closing') return;
    this.reportHotPeriodicSignal('hot-periodic-durability-clean');
  }

  private reportHotPeriodicSignal(
    signal: DatabaseExecutorTelemetryMessage['signal'],
  ): void {
    const session = this.session;
    if (!session || !this.send({
      ...session,
      type: 'telemetry',
      signal,
    } satisfies DatabaseExecutorTelemetryMessage)) {
      this.failClosed(this.transportError());
    }
  }

  private acceptMessage(message: unknown): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    const record = readDatabaseExecutorDataRecord(message);
    if (!record) {
      this.failClosed(this.protocolError());
      return;
    }

    if (this.state === 'handshaking') {
      this.acceptHandshake(record);
      return;
    }
    if (this.state !== 'ready' || !this.hasExpectedSession(record)) {
      this.failClosed(this.protocolError());
      return;
    }

    if (record.type === 'request') {
      this.acceptRequest(record);
      return;
    }
    if (record.type === 'shutdown'
      && hasExactDatabaseExecutorKeys(record, SHUTDOWN_KEYS)) {
      this.state = 'draining';
      this.requestCleanup(true);
      return;
    }
    this.failClosed(this.protocolError());
  }

  private acceptHandshake(record: Record<string, unknown>): void {
    if (!hasExactDatabaseExecutorKeys(record, HANDSHAKE_KEYS)
      || record.protocol !== DATABASE_EXECUTOR_PROTOCOL_KIND
      || record.version !== DATABASE_EXECUTOR_PROTOCOL_VERSION
      || record.type !== 'handshake'
      || typeof record.nonce !== 'string'
      || !NONCE_PATTERN.test(record.nonce)
      || record.role !== this.role
      || record.slot !== this.slot
      || !Number.isSafeInteger(record.generation)
      || (record.generation as number) <= 0) {
      this.failClosed(this.protocolError());
      return;
    }

    const session: ServerSession = Object.freeze({
      protocol: DATABASE_EXECUTOR_PROTOCOL_KIND,
      version: DATABASE_EXECUTOR_PROTOCOL_VERSION,
      nonce: record.nonce,
      role: this.role,
      slot: this.slot,
      generation: record.generation as number,
    });
    this.session = session;
    if (!this.send({ ...session, type: 'ready' } satisfies DatabaseExecutorReadyMessage)) {
      this.failClosed(new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor server could not confirm startup.',
        { retryable: false, outcome: 'not-started' },
      ));
      return;
    }
    this.state = 'ready';
    this.readyDeferred.resolve(undefined);
  }

  private acceptRequest(record: Record<string, unknown>): void {
    const nextRequestId = this.lastRequestId + 1;
    if (!hasExactDatabaseExecutorKeys(record, REQUEST_KEYS)
      || !Number.isSafeInteger(record.requestId)
      || record.requestId !== nextRequestId
      || !Number.isSafeInteger(nextRequestId)
      || !isDatabaseExecutorOperationName(record.operation)
      || (record.operationKind !== 'read' && record.operationKind !== 'write')
      || !isDatabaseExecutorValue(record.payload)) {
      this.failClosed(this.protocolError());
      return;
    }
    this.lastRequestId = nextRequestId;

    if (this.active.size >= this.maxInFlight) {
      const error = new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database executor server capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            generation: this.session?.generation ?? 0,
            maxInFlight: this.maxInFlight,
            slot: this.slot,
          },
        },
      );
      if (!this.sendFailure(nextRequestId, error)) {
        this.failClosed(this.transportError());
      }
      return;
    }

    const request: DatabaseExecutorServerRequest = Object.freeze({
      operation: record.operation,
      kind: record.operationKind,
      payload: record.payload,
    });
    const task = this.executeRequest(nextRequestId, request);
    this.active.add(task);
    const finish = (): void => {
      this.active.delete(task);
      if (this.active.size === 0) this.drainDeferred?.resolve(undefined);
    };
    void task.then(finish, () => {
      this.failClosed(this.transportError());
      finish();
    });
  }

  private async executeRequest(
    requestId: number,
    request: DatabaseExecutorServerRequest,
  ): Promise<void> {
    let value: DatabaseExecutorValue;
    try {
      value = await this.handle(request);
    } catch (error) {
      if (this.canSendResponses() && !this.sendFailure(requestId, error)) {
        this.failClosed(this.transportError());
      }
      return;
    }

    if (!this.canSendResponses()) return;
    if (!isDatabaseExecutorValue(value)) {
      const error = new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor handler returned an invalid result.',
        { retryable: false, outcome: 'unknown' },
      );
      if (!this.sendFailure(requestId, error)) {
        this.failClosed(this.transportError());
      }
      return;
    }

    const session = this.session;
    if (!session || !this.send({
      ...session,
      type: 'response',
      requestId,
      ok: true,
      value,
    } satisfies DatabaseExecutorSuccessMessage)) {
      this.failClosed(this.transportError());
    }
  }

  private sendFailure(requestId: number, error: unknown): boolean {
    const session = this.session;
    if (!session) return false;
    let envelope: SerializedDatabaseError;
    try {
      envelope = serializeDatabaseError(error);
    } catch {
      envelope = serializeDatabaseError(new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database executor handler failed.',
        { retryable: false, outcome: 'unknown' },
      ));
    }
    return this.send({
      ...session,
      type: 'response',
      requestId,
      ok: false,
      error: envelope,
    } satisfies DatabaseExecutorFailureMessage);
  }

  private canSendResponses(): boolean {
    return this.lastFailure === null
      && (this.state === 'ready' || this.state === 'draining');
  }

  private requestCleanup(sendShutdownAck: boolean): void {
    this.shutdownAckRequested ||= sendShutdownAck;
    this.cleanupTask ??= this.cleanup();
    void this.cleanupTask;
  }

  private async cleanup(): Promise<void> {
    await this.waitForDrain();
    this.state = this.lastFailure ? 'failed' : 'closing';

    if (!this.closeHookInvoked) {
      this.closeHookInvoked = true;
      try {
        await this.closeHook();
      } catch {
        this.recordFailure(new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database executor close hook failed.',
          { retryable: false, outcome: 'unknown' },
        ));
      }
    }

    const session = this.session;
    if (!this.lastFailure && this.shutdownAckRequested && session) {
      if (this.send({
        ...session,
        type: 'shutdown-ack',
      } satisfies DatabaseExecutorShutdownAckMessage)) {
        this.shutdownAckSent = true;
      } else {
        this.recordFailure(this.transportError());
      }
    }

    this.detachListeners();
    if (!this.disconnectObserved) {
      this.disconnectInitiated = true;
      try {
        this.transport.disconnect();
      } catch {
        this.recordFailure(this.transportError());
      }
    }

    if (this.lastFailure) {
      this.state = 'failed';
      this.readyDeferred.reject(this.lastFailure);
      this.finishedDeferred.reject(this.lastFailure);
    } else {
      this.state = 'closed';
      this.finishedDeferred.resolve(undefined);
    }
  }

  private waitForDrain(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    this.drainDeferred ??= createDeferred<void>();
    return this.drainDeferred.promise;
  }

  private failClosed(error: DatabaseError): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    this.recordFailure(error);
    this.state = 'failed';
    this.readyDeferred.reject(error);
    this.requestCleanup(false);
  }

  private recordFailure(error: DatabaseError): void {
    this.lastFailure ??= error;
  }

  private send(message: SubprocessDatabaseExecutorEvent): boolean {
    try {
      this.transport.send(message);
      return true;
    } catch {
      return false;
    }
  }

  private hasExpectedSession(record: Record<string, unknown>): boolean {
    const session = this.session;
    return session !== null
      && record.protocol === session.protocol
      && record.version === session.version
      && record.nonce === session.nonce
      && record.role === session.role
      && record.slot === session.slot
      && record.generation === session.generation;
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    try {
      this.transport.offMessage(this.messageListener);
    } catch {
      // Cleanup remains fail closed even when a custom adapter misbehaves.
    }
    try {
      this.transport.offDisconnect(this.disconnectListener);
    } catch {
      // Cleanup remains fail closed even when a custom adapter misbehaves.
    }
  }

  private protocolError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Invalid database executor command.',
      { retryable: false, outcome: 'unknown' },
    );
  }

  private transportError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor server transport failed.',
      { retryable: false, outcome: 'unknown' },
    );
  }

  private closedError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_CLOSED',
      'Database executor server is closed.',
      { retryable: false, outcome: 'not-started' },
    );
  }
}

function createProcessTransport(): SubprocessDatabaseServerTransport {
  if (typeof process.send !== 'function') {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_START_FAILED',
      'Database executor server requires a Bun IPC channel.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  return {
    send(message) {
      if (typeof process.send !== 'function') throw new Error('IPC unavailable.');
      process.send(message);
    },
    disconnect() {
      if (process.connected && typeof process.disconnect === 'function') {
        process.disconnect();
      }
    },
    onMessage(listener) {
      process.on('message', listener);
    },
    offMessage(listener) {
      process.off('message', listener);
    },
    onDisconnect(listener) {
      process.on('disconnect', listener);
    },
    offDisconnect(listener) {
      process.off('disconnect', listener);
    },
  };
}

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: DatabaseError) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}
