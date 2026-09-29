/**
 * Writer-actor ownership of immutable tenant-Sync snapshot sessions.
 *
 * A begin request copies one exact SQLite read snapshot into bounded TEMP
 * tables and commits before returning across IPC. Later pages read only that
 * immutable materialization, so concurrent application writes cannot mix
 * versions and no SQLite transaction remains open between actor requests.
 */

import type { Statement } from 'bun:sqlite';
import { DatabaseError } from './database-error';
import {
  createDatabaseSequenceToken,
  type DatabaseOperationCatalog,
} from './database-operations';
import type { DatabaseRuntime } from './database-runtime';
import { validateDatabaseTenantSyncStoredSession } from './database-tenant-sync-snapshot-codec';
import {
  databaseTenantSyncSnapshotCapacity,
  databaseTenantSyncSnapshotExpired,
  databaseTenantSyncSnapshotLimit,
  databaseTenantSyncSnapshotSchemaMismatch,
} from './database-tenant-sync-snapshot-errors';
import {
  createDatabaseTenantSyncSnapshotEpochClock,
  normalizeDatabaseTenantSyncSnapshotLimits,
  type DatabaseTenantSyncSnapshotSessionLimits,
} from './database-tenant-sync-snapshot-limits';
import { materializeDatabaseTenantSyncSnapshot } from './database-tenant-sync-snapshot-materializer';
import { buildDatabaseTenantSyncSnapshotPageRows } from './database-tenant-sync-snapshot-page';
import {
  sameDatabaseTenantSyncTables,
  validateDatabaseActorTenantSyncSnapshotAbortResult,
  validateDatabaseActorTenantSyncSnapshotBeginResult,
  validateDatabaseActorTenantSyncSnapshotPageResult,
  type DatabaseActorTenantSyncSnapshotAbortPayload,
  type DatabaseActorTenantSyncSnapshotAbortResult,
  type DatabaseActorTenantSyncSnapshotBeginPayload,
  type DatabaseActorTenantSyncSnapshotBeginResult,
  type DatabaseActorTenantSyncSnapshotPagePayload,
  type DatabaseActorTenantSyncSnapshotPageResult,
} from './database-tenant-sync-snapshot-protocol';
import { DatabaseTenantSyncSnapshotStorage } from './database-tenant-sync-snapshot-storage';

export { createDatabaseTenantSyncSnapshotEpochClock } from './database-tenant-sync-snapshot-limits';
export type { DatabaseTenantSyncSnapshotSessionLimits } from './database-tenant-sync-snapshot-limits';

export interface DatabaseTenantSyncSnapshotSessionStoreOptions {
  readonly runtime: DatabaseRuntime;
  readonly catalog: DatabaseOperationCatalog;
  /** Test seam for deterministic expiry. */
  readonly now?: () => number;
  /** Test-only lower bounds; production defaults remain hard protocol limits. */
  readonly limits?: Partial<DatabaseTenantSyncSnapshotSessionLimits>;
  /** @internal Deterministic statement-cleanup failure seam. */
  readonly finalizeStatement?: (statement: Statement) => void;
}

/** One actor owns one store for the lifetime of its writer binding. */
export class DatabaseTenantSyncSnapshotSessionStore implements Disposable {
  readonly #runtime: DatabaseRuntime;
  readonly #catalog: DatabaseOperationCatalog;
  readonly #now: () => number;
  readonly #limits: DatabaseTenantSyncSnapshotSessionLimits;
  readonly #storage: DatabaseTenantSyncSnapshotStorage;
  #closing = false;
  #closed = false;

