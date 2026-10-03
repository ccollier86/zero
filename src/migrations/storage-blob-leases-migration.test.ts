/** Verify migration 035 matches the runtime shared-CAS lease contract. */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { defineStorageTables } from '../storage/storage-service';
import { createReactiveDB } from '../sync/reactive-db';
import { migration } from './definitions/035_storage_blob_leases';

const LEASE_TABLE = '_storage_blob_leases';
const LEASE_INDEX = 'idx_storage_blob_leases_expiry';

describe('migration 035', () => {
  test('matches the runtime lease table and index contract', () => {
    const migrated = new Database(':memory:');
    const runtime = createReactiveDB({ mode: 'memory' });
    try {
      migration.up(migrated);
      defineStorageTables(runtime);

      expect(columns(migrated)).toEqual(
        runtime.prepare(`PRAGMA table_info(${LEASE_TABLE})`).all(),
      );
      expect(indexNames(migrated)).toEqual(
        (runtime.prepare(`PRAGMA index_list(${LEASE_TABLE})`).all() as IndexRow[])
          .map(({ name }) => name)
          .sort(),
      );
      expect(indexNames(migrated)).toContain(LEASE_INDEX);
    } finally {
      migrated.close();
      runtime.dispose();
    }
  });

  test('removes only the lease table on rollback', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE retained (id TEXT PRIMARY KEY)');
      migration.up(db);
      migration.down!(db);

      expect(tableExists(db, LEASE_TABLE)).toBe(false);
      expect(tableExists(db, 'retained')).toBe(true);
    } finally {
      db.close();
    }
  });
});

interface IndexRow {
  readonly name: string;
}

function columns(db: Database): unknown[] {
  return db.query(`PRAGMA table_info(${LEASE_TABLE})`).all();
}

function indexNames(db: Database): string[] {
  return (db.query(`PRAGMA index_list(${LEASE_TABLE})`).all() as IndexRow[])
    .map(({ name }) => name)
    .sort();
}

function tableExists(db: Database, name: string): boolean {
  return db.query(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name) !== null;
}
