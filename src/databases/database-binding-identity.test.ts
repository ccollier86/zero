import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  prepareDatabaseBindingIdentity,
  prepareDatabaseBindingIdentityForTesting,
  readDatabaseBindingIdentity,
} from './database-binding-identity';
import { DatabaseError } from './database-error';
import { createDatabaseRef, prepareDatabaseFile } from './database-file';
import { openDatabaseFileIdentityGuard } from './database-file-identity';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('database binding identity', () => {
  test('initializes only a pristine reservation and reopens the same instance', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const databaseRef = createDatabaseRef('tenant-a');
    const first = prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: 'application',
      initialize: true,
    });
    const second = prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: 'application',
      initialize: false,
    });

    expect(first).toEqual(second);
    expect(first.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const database = new Database(prepared.path, { readonly: true, strict: true });
    try {
      expect(readDatabaseBindingIdentity(
        database,
        databaseRef,
        'application',
      )).toEqual(first);
    } finally {
      database.close();
    }
  });

  test('fails closed for nonempty unbound and differently assigned images', () => {
    const root = createRoot();
    const legacy = prepareDatabaseFile(root, 'legacy');
    const database = new Database(legacy.path, { create: false, readwrite: true });
    database.run('CREATE TABLE application_data (id TEXT PRIMARY KEY)');
    database.close();

    expectDatabaseError(() => prepareDatabaseBindingIdentity({
      filePath: legacy.path,
      fileIdentity: legacy.identity,
      databaseRef: createDatabaseRef('legacy'),
      realmName: 'application',
      initialize: true,
    }), 'DATABASE_SCHEMA_MISMATCH');

    const first = prepareDatabaseFile(root, 'first');
    prepareDatabaseBindingIdentity({
      filePath: first.path,
      fileIdentity: first.identity,
      databaseRef: createDatabaseRef('first'),
      realmName: 'application',
      initialize: true,
    });
    const second = prepareDatabaseFile(root, 'second');
    prepareDatabaseBindingIdentity({
      filePath: second.path,
      fileIdentity: second.identity,
      databaseRef: createDatabaseRef('second'),
      realmName: 'application',
      initialize: true,
    });

    // Content replacement which preserves B's pathname/inode still cannot
    // change the durable logical assignment from A into B.
    copyFileSync(first.path, second.path);
    expectDatabaseError(() => prepareDatabaseBindingIdentity({
      filePath: second.path,
      fileIdentity: second.identity,
      databaseRef: createDatabaseRef('second'),
      realmName: 'application',
      initialize: false,
    }), 'DATABASE_SCHEMA_MISMATCH');
  });

  test('accepts a legitimate physical replacement only for the same instance', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const databaseRef = createDatabaseRef('tenant-a');
    const identity = prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: 'application',
      initialize: true,
    });
    const replacement = `${prepared.path}.replacement`;
    copyFileSync(prepared.path, replacement);
    renameSync(replacement, prepared.path);
    const guard = openDatabaseFileIdentityGuard(prepared.path, { access: 'read' });
    try {
      expect(prepareDatabaseBindingIdentity({
        filePath: prepared.path,
        fileIdentity: guard.proof,
        databaseRef,
        realmName: 'application',
        initialize: false,
      })).toEqual(identity);
    } finally {
      guard.release();
    }
  });

  test('rejects mutation or deletion of the internal singleton row', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef: createDatabaseRef('tenant-a'),
      realmName: 'application',
      initialize: true,
    });
    const database = new Database(prepared.path, { readwrite: true, create: false });
    try {
      expect(() => database.run(
        "UPDATE _zero_database_binding_v1 SET realm_name = 'other'",
      )).toThrow('zero database binding is immutable');
      expect(() => database.run(
        'DELETE FROM _zero_database_binding_v1',
      )).toThrow('zero database binding is immutable');
    } finally {
      database.close();
    }
  });

  test('does not publish an identity when the temporary SQLite handle cannot prove cleanup', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const databaseRef = createDatabaseRef('tenant-a');
    const closeModes: boolean[] = [];
    let guardReleased = false;

    const error = captureDatabaseError(() =>
      prepareDatabaseBindingIdentityForTesting({
        filePath: prepared.path,
        fileIdentity: prepared.identity,
        databaseRef,
        realmName: 'application',
        initialize: true,
      }, {
        closeDatabase(database, throwOnError) {
          closeModes.push(throwOnError);
          database.close(throwOnError);
          if (throwOnError) throw new Error('injected close-report failure');
        },
        releaseGuard(guard) {
          guard.release();
          guardReleased = true;
        },
      }));

    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(closeModes).toEqual([true, false]);
    expect(guardReleased).toBe(true);
    // The failed call cannot return an identity, but successful cleanup leaves
    // the durable binding verifiable by a later independent attempt.
    expect(prepareDatabaseBindingIdentity({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: 'application',
      initialize: false,
    }).databaseRef).toBe(databaseRef);
  });

  test('proves immediate temporary-handle release on the normal success path', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'tenant-a');
    const databaseRef = createDatabaseRef('tenant-a');
    const closeModes: boolean[] = [];
    let openedDatabase: Database | null = null;

    const identity = prepareDatabaseBindingIdentityForTesting({
      filePath: prepared.path,
      fileIdentity: prepared.identity,
      databaseRef,
      realmName: 'application',
      initialize: true,
    }, {
      closeDatabase(database, throwOnError) {
        openedDatabase = database;
        closeModes.push(throwOnError);
        database.close(throwOnError);
      },
      releaseGuard(guard) {
        guard.release();
      },
    });

    expect(identity.databaseRef).toBe(databaseRef);
    expect(closeModes).toEqual([true]);
    expect(() => openedDatabase!.run('SELECT 1')).toThrow();
  });

  test('aggregates a primary binding failure with a guard-release failure', () => {
    const root = createRoot();
    const prepared = prepareDatabaseFile(root, 'legacy');
    const database = new Database(prepared.path, { create: false, readwrite: true });
    database.run('CREATE TABLE application_data (id TEXT PRIMARY KEY)');
    database.close(true);
    let releaseAttempted = false;

    const error = captureDatabaseError(() =>
      prepareDatabaseBindingIdentityForTesting({
        filePath: prepared.path,
        fileIdentity: prepared.identity,
        databaseRef: createDatabaseRef('legacy'),
        realmName: 'application',
        initialize: true,
      }, {
        closeDatabase(opened, throwOnError) {
          opened.close(throwOnError);
        },
        releaseGuard(guard) {
          guard.release();
          releaseAttempted = true;
          throw new Error('injected guard-release report failure');
        },
      }));

    expect(releaseAttempted).toBe(true);
    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_FAILED',
      retryable: false,
      outcome: 'unknown',
    });
    expect(error.cause).toBeInstanceOf(AggregateError);
    expect((error.cause as AggregateError).errors).toHaveLength(2);
  });
});

function createRoot(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-binding-identity-')),
  );
  roots.push(root);
  return root;
}

function expectDatabaseError(
  operation: () => unknown,
  code: DatabaseError['code'],
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}
