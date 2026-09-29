import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlatformSQLiteService } from '../persistence';
import { DatabaseError } from './database-error';
import { createDatabaseRealmOperationCatalog } from './database-realm';
import { DatabaseRuntime } from './database-runtime';
import {
  DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS,
  DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
  type DatabaseActorTenantSyncSnapshotBeginPayload,
} from './database-tenant-sync-snapshot-protocol';
import {
  createDatabaseTenantSyncSnapshotEpochClock,
  DatabaseTenantSyncSnapshotSessionStore,
} from './database-tenant-sync-snapshot-session';
import type {
  DatabaseTenantSyncSnapshotSessionLimits,
  DatabaseTenantSyncSnapshotSessionStoreOptions,
} from './database-tenant-sync-snapshot-session';
import { databaseActorFixtureRealm as realm } from './test-fixtures/database-actor-realm';

const catalog = createDatabaseRealmOperationCatalog(realm);

function createHarness(
  now?: () => number,
  limits?: Partial<DatabaseTenantSyncSnapshotSessionLimits>,
  finalizeStatement?: DatabaseTenantSyncSnapshotSessionStoreOptions['finalizeStatement'],
) {
  const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
  const runtime = DatabaseRuntime.open({
    id: 'tenant-snapshot-session-tests',
    role: 'named',
    sqlite,
    ownsSQLite: true,
    tables: realm.tables,
  });
  const store = new DatabaseTenantSyncSnapshotSessionStore({
    runtime,
    catalog,
    ...(now ? { now } : {}),
    ...(limits ? { limits } : {}),
    ...(finalizeStatement ? { finalizeStatement } : {}),
  });
  return {
    runtime,
    store,
    close() {
      store.close();
      runtime.close();
    },
  };
}

function beginPayload(
  index = 0,
  tables: readonly string[] = ['todos'],
): DatabaseActorTenantSyncSnapshotBeginPayload {
  return {
    databaseRef: 'db:test' as DatabaseActorTenantSyncSnapshotBeginPayload['databaseRef'],
    generation: 7,
    ownerToken: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    tables,
  };
}

function seed(
  runtime: DatabaseRuntime,
  rows: readonly Readonly<{ id: string; title: string }>[],
): void {
  runtime.db.transaction(() => {
    for (const row of rows) runtime.db.createStrict('todos', row);
  });
}

