/**
 * subprocess-database-executor.ts
 *
 * Owns a single Bun subprocess and a strict request/response IPC channel. The
 * transport deliberately knows nothing about SQLite, database paths, SQL, or
 * coordinator routing.
 */

import { randomUUID } from 'node:crypto';

import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorDiagnostics,
  DatabaseExecutorEvent,
  DatabaseExecutorEventListener,
  DatabaseExecutorExecuteOptions,
  DatabaseExecutorRequest,
  DatabaseExecutorState,
  DatabaseExecutorValue,
} from './database-executor';
import {
  normalizeSubprocessDatabaseExecutorOptions,
  normalizeSubprocessDatabaseExecutorTimeout,
  type NormalizedSubprocessDatabaseExecutorOptions as NormalizedOptions,
  type SubprocessDatabaseExecutorOptions,
} from './subprocess-database-executor-config';
import {
  createDatabaseExecutorDeferred,
  DatabaseExecutorProcessSettlement,
  promiseWithDatabaseExecutorTimeout,
  terminateDatabaseExecutorProcess,
  waitForDatabaseExecutorProcessExit,
  type DatabaseExecutorDeferred as Deferred,
  type DatabaseExecutorProcess as ExecutorProcess,
} from './subprocess-database-executor-lifecycle';
import { SubprocessDatabaseRequestRegistry } from './subprocess-database-request-registry';
import { SubprocessDatabaseTelemetryState } from './subprocess-database-telemetry-state';
import {
  normalizeSubprocessDatabaseExecutorRequest,
  parseSubprocessDatabaseExecutorEvent,
  type ParsedSubprocessDatabaseExecutorEvent,
} from './subprocess-database-executor-wire';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  type DatabaseExecutorHandshakeMessage,
  type DatabaseExecutorOperationMessage,
  type DatabaseExecutorProtocolIdentity as ProtocolIdentity,
  type DatabaseExecutorShutdownMessage,
  type DatabaseExecutorTelemetryMessage,
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

/** Strict, bounded Bun-to-Bun IPC transport for one database actor process. */
export class SubprocessDatabaseExecutor implements DatabaseExecutor {
  readonly slot: number;
  readonly generation: number;

  private readonly options: NormalizedOptions;
  private readonly nonce = randomUUID();
  private readonly requests: SubprocessDatabaseRequestRegistry;
  private readonly processSettlement: DatabaseExecutorProcessSettlement;
  private readonly telemetry = new SubprocessDatabaseTelemetryState();
  private state: DatabaseExecutorState = 'created';
  private child: ExecutorProcess | null = null;
  private startTask: Promise<void> | null = null;
  private closeTask: Promise<void> | null = null;
  private startDeferred: Deferred<void> | null = null;
  private shutdownDeferred: Deferred<void> | null = null;
  private closeRequested = false;
  private shutdownAcknowledged = false;
  private disconnectObserved = false;
  private lastFailure: DatabaseError | null = null;
  private eventListener: DatabaseExecutorEventListener | null = null;

