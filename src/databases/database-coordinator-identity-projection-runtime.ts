/**
 * Framework-private Guardian identity projection execution boundary.
 *
 * Queueing, replacement recovery, and actor lifecycle remain owned by the
 * coordinator runtimes and are injected here so projection cannot fork their
 * ordering or retirement semantics.
 */

import { DATABASE_ACTOR_OPERATIONS } from './database-actor-protocol';
import {
  assertDatabaseCommitAuthorityCurrent,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type { AuthorityCommitCoordinator } from './authority-commit-coordinator';
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
  type DatabaseWriterLaneOperationClass,
} from './database-coordinator-runtime';
import { DatabaseError } from './database-error';
import type {
  DatabaseExecutor,
  DatabaseExecutorValue,
} from './database-executor';
import {
  validateDatabaseIdentityProjectionPayload,
  validateDatabaseIdentityProjectionResult,
  type DatabaseIdentityProjectionPayload,
  type DatabaseIdentityProjectionResult,
} from './database-identity-projection-actor';
import type { DatabaseObservability } from './database-observability';

interface DatabaseCoordinatorIdentityProjectionRuntimeOptions {
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
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

/** Executes only the private, ID-only identity projection actor protocol. */
export class DatabaseCoordinatorIdentityProjectionRuntime {
  constructor(
    private readonly options: DatabaseCoordinatorIdentityProjectionRuntimeOptions,
  ) {}

  execute(
    entry: DatabaseCoordinatorEntry,
    input: Omit<DatabaseIdentityProjectionPayload, 'databaseRef'>,
    execution: DatabaseExecutionOptions = {},
    commitAuthority: DatabaseCommitAuthority | null = null,
  ): Promise<DatabaseIdentityProjectionResult> {
    this.options.assertStarted();
    let payload: DatabaseIdentityProjectionPayload;
    try {
      payload = validateDatabaseIdentityProjectionPayload({
        ...input,
        databaseRef: entry.databaseRef,
      });
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.options.awaitReplacementOpening(
        entry,
        execution,
        'mutation',
        () => this.execute(entry, input, execution, commitAuthority),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.options.enqueueLane(entry, 'mutation', execution, () => (
      this.executeAtWriterHead(entry, payload, execution, commitAuthority)
    ));
  }

  private async executeAtWriterHead(
    entry: DatabaseCoordinatorEntry,
    payload: DatabaseIdentityProjectionPayload,
    execution: DatabaseExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseIdentityProjectionResult> {
    const startedAt = this.options.now();
    if (this.options.requireCommitAuthority && !commitAuthority) {
      throw authorityUnavailable();
    }
    const writer = this.options.requireWriter(entry);
    if (commitAuthority) {
      const authorityCoordinator = this.options.authorityCommitCoordinator;
      if (!authorityCoordinator) {
        throw new DatabaseError(
          'DATABASE_CONFIG_INVALID',
          'Database commit authority coordinator is unavailable.',
        );
      }
      // Recheck the private capability at the FIFO head. The actor commit does
      // not take a shared authority lease: retained ID-only anchors cannot
      // grant authentication, membership, roles, or permission.
      assertDatabaseCommitAuthorityCurrent(
        commitAuthority,
        authorityCoordinator,
        entry.databaseRef,
      );
    }
    try {
      const raw = await writer.execute({
        operation: DATABASE_ACTOR_OPERATIONS.identityProjection,
        kind: 'write',
        payload: payload as unknown as DatabaseExecutorValue,
      }, {
        timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
      });
      return validateDatabaseIdentityProjectionResult(payload.action, raw);
    } catch (caught) {
      const error = safeCoordinatorError(caught);
      this.emitFailure(entry, writer, error, startedAt);
      if (error.outcome === 'unknown'
        || this.options.isTerminalFailure(writer, error)) {
        await this.options.retire(entry, writer, error);
      }
      throw error;
    }
  }

  private emitFailure(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
    error: DatabaseError,
    startedAt: number,
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
      operation: 'mutation',
      durationMs: elapsed(startedAt, this.options.now()),
      ...(failureReason === null ? {} : { failureReason }),
      error,
    });
  }
}
