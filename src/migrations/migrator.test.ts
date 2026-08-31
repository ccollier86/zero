/**
 * migrator.test.ts
 *
 * Verifies first-class migration execution behavior: ledger events, schema
 * history, safety gates, backups, and rollback.
 */

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Migrator } from './migrator';
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
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zero-migrations-'));
  tempDirs.push(dir);
  return join(dir, 'test.db');
}
