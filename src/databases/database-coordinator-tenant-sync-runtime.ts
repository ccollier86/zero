/** Actor transport for exact tenant-Sync snapshot and replay capabilities. */

import {
  DATABASE_ACTOR_MAX_REPLAY_CHANGES,
  DATABASE_ACTOR_OPERATIONS,
  validateDatabaseActorReplayPayload,
} from './database-actor-protocol';
import {
  validateDatabaseActorReplayResult,
} from './database-actor-result-validation';
import type { CoordinatorTenantSyncSnapshotStart } from './database-coordinator-capability';
import type {
  DatabaseCoordinatorEntry,
  DatabaseTenantSyncIdentity,
} from './database-coordinator-entry';
import {
  elapsed,
  historyGapSequenceRange,
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
import type { DatabaseObservability } from './database-observability';
import type { createDatabaseRealmOperationCatalog } from './database-realm';
import {
  createDatabaseTenantSyncReplayResult,
  type DatabaseTenantSyncExecutionOptions,
  type DatabaseTenantSyncReplayResult,
  type DatabaseTenantSyncSnapshotPage,
} from './database-tenant-sync';
import {
  validateDatabaseActorTenantSyncSnapshotAbortPayload,
  validateDatabaseActorTenantSyncSnapshotAbortResult,
  validateDatabaseActorTenantSyncSnapshotBeginPayload,
  validateDatabaseActorTenantSyncSnapshotBeginResult,
  validateDatabaseActorTenantSyncSnapshotPagePayload,
  validateDatabaseActorTenantSyncSnapshotPageResult,
  validateDatabaseTenantSyncTableSelection,
} from './database-tenant-sync-snapshot-protocol';

interface DatabaseCoordinatorTenantSyncRuntimeOptions {
  readonly operationCatalog: ReturnType<typeof createDatabaseRealmOperationCatalog>;
  readonly operationTimeoutMs: number;
  readonly now: () => number;
  readonly assertStarted: () => void;
  readonly canAwaitOpening: (entry: DatabaseCoordinatorEntry) => boolean;
  readonly awaitReplacementOpening: <T>(
    entry: DatabaseCoordinatorEntry,
    options: DatabaseTenantSyncExecutionOptions,
    operation: DatabaseWriterLaneOperationClass,
    resume: () => Promise<T>,
  ) => Promise<T>;
  readonly assertUsableEntry: (entry: DatabaseCoordinatorEntry) => void;
  readonly isReadySessionGeneration: (
    entry: DatabaseCoordinatorEntry,
    generation: number,
  ) => boolean;
  readonly enqueueLane: <T>(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseWriterLaneOperationClass,
    options: DatabaseTenantSyncExecutionOptions,
    execute: () => Promise<T>,
  ) => Promise<T>;
  readonly requireWriter: (entry: DatabaseCoordinatorEntry) => DatabaseExecutor;
  readonly requireIdentity: (
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
  ) => DatabaseTenantSyncIdentity;
  readonly advanceSequence: (
    entry: DatabaseCoordinatorEntry,
    sequence: number,
  ) => void;
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

export class DatabaseCoordinatorTenantSyncRuntime {
  constructor(private readonly options: DatabaseCoordinatorTenantSyncRuntimeOptions) {}

  beginSnapshot(
    entry: DatabaseCoordinatorEntry,
    ownerToken: string,
    tables: readonly string[],
    execution: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<CoordinatorTenantSyncSnapshotStart> {
    this.options.assertStarted();
    let selected: readonly string[];
    try {
      selected = validateDatabaseTenantSyncTableSelection(
        tables,
        this.options.operationCatalog,
      );
    } catch (error) {
      throw safeCoordinatorError(error);
    }
    if (this.options.canAwaitOpening(entry)) {
      return this.options.awaitReplacementOpening(
        entry,
        execution,
        'snapshot',
        () => this.beginSnapshot(entry, ownerToken, selected, execution),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.options.enqueueLane(entry, 'snapshot', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const identity = this.options.requireIdentity(entry, writer);
      const startedAt = this.options.now();
      try {
        const payload = validateDatabaseActorTenantSyncSnapshotBeginPayload({
          databaseRef: entry.databaseRef,
          generation: identity.generation,
          ownerToken,
          tables: selected,
        }, this.options.operationCatalog);
        const raw = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        const result = validateDatabaseActorTenantSyncSnapshotBeginResult(
          raw,
          selected,
          this.options.operationCatalog,
        );
        const current = this.options.requireIdentity(entry, writer);
        if (result.syncEpoch !== identity.syncEpoch
          || current.syncEpoch !== identity.syncEpoch
          || current.generation !== identity.generation) {
          throw new DatabaseError(
            'DATABASE_PROTOCOL_ERROR',
            'Database tenant snapshot session did not match its writer generation.',
            { retryable: false, outcome: null },
          );
        }
        this.options.advanceSequence(entry, result.sequence.seq);
        return Object.freeze({
          databaseRef: entry.databaseRef,
          generation: identity.generation,
          result,
        });
      } catch (caught) {
        const error = safeCoordinatorError(caught);
        this.emitFailure('tenant-snapshot-failed', entry, writer, identity, startedAt, error);
        await this.retireIfTerminal(entry, writer, error);
        throw error;
      }
    });
  }

  pageSnapshot(
    entry: DatabaseCoordinatorEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
      totalRows: number;
    }>,
    cursor: number,
    execution: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<DatabaseTenantSyncSnapshotPage> {
    this.options.assertStarted();
    this.options.assertUsableEntry(entry);
    return this.options.enqueueLane(entry, 'snapshot', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const identity = this.options.requireIdentity(entry, writer);
      if (identity.generation !== session.generation) {
        throw generationChanged();
      }
      const startedAt = this.options.now();
      try {
        const payload = validateDatabaseActorTenantSyncSnapshotPagePayload({
          databaseRef: entry.databaseRef,
          generation: session.generation,
          ownerToken: session.ownerToken,
          sessionId: session.sessionId,
          tables: session.tables,
          cursor,
        }, this.options.operationCatalog);
        const raw = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        const result = validateDatabaseActorTenantSyncSnapshotPageResult(raw, {
          sessionId: session.sessionId,
          cursor: payload.cursor,
          totalRows: session.totalRows,
          tables: session.tables,
        }, this.options.operationCatalog);
        if (this.options.requireIdentity(entry, writer).generation
          !== session.generation) {
          throw generationChanged();
        }
        return Object.freeze({
          cursor: result.cursor,
          rows: result.rows,
          nextCursor: result.nextCursor,
        });
      } catch (caught) {
        const error = safeCoordinatorError(caught);
        this.emitFailure('tenant-snapshot-failed', entry, writer, identity, startedAt, error);
        await this.retireIfTerminal(entry, writer, error);
        throw error;
      }
    });
  }

  async abortSnapshot(
    entry: DatabaseCoordinatorEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
    }>,
    execution: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<void> {
    if (!this.options.isReadySessionGeneration(entry, session.generation)) return;
    await this.options.enqueueLane(entry, 'snapshot', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const identity = this.options.requireIdentity(entry, writer);
      if (identity.generation !== session.generation) return;
      try {
        const payload = validateDatabaseActorTenantSyncSnapshotAbortPayload({
          databaseRef: entry.databaseRef,
          generation: session.generation,
          ownerToken: session.ownerToken,
          sessionId: session.sessionId,
          tables: session.tables,
        }, this.options.operationCatalog);
        const raw = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        validateDatabaseActorTenantSyncSnapshotAbortResult(raw);
      } catch (caught) {
        const error = safeCoordinatorError(caught);
        await this.retireIfTerminal(entry, writer, error);
        throw error;
      }
    });
  }

  replay(
    entry: DatabaseCoordinatorEntry,
    afterSeq: number,
    limit = DATABASE_ACTOR_MAX_REPLAY_CHANGES,
    execution: DatabaseTenantSyncExecutionOptions = {},
  ): Promise<DatabaseTenantSyncReplayResult> {
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
      return this.options.awaitReplacementOpening(
        entry,
        execution,
        'replay',
        () => this.replay(entry, payload.afterSeq, payload.limit, execution),
      );
    }
    this.options.assertUsableEntry(entry);
    return this.options.enqueueLane(entry, 'replay', execution, async () => {
      const writer = this.options.requireWriter(entry);
      const identity = this.options.requireIdentity(entry, writer);
      const startedAt = this.options.now();
      try {
        const raw = await writer.execute({
          operation: DATABASE_ACTOR_OPERATIONS.replay,
          kind: 'read',
          payload: payload as unknown as DatabaseExecutorValue,
        }, {
          timeoutMs: operationTimeout(execution, this.options.operationTimeoutMs),
        });
        const result = validateDatabaseActorReplayResult(raw, payload);
        const current = this.options.requireIdentity(entry, writer);
        if (current.syncEpoch !== identity.syncEpoch
          || current.generation !== identity.generation) {
          throw new DatabaseError(
            'DATABASE_PROTOCOL_ERROR',
            'Database tenant replay crossed a writer generation.',
            { retryable: false, outcome: null },
          );
        }
        this.options.advanceSequence(entry, result.sequence.seq);
        return createDatabaseTenantSyncReplayResult(
          entry.databaseRef,
          identity.syncEpoch,
          identity.generation,
          result.value,
          result.sequence,
        );
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

  private emitFailure(
    type: 'tenant-snapshot-failed',
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
    identity: DatabaseTenantSyncIdentity,
    startedAt: number,
    error: DatabaseError,
  ): void {
    this.options.emit({
      type,
      databaseRef: entry.databaseRef,
      placement: entry.placement.mode,
      role: 'writer',
      slot: entry.slot,
      generation: writer.diagnostics().generation,
      sequenceStart: identity.sequence,
      sequenceEnd: identity.sequence,
      durationMs: elapsed(startedAt, this.options.now()),
      error,
    });
  }

  private async retireIfTerminal(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
    error: DatabaseError,
  ): Promise<void> {
    if (this.options.isTerminalFailure(writer, error)) {
      await this.options.retire(entry, writer, error);
    }
  }
}

function generationChanged(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database tenant snapshot-session generation changed.',
    { retryable: false, outcome: null },
  );
}
