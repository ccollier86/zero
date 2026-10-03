import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { identityAnchorReactiveTableSchemas } from '../auth/identity-projection-reactive-schema';
import { defineIdentityAnchorSQLiteTables } from '../auth/identity-projection-schema';
import { createPlatformSQLiteService } from '../persistence';
import type { Migration } from '../migrations';
import { DatabaseError } from './database-error';
import { composeDatabaseRealm } from './database-realm-composition';
import { defineDatabaseRealm } from './database-realm';
import { DatabaseRuntime } from './database-runtime';

describe('DatabaseRuntime', () => {
  test('registers only required Guardian anchor projections with ReactiveDB', () => {
    const userSqlite = createPlatformSQLiteService({ mode: 'memory' });
    defineIdentityAnchorSQLiteTables(userSqlite.raw);
    const userRuntime = DatabaseRuntime.open({
      id: 'user-anchor-projection',
      role: 'named',
      sqlite: userSqlite,
      ownsSQLite: true,
      tables: identityAnchorReactiveTableSchemas(['user']),
    });
    try {
      expect(userRuntime.db.get('users', 'missing-user')).toBeNull();
      expect(() => userRuntime.db.get('tenant_memberships', 'missing-membership'))
        .toThrow("Table 'tenant_memberships' is not defined");
    } finally {
      userRuntime.close();
    }

    const membershipSqlite = createPlatformSQLiteService({ mode: 'memory' });
    defineIdentityAnchorSQLiteTables(membershipSqlite.raw);
    membershipSqlite.raw.run('INSERT INTO users (user_id) VALUES (?)', ['user-one']);
    membershipSqlite.raw.run(`
      INSERT INTO tenant_memberships (membership_id, tenant_id, user_id)
      VALUES (?, ?, ?)
    `, ['membership-one', 'tenant-one', 'user-one']);
    const membershipRuntime = DatabaseRuntime.open({
      id: 'membership-anchor-projection',
      role: 'named',
      sqlite: membershipSqlite,
      ownsSQLite: true,
      tables: identityAnchorReactiveTableSchemas(['user', 'membership']),
    });
    try {
      expect(membershipRuntime.db.get('users', 'user-one')).toEqual({
        user_id: 'user-one',
      });
      expect(membershipRuntime.db.get(
        'tenant_memberships',
        'membership-one',
      )).toEqual({
        membership_id: 'membership-one',
        tenant_id: 'tenant-one',
        user_id: 'user-one',
      });
    } finally {
      membershipRuntime.close();
    }
  });

  test('opens composed realm tables in deterministic foreign-key dependency order', () => {
    const realm = composeDatabaseRealm({
      name: 'runtime-foreign-key-order',
      version: '1',
      contributions: [{
        name: 'dependant',
        version: '1',
        tables: {
          a_children: {
            id: 'text primary key',
            parent_id: 'text references z_parents(id) on delete restrict not null',
          },
        },
      }, {
        name: 'parent',
        version: '1',
        tables: { z_parents: { id: 'text primary key' } },
      }],
    });
    const runtime = DatabaseRuntime.open({
      id: 'composed-foreign-key-order',
      role: 'named',
      sqlite: createPlatformSQLiteService({ mode: 'memory' }),
      ownsSQLite: true,
      tables: realm.tables,
    });
    try {
      runtime.db.insert('z_parents', { id: 'parent-one' });
      expect(runtime.db.insert('a_children', {
        id: 'child-one',
        parent_id: 'parent-one',
      })).toMatchObject({
        op: 'INSERT',
        row: { id: 'child-one', parent_id: 'parent-one' },
      });
    } finally {
      runtime.close();
    }
  });

  test('orders every direct realm across quoted and repeated foreign-key references', () => {
    const realm = defineDatabaseRealm({
      name: 'direct-foreign-key-order',
      version: '1',
      tables: {
        a_quoted_children: {
          id: 'text primary key',
          parent_id: "text default 'references fake_parent(id)' "
            + "/* references fake_parent(id) */ references 'z_parents'(id) "
            + 'on delete restrict not null',
        },
        b_multiple_children: {
          id: 'text primary key',
          parent_id: 'text references external_parents(id) references z_parents(id) not null',
        },
        z_parents: { id: 'text primary key' },
      },
    });
    expect(Object.keys(realm.tables)).toEqual([
      'z_parents',
      'a_quoted_children',
      'b_multiple_children',
    ]);

    const sqlite = createPlatformSQLiteService({ mode: 'memory' });
    sqlite.raw.run('CREATE TABLE external_parents (id TEXT PRIMARY KEY)');
    const runtime = DatabaseRuntime.open({
      id: 'direct-foreign-key-order',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: realm.tables,
    });
    try {
      runtime.sqlite.raw.run(
        'INSERT INTO external_parents (id) VALUES (?)',
        ['parent-one'],
      );
      runtime.db.createStrict('z_parents', { id: 'parent-one' });
      runtime.db.createStrict('a_quoted_children', {
        id: 'quoted-child',
        parent_id: 'parent-one',
      });
      runtime.db.createStrict('b_multiple_children', {
        id: 'multiple-child',
        parent_id: 'parent-one',
      });
    } finally {
      runtime.close();
    }
  });

  test('preserves migration-created external foreign-key parents', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-external-parent-'));
    const path = join(root, 'external-parent.sqlite');
    const realm = composeDatabaseRealm({
      name: 'runtime-external-foreign-key',
      version: '1',
      contributions: [{
        name: 'records',
        version: '1',
        migrations: [{
          version: '001_external_parent',
          description: 'Create external realm support table',
          up(database) {
            database.run('CREATE TABLE external_parents (id TEXT PRIMARY KEY)');
          },
        }],
        tables: {
          records: {
            id: 'text primary key',
            parent_id: 'text references external_parents(id) on delete restrict not null',
          },
        },
      }],
    });

    try {
      const runtime = DatabaseRuntime.open({
        id: 'composed-external-foreign-key',
        role: 'named',
        sqlite: createPlatformSQLiteService({ mode: 'file', path }),
        ownsSQLite: true,
        migrate: true,
        migrations: realm.migrations,
        tables: realm.tables,
      });
      try {
        runtime.sqlite.raw.run(
          'INSERT INTO external_parents (id) VALUES (?)',
          ['parent-one'],
        );
        expect(runtime.db.insert('records', {
          id: 'record-one',
          parent_id: 'parent-one',
        })).toMatchObject({ op: 'INSERT' });
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('owns one ReactiveDB and preserves per-file rows and sequence state', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-runtime-'));
    const path = join(root, 'app.sqlite');

    try {
      const first = DatabaseRuntime.open({
        id: 'app',
        role: 'named',
        sqlite: createPlatformSQLiteService({ mode: 'file', path }),
        ownsSQLite: true,
        tables: { notes: { id: 'text primary key', body: 'text not null' } },
      });
      first.start();
      const change = first.db.insert('notes', { id: 'same-id', body: 'persisted' });
      expect(change.seq).toBe(1);
      expect(first.diagnostics()).toMatchObject({
        id: 'app',
        role: 'named',
        started: true,
        closed: false,
        sqlite: { mode: 'file', path },
      });
      first.close();

      const reopened = DatabaseRuntime.open({
        id: 'app',
        role: 'named',
        sqlite: createPlatformSQLiteService({ mode: 'file', path }),
        ownsSQLite: true,
        tables: { notes: { id: 'text primary key', body: 'text not null' } },
      });
      try {
        expect(reopened.db.get('notes', 'same-id')).toEqual({
          id: 'same-id',
          body: 'persisted',
        });
        expect(reopened.db.currentSeq).toBe(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('runs the database-specific migration registry before ReactiveDB opens', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-migration-'));
    const path = join(root, 'migrated.sqlite');
    const migration: Migration = {
      version: '001',
      description: 'named database marker',
      up(db) {
        db.run('CREATE TABLE named_marker (id TEXT PRIMARY KEY)');
      },
    };

    try {
      const runtime = DatabaseRuntime.open({
        id: 'migrated',
        role: 'named',
        sqlite: createPlatformSQLiteService({ mode: 'file', path }),
        ownsSQLite: true,
        migrate: true,
        migrations: [migration],
      });
      try {
        expect(runtime.sqlite.raw.query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'named_marker'",
        ).get()).toEqual({ name: 'named_marker' });
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('classifies a failed post-migration snapshot as retryable storage open failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-hot-migration-'));
    const snapshotPath = join(root, 'migrated.snapshot.sqlite');
    const sqlite = createPlatformSQLiteService({
      mode: 'hot',
      path: join(root, 'migrated.sqlite'),
      snapshotPath,
    });
    const migration: Migration = {
      version: '001',
      description: 'hot migration marker',
      up(db) {
        db.run('CREATE TABLE hot_migration_marker (id TEXT PRIMARY KEY)');
      },
    };
    const snapshot = sqlite.snapshot!;
    const snapshotSync = snapshot.snapshotSyncDetailed.bind(snapshot);
    let calls = 0;
    snapshot.snapshotSyncDetailed = () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 'failed',
          durable: false,
          error: new Error('injected migration snapshot failure'),
        };
      }
      return snapshotSync();
    };

    try {
      const error = captureDatabaseError(() => DatabaseRuntime.open({
        id: 'hot-migration',
        role: 'named',
        sqlite,
        ownsSQLite: true,
        migrate: true,
        migrations: [migration],
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_OPEN_FAILED',
        retryable: true,
        outcome: 'not-started',
        details: { phase: 'durability' },
      });
      expect(error.message).toBe('Database migration durability could not be established.');
      expect(error.message).not.toContain(snapshotPath);
      // Startup rejection discards the in-memory image and never publishes a
      // second snapshot through graceful-close cleanup.
      expect(calls).toBe(1);
      expect(existsSync(snapshotPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reapplies the captured hot page budget after migration code raises it', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-hot-limit-'));
    const maxBytes = 256 * 1_024;
    const migration: Migration = {
      version: '001',
      description: 'attempt to widen hot page budget',
      up(db) {
        db.run('PRAGMA max_page_count = 1000000');
        db.run('CREATE TABLE hot_limit_marker (id TEXT PRIMARY KEY)');
      },
    };

    try {
      const runtime = DatabaseRuntime.open({
        id: 'hot-limit',
        role: 'named',
        sqlite: createPlatformSQLiteService({
          mode: 'hot',
          path: join(root, 'hot-limit.sqlite'),
          snapshotPath: join(root, 'hot-limit.snapshot.sqlite'),
          hotMaxBytes: maxBytes,
        }),
        ownsSQLite: true,
        migrate: true,
        migrations: [migration],
      });
      try {
        const pageSize = pragmaInteger(runtime, 'page_size');
        const maxPages = pragmaInteger(runtime, 'max_page_count');
        expect(maxPages).toBeLessThanOrEqual(Math.floor(maxBytes / pageSize));
      } finally {
        runtime.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('classifies hot migration exhaustion as a permanent size configuration failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-hot-full-'));
    const snapshotPath = join(root, 'hot-full.snapshot.sqlite');
    const migration: Migration = {
      version: '001',
      description: 'oversized hot migration',
      up(db) {
        db.run('CREATE TABLE oversized (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
        db.run('INSERT INTO oversized (payload) VALUES (zeroblob(1048576))');
      },
    };

    try {
      const error = captureDatabaseError(() => DatabaseRuntime.open({
        id: 'hot-full',
        role: 'named',
        sqlite: createPlatformSQLiteService({
          mode: 'hot',
          path: join(root, 'hot-full.sqlite'),
          snapshotPath,
          hotMaxBytes: 128 * 1_024,
        }),
        ownsSQLite: true,
        migrate: true,
        migrations: [migration],
        migrationLog: () => undefined,
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_CONFIG_INVALID',
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'migration', reason: 'max-bytes' },
      });
      expect(error.message).toBe('Hot SQLite database exceeds the configured memory limit.');
      expect(existsSync(snapshotPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('disposes ReactiveDB before owned SQLite and leaves injected SQLite open', () => {
    const ownedSQLite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const owned = DatabaseRuntime.open({
      id: 'owned',
      role: 'default',
      sqlite: ownedSQLite,
      ownsSQLite: true,
    });
    const ownedEvents: string[] = [];
    const dispose = owned.db.dispose.bind(owned.db);
    const close = ownedSQLite.close.bind(ownedSQLite);
    owned.db.dispose = () => { ownedEvents.push('db'); dispose(); };
    ownedSQLite.close = () => { ownedEvents.push('sqlite'); close(); };
    owned.close();
    owned.close();
    expect(ownedEvents).toEqual(['db', 'sqlite']);

    const injectedSQLite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const injected = DatabaseRuntime.open({
      id: 'injected',
      role: 'default',
      sqlite: injectedSQLite,
      ownsSQLite: false,
    });
    injected.close();
    expect(injectedSQLite.raw.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    injectedSQLite.close();
  });

  test('keeps owned SQLite cleanup retryable behind the stable database error contract', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const runtime = DatabaseRuntime.open({
      id: 'close-retry',
      role: 'default',
      sqlite,
      ownsSQLite: true,
    });
    const close = sqlite.close.bind(sqlite);
    let attempts = 0;
    sqlite.close = () => {
      attempts += 1;
      if (attempts === 1) throw new Error('/private/sqlite close failure');
      close();
    };

    expect(captureDatabaseError(() => runtime.close())).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(runtime.diagnostics().closed).toBe(false);
    runtime.close();
    expect(runtime.diagnostics().closed).toBe(true);
    expect(attempts).toBe(2);
  });

  test('closes runtime start failures and closed-state reuse into DatabaseError', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const runtime = DatabaseRuntime.open({
      id: 'start-error-contract',
      role: 'service',
      sqlite,
      ownsSQLite: false,
    });
    const start = sqlite.start.bind(sqlite);
    sqlite.start = () => {
      throw new Error('/private/database/startup detail');
    };

    const startError = captureDatabaseError(() => runtime.start());
    expect(startError).toMatchObject({
      code: 'DATABASE_OPEN_FAILED',
      retryable: true,
      outcome: 'not-started',
    });
    expect(startError.message).not.toContain('/private/database');

    sqlite.start = () => {
      throw new Proxy(Object.create(null), {
        getPrototypeOf() {
          throw new Error('/private/hostile-prototype-trap');
        },
      });
    };
    const hostileError = captureDatabaseError(() => runtime.start());
    expect(hostileError).toMatchObject({
      code: 'DATABASE_OPEN_FAILED',
      retryable: true,
      outcome: 'not-started',
    });
    expect(hostileError.message).not.toContain('hostile-prototype-trap');

    sqlite.start = start;
    runtime.close();
    expect(captureDatabaseError(() => runtime.start())).toMatchObject({
      code: 'DATABASE_CLOSED',
      retryable: false,
      outcome: 'not-started',
    });
    sqlite.close();
  });

  test('aborts owned SQLite when table initialization fails', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    let closeCalls = 0;
    let abortCalls = 0;
    const close = sqlite.close.bind(sqlite);
    const abort = sqlite.abort.bind(sqlite);
    sqlite.close = () => { closeCalls += 1; close(); };
    sqlite.abort = () => { abortCalls += 1; abort(); };

    const error = captureDatabaseError(() => DatabaseRuntime.open({
      id: 'broken',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: { broken: { value: 'text' } },
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_SCHEMA_MISMATCH',
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'reactive-schema' },
    });
    expect(error.message).not.toContain('broken');
    expect(abortCalls).toBe(1);
    expect(closeCalls).toBe(0);
  });

  test('classifies deterministic migration failures without exposing raw details', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-migration-failure-'));
    const sqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'migration-failure.sqlite'),
    });
    const migration: Migration = {
      version: '001',
      description: 'private migration description',
      up() {
        throw new Error('/private/tenant/database.sqlite migration exploded');
      },
    };

    try {
      const error = captureDatabaseError(() => DatabaseRuntime.open({
        id: 'private-tenant-id',
        role: 'tenant',
        sqlite,
        ownsSQLite: true,
        migrate: true,
        migrations: [migration],
        migrationLog: () => undefined,
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_MIGRATION_FAILED',
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'migration' },
      });
      expect(error.message).toBe('Database migration failed.');
      expect(error.message).not.toContain('private-tenant-id');
      expect(error.message).not.toContain('/private/tenant');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('normalizes startup cleanup ambiguity for actor-level promotion', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    const abort = sqlite.abort.bind(sqlite);
    sqlite.abort = () => {
      throw new Error('/private/tenant/database.sqlite cleanup failed');
    };

    try {
      const error = captureDatabaseError(() => DatabaseRuntime.open({
        id: 'private-tenant-id',
        role: 'tenant',
        sqlite,
        ownsSQLite: true,
        tables: { broken: { value: 'text' } },
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_EXECUTOR_FAILED',
        retryable: false,
        outcome: 'unknown',
      });
      expect(error.message).not.toContain('/private/tenant');
      expect(error.cause).toBeInstanceOf(AggregateError);
    } finally {
      sqlite.abort = abort;
      sqlite.abort();
    }
  });

  test('does not publish rejected durable startup through a legacy close fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-database-legacy-abort-'));
    const sqlite = createPlatformSQLiteService({
      mode: 'file',
      path: join(root, 'legacy.sqlite'),
    });
    const abort = sqlite.abort.bind(sqlite);
    Object.defineProperty(sqlite, 'abort', {
      configurable: true,
      value: undefined,
    });

    try {
      const error = captureDatabaseError(() => DatabaseRuntime.open({
        id: 'legacy-durable',
        role: 'named',
        sqlite,
        ownsSQLite: true,
        tables: { broken: { value: 'text' } },
      }));
      expect(error).toMatchObject({
        code: 'DATABASE_EXECUTOR_FAILED',
        retryable: false,
        outcome: 'unknown',
      });
      expect(error.cause).toBeInstanceOf(AggregateError);
      expect(sqlite.raw.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    } finally {
      Object.defineProperty(sqlite, 'abort', {
        configurable: true,
        value: abort,
      });
      sqlite.abort();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

function pragmaInteger(runtime: DatabaseRuntime, pragma: string): number {
  const row = runtime.sqlite.raw.query(`PRAGMA ${pragma}`).get() as
    | Record<string, unknown>
    | null;
  const value = row ? Object.values(row)[0] : null;
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${pragma} result.`);
  return value as number;
}
