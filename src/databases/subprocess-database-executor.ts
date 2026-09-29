/**
 * subprocess-database-executor.ts
 *
 * Owns a single Bun subprocess and a strict request/response IPC channel. The
 * transport deliberately knows nothing about SQLite, database paths, SQL, or
 * coordinator routing.
 */

import { randomUUID } from 'node:crypto';

import {
  DatabaseError,
  deserializeDatabaseError,
  isSerializedDatabaseError,
} from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEvent,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorOperationKind,
  DatabaseExecutorRequest,
  DatabaseExecutorState,
  DatabaseExecutorValue,
} from './database-executor';
import {
  hasExactDatabaseExecutorKeys as hasExactKeys,
  isDatabaseExecutorOperationName,
  isDatabaseExecutorValue,
  readDatabaseExecutorDataRecord as ownDataRecord,
} from './database-executor-validation';
import {
  normalizeSubprocessDatabaseExecutorOptions,
  normalizeSubprocessDatabaseExecutorTimeout,
  type NormalizedSubprocessDatabaseExecutorOptions as NormalizedOptions,
  type SubprocessDatabaseExecutorOptions,
} from './subprocess-database-executor-config';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  type DatabaseExecutorHandshakeMessage,
  type DatabaseExecutorOperationMessage,
  type DatabaseExecutorProtocolIdentity as ProtocolIdentity,
  type DatabaseExecutorShutdownMessage,
  type SubprocessDatabaseExecutorCommand,
} from './subprocess-database-protocol';

export {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
} from './subprocess-database-protocol';
export type {
  DatabaseExecutorFailureMessage,
  DatabaseExecutorHandshakeMessage,
  DatabaseExecutorOperationMessage,
  DatabaseExecutorReadyMessage,
  DatabaseExecutorShutdownAckMessage,
  DatabaseExecutorShutdownMessage,
  DatabaseExecutorSuccessMessage,
  DatabaseExecutorTelemetryMessage,
  SubprocessDatabaseExecutorCommand,
  SubprocessDatabaseExecutorEvent,
} from './subprocess-database-protocol';
export type { SubprocessDatabaseExecutorOptions } from './subprocess-database-executor-config';

let nextExecutorGeneration = 1;


interface PendingRequest {
  readonly kind: DatabaseExecutorOperationKind;
  readonly resolve: (value: DatabaseExecutorValue) => void;
  readonly reject: (error: DatabaseError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: DatabaseError) => void;
}

type ExecutorProcess = Bun.Subprocess<'ignore', 'ignore', 'ignore'>;

/** Strict, bounded Bun-to-Bun IPC transport for one database actor process. */
export class SubprocessDatabaseExecutor implements DatabaseExecutor {
  readonly slot: number;
  readonly generation: number;

  private readonly options: NormalizedOptions;
  private readonly nonce = randomUUID();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly settledDeferred = createDeferred<void>();
  private state: DatabaseExecutorState = 'created';
  private child: ExecutorProcess | null = null;
  private startTask: Promise<void> | null = null;
  private closeTask: Promise<void> | null = null;
  private terminationTask: Promise<boolean> | null = null;
  private startDeferred: Deferred<void> | null = null;
  private drainDeferred: Deferred<void> | null = null;
  private shutdownDeferred: Deferred<void> | null = null;
  private nextRequestId = 1;
  private closeRequested = false;
  private shutdownAcknowledged = false;
  private hotPeriodicSnapshotActive = false;
  private hotPeriodicDurabilityDirty = false;
  private disconnectObserved = false;
  private exitObserved = false;
  private settlementObserved = false;
  private exitCode: number | null = null;
  private signalCode: string | number | null = null;
  private lastFailure: DatabaseError | null = null;
  private eventListener: DatabaseExecutorEventListener | null = null;

  constructor(options: SubprocessDatabaseExecutorOptions) {
    this.options = normalizeSubprocessDatabaseExecutorOptions(options);
    this.slot = this.options.slot;
    this.generation = allocateGeneration();
  }