  constructor(options: DatabaseTenantSyncSnapshotSessionStoreOptions) {
    this.#runtime = options.runtime;
    this.#catalog = options.catalog;
    this.#now = options.now ?? createDatabaseTenantSyncSnapshotEpochClock();
    this.#limits = normalizeDatabaseTenantSyncSnapshotLimits(options.limits);
    this.#storage = new DatabaseTenantSyncSnapshotStorage(
      this.#runtime,
      options.finalizeStatement ?? ((statement) => statement.finalize()),
    );
  }

  begin(
    payload: DatabaseActorTenantSyncSnapshotBeginPayload,
  ): DatabaseActorTenantSyncSnapshotBeginResult {
    this.#assertOpen();
    const createdAt = this.#now();
    const expiresAt = createdAt + this.#limits.ttlMs;
    if (!Number.isSafeInteger(createdAt)
      || createdAt < 0
      || !Number.isSafeInteger(expiresAt)) {
      throw databaseTenantSyncSnapshotLimit('deadline');
    }
    this.#cleanupExpired(createdAt);
    const active = this.#storage.readActiveStats();
    if (active.sessionCount >= this.#limits.maxSessions) {
      throw databaseTenantSyncSnapshotCapacity();
    }

    const sessionId = crypto.randomUUID().toLowerCase();
    const tableSelectionJson = JSON.stringify(payload.tables);
    const materialized = materializeDatabaseTenantSyncSnapshot({
      runtime: this.#runtime,
      catalog: this.#catalog,
      storage: this.#storage,
      payload,
      sessionId,
      tableSelectionJson,
      createdAt,
      expiresAt,
      activeSourceBytes: active.sourceBytes,
      limits: this.#limits,
      now: this.#now,
    });
    return validateDatabaseActorTenantSyncSnapshotBeginResult({
      sessionId,
      syncEpoch: this.#runtime.db.syncEpoch,
      sequence: createDatabaseSequenceToken(materialized.seq),
      tables: payload.tables,
      totalRows: materialized.totalRows,
      totalSourceBytes: materialized.totalSourceBytes,
      expiresAt,
    }, payload.tables, this.#catalog);
  }

  page(
    payload: DatabaseActorTenantSyncSnapshotPagePayload,
  ): DatabaseActorTenantSyncSnapshotPageResult {
    this.#assertOpen();
    const session = this.#requireSession(payload);
    if (payload.cursor > session.total_rows) {
      throw databaseTenantSyncSnapshotExpired('cursor');
    }
    const rows = buildDatabaseTenantSyncSnapshotPageRows({
      candidates: this.#storage.getPage(
        payload.sessionId,
        payload.cursor,
        this.#limits.pageMaxRows + 1,
      ),
      cursor: payload.cursor,
      tables: payload.tables,
      catalog: this.#catalog,
      limits: this.#limits,
    });
    if (this.#now() >= session.expires_at) {
      this.#storage.deleteSessionRows(payload.sessionId);
      throw databaseTenantSyncSnapshotExpired('deadline');
    }
    const next = payload.cursor + rows.length;
    return validateDatabaseActorTenantSyncSnapshotPageResult({
      sessionId: payload.sessionId,
      cursor: payload.cursor,
      rows,
      nextCursor: next === session.total_rows ? null : next,
    }, {
      sessionId: payload.sessionId,
      cursor: payload.cursor,
      totalRows: session.total_rows,
      tables: payload.tables,
    }, this.#catalog);
  }

  abort(
    payload: DatabaseActorTenantSyncSnapshotAbortPayload,
  ): DatabaseActorTenantSyncSnapshotAbortResult {
    this.#assertOpen();
    const candidate = this.#storage.getSession(payload.sessionId);
    if (!candidate) {
      return validateDatabaseActorTenantSyncSnapshotAbortResult({ aborted: false });
    }
    const session = validateDatabaseTenantSyncStoredSession(candidate);
    this.#assertSessionIdentity(session, payload);
    this.#storage.deleteSessionRows(payload.sessionId);
    return validateDatabaseActorTenantSyncSnapshotAbortResult({ aborted: true });
  }

  close(): void {
    if (this.#closed) return;
    this.#closing = true;
    this.#storage.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #requireSession(
    payload: DatabaseActorTenantSyncSnapshotPagePayload,
  ): ReturnType<typeof validateDatabaseTenantSyncStoredSession> {
    const candidate = this.#storage.getSession(payload.sessionId);
    if (!candidate) throw databaseTenantSyncSnapshotExpired('missing');
    const session = validateDatabaseTenantSyncStoredSession(candidate);
    this.#assertSessionIdentity(session, payload);
    if (this.#now() >= session.expires_at) {
      this.#storage.deleteSessionRows(payload.sessionId);
      throw databaseTenantSyncSnapshotExpired('deadline');
    }
    return session;
  }

  #assertSessionIdentity(
    session: ReturnType<typeof validateDatabaseTenantSyncStoredSession>,
    payload: DatabaseActorTenantSyncSnapshotAbortPayload,
  ): void {
    let tables: unknown;
    try {
      tables = JSON.parse(session.table_selection_json);
    } catch (cause) {
      throw databaseTenantSyncSnapshotSchemaMismatch(cause);
    }
    if (session.owner_token !== payload.ownerToken
      || session.generation !== payload.generation
      || !Array.isArray(tables)
      || !sameDatabaseTenantSyncTables(tables, payload.tables)) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database tenant snapshot-session capability changed.',
        { retryable: false, outcome: null },
      );
    }
  }

  #cleanupExpired(now: number): void {
    for (const sessionId of this.#storage.expiredSessionIds(now)) {
      this.#storage.deleteSessionRows(sessionId);
    }
  }

  #assertOpen(): void {
    if (this.#closing || this.#closed || this.#runtime.diagnostics().closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database tenant snapshot-session store is closed.',
      );
    }
  }
}
