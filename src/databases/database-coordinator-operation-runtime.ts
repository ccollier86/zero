/**
 * Capability operation boundary for coordinator reads, writes, receipts, and
 * replay. Actor lifecycle and catalog ownership remain with the coordinator.
 */

import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
  DATABASE_ACTOR_OPERATIONS,
  validateDatabaseActorFindReceiptPayload,
  validateDatabaseActorReplayPayload,
} from './database-actor-protocol';
import {
  validateDatabaseActorExecuteOutcome,
  validateDatabaseActorReceiptLookupResult,
  validateDatabaseActorReplayResult,
  validateDatabaseActorTrustedWriteOutcome,
} from './database-actor-result-validation';
import type { AuthorityCommitCoordinator, AuthorityCommitLease } from './authority-commit-coordinator';
import {
  assertDatabaseCommitAuthorityCurrent,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type { DatabaseExecutionOptions } from './database-coordinator-contract';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import {
  authorityUnavailable,
  elapsed,
  historyGapSequenceRange,
  isExpiredReceiptOutcome,
  permanentCapacityDetails,
  queueCancelled,
  safeCoordinatorError,
  sameKeyOnlyUnknownWrite,
} from './database-coordinator-errors';
import {
  isWriteOperation,
  operationClass,
  operationTimeout,
  queueTimeout,
  type DatabaseWriterLaneOperationClass,
} from './database-coordinator-runtime';
import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorValue,
} from './database-executor';
import type { DatabaseObservability } from './database-observability';
import {
  validateDatabaseOperation,
  type DatabaseCommitResult,
  type DatabaseOperation,
  type DatabaseReadResult,
  type DatabaseWriteOperation,
} from './database-operations';
import type { createDatabaseRealmOperationCatalog } from './database-realm';
import {
  validateDatabaseLogicalReceiptFingerprint,
  type DatabaseLogicalReceiptFingerprint,
  type DatabaseTrustedReceiptExecutionOptions,
  type DatabaseTrustedReceiptLookup,
  type DatabaseTrustedWriteExecutionOptions,
} from './database-trusted-writer';
import type {
  DatabaseWriterCommitValue,
  DatabaseWriterReceiptCompaction,
} from './database-writer-engine';

interface DatabaseCoordinatorOperationRuntimeOptions {
  readonly operationCatalog: ReturnType<typeof createDatabaseRealmOperationCatalog>;
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly maxQueuedPerDatabase: number;
  readonly maxQueuedTotal: number;
  readonly now: () => number;
  readonly authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  readonly requireCommitAuthority: boolean;
  readonly assertStarted: () => void;
  readonly canAwaitOpening: (entry: DatabaseCoordinatorEntry) => boolean;
  readonly assertUsableEntry: (entry: DatabaseCoordinatorEntry) => void;
  readonly requireWriter: (entry: DatabaseCoordinatorEntry) => DatabaseExecutor;
  readonly isTerminalFailure: (
    executor: DatabaseExecutor,
    error: DatabaseError,
  ) => boolean;
  readonly retire: (
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
  ) => Promise<void>;
  readonly publishCommit: (
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseWriteOperation,
    result: DatabaseCommitResult,
  ) => void;
  readonly holdAuthorityUntilSettlement: (
    lease: AuthorityCommitLease,
    executor: DatabaseExecutor,
  ) => void;
  readonly queuedOperations: () => number;
  readonly incrementQueuedOperations: () => void;
  readonly decrementQueuedOperations: () => void;
  readonly cleanupFailedEntryIfUnused: (entry: DatabaseCoordinatorEntry) => void;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorOperationRuntime {
  constructor(private readonly options: DatabaseCoordinatorOperationRuntimeOptions) {}

  execute(
    entry: DatabaseCoordinatorEntry,
    value: unknown,
    execution: DatabaseExecutionOptions = {},
    commitAuthority: DatabaseCommitAuthority | null = null,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    this.options.assertStarted();
    let operation: DatabaseOperation;
    try {
      operation = validateDatabaseOperation(value, this.options.operationCatalog);
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        execution,
        operationClass(operation),
        () => this.execute(entry, operation, execution, commitAuthority),
      );
    }
    this.options.assertUsableEntry(entry);
    if (isWriteOperation(operation)) {
      return this.enqueueWriterOperation(
        entry,
        operation,
        execution,
        commitAuthority,
      );
    }
    if (operation.consistency?.mode === 'strong' || !entry.reader) {
      return this.enqueueWriterOperation(entry, operation, execution, null);
    }
    return this.trackOperation(entry, async () => {
      try {
        return await this.executeOnActor(
          entry,
          entry.reader!,
          operation,
          execution,
        );
      } catch (error) {
        const normalized = safeCoordinatorError(error);
        if (operation.consistency?.mode === 'read-your-writes'
          && normalized.code === 'DATABASE_TRANSACTION_STALE') {
          return entry.lane.enqueue(
            () => this.executeOnActor(
              entry,
              this.options.requireWriter(entry),
              operation,
              execution,
            ),
            {
              signal: execution.signal,
              timeoutMs: queueTimeout(execution, this.options.queueTimeoutMs),
              operationClass: 'query',
            },
          );
        }
        throw normalized;
      }
    });
  }

