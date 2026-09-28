import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import type { Migration } from '../migrations';
import { DatabaseRuntime } from './database-runtime';

describe('DatabaseRuntime', () => {
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

  test('closes owned SQLite when table initialization fails', () => {
    const sqlite = createPlatformSQLiteService({ mode: 'ephemeral' });
    let closeCalls = 0;
    const close = sqlite.close.bind(sqlite);
    sqlite.close = () => { closeCalls += 1; close(); };

    expect(() => DatabaseRuntime.open({
      id: 'broken',
      role: 'named',
      sqlite,
      ownsSQLite: true,
      tables: { broken: { value: 'text' } },
    })).toThrow("must have a column with 'primary key'");
    expect(closeCalls).toBe(1);
  });
});
