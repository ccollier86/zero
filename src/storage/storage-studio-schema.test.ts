/**
 * storage-studio-schema.test.ts
 *
 * Verifies runtime sidecar creation and owner/lifecycle/idempotency invariants.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  STORAGE_DRIVE_PROFILES_TABLE,
  STORAGE_JOBS_TABLE,
  STORAGE_QUOTA_RESERVATIONS_TABLE,
  STORAGE_STUDIO_OPERATIONS_TABLE,
  defineStorageStudioTables,
} from './storage-studio-schema';

let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  definePrerequisites(db);
});

afterEach(() => db.close());

describe('Storage Studio runtime schema', () => {
  test('creates all private sidecars and indexes idempotently', () => {
    defineStorageStudioTables(db);
    defineStorageStudioTables(db);

    const tables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE '_storage_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      STORAGE_DRIVE_PROFILES_TABLE,
      STORAGE_JOBS_TABLE,
      STORAGE_QUOTA_RESERVATIONS_TABLE,
      STORAGE_STUDIO_OPERATIONS_TABLE,
    ].sort());

    const indexes = db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_storage_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(indexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'idx_storage_drive_profiles_scope_lifecycle',
      'idx_storage_drive_profiles_owner_lifecycle',
      'idx_storage_drive_profiles_provider_namespace',
      'idx_storage_studio_operations_scope_status',
      'idx_storage_quota_reservations_drive_active',
      'idx_storage_jobs_claim',
    ]));
  });

  test('supports single-mode application ownership and tenant user ownership', () => {
    defineStorageStudioTables(db);
    seedUserAndDrives(db);
    insertProfile(db, {
      driveId: 'drive_app',
      key: 'documents',
      ownerKind: 'application',
      ownerId: 'application',
      scopeKind: 'application',
      scopeId: 'application',
      lifecycle: 'ready',
      readyAt: 10,
    });
    insertProfile(db, {
      driveId: 'drive_user',
      key: 'private-files',
      ownerKind: 'user',
      ownerId: 'user_one',
      scopeKind: 'tenant',
      scopeId: 'tenant_one',
      lifecycle: 'degraded',
      degradedAt: 11,
      failureCode: 'STORAGE_PROVIDER_UNAVAILABLE',
    });

    const rows = db.query(`
      SELECT drive_id, owner_kind, scope_kind, lifecycle
      FROM ${STORAGE_DRIVE_PROFILES_TABLE}
      ORDER BY drive_id
    `).all();
    expect(rows).toEqual([
      {
        drive_id: 'drive_app',
        owner_kind: 'application',
        scope_kind: 'application',
        lifecycle: 'ready',
      },
      {
        drive_id: 'drive_user',
        owner_kind: 'user',
        scope_kind: 'tenant',
        lifecycle: 'degraded',
      },
    ]);
  });

  test('rejects mismatched owner scopes and duplicate stable keys', () => {
    defineStorageStudioTables(db);
    seedUserAndDrives(db);

    expect(() => insertProfile(db, {
      driveId: 'drive_app',
      key: 'documents',
      ownerKind: 'organization',
      ownerId: 'tenant_one',
      scopeKind: 'application',
      scopeId: 'application',
      lifecycle: 'provisioning',
    })).toThrow();

    insertProfile(db, {
      driveId: 'drive_app',
      key: 'documents',
      ownerKind: 'application',
      ownerId: 'application',
      scopeKind: 'application',
      scopeId: 'application',
      lifecycle: 'provisioning',
    });
    expect(() => db.exec(`
      UPDATE ${STORAGE_DRIVE_PROFILES_TABLE}
      SET drive_key = 'renamed', revision = revision + 1
      WHERE drive_id = 'drive_app'
    `)).toThrow();
    expect(() => db.exec(`
      UPDATE ${STORAGE_DRIVE_PROFILES_TABLE}
      SET updated_at = updated_at + 1
      WHERE drive_id = 'drive_app'
    `)).toThrow();
    expect(() => insertProfile(db, {
      driveId: 'drive_user',
      key: 'documents',
      ownerKind: 'application',
      ownerId: 'application',
      scopeKind: 'application',
      scopeId: 'application',
      lifecycle: 'provisioning',
    })).toThrow();
  });

  test('enforces idempotency identity and active quota reservation state', () => {
    defineStorageStudioTables(db);
    seedUserAndDrives(db);
    db.query(`INSERT INTO ${STORAGE_STUDIO_OPERATIONS_TABLE} (
      operation_id, idempotency_key, operation_kind, scope_kind, scope_id,
      actor_user_id, request_hash, status, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('operation_one', 'request_one', 'provision', 'application', 'application',
        'user_one', 'a'.repeat(64), 'pending', 10, 10, 20);

    expect(() => db.query(`INSERT INTO ${STORAGE_STUDIO_OPERATIONS_TABLE} (
      operation_id, idempotency_key, operation_kind, scope_kind, scope_id,
      actor_user_id, request_hash, status, created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('operation_two', 'request_one', 'provision', 'application', 'application',
        'user_one', 'b'.repeat(64), 'pending', 10, 10, 20)).toThrow();

    db.query(`INSERT INTO ${STORAGE_QUOTA_RESERVATIONS_TABLE} (
      reservation_id, drive_id, operation_id, reserved_bytes,
      reserved_objects, status, generation, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('reservation_one', 'drive_app', 'operation_one', 100, 1, 'active', 1, 10, 20);
    expect(() => db.query(`INSERT INTO ${STORAGE_QUOTA_RESERVATIONS_TABLE} (
      reservation_id, drive_id, reserved_bytes, reserved_objects,
      status, generation, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('reservation_empty', 'drive_app', 0, 0, 'active', 1, 10, 20)).toThrow();
  });
});

function definePrerequisites(database: Database): void {
  database.exec(`
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY);
  `);
}

function seedUserAndDrives(database: Database): void {
  database.exec(`
    INSERT INTO users (user_id) VALUES ('user_one');
    INSERT INTO storage_drives (drive_id) VALUES ('drive_app');
    INSERT INTO storage_drives (drive_id) VALUES ('drive_user');
  `);
}

interface ProfileFixture {
  driveId: string;
  key: string;
  ownerKind: 'application' | 'organization' | 'user';
  ownerId: string;
  scopeKind: 'application' | 'tenant';
  scopeId: string;
  lifecycle: 'provisioning' | 'ready' | 'degraded';
  readyAt?: number;
  degradedAt?: number;
  failureCode?: string;
}

function insertProfile(database: Database, fixture: ProfileFixture): void {
  database.query(`INSERT INTO ${STORAGE_DRIVE_PROFILES_TABLE} (
    drive_id, drive_key, owner_kind, owner_id, scope_kind, scope_id,
    lifecycle, revision, provider, provider_namespace, isolation_mode,
    generation, created_by_user_id, updated_by_user_id, created_at,
    updated_at, ready_at, degraded_at, failure_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'local', ?, 'shared-cas', 1,
    'user_one', 'user_one', 10, 10, ?, ?, ?)`)
    .run(
      fixture.driveId,
      fixture.key,
      fixture.ownerKind,
      fixture.ownerId,
      fixture.scopeKind,
      fixture.scopeId,
      fixture.lifecycle,
      `namespace_${fixture.driveId}`,
      fixture.readyAt ?? null,
      fixture.degradedAt ?? null,
      fixture.failureCode ?? null,
    );
}