  executeTrustedWrite(
    entry: DatabaseCoordinatorEntry,
    value: unknown,
    execution: DatabaseTrustedWriteExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>> {
    this.options.assertStarted();
    if (!execution || typeof execution !== 'object') {
      throw new DatabaseError(
        'DATABASE_PAYLOAD_INVALID',
        'Database trusted write options are invalid.',
      );
    }
    let operation: DatabaseWriteOperation;
    let logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint;
    try {
      const validated = validateDatabaseOperation(value, this.options.operationCatalog);
      if (!isWriteOperation(validated)) {
        throw new DatabaseError(
          'DATABASE_OPERATION_UNSUPPORTED',
          'Database trusted writer accepts only write operations.',
        );
      }
      operation = validated;
      logicalReceiptFingerprint = validateDatabaseLogicalReceiptFingerprint(
        execution.logicalReceiptFingerprint,
      );
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        execution,
        'mutation',
        () => this.executeTrustedWrite(
          entry,
          operation,
          execution,
          commitAuthority,
        ),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.enqueueWriterOperation(
      entry,
      operation,
      execution,
      commitAuthority,
      logicalReceiptFingerprint,
    ) as Promise<DatabaseCommitResult<DatabaseWriterCommitValue>>;
  }

  findTrustedReceipt(
    entry: DatabaseCoordinatorEntry,
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    execution: DatabaseTrustedReceiptExecutionOptions = {},
  ): Promise<DatabaseTrustedReceiptLookup> {
    this.options.assertStarted();
    let payload: ReturnType<typeof validateDatabaseActorFindReceiptPayload>;
    try {
      payload = validateDatabaseActorFindReceiptPayload({
        databaseRef: entry.databaseRef,
        idempotencyKey,
        logicalReceiptFingerprint,
      });
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        execution,
        'receipt',
        () => this.findTrustedReceipt(
          entry,
          payload.idempotencyKey,
          payload.logicalReceiptFingerprint,
          execution,
        ),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.enqueueLane(entry, 'receipt', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const startedAt = this.options.now();
      try {
        const raw = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.findReceipt,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        return validateDatabaseActorReceiptLookupResult(
          raw,
          payload.idempotencyKey,
          this.options.operationCatalog,
        );
      } catch (caught) {
        const error = safeCoordinatorError(caught);
        this.options.emit({
          type: isExpiredReceiptOutcome(error)
            ? 'receipt-expired'
            : 'receipt-lookup-failed',
          databaseRef: entry.databaseRef,
          placement: entry.placement.mode,
          role: 'writer',
          slot: entry.slot,
          generation: writer.diagnostics().generation,
          durationMs: elapsed(startedAt, this.options.now()),
          error,
        });
        await this.retireIfTerminal(entry, writer, error);
        throw error;
      }
    });
  }

  replay(
    entry: DatabaseCoordinatorEntry,
    afterSeq: number,
    limit = DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    execution: DatabaseExecutionOptions = {},
  ): Promise<DatabaseReadResult> {
    this.options.assertStarted();
    let payload: ReturnType<typeof validateDatabaseActorReplayPayload>;
    try {
      payload = validateDatabaseActorReplayPayload({
        databaseRef: entry.databaseRef,
        afterSeq,
        limit,
      });
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.awaitReplacementOpening(
        entry,
        execution,
        'replay',
        () => this.replay(entry, payload.afterSeq, payload.limit, execution),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.enqueueLane(entry, 'replay', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const startedAt = this.options.now();
      try {
        const result = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.replay,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        return validateDatabaseActorReplayResult(result, payload);
      } catch (caught) {
        const historyGap = historyGapSequenceRange(caught, payload.afterSeq);
        const error = safeCoordinatorError(caught);
        this.options.emit(historyGap ? {
          type: 'history-gap',
          databaseRef: entry.databaseRef,
          placement: entry.placement.mode,
          role: 'writer',
          slot: entry.slot,
          generation: writer.diagnostics().generation,
          ...historyGap,
          reason: 'history-gap',
        } : {
          type: 'replay-failed',
          databaseRef: entry.databaseRef,
          placement: entry.placement.mode,
          role: 'writer',
          slot: entry.slot,
          generation: writer.diagnostics().generation,
          sequenceStart: payload.afterSeq,
          sequenceEnd: payload.afterSeq,
          durationMs: elapsed(startedAt, this.options.now()),
          error,
        });
        await this.retireIfTerminal(entry, writer, error);
        throw error;
      }
    });
  }

  enqueueLane<T>(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseWriterLaneOperationClass,
    execution: DatabaseExecutionOptions,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.trackOperation(entry, () => entry.lane.enqueue(run, {
      signal: execution.signal,
      timeoutMs: queueTimeout(execution, this.options.queueTimeoutMs),
      operationClass: operation,
    }));
  }

  awaitReplacementOpening<T>(
    entry: DatabaseCoordinatorEntry,
    execution: DatabaseExecutionOptions,
    operation: DatabaseWriterLaneOperationClass,
    resume: () => Promise<T>,
  ): Promise<T> {
    let timeoutMs: number;
    try {
      timeoutMs = queueTimeout(execution, this.options.queueTimeoutMs);
    } catch (error) {
      return Promise.reject(safeCoordinatorError(error));
    }
    if (execution.signal?.aborted) return Promise.reject(queueCancelled());

    if (entry.recoveryWaiters >= this.options.maxQueuedPerDatabase
      || this.options.queuedOperations() >= this.options.maxQueuedTotal) {
      this.options.emit({
        type: 'queue-saturated',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        operation,
        queueDepth: entry.recoveryWaiters,
        queueLimit: this.options.maxQueuedPerDatabase,
      });
      return Promise.reject(new DatabaseError(
        'DATABASE_BACKPRESSURE',
        'Database recovery queue capacity is exhausted.',
        {
          retryable: true,
          outcome: 'not-started',
          details: {
            queueDepth: entry.recoveryWaiters,
            queueLimit: this.options.maxQueuedPerDatabase,
          },
        },
      ));
    }

    const opening = entry.opening;
    const queuedAt = this.options.now();
    entry.recoveryWaiters += 1;
    this.options.incrementQueuedOperations();
    entry.lastUsedAt = queuedAt;

    const waiting = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abortListener: (() => void) | null = null;

      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        timer = null;
        if (execution.signal && abortListener) {
          execution.signal.removeEventListener('abort', abortListener);
        }
        abortListener = null;
        entry.recoveryWaiters = Math.max(0, entry.recoveryWaiters - 1);
        this.options.decrementQueuedOperations();
        entry.lastUsedAt = this.options.now();
        this.options.cleanupFailedEntryIfUnused(entry);
        if (error === undefined) resolve();
        else reject(safeCoordinatorError(error));
      };

      timer = setTimeout(() => {
        const durationMs = elapsed(queuedAt, this.options.now());
        this.options.emit({
          type: 'queue-timeout',
          databaseRef: entry.databaseRef,
          placement: entry.placement.mode,
          operation,
          queueDepth: Math.max(0, entry.recoveryWaiters - 1),
          durationMs,
        });
        finish(new DatabaseError(
          'DATABASE_QUEUE_TIMEOUT',
          'Database operation expired while waiting for binding recovery.',
          {
            retryable: true,
            outcome: 'not-started',
            details: {
              durationMs,
              queueDepth: Math.max(0, entry.recoveryWaiters - 1),
            },
          },
        ));
      }, timeoutMs);
      if (execution.signal) {
        abortListener = () => finish(queueCancelled());
        execution.signal.addEventListener('abort', abortListener, { once: true });
        if (execution.signal.aborted) finish(queueCancelled());
      }
      void opening.then(
        () => finish(),
        (error) => finish(error),
      );
    });
    return waiting.then(resume);
  }

