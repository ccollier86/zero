/**
 * Bound coordinator capabilities handed to callers and persistent tenant Sync.
 * These adapters never expose mutable entry state, actor handles, or paths.
 */

import type { DatabaseCommitAuthority } from './database-commit-authority';
import type {
  DatabaseCoordinatorLease,
  DatabaseExecutionOptions,
} from './database-coordinator-contract';
import type {
  DatabaseCoordinatorEntry,
  DatabaseCoordinatorSyncBindingHandle,
} from './database-coordinator-entry';
import { DatabaseError } from './database-error';
import type {
  AsyncDatabaseClient,
  AsyncDatabaseOperationExecutor,
  DatabaseCommitResult,
  DatabaseReadResult,
  DatabaseSequenceToken,
} from './database-operations';
import { createAsyncDatabaseClient } from './database-client';
import type {
  DatabaseTenantSyncBinding,
  DatabaseTenantSyncExecutionOptions,
  DatabaseTenantSyncReplayResult,
  DatabaseTenantSyncSnapshotPage,
  DatabaseTenantSyncSnapshotSession,
  DatabaseTenantSyncWakeup,
  DatabaseTenantSyncWakeupListener,
} from './database-tenant-sync';
import type { DatabaseActorTenantSyncSnapshotBeginResult } from './database-tenant-sync-snapshot-protocol';
import type {
  DatabaseLogicalReceiptFingerprint,
  DatabaseTrustedReceiptExecutionOptions,
  DatabaseTrustedReceiptLookup,
  DatabaseTrustedWriteExecutionOptions,
  DatabaseTrustedWriteExecutor,
} from './database-trusted-writer';
import type { DatabaseWriterCommitValue } from './database-writer-engine';

export interface CoordinatorTenantSyncSnapshotStart {
  readonly databaseRef: DatabaseCoordinatorEntry['databaseRef'];
  readonly generation: number;
  readonly result: DatabaseActorTenantSyncSnapshotBeginResult;
}