  constructor(options: SubprocessDatabaseExecutorOptions) {
    this.options = normalizeSubprocessDatabaseExecutorOptions(options);
    this.slot = this.options.slot;
    this.generation = allocateGeneration();
    this.processSettlement = new DatabaseExecutorProcessSettlement(() => {
      if (this.state === 'quarantined') {
        this.state = this.closeRequested ? 'closed' : 'failed';
      }
    });
    this.requests = new SubprocessDatabaseRequestRegistry({
      generation: this.generation,
      slot: this.slot,
      maxInFlight: this.options.maxInFlight,
      onOperationTimeout: (error) => this.handleOperationTimeout(error),
    });
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

    const normalizedRequest = normalizeSubprocessDatabaseExecutorRequest(request);
    // Request inspection is intentionally side-effect free for ordinary data,
    // but re-check the lifecycle before allocating transport capacity in case
    // an adversarial Proxy triggered a re-entrant close while being rejected.
    const postValidationLifecycleError = this.executionLifecycleError();
    if (postValidationLifecycleError) throw postValidationLifecycleError;
    this.requests.assertCapacity();

    const timeoutMs = normalizeSubprocessDatabaseExecutorTimeout(
      options.timeoutMs ?? this.options.operationTimeoutMs,
      'timeoutMs',
    );
    const { requestId, result } = this.requests.register(
      normalizedRequest.kind,
      timeoutMs,
    );

    const message: DatabaseExecutorOperationMessage<Payload> = {
      ...this.identity(),
      type: 'request',
      requestId,
      operation: normalizedRequest.operation,
      operationKind: normalizedRequest.kind,
      payload: normalizedRequest.payload,
    };

    if (!this.sendToChild(message)) {
      this.requests.reject(requestId, new DatabaseError(
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
    if (this.closeTask) return this.closeTask;
    const task = this.closeOnce();
    this.closeTask = task;
    // A quarantined process has not completed shutdown. Preserve successful
    // close idempotency, but let an explicit later close retry termination.
    void task.catch(() => {
      if (this.closeTask === task) this.closeTask = null;
    });
    return task;
  }

  settled(): Promise<void> {
    return this.processSettlement.settled();
  }

  diagnostics(): DatabaseExecutorDiagnostics {
    const process = this.processSettlement.diagnostics();
    return Object.freeze({
      state: this.state,
      slot: this.slot,
      generation: this.generation,
      inFlight: this.requests.size,
      maxInFlight: this.options.maxInFlight,
      disconnectObserved: this.disconnectObserved,
      exitObserved: process.exitObserved,
      settled: process.settled,
      exitCode: process.exitCode,
      signalCode: process.signalCode,
      lastFailureCode: this.lastFailure?.code ?? null,
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async startOnce(): Promise<void> {
    this.startDeferred = createDatabaseExecutorDeferred<void>();
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
      if (!terminated && !this.processSettlement.settledObserved) {
        this.state = 'quarantined';
      }
      throw error;
    } finally {
      clearTimeout(startupTimer);
    }
  }

  private async closeOnce(): Promise<void> {
    if (this.state === 'created') {
      this.processSettlement.observeNoProcessSettlement(this.child);
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
    await this.requests.waitForDrain();
    if (this.hasFailed()) {
      await this.settleTerminationOrQuarantine();
      this.state = 'closed';
      return;
    }

    this.state = 'closing';
    this.shutdownDeferred = createDatabaseExecutorDeferred<void>();
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
      await promiseWithDatabaseExecutorTimeout(
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
      } else {
        const process = this.processSettlement.diagnostics();
        if (process.exitCode !== 0 || process.signalCode !== null) {
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
    const event = parseSubprocessDatabaseExecutorEvent(
      message,
      this.identity(),
    );
    if (!event) {
      this.failProtocol();
      return;
    }

    switch (event.type) {
      case 'ready':
        if (this.state !== 'starting') {
          this.failProtocol();
          return;
        }
        this.state = 'ready';
        this.startDeferred?.resolve(undefined);
        return;
      case 'success':
      case 'failure':
        this.handleResponse(event);
        return;
      case 'telemetry':
        this.handleTelemetry(event.signal);
        return;
      case 'shutdown-ack':
        if (this.state !== 'closing' || this.shutdownAcknowledged) {
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

  private handleResponse(
    event: Extract<
      ParsedSubprocessDatabaseExecutorEvent,
      { readonly type: 'success' | 'failure' }
    >,
  ): void {
    if (this.state !== 'ready' && this.state !== 'draining') {
      this.failProtocol();
      return;
    }
    if (!this.requests.has(event.requestId)) {
      this.failProtocol();
      return;
    }
    if (event.type === 'success') {
      this.requests.resolve(event.requestId, event.value);
      return;
    }
    this.requests.reject(event.requestId, event.error);
  }

  private handleTelemetry(
    signal: DatabaseExecutorTelemetryMessage['signal'],
  ): void {
    const transition = this.telemetry.accept(signal, this.state);
    if (!transition) {
      this.failProtocol();
      return;
    }
    if (transition.kind === 'event') {
      this.emitEvent(transition.type);
      return;
    }

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
    this.requests.rejectForTransportFailure('hot-periodic-durability');
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
    this.processSettlement.observeExit(exitCode, signalCode);
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

  private handleOperationTimeout(error: DatabaseError): void {
    this.recordFailure(error);
    this.state = 'failed';
    this.requests.rejectForTransportFailure('operation-timeout');
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
    this.requests.rejectAll(error);
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
    this.requests.rejectForTransportFailure(phase);
    this.beginTermination();
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
        && !this.processSettlement.settledObserved
        && this.state !== 'closed') {
        this.state = 'quarantined';
      }
    }, () => {
      if (!this.processSettlement.settledObserved && this.state !== 'closed') {
        this.state = 'quarantined';
      }
    });
  }

  private async settleTerminationOrQuarantine(): Promise<void> {
    if (this.processSettlement.settledObserved) return;
    const terminated = await this.ensureTerminated();
    if (!terminated && !this.processSettlement.settledObserved) {
      this.state = 'quarantined';
      throw this.settlementError();
    }
    await this.settled();
  }

  private async ensureTerminated(): Promise<boolean> {
    return await this.processSettlement.ensureTerminated(
      () => this.terminateWithEscalation(),
    );
  }

  protected async terminateWithEscalation(): Promise<boolean> {
    return await terminateDatabaseExecutorProcess({
      child: this.child,
      exitObserved: this.processSettlement.exitObserved,
      sigtermTimeoutMs: this.options.sigtermTimeoutMs,
      sigkillTimeoutMs: this.options.sigkillTimeoutMs,
      observeNoProcessSettlement: () => {
        this.processSettlement.observeNoProcessSettlement(this.child);
      },
      captureSettledProcess: (child) => {
        this.processSettlement.captureSettledProcess(child);
      },
    });
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    return await waitForDatabaseExecutorProcessExit({
      child: this.child,
      exitObserved: this.processSettlement.exitObserved,
      timeoutMs,
      observeNoProcessSettlement: () => {
        this.processSettlement.observeNoProcessSettlement(this.child);
      },
      captureSettledProcess: (child) => {
        this.processSettlement.captureSettledProcess(child);
      },
    });
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

function allocateGeneration(): number {
  const generation = nextExecutorGeneration;
  nextExecutorGeneration += 1;
  if (!Number.isSafeInteger(nextExecutorGeneration)) nextExecutorGeneration = 1;
  return generation;
}