function captureDatabaseError(run: () => unknown): DatabaseError {
  try {
    run();
    throw new Error('Expected a DatabaseError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
}

describe('DatabaseTenantSyncSnapshotSessionStore', () => {
  test('seals admission and retries only failed statement cleanup', () => {
    const attempts = new Map<object, number>();
    let injectFailure = true;
    const harness = createHarness(undefined, undefined, (statement) => {
      attempts.set(statement, (attempts.get(statement) ?? 0) + 1);
      if (injectFailure) {
        injectFailure = false;
        throw new Error('injected snapshot statement cleanup failure');
      }
      statement.finalize();
    });
    try {
      expect(() => harness.store.close()).toThrow(AggregateError);
      expect(captureDatabaseError(() => harness.store.begin(beginPayload())))
        .toMatchObject({ code: 'DATABASE_CLOSED' });

      harness.store.close();

      expect([...attempts.values()].filter((count) => count === 2)).toHaveLength(1);
      expect([...attempts.values()].filter((count) => count === 1)).toHaveLength(7);
    } finally {
      harness.close();
    }
  });

  test('pages one immutable H snapshot retry-safely across interleaved writes', () => {
    const harness = createHarness();
    try {
      seed(harness.runtime, [
        { id: 'a', title: 'Before A' },
        { id: 'b', title: 'Before B' },
      ]);
      const payload = beginPayload();
      const begun = harness.store.begin(payload);
      harness.runtime.db.transaction(() => {
        harness.runtime.db.update('todos', 'a', { title: 'After A' });
        harness.runtime.db.createStrict('todos', { id: 'c', title: 'After C' });
      });
      const pagePayload = {
        ...payload,
        sessionId: begun.sessionId,
        cursor: 0,
      };
      const first = harness.store.page(pagePayload);

      expect(begun).toMatchObject({
        sequence: { seq: 2 },
        totalRows: 2,
        tables: ['todos'],
      });
      expect(first).toMatchObject({
        cursor: 0,
        nextCursor: null,
        rows: [
          { ordinal: 0, rowId: 'a', row: { id: 'a', title: 'Before A' } },
          { ordinal: 1, rowId: 'b', row: { id: 'b', title: 'Before B' } },
        ],
      });
      expect(harness.store.page(pagePayload)).toEqual(first);
      expect(harness.runtime.db.get('todos', 'a')).toMatchObject({ title: 'After A' });
      expect(harness.runtime.db.get('todos', 'c')).toMatchObject({ title: 'After C' });
      expect(harness.store.abort({
        ...payload,
        sessionId: begun.sessionId,
      })).toEqual({ aborted: true });
      expect(captureDatabaseError(() => harness.store.page(pagePayload))).toMatchObject({
        code: 'DATABASE_TRANSACTION_EXPIRED',
        details: { snapshotReason: 'missing' },
      });
    } finally {
      harness.close();
    }
  });

  test('fails closed at the hard active-session quota without harming old sessions', () => {
    const harness = createHarness();
    try {
      const sessions = Array.from(
        { length: DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS },
        (_, index) => {
          const payload = beginPayload(index, []);
          return { payload, result: harness.store.begin(payload) };
        },
      );
      expect(captureDatabaseError(() => harness.store.begin(
        beginPayload(DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS, []),
      ))).toMatchObject({
        code: 'DATABASE_BACKPRESSURE',
        retryable: true,
        outcome: 'not-started',
        details: { snapshotReason: 'sessions' },
      });
      const first = sessions[0]!;
      expect(harness.store.page({
        ...first.payload,
        sessionId: first.result.sessionId,
        cursor: 0,
      })).toMatchObject({ rows: [], nextCursor: null });
      harness.store.abort({
        ...first.payload,
        sessionId: first.result.sessionId,
      });
      expect(harness.store.begin(
        beginPayload(DATABASE_TENANT_SYNC_SNAPSHOT_MAX_SESSIONS, []),
      )).toMatchObject({ totalRows: 0 });
    } finally {
      harness.close();
    }
  });

  test('distinguishes transient aggregate-byte pressure from an oversized snapshot', () => {
    const harness = createHarness(undefined, {
      maxSourceBytes: 800,
      maxSourceRowBytes: 800,
    });
    try {
      seed(harness.runtime, [{ id: 'a', title: 'x'.repeat(500) }]);
      const firstPayload = beginPayload();
      const first = harness.store.begin(firstPayload);
      expect(captureDatabaseError(() => harness.store.begin(beginPayload(1))))
        .toMatchObject({
          code: 'DATABASE_BACKPRESSURE',
          retryable: true,
          outcome: 'not-started',
          details: { snapshotReason: 'bytes' },
        });
      harness.store.abort({
        ...firstPayload,
        sessionId: first.sessionId,
      });
      seed(harness.runtime, [{ id: 'b', title: 'y'.repeat(500) }]);
      expect(captureDatabaseError(() => harness.store.begin(beginPayload(2))))
        .toMatchObject({
          code: 'DATABASE_PAYLOAD_LIMIT',
          retryable: false,
          details: { snapshotReason: 'bytes' },
        });
    } finally {
      harness.close();
    }
  });

  test('binds pages and aborts to the owner, generation, and exact table selection', () => {
    const harness = createHarness();
    try {
      seed(harness.runtime, [{ id: 'a', title: 'A' }]);
      const payload = beginPayload();
      const begun = harness.store.begin(payload);
      const wrongOwner = beginPayload(1);
      expect(captureDatabaseError(() => harness.store.page({
        ...wrongOwner,
        sessionId: begun.sessionId,
        cursor: 0,
      }))).toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
      expect(captureDatabaseError(() => harness.store.abort({
        ...payload,
        generation: 8,
        sessionId: begun.sessionId,
      }))).toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
      expect(harness.store.page({
        ...payload,
        sessionId: begun.sessionId,
        cursor: 0,
      })).toMatchObject({ rows: [{ rowId: 'a' }] });
    } finally {
      harness.close();
    }
  });

  test('expires at the absolute deadline and removes the retained materialization', () => {
    let now = 1_000;
    const harness = createHarness(() => now);
    try {
      seed(harness.runtime, [{ id: 'a', title: 'A' }]);
      const payload = beginPayload();
      const begun = harness.store.begin(payload);
      now += DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS + 1;
      expect(captureDatabaseError(() => harness.store.page({
        ...payload,
        sessionId: begun.sessionId,
        cursor: 0,
      }))).toMatchObject({
        code: 'DATABASE_TRANSACTION_EXPIRED',
        details: { snapshotReason: 'deadline' },
      });
      expect(harness.store.abort({
        ...payload,
        sessionId: begun.sessionId,
      })).toEqual({ aborted: false });
    } finally {
      harness.close();
    }
  });

  test('uses monotonic elapsed time when the wall clock moves backward', () => {
    let wallNow = 1_000_000;
    let monotonicNow = 50;
    const now = createDatabaseTenantSyncSnapshotEpochClock(
      () => wallNow,
      () => monotonicNow,
    );
    const harness = createHarness(now);
    try {
      const payload = beginPayload(0, []);
      const begun = harness.store.begin(payload);
      expect(begun.expiresAt).toBe(
        1_000_000 + DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS,
      );

      wallNow -= 3_600_000;
      monotonicNow += DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS + 1;

      expect(captureDatabaseError(() => harness.store.page({
        ...payload,
        sessionId: begun.sessionId,
        cursor: 0,
      }))).toMatchObject({
        code: 'DATABASE_TRANSACTION_EXPIRED',
        details: { snapshotReason: 'deadline' },
      });
    } finally {
      harness.close();
    }
  });

  test('rolls back partial materialization when the absolute deadline expires', () => {
    let calls = 0;
    const harness = createHarness(() => {
      calls += 1;
      return calls === 1 ? 1_000 : 1_000 + DATABASE_TENANT_SYNC_SNAPSHOT_TTL_MS + 1;
    });
    try {
      seed(harness.runtime, [{ id: 'a', title: 'A' }]);
      expect(captureDatabaseError(() => harness.store.begin(beginPayload())))
        .toMatchObject({
          code: 'DATABASE_TRANSACTION_EXPIRED',
          details: { snapshotReason: 'deadline' },
        });
      expect(harness.runtime.sqlite.raw.query(
        'SELECT count(*) AS count FROM temp._zero_tenant_sync_snapshot_sessions',
      ).get()).toEqual({ count: 0 });
      expect(harness.runtime.sqlite.raw.query(
        'SELECT count(*) AS count FROM temp._zero_tenant_sync_snapshot_rows',
      ).get()).toEqual({ count: 0 });
    } finally {
      harness.close();
    }
  });

  test('rolls back every TEMP row when one source row exceeds its hard byte bound', () => {
    const harness = createHarness();
    try {
      seed(harness.runtime, [{ id: 'oversized', title: 'x'.repeat(1_048_576) }]);
      expect(captureDatabaseError(() => harness.store.begin(beginPayload()))).toMatchObject({
        code: 'DATABASE_PAYLOAD_LIMIT',
        details: { snapshotReason: 'row-bytes' },
      });
      const sessions = harness.runtime.sqlite.raw.query(
        'SELECT count(*) AS count FROM temp._zero_tenant_sync_snapshot_sessions',
      ).get() as { count: number };
      const rows = harness.runtime.sqlite.raw.query(
        'SELECT count(*) AS count FROM temp._zero_tenant_sync_snapshot_rows',
      ).get() as { count: number };
      expect(sessions.count).toBe(0);
      expect(rows.count).toBe(0);
    } finally {
      harness.close();
    }
  });

  test('rejects incompatible private TEMP schema rather than trusting it', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const runtime = DatabaseRuntime.open({
      id: 'tenant-snapshot-corrupt-schema',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: realm.tables,
    });
    try {
      runtime.sqlite.raw.run(`
        CREATE TEMP TABLE _zero_tenant_sync_snapshot_sessions (
          session_id TEXT PRIMARY KEY
        ) STRICT, WITHOUT ROWID
      `);
      expect(captureDatabaseError(() => new DatabaseTenantSyncSnapshotSessionStore({
        runtime,
        catalog,
      }))).toMatchObject({ code: 'DATABASE_SCHEMA_MISMATCH' });
    } finally {
      runtime.close();
    }
  });

  test('drops every old capability across a file actor restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zero-snapshot-session-'));
    const path = join(directory, 'tenant.sqlite');
    let firstRuntime: DatabaseRuntime | null = null;
    let firstStore: DatabaseTenantSyncSnapshotSessionStore | null = null;
    let secondRuntime: DatabaseRuntime | null = null;
    let secondStore: DatabaseTenantSyncSnapshotSessionStore | null = null;
    try {
      firstRuntime = openFileRuntime(path);
      firstStore = new DatabaseTenantSyncSnapshotSessionStore({
        runtime: firstRuntime,
        catalog,
      });
      seed(firstRuntime, [{ id: 'durable', title: 'Durable' }]);
      const payload = beginPayload();
      const begun = firstStore.begin(payload);
      firstStore.close();
      firstStore = null;
      firstRuntime.close();
      firstRuntime = null;

      secondRuntime = openFileRuntime(path);
      secondStore = new DatabaseTenantSyncSnapshotSessionStore({
        runtime: secondRuntime,
        catalog,
      });
      expect(captureDatabaseError(() => secondStore!.page({
        ...payload,
        sessionId: begun.sessionId,
        cursor: 0,
      }))).toMatchObject({
        code: 'DATABASE_TRANSACTION_EXPIRED',
        details: { snapshotReason: 'missing' },
      });
      expect(secondStore.begin(beginPayload(1))).toMatchObject({
        totalRows: 1,
      });
    } finally {
      try { firstStore?.close(); } catch { /* Preserve test failure. */ }
      try { firstRuntime?.close(); } catch { /* Preserve test failure. */ }
      try { secondStore?.close(); } catch { /* Preserve test failure. */ }
      try { secondRuntime?.close(); } catch { /* Preserve test failure. */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function openFileRuntime(path: string): DatabaseRuntime {
  const sqlite = createPlatformSQLiteService({ mode: 'file', path });
  return DatabaseRuntime.open({
    id: 'tenant-snapshot-session-file-test',
    role: 'named',
    sqlite,
    ownsSQLite: true,
    tables: realm.tables,
  });
}
