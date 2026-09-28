/**
 * migrator.test.ts
 *
 * Verifies first-class migration execution behavior: ledger events, schema
 * history, safety gates, backups, and rollback.
 */

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Migrator } from './migrator';
import { runMigrationDoctor, statusToFindings } from './migration-doctor';
import type { Migration } from './types';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Migrator first-class ledger and history', () => {
  test('records applied migrations in the ledger and schema history', () => {
    const dbPath = tempDbPath();
    const migration: Migration = {
      version: '001',
      description: 'create todos',
      safety: 'safe',
      downSafety: 'destructive',
      up(db: Database) {
        db.run('CREATE TABLE todos (id text primary key, title text not null)');
      },
      down(db: Database) {
        db.run('DROP TABLE todos');
      },
    };

    const migrator = new Migrator({ dbPath, migrations: [migration], log: () => {} });
    try {
      expect(migrator.run()).toEqual(['001']);
      expect(migrator.status()[0]).toMatchObject({
        version: '001',
        applied: true,
        checksumMatches: true,
        hasDown: true,
      });
      expect(migrator.list()[0]).toMatchObject({
        version: '001',
        applied: true,
      });

      const ledgerCount = migrator.database
        .prepare('SELECT COUNT(*) AS count FROM _zero_migrations WHERE version = ? AND status = ?')
        .get('001', 'applied') as { count: number };
      const historyCount = migrator.database
        .prepare('SELECT COUNT(*) AS count FROM _zero_schema_history WHERE migration_version = ?')
        .get('001') as { count: number };

      expect(ledgerCount.count).toBe(1);
      expect(historyCount.count).toBe(1);
    } finally {
      migrator.dispose();
    }
  });

  test('blocks destructive rollback unless explicitly allowed', () => {
    const dbPath = tempDbPath();
    const migration: Migration = {
      version: '001',
      description: 'create todos',
      safety: 'safe',
      downSafety: 'destructive',
      up(db: Database) {
        db.run('CREATE TABLE todos (id text primary key)');
      },
      down(db: Database) {
        db.run('DROP TABLE todos');
      },
    };

    const migrator = new Migrator({ dbPath, migrations: [migration], log: () => {} });
    try {
      migrator.run();
      expect(() => migrator.rollback('000')).toThrow('--allow-destructive-down');
    } finally {
      migrator.dispose();
    }

    const rollbackMigrator = new Migrator({
      dbPath,
      migrations: [migration],
      allowDestructiveDown: true,
      log: () => {},
    });
    try {
      expect(rollbackMigrator.rollback('000')).toEqual(['001']);
      expect(rollbackMigrator.status()[0].applied).toBe(false);
    } finally {
      rollbackMigrator.dispose();
    }
  });

  test('blocks destructive forward migrations unless explicitly allowed and records backups', () => {
    const dbPath = tempDbPath();
    const backupDir = join(tempDirs[0], 'backups');
    const migration: Migration = {
      version: '002',
      description: 'drop legacy table',
      safety: 'destructive',
      backupRequired: true,
      up(db: Database) {
        db.run('CREATE TABLE migrated (id text primary key)');
      },
      down(db: Database) {
        db.run('DROP TABLE migrated');
      },
    };

    const blocked = new Migrator({ dbPath, migrations: [migration], log: () => {} });
    try {
      expect(() => blocked.run()).toThrow('--allow-destructive');
    } finally {
      blocked.dispose();
    }

    const allowed = new Migrator({
      dbPath,
      migrations: [migration],
      allowDestructive: true,
      backupDir,
      log: () => {},
    });
    try {
      allowed.database.run('CREATE TABLE live_before_backup (value text NOT NULL)');
      allowed.database.run("INSERT INTO live_before_backup VALUES ('committed-in-wal')");
      expect(allowed.run()).toEqual(['002']);
      const artifact = allowed.database
        .prepare('SELECT path FROM _zero_migration_artifacts WHERE migration_version = ? AND kind = ?')
        .get('002', 'backup') as { path: string };
      expect(statSync(artifact.path).mode & 0o777).toBe(0o600);
      const backup = new Database(artifact.path, { readonly: true });
      try {
        expect(backup.query('SELECT value FROM live_before_backup').get())
          .toEqual({ value: 'committed-in-wal' });
        expect(() => backup.query('SELECT * FROM migrated').get()).toThrow();
      } finally {
        backup.close();
      }
    } finally {
      allowed.dispose();
    }
  });

  test('backs up a live hot-mode handle before its snapshot file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'zero-hot-migration-'));
    tempDirs.push(root);
    const snapshotPath = join(root, 'data', 'app.snapshot.db');
    const backupDir = join(root, 'backups');
    const database = new Database(':memory:');
    database.run('CREATE TABLE live_hot_data (value text NOT NULL)');
    database.run("INSERT INTO live_hot_data VALUES ('not-yet-snapshotted')");
    const migration: Migration = {
      version: '006',
      description: 'guarded hot migration',
      safety: 'guarded',
      backupRequired: true,
      up(db: Database) {
        db.run('CREATE TABLE migrated_hot_data (id text primary key)');
      },
    };
    const migrator = new Migrator({
      database,
      dbPath: snapshotPath,
      backupDir,
      migrations: [migration],
      createBackups: true,
      log: () => {},
    });

    try {
      expect(existsSync(snapshotPath)).toBe(false);
      expect(migrator.run()).toEqual(['006']);
      const artifact = database
        .prepare('SELECT path FROM _zero_migration_artifacts WHERE migration_version = ?')
        .get('006') as { path: string };
      const backup = new Database(artifact.path, { readonly: true });
      try {
        expect(backup.query('SELECT value FROM live_hot_data').get())
          .toEqual({ value: 'not-yet-snapshotted' });
        expect(() => backup.query('SELECT * FROM migrated_hot_data').get()).toThrow();
      } finally {
        backup.close();
      }
    } finally {
      migrator.dispose();
      database.close();
    }
  });

  test('serializes concurrent process startup and applies each migration once', async () => {
    const dbPath = tempDbPath();
    const root = tempDirs.at(-1)!;
    const startPath = join(root, 'start');
    const workerPath = join(import.meta.dir, 'test-fixtures', 'concurrent-migrator-worker.ts');
    const readyPaths = [join(root, 'ready-a'), join(root, 'ready-b')];
    const workers = readyPaths.map((readyPath) => Bun.spawn({
      cmd: [process.execPath, 'run', workerPath, dbPath, readyPath, startPath],
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    }));

    const readyDeadline = Date.now() + 10_000;
    while (!readyPaths.every(existsSync)) {
      if (workers.some((worker) => worker.exitCode !== null)) break;
      if (Date.now() >= readyDeadline) break;
      await Bun.sleep(5);
    }
    if (!readyPaths.every(existsSync)) {
      for (const worker of workers) {
        if (worker.exitCode === null) worker.kill();
      }
      await Promise.all(workers.map((worker) => worker.exited));
      const diagnostics = await Promise.all(workers.map(async (worker) => ({
        exitCode: worker.exitCode,
        stdout: await new Response(worker.stdout).text(),
        stderr: await new Response(worker.stderr).text(),
      })));
      throw new Error(
        `Concurrent migration workers did not reach the start barrier: ${JSON.stringify(diagnostics)}`,
      );
    }
    writeFileSync(startPath, 'start');

    const exitCodes = await Promise.all(workers.map((worker) => worker.exited));
    const diagnostics = await Promise.all(workers.map(async (worker) => ({
      stdout: await new Response(worker.stdout).text(),
      stderr: await new Response(worker.stderr).text(),
    })));
    expect(exitCodes, JSON.stringify(diagnostics)).toEqual([0, 0]);

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.query('SELECT COUNT(*) AS count FROM concurrent_effect').get())
        .toEqual({ count: 1 });
      expect(db.query(`
        SELECT COUNT(*) AS count
        FROM _zero_migrations
        WHERE version = '001' AND status = 'applied'
      `).get()).toEqual({ count: 1 });
      expect(db.query(`
        SELECT COUNT(*) AS count
        FROM _zero_schema_history
        WHERE migration_version = '001' AND direction = 'up'
      `).get()).toEqual({ count: 1 });
      expect(db.query(`
        SELECT COUNT(*) AS count
        FROM _zero_migration_artifacts
        WHERE migration_version = '001' AND kind = 'backup'
      `).get()).toEqual({ count: 1 });
      expect(readdirSync(join(root, 'backups'))).toHaveLength(1);
    } finally {
      db.close();
    }
  }, 20_000);

  test('a failed rollback preserves applied state and can be retried', () => {
    const dbPath = tempDbPath();
    let failRollback = true;
    const migration: Migration = {
      version: '001',
      description: 'retry rollback',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE rollback_retry (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        if (failRollback) throw new Error('injected rollback failure');
        db.run('DROP TABLE rollback_retry');
      },
    };
    const migrator = new Migrator({ dbPath, migrations: [migration], log: () => {} });

    try {
      expect(migrator.run()).toEqual(['001']);
      expect(() => migrator.rollback('000')).toThrow('injected rollback failure');
      expect(migrator.status()[0]).toMatchObject({
        applied: true,
        lastStatus: 'failed',
      });
      const failedRollbackReport = runMigrationDoctor({
        db: migrator.database,
        migrations: [migration],
      });
      expect(failedRollbackReport.findings.map((finding) => finding.code))
        .toContain('migration.failed');
      expect(failedRollbackReport.findings.map((finding) => finding.code))
        .not.toContain('migration.pending');
      expect(migrator.database.query(`
        SELECT COUNT(*) AS count FROM _migrations WHERE version = '001'
      `).get()).toEqual({ count: 1 });

      failRollback = false;
      expect(migrator.rollback('000')).toEqual(['001']);
      expect(migrator.status()[0]).toMatchObject({
        applied: false,
        lastStatus: 'rolled_back',
      });
      const rolledBackReport = runMigrationDoctor({
        db: migrator.database,
        migrations: [migration],
      });
      expect(rolledBackReport.findings.map((finding) => finding.code))
        .toContain('migration.pending');
      expect(rolledBackReport.findings.map((finding) => finding.code))
        .not.toContain('migration.failed');
      expect(migrator.database.query(`
        SELECT COUNT(*) AS count FROM _migrations WHERE version = '001'
      `).get()).toEqual({ count: 0 });
    } finally {
      migrator.dispose();
    }
  });

  test('reports a failed forward attempt as both failed and pending', () => {
    const dbPath = tempDbPath();
    const migration: Migration = {
      version: '001',
      description: 'fail forward',
      up() {
        throw new Error('injected forward failure');
      },
    };
    const migrator = new Migrator({ dbPath, migrations: [migration], log: () => {} });

    try {
      expect(() => migrator.run()).toThrow('injected forward failure');
      const report = runMigrationDoctor({ db: migrator.database, migrations: [migration] });
      const codes = report.findings.map((finding) => finding.code);
      expect(codes).toContain('migration.failed');
      expect(codes).toContain('migration.pending');
      expect(statusToFindings(migrator.status()).map((finding) => finding.code))
        .toEqual(expect.arrayContaining(['migration.failed', 'migration.pending']));
    } finally {
      migrator.dispose();
    }
  });

  test('reconciles legacy versions missing from a partially populated event ledger', () => {
    const dbPath = tempDbPath();
    const first: Migration = {
      version: '001',
      description: 'first migration',
      up(db: Database) {
        db.run('CREATE TABLE first_migration (id TEXT PRIMARY KEY)');
      },
    };
    const initial = new Migrator({ dbPath, migrations: [first], log: () => {} });
    try {
      expect(initial.run()).toEqual(['001']);
    } finally {
      initial.dispose();
    }

    const legacy = new Database(dbPath);
    try {
      legacy.query(`
        INSERT INTO _migrations (version, description, applied_at, checksum, duration_ms)
        VALUES ('002', 'legacy only', datetime('now'), 'legacy-checksum', 7)
      `).run();
    } finally {
      legacy.close();
    }

    const reconciled = new Migrator({ dbPath, migrations: [], log: () => {} });
    try {
      expect(reconciled.database.query(`
        SELECT version, description, checksum, duration_ms
        FROM _zero_migrations
        WHERE version = '002'
      `).all()).toEqual([{
        version: '002',
        description: 'legacy only',
        checksum: 'legacy-checksum',
        duration_ms: 7,
      }]);
    } finally {
      reconciled.dispose();
    }

    const reopened = new Migrator({ dbPath, migrations: [], log: () => {} });
    try {
      expect(reopened.database.query(`
        SELECT COUNT(*) AS count FROM _zero_migrations WHERE version = '002'
      `).get()).toEqual({ count: 1 });
    } finally {
      reopened.dispose();
    }
  });

  test('repairs stale and missing legacy rows from authoritative successful state', () => {
    const dbPath = tempDbPath();
    const [first, second] = dependencyMigrations();
    const initial = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    try {
      expect(initial.run()).toEqual(['001', '002']);
      expect(initial.rollback()).toEqual(['002']);
      initial.database.query("DELETE FROM _migrations WHERE version = '001'").run();
      initial.database.query(`
        INSERT INTO _migrations (version, description, applied_at, checksum, duration_ms)
        VALUES ('002', 'stale rollback row', datetime('now'), 'stale', 0)
      `).run();
    } finally {
      initial.dispose();
    }

    const repaired = new Migrator({ dbPath, migrations: [], log: () => {} });
    try {
      expect(repaired.database.query(`
        SELECT version, description FROM _migrations ORDER BY version
      `).all()).toEqual([{
        version: '001',
        description: 'first dependency',
      }]);
    } finally {
      repaired.dispose();
    }
  });

  test('rejects a changed migration after its successful rollback', () => {
    const dbPath = tempDbPath();
    const original: Migration = {
      version: '001',
      description: 'original migration',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE immutable_migration (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        db.run('DROP TABLE immutable_migration');
      },
    };
    const first = new Migrator({ dbPath, migrations: [original], log: () => {} });
    try {
      expect(first.run()).toEqual(['001']);
      expect(first.rollback('000')).toEqual(['001']);
    } finally {
      first.dispose();
    }

    const changed = { ...original, description: 'changed after rollback' };
    const retry = new Migrator({ dbPath, migrations: [changed], log: () => {} });
    try {
      expect(() => retry.run()).toThrow('changed after it was applied');
      expect(retry.database.query(`
        SELECT COUNT(*) AS count FROM _zero_migrations WHERE status = 'failed'
      `).get()).toEqual({ count: 0 });
    } finally {
      retry.dispose();
    }
  });

  test('rejects a changed migration even when no forward work is pending', () => {
    const dbPath = tempDbPath();
    const original: Migration = {
      version: '001',
      description: 'immutable applied migration',
      up(db: Database) {
        db.run('CREATE TABLE immutable_applied (id TEXT PRIMARY KEY)');
      },
    };
    const first = new Migrator({ dbPath, migrations: [original], log: () => {} });
    try {
      expect(first.run()).toEqual(['001']);
    } finally {
      first.dispose();
    }

    const changed = { ...original, description: 'changed while applied' };
    const reopened = new Migrator({ dbPath, migrations: [changed], log: () => {} });
    try {
      expect(() => reopened.run()).toThrow('changed after it was applied');
    } finally {
      reopened.dispose();
    }
  });

  test('does not record lock acquisition timeout as a failed migration attempt', () => {
    const dbPath = tempDbPath();
    const migration: Migration = {
      version: '001',
      description: 'busy migration',
      up(db: Database) {
        db.run('CREATE TABLE busy_migration (id TEXT PRIMARY KEY)');
      },
    };
    const migrator = new Migrator({
      dbPath,
      migrations: [migration],
      busyTimeoutMs: 0,
      log: () => {},
    });
    const blocker = new Database(dbPath);

    try {
      blocker.run('BEGIN IMMEDIATE');
      expect(() => migrator.run()).toThrow();
      blocker.run('ROLLBACK');

      expect(migrator.database.query(`
        SELECT COUNT(*) AS count FROM _zero_migrations WHERE status = 'failed'
      `).get()).toEqual({ count: 0 });
      expect(migrator.run()).toEqual(['001']);
    } finally {
      try {
        blocker.run('ROLLBACK');
      } catch {
        // The normal path already released the test lock.
      }
      blocker.close();
      migrator.dispose();
    }
  });

  test('rejects invalid busy timeouts before opening an owned database', () => {
    const dbPath = tempDbPath();
    expect(existsSync(dbPath)).toBe(false);
    expect(() => new Migrator({
      dbPath,
      migrations: [],
      busyTimeoutMs: -1,
      log: () => {},
    })).toThrow('busyTimeoutMs must be a non-negative finite number');
    expect(existsSync(dbPath)).toBe(false);
  });

  test('rejects duplicate or out-of-order registries before opening the database', () => {
    const dbPath = tempDbPath();
    const migration = (version: string): Migration => ({
      version,
      description: version,
      up() {},
    });

    expect(() => new Migrator({
      dbPath,
      migrations: [migration('002'), migration('001')],
      log: () => {},
    })).toThrow('out-of-order version 001');
    expect(existsSync(dbPath)).toBe(false);

    expect(() => new Migrator({
      dbPath,
      migrations: [migration('001'), migration('001')],
      log: () => {},
    })).toThrow('duplicate version 001');
    expect(existsSync(dbPath)).toBe(false);
  });

  test('refuses rollback from a stale registry while a newer migration remains applied', () => {
    const dbPath = tempDbPath();
    const first: Migration = {
      version: '001',
      description: 'first dependency',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE dependency_one (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        db.run('DROP TABLE dependency_one');
      },
    };
    const second: Migration = {
      version: '002',
      description: 'second dependency',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE dependency_two (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        db.run('DROP TABLE dependency_two');
      },
    };
    const current = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    try {
      expect(current.run()).toEqual(['001', '002']);
    } finally {
      current.dispose();
    }

    const stale = new Migrator({ dbPath, migrations: [first], log: () => {} });
    try {
      expect(() => stale.run()).toThrow('unknown applied migration 002');
      expect(() => stale.rollback('000')).toThrow('unknown applied migration 002');
      expect(stale.database.query(`
        SELECT COUNT(*) AS count FROM _zero_migrations WHERE status = 'failed'
      `).get()).toEqual({ count: 0 });
      expect(stale.database.query(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('dependency_one', 'dependency_two')
        ORDER BY name
      `).all()).toEqual([
        { name: 'dependency_one' },
        { name: 'dependency_two' },
      ]);
    } finally {
      stale.dispose();
    }
  });

  test('keeps migration order intact when a forward run wins a rollback race', () => {
    const dbPath = tempDbPath();
    const [first, second] = dependencyMigrations();
    const setup = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    try {
      expect(setup.run('001')).toEqual(['001']);
    } finally {
      setup.dispose();
    }

    const forward = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    let interleaved = false;
    const rollback = new Migrator({
      dbPath,
      migrations: [first, second],
      log(message) {
        if (interleaved || !String(message).includes('Rolling back 001')) return;
        interleaved = true;
        expect(forward.run()).toEqual(['002']);
      },
    });

    try {
      expect(() => rollback.rollback('000')).toThrow('later applied migration 002');
      expect(interleaved).toBe(true);
      expect(forward.status().map((status) => status.applied)).toEqual([true, true]);
    } finally {
      rollback.dispose();
      forward.dispose();
    }
  });

  test('keeps migration order intact when a rollback wins a forward-run race', () => {
    const dbPath = tempDbPath();
    const [first, second] = dependencyMigrations();
    const setup = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    try {
      expect(setup.run('001')).toEqual(['001']);
    } finally {
      setup.dispose();
    }

    const rollback = new Migrator({ dbPath, migrations: [first, second], log: () => {} });
    let interleaved = false;
    const forward = new Migrator({
      dbPath,
      migrations: [first, second],
      log(message) {
        if (interleaved || !String(message).includes('Applying 002')) return;
        interleaved = true;
        expect(rollback.rollback('000')).toEqual(['001']);
      },
    });

    try {
      expect(() => forward.run()).toThrow('earlier migration 001 is not applied');
      expect(interleaved).toBe(true);
      expect(forward.status().map((status) => status.applied)).toEqual([false, false]);
    } finally {
      forward.dispose();
      rollback.dispose();
    }
  });
});

function dependencyMigrations(): [Migration, Migration] {
  return [
    {
      version: '001',
      description: 'first dependency',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE dependency_one (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        db.run('DROP TABLE dependency_one');
      },
    },
    {
      version: '002',
      description: 'second dependency',
      downSafety: 'safe',
      up(db: Database) {
        db.run('CREATE TABLE dependency_two (id TEXT PRIMARY KEY)');
      },
      down(db: Database) {
        db.run('DROP TABLE dependency_two');
      },
    },
  ];
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zero-migrations-'));
  tempDirs.push(dir);
  return join(dir, 'test.db');
}