  private enqueueWriterOperation(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseOperation,
    execution: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    const run = async () => {
      const result = await this.executeWriterAtHead(
        entry,
        operation,
        execution,
        commitAuthority,
        logicalReceiptFingerprint,
      );
      if (isWriteOperation(operation)) {
        this.options.publishCommit(
          entry,
          operation,
          result as DatabaseCommitResult,
        );
      }
      return result;
    };
    return this.enqueueLane(entry, operationClass(operation), execution, run);
  }

  private async executeWriterAtHead(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseOperation,
    execution: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    if (!isWriteOperation(operation) || !commitAuthority) {
      if (isWriteOperation(operation) && this.options.requireCommitAuthority) {
        throw authorityUnavailable();
      }
      return this.executeOnActor(
        entry,
        this.options.requireWriter(entry),
        operation,
        execution,
        logicalReceiptFingerprint,
      );
    }

    const authorityCoordinator = this.options.authorityCommitCoordinator;
    if (!authorityCoordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit authority coordinator is unavailable.',
      );
    }
    const authorityLease = await authorityCoordinator.acquireShared({
      ...(execution.signal ? { signal: execution.signal } : {}),
      timeoutMs: queueTimeout(execution, this.options.queueTimeoutMs),
    });
    let transferred = false;
    try {
      const writer = this.options.requireWriter(entry);
      assertDatabaseCommitAuthorityCurrent(
        commitAuthority,
        authorityCoordinator,
        entry.databaseRef,
      );
      try {
        return await this.executeOnActor(
          entry,
          writer,
          operation,
          execution,
          logicalReceiptFingerprint,
        );
      } catch (error) {
        const normalized = safeCoordinatorError(error);
        if (normalized.outcome === 'unknown'
          && !isExpiredReceiptOutcome(normalized)
          && !writer.diagnostics().settled) {
          transferred = true;
          this.options.holdAuthorityUntilSettlement(authorityLease, writer);
        }
        throw normalized;
      }
    } finally {
      if (!transferred) authorityLease.release();
    }
  }

  private async executeOnActor(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    operation: DatabaseOperation,
    execution: DatabaseExecutionOptions,
    logicalReceiptFingerprint?: DatabaseLogicalReceiptFingerprint,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    const kind = isWriteOperation(operation) ? 'write' : 'read';
    const startedAt = this.options.now();
    try {
      const value = await executor.execute({
        operation: DATABASE_ACTOR_OPERATIONS.execute,
        kind,
        payload: {
          databaseRef: entry.databaseRef,
          operation,
          ...(logicalReceiptFingerprint === undefined
            ? {}
            : { logicalReceiptFingerprint }),
        } as unknown as DatabaseExecutorValue,
      }, {
        timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
      });
      if (logicalReceiptFingerprint === undefined) {
        const outcome = validateDatabaseActorExecuteOutcome(
          value,
          operation,
          this.options.operationCatalog,
        );
        this.emitReceiptCompaction(entry, executor, outcome.receiptCompaction);
        return outcome.result;
      }
      if (!isWriteOperation(operation)) {
        throw new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Database trusted receipt operation is invalid.',
          { retryable: false, outcome: 'unknown' },
        );
      }
      const outcome = validateDatabaseActorTrustedWriteOutcome(
        value,
        operation.idempotencyKey,
        this.options.operationCatalog,
      );
      this.emitReceiptCompaction(entry, executor, outcome.receiptCompaction);
      return outcome.result;
    } catch (caught) {
      const normalized = safeCoordinatorError(caught);
      const expiredReceipt = isExpiredReceiptOutcome(normalized);
      const error = kind === 'write'
        && normalized.outcome === 'unknown'
        && !expiredReceipt
        ? sameKeyOnlyUnknownWrite(normalized)
        : normalized;
      const capacity = permanentCapacityDetails(error);
      this.options.emit(capacity ? {
        type: 'capacity-exhausted',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: executor === entry.writer ? 'writer' : 'reader',
        slot: entry.slot,
        generation: executor.diagnostics().generation,
        ...capacity,
      } : expiredReceipt ? {
        type: 'receipt-expired',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: executor === entry.writer ? 'writer' : 'reader',
        slot: entry.slot,
        generation: executor.diagnostics().generation,
        durationMs: elapsed(startedAt, this.options.now()),
        error,
      } : {
        type: error.outcome === 'unknown'
          ? 'operation-outcome-unknown'
          : 'operation-failed',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: executor === entry.writer ? 'writer' : 'reader',
        slot: entry.slot,
        generation: executor.diagnostics().generation,
        operation: operationClass(operation),
        durationMs: elapsed(startedAt, this.options.now()),
        error,
      });
      if ((kind === 'write' && error.outcome === 'unknown' && !expiredReceipt)
        || this.options.isTerminalFailure(executor, error)) {
        await this.options.retire(entry, executor, error);
      }
      throw error;
    }
  }

  private emitReceiptCompaction(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    compaction: DatabaseWriterReceiptCompaction | null,
  ): void {
    if (!compaction) return;
    this.options.emit({
      type: 'receipt-compacted',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role: executor === entry.writer ? 'writer' : 'reader',
      slot: entry.slot,
      generation: executor.diagnostics().generation,
      ...compaction,
    });
  }

  private async trackOperation<T>(
    entry: DatabaseCoordinatorEntry,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.options.assertUsableEntry(entry);
    entry.activeOperations += 1;
    entry.lastUsedAt = this.options.now();
    try {
      return await operation();
    } finally {
      entry.activeOperations -= 1;
      entry.lastUsedAt = this.options.now();
      this.options.cleanupFailedEntryIfUnused(entry);
    }
  }

  private async retireIfTerminal(
    entry: DatabaseCoordinatorEntry,
    executor: DatabaseExecutor,
    error: DatabaseError,
  ): Promise<void> {
    if (this.options.isTerminalFailure(executor, error)) {
      await this.options.retire(entry, executor, error);
    }
  }
}
