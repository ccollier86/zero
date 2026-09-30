/**
 * sync-mode-resolver.test.ts
 *
 * Verifies startup table sync mode resolution. These tests exercise the
 * auto-lazy policy without opening websocket connections or rendering pages.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryEventStore, OBS_CODES, configureObservability } from '../../observability';
import { createReactiveDB, type ReactiveDB } from '../../sync';
import { applyTableSyncResolution, resolveTableSyncModes } from './sync-mode-resolver';
import { resolveConfig, type ResolvedConfig } from './types';

let db: ReactiveDB | null = null;

function createConfig(options: {
  rowLimit?: number;
  action?: 'lazy' | 'warn' | 'reject';
} = {}): ResolvedConfig {
  return resolveConfig({
    db: { mode: 'memory' },
    tables: {
      events: {
        id: 'text primary key',
        title: 'text not null',
      },
    },
    syncDefaults: {
      autoLazy: {
        rowLimit: options.rowLimit,
        action: options.action,
      },
    },
  });
}

function createDb(config: ResolvedConfig): ReactiveDB {
  const nextDb = createReactiveDB({ mode: 'memory' });
  for (const [name, schema] of Object.entries(config.tables)) {
    nextDb.defineTable(name, schema);
  }
  return nextDb;
}

function seedRows(count: number): void {
  for (let index = 0; index < count; index++) {
    db!.insert('events', { id: `e${index}`, title: `Event ${index}` });
  }
}

afterEach(() => {
  db?.dispose();
  db = null;
});

describe('sync mode resolver', () => {
  test('auto-resolves oversized tables to lazy and applies shared runtime sets', () => {
    const config = createConfig({ rowLimit: 1 });
    db = createDb(config);
    seedRows(2);

    const resolution = resolveTableSyncModes(config, db, { warn() {}, log() {} });
    applyTableSyncResolution(config, resolution);

    expect(resolution.resolvedSyncModes.events).toBe('lazy');
    expect(config.lazyTables.has('events')).toBe(true);
    expect(config.snapshotTables.has('events')).toBe(false);

    const persisted = db
      .prepare('SELECT mode, source FROM _zero_sync_table_modes WHERE table_name = ?')
      .get('events') as { mode: string; source: string } | null;
    expect(persisted).toEqual({ mode: 'lazy', source: 'auto' });
  });

  test('keeps explicit full mode even when the table is above the auto limit', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables: {
        events: {
          serverTable: { id: 'text primary key', title: 'text not null' },
          clientTable: { _pk: 'id', _sync: 'full', id: 'text', title: 'text' },
        },
      },
      syncDefaults: {
        autoLazy: { rowLimit: 1 },
      },
    });
    db = createDb(config);
    seedRows(2);

    const warnings: string[] = [];
    const resolution = resolveTableSyncModes(config, db, {
      warn(message) { warnings.push(message); },
      log() {},
    });

    expect(resolution.resolvedSyncModes.events).toBe('full');
    expect(resolution.snapshotTables.has('events')).toBe(true);
    expect(warnings[0]).toContain('explicit full sync');
  });

  test('keeps persisted lazy auto decisions stable on later startups', () => {
    const config = createConfig({ rowLimit: 1 });
    db = createDb(config);
    seedRows(2);

    resolveTableSyncModes(config, db, { warn() {}, log() {} });
    db.delete('events', 'e0');
    db.delete('events', 'e1');

    const nextConfig = createConfig({ rowLimit: 1 });
    const resolution = resolveTableSyncModes(nextConfig, db!, { warn() {}, log() {} });

    expect(resolution.decisions[0]).toMatchObject({
      table: 'events',
      resolvedMode: 'lazy',
      source: 'persisted',
      rowCount: 0,
    });
  });

  test('counts application rows while persisting decisions only in system metadata', () => {
    const config = createConfig({ rowLimit: 1 });
    db = createDb(config);
    const systemDB = createReactiveDB({ mode: 'memory' });
    try {
      seedRows(2);

      const first = resolveTableSyncModes(config, db, undefined, {
        metadataDB: systemDB,
      });
      expect(first.decisions[0]).toMatchObject({
        resolvedMode: 'lazy',
        source: 'auto',
        rowCount: 2,
        persisted: true,
      });
      expect(hasPhysicalTable(db, '_zero_sync_table_modes')).toBe(false);
      expect(systemDB.prepare(`
        SELECT table_name, mode, source, row_count_at_decision
        FROM _zero_sync_table_modes
      `).all()).toEqual([{
        table_name: 'events',
        mode: 'lazy',
        source: 'auto',
        row_count_at_decision: 2,
      }]);

      db.delete('events', 'e0');
      db.delete('events', 'e1');
      const restarted = resolveTableSyncModes(createConfig({ rowLimit: 1 }), db, undefined, {
        metadataDB: systemDB,
      });
      expect(restarted.decisions[0]).toMatchObject({
        resolvedMode: 'lazy',
        source: 'persisted',
        rowCount: 0,
      });
    } finally {
      systemDB.dispose();
    }
  });

  test('reject action fails startup instead of auto-lazying', () => {
    const config = createConfig({ rowLimit: 1, action: 'reject' });
    db = createDb(config);
    seedRows(2);

    expect(() =>
      resolveTableSyncModes(config, db!, { warn() {}, log() {} })
    ).toThrow('exceeding auto-lazy rowLimit 1');
  });

  test('resolves isolated tenant tables without querying a default-db shadow', () => {
    const config = createConfig({ rowLimit: 1, action: 'reject' });
    db = createReactiveDB({ mode: 'memory' });

    const resolution = resolveTableSyncModes(
      config,
      db,
      { warn() {}, log() {} },
      { tenantDatabaseTables: new Set(['events']) },
    );

    expect(resolution.decisions).toEqual([{
      table: 'events',
      declaredMode: 'auto',
      resolvedMode: 'lazy',
      source: 'tenant-database',
      rowCount: null,
      rowLimit: 1,
      persisted: false,
      reason: 'isolated tenant databases resolve auto sync to lazy',
    }]);
    expect(resolution.lazyTables).toEqual(new Set(['events']));
    expect(db.hasTable('events')).toBe(false);
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM _zero_sync_table_modes WHERE table_name = ?',
    ).get('events')).toEqual({ count: 0 });
  });

  test('honors explicit full mode for isolated tenant tables', () => {
    const config = resolveConfig({
      db: { mode: 'memory' },
      tables: {
        events: {
          serverTable: { id: 'text primary key', title: 'text not null' },
          clientTable: { _pk: 'id', _sync: 'full', id: 'text', title: 'text' },
        },
      },
    });
    db = createReactiveDB({ mode: 'memory' });

    const resolution = resolveTableSyncModes(
      config,
      db,
      undefined,
      { tenantDatabaseTables: new Set(['events']) },
    );
    expect(resolution.decisions[0]).toMatchObject({
      resolvedMode: 'full',
      source: 'explicit',
      rowCount: null,
    });
    expect(resolution.snapshotTables).toEqual(new Set(['events']));
  });

  test('emits warnings only through the owning app runtime', () => {
    const ambient = new MemoryEventStore();
    const appA = new MemoryEventStore();
    const appB = new MemoryEventStore();
    const configA = createConfig({ rowLimit: 1 });
    const configB = createConfig({ rowLimit: 1 });
    const dbA = createDb(configA);
    const dbB = createDb(configB);
    configureObservability({ console: false, store: ambient });
    try {
      for (const target of [dbA, dbB]) {
        target.insert('events', { id: 'e1', title: 'One' });
        target.insert('events', { id: 'e2', title: 'Two' });
      }
      resolveTableSyncModes(configA, dbA, undefined, {
        observability: { sink: appA, store: appA, config: { store: appA } },
      });
      resolveTableSyncModes(configB, dbB, undefined, {
        observability: { sink: appB, store: appB, config: { store: appB } },
      });

      expect(appA.query().events.map((event) => event.code)).toEqual([
        OBS_CODES.SYNC_MODE_AUTO_LAZY.code,
      ]);
      expect(appB.query().events.map((event) => event.code)).toEqual([
        OBS_CODES.SYNC_MODE_AUTO_LAZY.code,
      ]);
      expect(ambient.query().count).toBe(0);
    } finally {
      dbA.dispose();
      dbB.dispose();
      configureObservability(false);
    }
  });
});

function hasPhysicalTable(database: ReactiveDB, table: string): boolean {
  return Boolean(database.prepare(
    'SELECT 1 FROM sqlite_schema WHERE type = \'table\' AND name = ? LIMIT 1',
  ).get(table));
}
