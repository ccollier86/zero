/**
 * storage-studio-foundation-migration.test.ts
 *
 * Verifies migration 034 installs the same sidecar columns as runtime repair.
 */

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migration } from './definitions/034_storage_studio_foundation';
import {
  STORAGE_DRIVE_PROFILES_TABLE,
  STORAGE_JOBS_TABLE,
  STORAGE_QUOTA_RESERVATIONS_TABLE,
  STORAGE_STUDIO_OPERATIONS_TABLE,
  defineStorageStudioTables,
} from '../storage/storage-studio-schema';

const TABLES = [
  STORAGE_DRIVE_PROFILES_TABLE,
  STORAGE_STUDIO_OPERATIONS_TABLE,
  STORAGE_QUOTA_RESERVATIONS_TABLE,
  STORAGE_JOBS_TABLE,
] as const;

describe('migration 034', () => {
  test('is additive and matches the runtime sidecar column contract', () => {
    const migrated = databaseWithPrerequisites();
    const runtime = databaseWithPrerequisites();
    try {
      migration.up(migrated);
      defineStorageStudioTables(runtime);

      for (const table of TABLES) {
        expect(columns(migrated, table)).toEqual(columns(runtime, table));
      }
      expect(migrated.query('SELECT count(*) AS count FROM storage_drives')
        .get()).toEqual({ count: 1 });
    } finally {
      migrated.close();
      runtime.close();
    }
  });

  test('retains legacy rows without synthesizing a sidecar profile', () => {
    const db = databaseWithPrerequisites();
    try {
      migration.up(db);
      expect(db.query(`SELECT count(*) AS count FROM ${STORAGE_DRIVE_PROFILES_TABLE}`)
        .get()).toEqual({ count: 0 });
      expect(db.query('SELECT drive_id FROM storage_drives').all()).toEqual([
        { drive_id: 'legacy_drive' },
      ]);
    } finally {
      db.close();
    }
  });
});

function databaseWithPrerequisites(): Database {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY);
    INSERT INTO storage_drives (drive_id) VALUES ('legacy_drive');
  `);
  return db;
}

function columns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map(({ name }) => name);
}
