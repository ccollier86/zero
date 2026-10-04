/**
 * Framework-private execution boundary for source-local automation delivery.
 *
 * Every lifecycle action targets the current writer and enters the same
 * per-database FIFO as application mutations. Host handlers receive only the
 * validated result after that FIFO operation has settled.
 */

import type {
  AuthorityCommitCoordinator,
  AuthorityCommitLease,
} from './authority-commit-coordinator';
import {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
  validateDatabaseActorAutomationOutboxPayload,
  validateDatabaseActorAutomationOutboxResult,
  type DatabaseActorAutomationOutboxClaimPayload,
  type DatabaseActorAutomationOutboxCompletePayload,
  type DatabaseActorAutomationOutboxCountsPayload,
  type DatabaseActorAutomationOutboxDeadPayload,
  type DatabaseActorAutomationOutboxPayload,
  type DatabaseActorAutomationOutboxRecoverExpiredPayload,
  type DatabaseActorAutomationOutboxRenewPayload,
  type DatabaseActorAutomationOutboxResultFor,
  type DatabaseActorAutomationOutboxRetryPayload,
} from './database-automation-actor-protocol';
import {
  assertDatabaseCommitAuthorityCurrent,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type { DatabaseExecutionOptions } from './database-coordinator-contract';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import {
  authorityUnavailable,
  elapsed,
  isHotMaxBytesFailure,
  permanentCapacityDetails,
  safeCoordinatorError,
} from './database-coordinator-errors';
import {
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

/** Exact source action accepted from the coordinator-owned lease adapter. */
export type DatabaseCoordinatorAutomationDeliveryInput =
  | Omit<DatabaseActorAutomationOutboxClaimPayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxRenewPayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxCompletePayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxRetryPayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxDeadPayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxRecoverExpiredPayload, 'databaseRef'>
  | Omit<DatabaseActorAutomationOutboxCountsPayload, 'databaseRef'>;

export type DatabaseCoordinatorAutomationDeliveryResult<
  TInput extends DatabaseCoordinatorAutomationDeliveryInput,
> = DatabaseActorAutomationOutboxResultFor<PayloadForInput<TInput>>;

interface DatabaseCoordinatorAutomationDeliveryRuntimeOptions {
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly now: () => number;
  readonly authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  readonly requireCommitAuthority: boolean;
  readonly assertStarted: () => void;
  readonly canAwaitOpening: (entry: DatabaseCoordinatorEntry) => boolean;
  readonly awaitReplacementOpening: <T>(
    entry: DatabaseCoordinatorEntry,
    execution: DatabaseExecutionOptions,
    operation: DatabaseWriterLaneOperationClass,
    resume: () => Promise<T>,
  ) => Promise<T>;
  readonly assertUsableEntry: (entry: DatabaseCoordinatorEntry) => void;
  readonly enqueueLane: <T>(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseWriterLaneOperationClass,
    execution: DatabaseExecutionOptions,
    run: () => Promise<T>,
  ) => Promise<T>;
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
  readonly holdAuthorityUntilSettlement: (
    lease: AuthorityCommitLease,
    executor: DatabaseExecutor,
  ) => void;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

/** Executes only the private source-local automation outbox protocol. */
export class DatabaseCoordinatorAutomationDeliveryRuntime {
  constructor(
    private readonly options: DatabaseCoordinatorAutomationDeliveryRuntimeOptions,
  ) {}

  execute<TInput extends DatabaseCoordinatorAutomationDeliveryInput>(
    entry: DatabaseCoordinatorEntry,
    input: TInput,
    execution: DatabaseExecutionOptions = {},
    commitAuthority: DatabaseCommitAuthority | null = null,
  ): Promise<DatabaseCoordinatorAutomationDeliveryResult<TInput>> {
    this.options.assertStarted();
    let payload: DatabaseActorAutomationOutboxPayload;
    try {
      payload = validateDatabaseActorAutomationOutboxPayload({
        ...input,
        databaseRef: entry.databaseRef,
      });
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    return this.executeValidated(
      entry,
      payload,
      execution,
      commitAuthority,
    ) as Promise<DatabaseCoordinatorAutomationDeliveryResult<TInput>>;
  }

  private executeValidated(
    entry: DatabaseCoordinatorEntry,
    payload: DatabaseActorAutomationOutboxPayload,
    execution: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseActorAutomationOutboxResultFor<
    DatabaseActorAutomationOutboxPayload
  >> {
    this.options.assertStarted();
    const operation = automationDeliveryOperationClass(payload);
    if (this.options.canAwaitOpening(entry)) {
      return this.options.awaitReplacementOpening(
        entry,
        execution,
        operation,
        () => this.executeValidated(
          entry,
          payload,
          execution,
          commitAuthority,
        ),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.options.enqueueLane(entry, operation, execution, () => (
      this.executeAtWriterHead(
        entry,
        payload,
        execution,
        commitAuthority,
        operation,
      )
    ));
  }

  private async executeAtWriterHead(
    entry: DatabaseCoordinatorEntry,
    payload: DatabaseActorAutomationOutboxPayload,
    execution: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
    operation: DatabaseWriterLaneOperationClass,
  ): Promise<DatabaseActorAutomationOutboxResultFor<
    DatabaseActorAutomationOutboxPayload
  >> {
    const startedAt = this.options.now();
    if (this.options.requireCommitAuthority && !commitAuthority) {
      throw authorityUnavailable();
    }
    const authorityCoordinator = commitAuthority
      ? this.options.authorityCommitCoordinator
      : null;
    if (commitAuthority && !authorityCoordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit authority coordinator is unavailable.',
      );
    }
    const authorityLease = authorityCoordinator
      ? await authorityCoordinator.acquireShared({
          ...(execution.signal ? { signal: execution.signal } : {}),
          timeoutMs: queueTimeout(execution, this.options.queueTimeoutMs),
        })
      : null;
    let transferredAuthority = false;
    let writer: DatabaseExecutor | null = null;

    try {
      writer = this.options.requireWriter(entry);
      if (commitAuthority && authorityCoordinator) {
        assertDatabaseCommitAuthorityCurrent(
          commitAuthority,
          authorityCoordinator,
          entry.databaseRef,
        );
      }
      const raw = await writer.execute({
        operation: DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
        kind: payload.action === 'counts' ? 'read' : 'write',
        payload: payload as unknown as DatabaseExecutorValue,
      }, {
        timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
      });
      return validateDatabaseActorAutomationOutboxResult(payload, raw);
    } catch (caught) {
      const error = safeCoordinatorError(caught);
      if (!writer) throw error;
      this.emitFailure(entry, writer, error, startedAt, operation);
      if (authorityLease
        && error.outcome === 'unknown'
        && !writer.diagnostics().settled) {
        this.options.holdAuthorityUntilSettlement(authorityLease, writer);
        transferredAuthority = true;
      }
      if (error.outcome === 'unknown'
        || this.options.isTerminalFailure(writer, error)) {
        await this.options.retire(entry, writer, error);
      }
      throw error;
    } finally {
      if (authorityLease && !transferredAuthority) authorityLease.release();
    }
  }

  private emitFailure(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
    error: DatabaseError,
    startedAt: number,
    operation: DatabaseWriterLaneOperationClass,
  ): void {
    const capacity = permanentCapacityDetails(error);
    if (capacity) {
      this.options.emit({
        type: 'capacity-exhausted',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: 'writer',
        slot: entry.slot,
        generation: writer.diagnostics().generation,
        ...capacity,
      });
      return;
    }

    const failureReason = entry.placement.mode === 'hot'
      && isHotMaxBytesFailure(error)
      ? 'hot-max-bytes' as const
      : null;
    this.options.emit({
      type: error.outcome === 'unknown'
        ? 'operation-outcome-unknown'
        : 'operation-failed',
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role: 'writer',
      slot: entry.slot,
      generation: writer.diagnostics().generation,
      operation,
      durationMs: elapsed(startedAt, this.options.now()),
      ...(failureReason === null ? {} : { failureReason }),
      error,
    });
  }
}

type PayloadForInput<TInput extends DatabaseCoordinatorAutomationDeliveryInput> =
  TInput extends { readonly action: 'claim' }
    ? DatabaseActorAutomationOutboxClaimPayload
    : TInput extends { readonly action: 'renew' }
      ? DatabaseActorAutomationOutboxRenewPayload
      : TInput extends { readonly action: 'complete' }
        ? DatabaseActorAutomationOutboxCompletePayload
        : TInput extends { readonly action: 'retry' }
          ? DatabaseActorAutomationOutboxRetryPayload
          : TInput extends { readonly action: 'dead' }
            ? DatabaseActorAutomationOutboxDeadPayload
            : TInput extends { readonly action: 'recover-expired' }
              ? DatabaseActorAutomationOutboxRecoverExpiredPayload
              : DatabaseActorAutomationOutboxCountsPayload;

function automationDeliveryOperationClass(
  payload: DatabaseActorAutomationOutboxPayload,
): 'query' | 'mutation' {
  return payload.action === 'counts' ? 'query' : 'mutation';
}