  setEventListener(listener: DatabaseExecutorEventListener): void {
    if (typeof listener !== 'function') {
      throw new TypeError('Database executor event listener must be a function.');
    }
    if (this.state !== 'created' || this.eventListener) {
      throw new TypeError('Database executor event listener must be installed once before startup.');
    }
    this.eventListener = listener;
  }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.closeRequested || this.state === 'closed') {
      return Promise.reject(this.closedError());
    }
    if (this.state === 'failed') {
      return Promise.reject(this.lastFailure ?? this.failedError('startup'));
    }
    if (this.startTask) return this.startTask;
    if (this.state !== 'created') {
      return Promise.reject(this.lastFailure ?? this.failedError('startup'));
    }

    this.state = 'starting';
    this.startTask = this.startOnce();
    return this.startTask;
  }

  async execute<
    Result extends DatabaseExecutorValue = DatabaseExecutorValue,
    Payload extends DatabaseExecutorValue = DatabaseExecutorValue,
  >(
    request: DatabaseExecutorRequest<Payload>,
    options: DatabaseExecutorExecuteOptions = {},
  ): Promise<Result> {
    if (this.closeRequested) throw this.closedError();
    if (this.state !== 'ready') await this.start();
    const lifecycleError = this.executionLifecycleError();
    if (lifecycleError) throw lifecycleError;

    const normalizedRequest = normalizeRequest(request);
    // Request inspection is intentionally side-effect free for ordinary data,
    // but re-check the lifecycle before allocating transport capacity in case
    // an adversarial Proxy triggered a re-entrant close while being rejected.
    const postValidationLifecycleError = this.executionLifecycleError();
    if (postValidationLifecycleError) throw postValidationLifecycleError;
    if (this.pending.size >= this.options.maxInFlight) {
      throw new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database executor capacity is exhausted.',
        {
          details: {
            generation: this.generation,
            maxInFlight: this.options.maxInFlight,
            slot: this.slot,
          },
        },
      );
    }

    const timeoutMs = normalizeSubprocessDatabaseExecutorTimeout(
      options.timeoutMs ?? this.options.operationTimeoutMs,
      'timeoutMs',
    );
    const requestId = this.allocateRequestId();
    const result = new Promise<DatabaseExecutorValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handleOperationTimeout(requestId);
      }, timeoutMs);
      this.pending.set(requestId, {
        kind: normalizedRequest.kind,
        resolve,
        reject,
        timer,
      });
    });

    const message: DatabaseExecutorOperationMessage<Payload> = {
      ...this.identity(),
      type: 'request',
      requestId,
      operation: normalizedRequest.operation,
      operationKind: normalizedRequest.kind,
      payload: normalizedRequest.payload,
    };

    if (!this.sendToChild(message)) {
      const pending = this.takePending(requestId);
      pending?.reject(new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database executor request could not be sent.',
        {
          outcome: 'not-started',
          retryable: false,
          details: {
            generation: this.generation,
            slot: this.slot,
          },
        },
      ));
      this.failTransport('send');
    }

    return await result as Result;
  }

  close(): Promise<void> {
    this.closeRequested = true;
    this.closeTask ??= this.closeOnce();
    return this.closeTask;
  }

  settled(): Promise<void> {
    return this.settledDeferred.promise;
  }

  diagnostics(): DatabaseExecutorDiagnostics {
    return Object.freeze({
      state: this.state,
      slot: this.slot,
      generation: this.generation,
      inFlight: this.pending.size,
      maxInFlight: this.options.maxInFlight,
      disconnectObserved: this.disconnectObserved,
      exitObserved: this.exitObserved,
      settled: this.settlementObserved,
      exitCode: this.exitCode,
      signalCode: this.signalCode,
      lastFailureCode: this.lastFailure?.code ?? null,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async startOnce(): Promise<void> {
    this.startDeferred = createDeferred<void>();
    const startupTimer = setTimeout(() => {
      this.failStart(new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor startup timed out.',
        {
          details: {
            generation: this.generation,
            slot: this.slot,
          },
        },
      ));
    }, this.options.startupTimeoutMs);

    try {
      let child: ExecutorProcess;
      try {
        child = Bun.spawn({
          cmd: this.options.command,
          env: this.options.env,
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
          serialization: 'advanced',
          ipc: (message, subprocess) => {
            this.child ??= subprocess as ExecutorProcess;
            this.handleMessage(message);
          },
          onDisconnect: () => {
            this.handleDisconnect();
          },
          onExit: (subprocess, exitCode, signalCode) => {
            this.child ??= subprocess as ExecutorProcess;
            this.handleExit(exitCode, signalCode);
          },
        });
      } catch {
        const error = new DatabaseError(
          'DATABASE_EXECUTOR_START_FAILED',
          'Database executor could not start.',
          {
            details: {
              generation: this.generation,
              slot: this.slot,
            },
          },
        );
        this.recordFailure(error);
        this.state = 'failed';
        throw error;
      }

      this.child ??= child;
      if (this.state === 'starting') {
        try {
          child.send({
            ...this.identity(),
            type: 'handshake',
          } satisfies DatabaseExecutorHandshakeMessage);
        } catch {
          this.failStart(new DatabaseError(
            'DATABASE_EXECUTOR_START_FAILED',
            'Database executor handshake could not be sent.',
            {
              details: {
                generation: this.generation,
                slot: this.slot,
              },
            },
          ));
        }
      }

      await this.startDeferred.promise;
    } catch (error) {
      const terminated = await this.ensureTerminated();
      if (!terminated && !this.settlementObserved) this.state = 'quarantined';
      throw error;
    } finally {
      clearTimeout(startupTimer);
    }
  }

  private async closeOnce(): Promise<void> {
    if (this.state === 'created') {
      this.observeNoProcessSettlement();
      this.state = 'closed';
      return;
    }

    if (this.state === 'starting') {
      try {
        await this.startTask;
      } catch {
        await this.settleTerminationOrQuarantine();
        this.state = 'closed';
        return;
      }
    }

    if (this.state === 'failed' || this.state === 'quarantined') {
      await this.settleTerminationOrQuarantine();
      this.state = 'closed';
      return;
    }
    if (this.state === 'closed') return;

    this.state = 'draining';
    await this.waitForDrain();
    if (this.hasFailed()) {
      await this.settleTerminationOrQuarantine();
      this.state = 'closed';
      return;
    }

    this.state = 'closing';
    this.shutdownDeferred = createDeferred<void>();
    if (!this.sendToChild({
        ...this.identity(),
        type: 'shutdown',
      } satisfies DatabaseExecutorShutdownMessage)) {
      const error = this.failedError('shutdown-send');
      this.recordFailure(error);
      await this.settleTerminationOrQuarantine();
      this.state = 'closed';
      throw error;
    }

    let closeFailure: DatabaseError | null = null;
    try {
      await promiseWithTimeout(
        this.shutdownDeferred.promise,
        this.options.shutdownAckTimeoutMs,
        () => new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database executor shutdown acknowledgement timed out.',
          {
            details: {
              generation: this.generation,
              phase: 'shutdown-ack',
              slot: this.slot,
            },
          },
        ),
      );
    } catch (error) {
      closeFailure = error instanceof DatabaseError
        ? error
        : this.failedError('shutdown-ack');
      this.recordFailure(closeFailure);
    }

    if (!closeFailure) {
      const exited = await this.waitForExit(this.options.shutdownExitTimeoutMs);
      if (!exited) {
        closeFailure = new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database executor did not exit after shutdown.',
          {
            details: {
              generation: this.generation,
              phase: 'shutdown-exit',
              slot: this.slot,
            },
          },
        );
        this.recordFailure(closeFailure);
      } else if (this.exitCode !== 0 || this.signalCode !== null) {
        closeFailure = new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database executor exited abnormally after shutdown.',
          {
            details: {
              generation: this.generation,
              phase: 'shutdown-exit',
              slot: this.slot,
            },
          },
        );
        this.recordFailure(closeFailure);
      }
    }

    if (closeFailure) await this.settleTerminationOrQuarantine();
    await this.settled();
    this.state = 'closed';
    if (closeFailure) throw closeFailure;
  }

  private handleMessage(message: unknown): void {
    if (this.state === 'failed'
      || this.state === 'quarantined'
      || this.state === 'closed') return;
    const record = ownDataRecord(message);
    if (!record || !this.hasExpectedIdentity(record)) {
      this.failProtocol();
      return;
    }

    switch (record.type) {
      case 'ready':
        if (!hasExactKeys(record, READY_KEYS) || this.state !== 'starting') {
          this.failProtocol();
          return;
        }
        this.state = 'ready';
        this.startDeferred?.resolve(undefined);
        return;
      case 'response':
        this.handleResponse(record);
        return;
      case 'telemetry':
        this.handleTelemetry(record);
        return;
      case 'shutdown-ack':
        if (!hasExactKeys(record, SHUTDOWN_ACK_KEYS)
          || this.state !== 'closing'
          || this.shutdownAcknowledged) {
          this.failProtocol();
          return;
        }
        this.shutdownAcknowledged = true;
        this.shutdownDeferred?.resolve(undefined);
        return;
      default:
        this.failProtocol();
    }
  }

  private handleResponse(record: Record<string, unknown>): void {
    if (this.state !== 'ready' && this.state !== 'draining') {
      this.failProtocol();
      return;
    }
    const requestId = record.requestId;
    if (!Number.isSafeInteger(requestId) || (requestId as number) <= 0) {
      this.failProtocol();
      return;
    }
    const pending = this.pending.get(requestId as number);
    if (!pending) {
      this.failProtocol();
      return;
    }

    if (record.ok === true) {
      if (!hasExactKeys(record, SUCCESS_KEYS)
        || !isDatabaseExecutorValue(record.value)) {
        this.failProtocol();
        return;
      }
      this.takePending(requestId as number)?.resolve(
        record.value as DatabaseExecutorValue,
      );
      return;
    }

    if (record.ok === false
      && hasExactKeys(record, FAILURE_KEYS)
      && isSerializedDatabaseError(record.error)) {
      this.takePending(requestId as number)?.reject(
        deserializeDatabaseError(record.error),
      );
      return;
    }
    this.failProtocol();
  }

  private handleTelemetry(record: Record<string, unknown>): void {
    if (!hasExactKeys(record, TELEMETRY_KEYS)) {
      this.failProtocol();
      return;
    }

    if (record.signal === 'hot-periodic-snapshot-started') {
      if ((this.state !== 'ready' && this.state !== 'draining')
        || this.hotPeriodicSnapshotActive) {
        this.failProtocol();
        return;
      }
      this.hotPeriodicSnapshotActive = true;
      this.emitEvent('hot-periodic-snapshot-started');
      return;
    }

    if (record.signal === 'hot-periodic-snapshot-finished') {
      if ((this.state !== 'ready'
          && this.state !== 'draining'
          && this.state !== 'closing')
        || !this.hotPeriodicSnapshotActive) {
        this.failProtocol();
        return;
      }
      this.hotPeriodicSnapshotActive = false;
      this.emitEvent('hot-periodic-snapshot-finished');
      return;
    }

    if (record.signal === 'hot-periodic-durability-dirty') {
      if ((this.state !== 'ready' && this.state !== 'draining')
        || this.hotPeriodicDurabilityDirty) {
        this.failProtocol();
        return;
      }
      this.hotPeriodicDurabilityDirty = true;
      this.emitEvent('hot-periodic-durability-dirty');
      return;
    }

    if (record.signal === 'hot-periodic-durability-clean') {
      if ((this.state !== 'ready'
          && this.state !== 'draining'
          && this.state !== 'closing')
        || !this.hotPeriodicDurabilityDirty) {
        this.failProtocol();
        return;
      }
      this.hotPeriodicDurabilityDirty = false;
      this.emitEvent('hot-periodic-durability-clean');
      return;
    }

    if (record.signal !== 'hot-periodic-durability-failed'
      || (this.state !== 'ready'
        && this.state !== 'draining'
        && this.state !== 'closing')) {
      this.failProtocol();
      return;
    }
    this.hotPeriodicSnapshotActive = false;
    this.hotPeriodicDurabilityDirty = false;

    const error = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor hot durability failed.',
      { retryable: false, outcome: 'unknown' },
    );
    this.recordFailure(error);
    this.state = 'failed';
    this.emitEvent('hot-periodic-durability-failed');
    this.startDeferred?.reject(error);
    this.shutdownDeferred?.reject(error);
    this.rejectPendingForTransportFailure('hot-periodic-durability');
    this.beginTermination();
  }

  private emitEvent(type: DatabaseExecutorEvent['type']): void {
    try {
      this.eventListener?.(Object.freeze({ type }));
    } catch {
      // Lifecycle listeners cannot alter the transport control path.
    }
  }

  private handleDisconnect(): void {
    this.disconnectObserved = true;
    if ((this.state === 'closing' && this.shutdownAcknowledged)
      || this.state === 'failed'
      || this.state === 'quarantined'
      || this.state === 'closed') {
      return;
    }
    if (this.state === 'starting') {
      this.failStart(new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor disconnected during startup.',
        {
          details: {
            generation: this.generation,
            slot: this.slot,
          },
        },
      ));
      return;
    }
    this.failTransport('disconnect');
  }

  private handleExit(
    exitCode: number | null,
    signalCode: string | number | null,
  ): void {
    this.exitObserved = true;
    this.exitCode = exitCode;
    this.signalCode = signalCode;
    this.observeProcessSettlement();
    if ((this.state === 'closing' && this.shutdownAcknowledged)
      || this.state === 'failed'
      || this.state === 'quarantined'
      || this.state === 'closed') {
      return;
    }
    if (this.state === 'starting') {
      this.failStart(new DatabaseError(
        'DATABASE_EXECUTOR_START_FAILED',
        'Database executor exited during startup.',
        {
          details: {
            generation: this.generation,
            slot: this.slot,
          },
        },
      ));
      return;
    }
    this.failTransport('exit');
  }

  private handleOperationTimeout(requestId: number): void {
    const pending = this.takePending(requestId);
    if (!pending) return;
    const error = new DatabaseError(
      'DATABASE_OPERATION_TIMEOUT',
      'Database executor operation timed out.',
      {
        outcome: pending.kind === 'write' ? 'unknown' : null,
        retryable: false,
        details: {
          generation: this.generation,
          slot: this.slot,
        },
      },
    );
    pending.reject(error);
    this.recordFailure(error);
    this.state = 'failed';
    this.rejectPendingForTransportFailure('operation-timeout');
    this.startDeferred?.reject(error);
    this.shutdownDeferred?.reject(error);
    this.beginTermination();
  }

  private failStart(error: DatabaseError): void {
    if (this.state !== 'starting') return;
    this.recordFailure(error);
    this.state = 'failed';
    this.startDeferred?.reject(error);
    this.beginTermination();
  }

  private failProtocol(): void {
    const error = new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Invalid database executor response.',
      {
        details: {
          generation: this.generation,
          slot: this.slot,
        },
      },
    );
    this.recordFailure(error);
    this.state = 'failed';
    this.startDeferred?.reject(error);
    this.shutdownDeferred?.reject(error);
    this.rejectAllPending(error);
    this.beginTermination();
  }

  private failTransport(phase: string): void {
    if (this.state === 'failed'
      || this.state === 'quarantined'
      || this.state === 'closed') return;
    const error = this.failedError(phase);
    this.recordFailure(error);
    this.state = 'failed';
    this.startDeferred?.reject(error);
    this.shutdownDeferred?.reject(error);
    this.rejectPendingForTransportFailure(phase);
    this.beginTermination();
  }

  private rejectPendingForTransportFailure(phase: string): void {
    for (const [requestId, pending] of [...this.pending]) {
      this.takePending(requestId)?.reject(new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database executor failed while an operation was in flight.',
        {
          outcome: pending.kind === 'write' ? 'unknown' : null,
          retryable: false,
          details: {
            generation: this.generation,
            phase,
            slot: this.slot,
          },
        },
      ));
    }
  }

  private rejectAllPending(error: DatabaseError): void {
    for (const requestId of [...this.pending.keys()]) {
      this.takePending(requestId)?.reject(error);
    }
  }

  private takePending(requestId: number): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (this.pending.size === 0) this.drainDeferred?.resolve(undefined);
    return pending;
  }

  private waitForDrain(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    this.drainDeferred ??= createDeferred<void>();
    return this.drainDeferred.promise;
  }

  private sendToChild(message: SubprocessDatabaseExecutorCommand): boolean {
    const child = this.child;
    if (!child) return false;
    try {
      child.send(message);
      return true;
    } catch {
      return false;
    }
  }

  private beginTermination(): void {
    void this.ensureTerminated().then((terminated) => {
      if (!terminated
        && !this.settlementObserved
        && this.state !== 'closed') {
        this.state = 'quarantined';
      }
    }, () => {
      if (!this.settlementObserved && this.state !== 'closed') {
        this.state = 'quarantined';
      }
    });
  }

  private async settleTerminationOrQuarantine(): Promise<void> {
    if (this.settlementObserved) return;
    const terminated = await this.ensureTerminated();
    if (!terminated && !this.settlementObserved) {
      this.state = 'quarantined';
      throw this.settlementError();
    }
    await this.settled();
  }

  private async ensureTerminated(): Promise<boolean> {
    const existing = this.terminationTask;
    if (existing) return await existing;

    const task = this.terminateWithEscalation();
    this.terminationTask = task;
    const terminated = await task;
    // A timed-out attempt is not settlement and must not be cached as one.
    // Keep successful completion stable, but permit an explicit later retry.
    if (!terminated && this.terminationTask === task) {
      this.terminationTask = null;
    }
    return terminated;
  }

  protected async terminateWithEscalation(): Promise<boolean> {
    const child = this.child;
    if (!child) {
      this.observeNoProcessSettlement();
      return true;
    }
    if (this.exitObserved || child.exitCode !== null) {
      this.captureSettledProcess(child);
      return true;
    }

    try {
      child.kill('SIGTERM');
    } catch {
      // The process may have exited between the state check and signal send.
    }
    if (await this.waitForExit(this.options.sigtermTimeoutMs)) return true;

    try {
      child.kill('SIGKILL');
    } catch {
      // The process may have exited between deadline escalation and signal send.
    }
    return await this.waitForExit(this.options.sigkillTimeoutMs);
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const child = this.child;
    if (!child) {
      this.observeNoProcessSettlement();
      return true;
    }
    if (this.exitObserved || child.exitCode !== null) {
      this.captureSettledProcess(child);
      return true;
    }
    const exited = await settlesWithin(child.exited, timeoutMs);
    if (exited) {
      // `exited` and `onExit` are independent notifications. In Bun, the
      // promise can settle just before the callback, so capture the observable
      // process state here without depending on callback ordering.
      this.captureSettledProcess(child);
    }
    return exited;
  }

  private captureSettledProcess(child: ExecutorProcess): void {
    this.exitObserved = true;
    this.exitCode = child.exitCode;
    this.signalCode = child.signalCode;
    this.observeProcessSettlement();
  }

  private observeNoProcessSettlement(): void {
    if (this.child) return;
    this.observeProcessSettlement();
  }

  private observeProcessSettlement(): void {
    if (this.settlementObserved) return;
    this.settlementObserved = true;
    this.settledDeferred.resolve(undefined);
    if (this.state === 'quarantined') {
      this.state = this.closeRequested ? 'closed' : 'failed';
    }
  }

  private hasExpectedIdentity(record: Record<string, unknown>): boolean {
    return record.protocol === DATABASE_EXECUTOR_PROTOCOL_KIND
      && record.version === DATABASE_EXECUTOR_PROTOCOL_VERSION
      && record.nonce === this.nonce
      && record.role === this.options.role
      && record.slot === this.slot
      && record.generation === this.generation;
  }

  private identity(): ProtocolIdentity {
    return {
      protocol: DATABASE_EXECUTOR_PROTOCOL_KIND,
      version: DATABASE_EXECUTOR_PROTOCOL_VERSION,
      nonce: this.nonce,
      role: this.options.role,
      slot: this.slot,
      generation: this.generation,
    };
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId;
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database executor request identifier space is exhausted.',
      );
    }
    this.nextRequestId += 1;
    return requestId;
  }

  private recordFailure(error: DatabaseError): void {
    this.lastFailure ??= error;
  }

  private hasFailed(): boolean {
    return this.state === 'failed' || this.state === 'quarantined';
  }

  private failedError(phase: string): DatabaseError {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor failed.',
      {
        details: {
          generation: this.generation,
          phase,
          slot: this.slot,
        },
      },
    );
  }

  private settlementError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database executor termination is not settled.',
      {
        retryable: false,
        outcome: 'unknown',
        details: {
          generation: this.generation,
          phase: 'termination-settlement',
          slot: this.slot,
        },
      },
    );
  }

  private executionLifecycleError(): DatabaseError | null {
    if (!this.closeRequested && this.state === 'ready') return null;
    return this.state === 'failed' || this.state === 'quarantined'
      ? (this.lastFailure ?? this.failedError('execution'))
      : this.closedError();
  }

  private closedError(): DatabaseError {
    return new DatabaseError(
      'DATABASE_CLOSED',
      'Database executor is closed.',
      {
        details: {
          generation: this.generation,
          slot: this.slot,
        },
      },
    );
  }
}

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

function normalizeRequest<Payload extends DatabaseExecutorValue>(
  request: DatabaseExecutorRequest<Payload>,
): DatabaseExecutorRequest<Payload> {
  const record = ownDataRecord(request);
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

function allocateGeneration(): number {
  const generation = nextExecutorGeneration;
  nextExecutorGeneration += 1;
  if (!Number.isSafeInteger(nextExecutorGeneration)) nextExecutorGeneration = 1;
  return generation;
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

async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => DatabaseError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(createError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
