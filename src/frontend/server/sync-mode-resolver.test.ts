/**
 * sync-mode-resolver.test.ts
 *
 * Verifies startup table sync mode resolution. These tests exercise the
 * auto-lazy policy without opening websocket connections or rendering pages.
 */

import { afterEach, describe, expect, test } from 'bun:test';
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

  test('reject action fails startup instead of auto-lazying', () => {
    const config = createConfig({ rowLimit: 1, action: 'reject' });
    db = createDb(config);
    seedRows(2);

    expect(() =>
      resolveTableSyncModes(config, db!, { warn() {}, log() {} })
    ).toThrow('exceeding auto-lazy rowLimit 1');
  });
});