/** Narrow host boundary implemented by DatabaseCoordinator. */
export interface DatabaseCoordinatorCapabilityHost {
  execute(
    entry: DatabaseCoordinatorEntry,
    value: unknown,
    options?: DatabaseExecutionOptions,
    commitAuthority?: DatabaseCommitAuthority | null,
  ): Promise<DatabaseReadResult | DatabaseCommitResult>;
  executeTrustedWrite(
    entry: DatabaseCoordinatorEntry,
    value: unknown,
    options: DatabaseTrustedWriteExecutionOptions,
    commitAuthority: DatabaseCommitAuthority | null,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>>;
  findTrustedReceipt(
    entry: DatabaseCoordinatorEntry,
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    options?: DatabaseTrustedReceiptExecutionOptions,
  ): Promise<DatabaseTrustedReceiptLookup>;
  replay(
    entry: DatabaseCoordinatorEntry,
    afterSeq: number,
    limit?: number,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult>;
  beginTenantSyncSnapshot(
    entry: DatabaseCoordinatorEntry,
    ownerToken: string,
    tables: readonly string[],
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<CoordinatorTenantSyncSnapshotStart>;
  pageTenantSyncSnapshot(
    entry: DatabaseCoordinatorEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
      totalRows: number;
    }>,
    cursor: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotPage>;
  abortTenantSyncSnapshot(
    entry: DatabaseCoordinatorEntry,
    session: Readonly<{
      generation: number;
      ownerToken: string;
      sessionId: string;
      tables: readonly string[];
    }>,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<void>;
  replayTenantSync(
    entry: DatabaseCoordinatorEntry,
    afterSeq: number,
    limit?: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncReplayResult>;
  releaseEntry(entry: DatabaseCoordinatorEntry): void;
  cancelTenantSyncBindingReservation(entry: DatabaseCoordinatorEntry): void;
  activateTenantSyncBinding(
    entry: DatabaseCoordinatorEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void;
  releaseTenantSyncBinding(
    entry: DatabaseCoordinatorEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void;
  assertTenantSyncAuthority(
    entry: DatabaseCoordinatorEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ): undefined;
}

export class CoordinatorLease implements DatabaseCoordinatorLease {
  #active = true;
  readonly #coordinator: DatabaseCoordinatorCapabilityHost;
  readonly #entry: DatabaseCoordinatorEntry;
  readonly #commitAuthority: DatabaseCommitAuthority | null;
  readonly #trustedWriter: DatabaseTrustedWriteExecutor;

  constructor(
    coordinator: DatabaseCoordinatorCapabilityHost,
    entry: DatabaseCoordinatorEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ) {
    this.#coordinator = coordinator;
    this.#entry = entry;
    this.#commitAuthority = commitAuthority;
    this.#trustedWriter = new CoordinatorTrustedWriter(this);
  }

  get databaseRef(): DatabaseCoordinatorEntry['databaseRef'] {
    return this.#entry.databaseRef;
  }
  get trustedWriter(): DatabaseTrustedWriteExecutor { return this.#trustedWriter; }
  get released(): boolean { return !this.#active; }

  tenantSyncReservedEntry(): DatabaseCoordinatorEntry {
    return this.#entry;
  }

  assertTenantSyncAuthority(): undefined {
    this.assertActive();
    return this.#coordinator.assertTenantSyncAuthority(
      this.#entry,
      this.#commitAuthority,
    );
  }

  executeTrustedWrite(
    operation: unknown,
    options: DatabaseTrustedWriteExecutionOptions,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>> {
    this.assertActive();
    return this.#coordinator.executeTrustedWrite(
      this.#entry,
      operation,
      options,
      this.#commitAuthority,
    );
  }

  findTrustedReceipt(
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    options?: DatabaseTrustedReceiptExecutionOptions,
  ): Promise<DatabaseTrustedReceiptLookup> {
    this.assertActive();
    return this.#coordinator.findTrustedReceipt(
      this.#entry,
      idempotencyKey,
      logicalReceiptFingerprint,
      options,
    );
  }

  execute(
    operation: unknown,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult | DatabaseCommitResult> {
    this.assertActive();
    return this.#coordinator.execute(
      this.#entry,
      operation,
      options,
      this.#commitAuthority,
    );
  }

  replay(
    afterSeq: number,
    limit?: number,
    options?: DatabaseExecutionOptions,
  ): Promise<DatabaseReadResult> {
    this.assertActive();
    return this.#coordinator.replay(this.#entry, afterSeq, limit, options);
  }

  release(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#coordinator.releaseEntry(this.#entry);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.release();
  }

  private assertActive(): void {
    if (!this.#active) {
      throw new DatabaseError('DATABASE_CLOSED', 'Database capability was released.');
    }
  }
}

class CoordinatorTrustedWriter implements DatabaseTrustedWriteExecutor {
  readonly #lease: CoordinatorLease;

  constructor(lease: CoordinatorLease) {
    this.#lease = lease;
    Object.freeze(this);
  }

  async findReceipt(
    idempotencyKey: string,
    logicalReceiptFingerprint: DatabaseLogicalReceiptFingerprint,
    options?: DatabaseTrustedReceiptExecutionOptions,
  ): Promise<DatabaseTrustedReceiptLookup> {
    this.#lease.assertTenantSyncAuthority();
    const result = await this.#lease.findTrustedReceipt(
      idempotencyKey,
      logicalReceiptFingerprint,
      options,
    );
    this.#lease.assertTenantSyncAuthority();
    return result;
  }

  executeWrite(
    operation: unknown,
    options: DatabaseTrustedWriteExecutionOptions,
  ): Promise<DatabaseCommitResult<DatabaseWriterCommitValue>> {
    this.#lease.assertTenantSyncAuthority();
    return this.#lease.executeTrustedWrite(operation, options);
  }
}

export class CoordinatorTenantSyncBinding
implements DatabaseTenantSyncBinding, DatabaseCoordinatorSyncBindingHandle {
  readonly #coordinator: DatabaseCoordinatorCapabilityHost;
  readonly #entry: DatabaseCoordinatorEntry;
  readonly #lease: CoordinatorLease;
  readonly #client: AsyncDatabaseClient;
  readonly #assertReadAuthority: (() => undefined) | null;
  readonly #listeners = new Set<DatabaseTenantSyncWakeupListener>();
  readonly #snapshotSessions = new Set<CoordinatorTenantSyncSnapshotSession>();
  readonly #snapshotOwnerToken = crypto.randomUUID().toLowerCase();
  #active = true;

  constructor(
    coordinator: DatabaseCoordinatorCapabilityHost,
    entry: DatabaseCoordinatorEntry,
    lease: CoordinatorLease,
    assertReadAuthority: (() => undefined) | null,
  ) {
    this.#coordinator = coordinator;
    this.#entry = entry;
    this.#lease = lease;
    this.#assertReadAuthority = assertReadAuthority;
    const executor: AsyncDatabaseOperationExecutor = {
      execute: (operation, options) => lease.execute(operation, options),
    } as AsyncDatabaseOperationExecutor;
    this.#client = createAsyncDatabaseClient({
      executor,
      assertReadAuthority: () => this.assertClientReadAuthority(),
    });
    Object.preventExtensions(this);
    coordinator.activateTenantSyncBinding(entry, this);
  }

  get databaseRef(): DatabaseCoordinatorEntry['databaseRef'] {
    return this.#entry.databaseRef;
  }
  get client(): AsyncDatabaseClient { return this.#client; }
  get trustedWriter(): DatabaseTrustedWriteExecutor {
    return this.#lease.trustedWriter;
  }
  get released(): boolean { return !this.#active; }

  async beginSnapshot(
    tables: readonly string[],
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotSession> {
    this.assertActive();
    this.assertCurrentReadAuthority('not-started');
    const start = await this.#coordinator.beginTenantSyncSnapshot(
      this.#entry,
      this.#snapshotOwnerToken,
      tables,
      options,
    );
    try {
      this.assertActive();
      this.assertCurrentReadAuthority(null);
      const session = new CoordinatorTenantSyncSnapshotSession(
        this,
        start,
        this.#snapshotOwnerToken,
      );
      this.#snapshotSessions.add(session);
      return session;
    } catch (error) {
      void this.#coordinator.abortTenantSyncSnapshot(this.#entry, {
        generation: start.generation,
        ownerToken: this.#snapshotOwnerToken,
        sessionId: start.result.sessionId,
        tables: start.result.tables,
      }).catch(() => undefined);
      throw error;
    }
  }

  async replay(
    afterSeq: number,
    limit?: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncReplayResult> {
    this.assertActive();
    this.assertCurrentReadAuthority('not-started');
    const result = await this.#coordinator.replayTenantSync(
      this.#entry,
      afterSeq,
      limit,
      options,
    );
    this.assertCurrentReadAuthority(null);
    return result;
  }

  onWakeup(listener: DatabaseTenantSyncWakeupListener): () => void {
    this.assertActive();
    if (typeof listener !== 'function') {
      throw new TypeError('Database tenant Sync listener must be a function.');
    }
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  notify(wakeup: DatabaseTenantSyncWakeup): void {
    if (!this.#active) return;
    if (wakeup.type === 'reset' || wakeup.type === 'unavailable') {
      for (const session of [...this.#snapshotSessions]) {
        session.releaseFromBinding();
      }
      this.#snapshotSessions.clear();
    }
    for (const listener of [...this.#listeners]) {
      try {
        const returned = listener(wakeup) as unknown;
        if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned).catch(() => undefined);
        }
      } catch {
        // A Sync consumer cannot alter commit success or other subscribers.
      }
    }
  }

  release(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#listeners.clear();
    for (const session of [...this.#snapshotSessions]) {
      session.releaseFromBinding();
    }
    this.#snapshotSessions.clear();
    this.#coordinator.releaseTenantSyncBinding(this.#entry, this);
    this.#lease.release();
  }

  coordinatorClosed(): void {
    this.notify(Object.freeze({
      type: 'unavailable',
      databaseRef: this.#entry.databaseRef,
    }));
    this.release();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.release();
  }

  private assertCurrentReadAuthority(
    outcome: 'not-started' | null,
  ): undefined {
    this.#lease.assertTenantSyncAuthority();
    if (!this.#assertReadAuthority) return undefined;

    let result: unknown;
    try {
      result = this.#assertReadAuthority();
    } catch {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database tenant Sync read authority changed during execution.',
        { retryable: false, outcome },
      );
    }
    if (result !== undefined) {
      // Runtime JavaScript can bypass the synchronous TypeScript contract.
      void Promise.resolve(result).catch(() => undefined);
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database tenant Sync read-authority checks must be synchronous.',
        { retryable: false, outcome },
      );
    }
    return undefined;
  }

  private assertClientReadAuthority(): undefined {
    this.#lease.assertTenantSyncAuthority();
    return this.#assertReadAuthority?.();
  }

  private assertActive(): void {
    if (!this.#active) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database tenant Sync capability was released.',
      );
    }
  }

  async pageSnapshotSession(
    session: CoordinatorTenantSyncSnapshotSession,
    cursor: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotPage> {
    this.assertActive();
    if (!this.#snapshotSessions.has(session)) {
      throw missingSnapshotSession();
    }
    this.assertCurrentReadAuthority('not-started');
    const result = await this.#coordinator.pageTenantSyncSnapshot(
      this.#entry,
      session,
      cursor,
      options,
    );
    this.assertCurrentReadAuthority(null);
    return result;
  }

  async abortSnapshotSession(
    session: CoordinatorTenantSyncSnapshotSession,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<void> {
    this.#snapshotSessions.delete(session);
    await this.#coordinator.abortTenantSyncSnapshot(
      this.#entry,
      session,
      options,
    );
  }
}

class CoordinatorTenantSyncSnapshotSession
implements DatabaseTenantSyncSnapshotSession {
  readonly databaseRef: DatabaseCoordinatorEntry['databaseRef'];
  readonly generation: number;
  readonly syncEpoch: string;
  readonly sequence: DatabaseSequenceToken;
  readonly tables: readonly string[];
  readonly totalRows: number;
  readonly totalSourceBytes: number;
  readonly expiresAt: number;
  readonly ownerToken: string;
  readonly sessionId: string;
  readonly #binding: CoordinatorTenantSyncBinding;
  #aborted = false;
  #abortTask: Promise<void> | null = null;

  constructor(
    binding: CoordinatorTenantSyncBinding,
    start: CoordinatorTenantSyncSnapshotStart,
    ownerToken: string,
  ) {
    this.#binding = binding;
    this.databaseRef = start.databaseRef;
    this.generation = start.generation;
    this.syncEpoch = start.result.syncEpoch;
    this.sequence = start.result.sequence;
    this.tables = start.result.tables;
    this.totalRows = start.result.totalRows;
    this.totalSourceBytes = start.result.totalSourceBytes;
    this.expiresAt = start.result.expiresAt;
    this.ownerToken = ownerToken;
    this.sessionId = start.result.sessionId;
    Object.preventExtensions(this);
  }

  get aborted(): boolean { return this.#aborted; }

  page(
    cursor: number,
    options?: DatabaseTenantSyncExecutionOptions,
  ): Promise<DatabaseTenantSyncSnapshotPage> {
    if (this.#aborted) throw missingSnapshotSession();
    return this.#binding.pageSnapshotSession(this, cursor, options);
  }

  async abort(options?: DatabaseTenantSyncExecutionOptions): Promise<void> {
    if (this.#aborted) return;
    if (this.#abortTask) return this.#abortTask;
    const task = this.#binding.abortSnapshotSession(this, options).then(() => {
      this.#aborted = true;
    });
    this.#abortTask = task;
    try {
      await task;
    } finally {
      if (this.#abortTask === task) this.#abortTask = null;
    }
  }

  releaseFromBinding(): void {
    if (this.#aborted) return;
    this.#aborted = true;
    void this.#binding.abortSnapshotSession(this).catch(() => undefined);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.abort();
  }
}

function missingSnapshotSession(): DatabaseError {
  return new DatabaseError(
    'DATABASE_TRANSACTION_EXPIRED',
    'Database tenant snapshot session is unavailable.',
    {
      retryable: false,
      outcome: null,
      details: { snapshotReason: 'missing' },
    },
  );
}
