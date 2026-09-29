/**
 * database-binding-identity.ts
 *
 * Durable, immutable binding between one Fabric main file and its opaque
 * logical database reference. This prevents a valid SQLite image copied or
 * restored under another managed filename from silently becoming that tenant.
 */

import { randomUUID } from 'node:crypto';

import { Database } from 'bun:sqlite';

import { DatabaseError } from './database-error';
import {
  normalizeDatabaseRef,
  type DatabaseRef,
} from './database-file';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';

const BINDING_FORMAT_VERSION = 1;
const BINDING_TABLE = '_zero_database_binding_v1';
const INSERT_GUARD = '_zero_database_binding_insert_guard_v1';
const UPDATE_GUARD = '_zero_database_binding_update_guard_v1';
const DELETE_GUARD = '_zero_database_binding_delete_guard_v1';
const INSTANCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const CREATE_BINDING_TABLE_SQL = `
  CREATE TABLE main.${BINDING_TABLE} (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    database_ref TEXT NOT NULL CHECK (length(database_ref) = 64),
    instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
    realm_name TEXT NOT NULL CHECK (length(realm_name) BETWEEN 1 AND 128)
  ) WITHOUT ROWID
`;

interface BindingRow {
  readonly singleton?: unknown;
  readonly format_version?: unknown;
  readonly database_ref?: unknown;
  readonly instance_id?: unknown;
  readonly realm_name?: unknown;
}

interface TableInfoRow {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly notnull?: unknown;
  readonly pk?: unknown;
  readonly dflt_value?: unknown;
}

/** Stable identity returned by both writer and reader readiness proofs. */
export interface DatabaseBindingIdentity {
  readonly databaseRef: DatabaseRef;
  readonly instanceId: string;
  readonly realmName: string;
}

interface DatabaseBindingIdentityCleanup {
  closeDatabase(database: Database, throwOnError: boolean): void;
  releaseGuard(guard: ReturnType<typeof openDatabaseFileIdentityGuard>): void;
}

const PRODUCTION_BINDING_CLEANUP: DatabaseBindingIdentityCleanup = Object.freeze({
  closeDatabase(database: Database, throwOnError: boolean) {
    database.close(throwOnError);
  },
  releaseGuard(guard: ReturnType<typeof openDatabaseFileIdentityGuard>) {
    guard.release();
  },
});

/**
 * Initialize only a file atomically reserved by the current parent, or verify
 * the existing immutable binding. Nonempty unbound/legacy images fail closed.
 */
export function prepareDatabaseBindingIdentity(options: Readonly<{
  filePath: string;
  fileIdentity: DatabaseFileIdentityProof;
  databaseRef: DatabaseRef;
  realmName: string;
  initialize: boolean;
}>): DatabaseBindingIdentity {
  return prepareDatabaseBindingIdentityWithCleanup(
    options,
    PRODUCTION_BINDING_CLEANUP,
  );
}

/** @internal Deterministic cleanup-failure seam; not exported by the package. */
export function prepareDatabaseBindingIdentityForTesting(
  options: Readonly<{
    filePath: string;
    fileIdentity: DatabaseFileIdentityProof;
    databaseRef: DatabaseRef;
    realmName: string;
    initialize: boolean;
  }>,
  cleanup: DatabaseBindingIdentityCleanup,
): DatabaseBindingIdentity {
  return prepareDatabaseBindingIdentityWithCleanup(options, cleanup);
}

function prepareDatabaseBindingIdentityWithCleanup(
  options: Readonly<{
    filePath: string;
    fileIdentity: DatabaseFileIdentityProof;
    databaseRef: DatabaseRef;
    realmName: string;
    initialize: boolean;
  }>,
  cleanup: DatabaseBindingIdentityCleanup,
): DatabaseBindingIdentity {
  const guard = openDatabaseFileIdentityGuard(options.filePath, {
    // Verification may need SQLite to recover/create WAL companion files after
    // a crashed writer. The parent owns this path and liveness-fences actors
    // before admission, so use a non-creating read/write handle in both modes.
    access: 'readwrite',
    expected: options.fileIdentity,
  });
  let database: Database | null = null;
  let identity: DatabaseBindingIdentity | null = null;
  let failure: unknown = null;
  try {
    database = new Database(options.filePath, {
      create: false,
      readwrite: true,
      strict: true,
    });
    guard.assertCurrent();
    if (options.initialize) {
      initializeBinding(database, options.databaseRef, options.realmName);
    }
    identity = readDatabaseBindingIdentity(
      database,
      options.databaseRef,
      options.realmName,
    );
    guard.assertCurrent();
  } catch (error) {
    failure = error instanceof DatabaseError ? error : bindingMismatch(error);
  }

  const cleanupFailures: unknown[] = [];
  if (database) {
    try {
      cleanup.closeDatabase(database, true);
    } catch (error) {
      cleanupFailures.push(error);
      // Request deferred close as a best-effort resource fallback. The binding
      // still fails closed because this does not prove immediate handle release.
      try {
        cleanup.closeDatabase(database, false);
      } catch (fallbackError) {
        cleanupFailures.push(fallbackError);
      }
    }
  }
  try {
    cleanup.releaseGuard(guard);
  } catch (error) {
    cleanupFailures.push(error);
  }

  if (cleanupFailures.length > 0) {
    const causes = failure === null
      ? cleanupFailures
      : [failure, ...cleanupFailures];
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database binding identity cleanup failed.',
      {
        cause: causes.length === 1
          ? causes[0]
          : new AggregateError(causes, 'Database binding identity cleanup failed.'),
        retryable: false,
        outcome: 'unknown',
      },
    );
  }
  if (failure !== null) throw failure;
  if (identity === null) throw bindingMismatch();
  return identity;
}

/** Verify the immutable identity through an already-open actor connection. */
export function readDatabaseBindingIdentity(
  database: Database,
  expectedDatabaseRef: DatabaseRef,
  expectedRealmName: string,
): DatabaseBindingIdentity {
  try {
    assertBindingSchema(database);
    const rows = readAllRows<BindingRow>(database, `
      SELECT singleton, format_version, database_ref, instance_id, realm_name
      FROM main.${BINDING_TABLE}
    `);
    if (rows.length !== 1) throw bindingMismatch();
    const row = rows[0]!;
    const databaseRef = normalizeDatabaseRef(row.database_ref as string);
    if (row.singleton !== 1
      || row.format_version !== BINDING_FORMAT_VERSION
      || databaseRef !== expectedDatabaseRef
      || typeof row.instance_id !== 'string'
      || !INSTANCE_ID_PATTERN.test(row.instance_id)
      || row.realm_name !== expectedRealmName) {
      throw bindingMismatch();
    }
    return Object.freeze({
      databaseRef,
      instanceId: row.instance_id,
      realmName: expectedRealmName,
    });
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw bindingMismatch(error);
  }
}

function initializeBinding(
  database: Database,
  databaseRef: DatabaseRef,
  realmName: string,
): void {
  if (typeof realmName !== 'string'
    || realmName.length === 0
    || realmName.length > 128) {
    throw bindingMismatch();
  }
  database.run('BEGIN IMMEDIATE');
  try {
    const objects = readAllRows(database, `
      SELECT name
      FROM main.sqlite_schema
      WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
    `);
    if (objects.length !== 0) throw bindingMismatch();

    database.run(CREATE_BINDING_TABLE_SQL);
    database.run(`
      INSERT INTO main.${BINDING_TABLE} (
        singleton, format_version, database_ref, instance_id, realm_name
      ) VALUES (1, ?, ?, ?, ?)
    `, [
      BINDING_FORMAT_VERSION,
      databaseRef,
      randomUUID().toLowerCase(),
      realmName,
    ]);
    database.run(`
      CREATE TRIGGER main.${INSERT_GUARD}
      BEFORE INSERT ON ${BINDING_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'zero database binding is immutable');
      END
    `);
    database.run(`
      CREATE TRIGGER main.${UPDATE_GUARD}
      BEFORE UPDATE ON ${BINDING_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'zero database binding is immutable');
      END
    `);
    database.run(`
      CREATE TRIGGER main.${DELETE_GUARD}
      BEFORE DELETE ON ${BINDING_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'zero database binding is immutable');
      END
    `);
    database.run('COMMIT');
  } catch (error) {
    try {
      if (database.inTransaction) database.run('ROLLBACK');
    } catch {
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Database binding initialization rollback failed.',
        { retryable: false, outcome: 'unknown', details: { phase: 'identity' } },
      );
    }
    throw error;
  }
}

function assertBindingSchema(database: Database): void {
  const columns = readAllRows<TableInfoRow>(database, `
    SELECT name, type, "notnull", pk, dflt_value
    FROM pragma_table_info('${BINDING_TABLE}')
    ORDER BY cid ASC
  `);
  const expected = [
    ['singleton', 'INTEGER', 1, 1],
    ['format_version', 'INTEGER', 1, 0],
    ['database_ref', 'TEXT', 1, 0],
    ['instance_id', 'TEXT', 1, 0],
    ['realm_name', 'TEXT', 1, 0],
  ] as const;
  if (columns.length !== expected.length
    || columns.some((column, index) => {
      const shape = expected[index]!;
      return column.name !== shape[0]
        || column.type !== shape[1]
        || column.notnull !== shape[2]
        || column.pk !== shape[3]
        || column.dflt_value !== null;
    })) {
    throw bindingMismatch();
  }

  const guards = readAllRows<{ name?: unknown }>(database, `
    SELECT name
    FROM main.sqlite_schema
    WHERE type = 'trigger'
      AND tbl_name = '${BINDING_TABLE}'
    ORDER BY name ASC
  `);
  const names = guards.map((row) => row.name);
  const expectedNames = [DELETE_GUARD, INSERT_GUARD, UPDATE_GUARD].sort();
  if (names.length !== expectedNames.length
    || names.some((name, index) => name !== expectedNames[index])) {
    throw bindingMismatch();
  }
}

function readAllRows<Row>(database: Database, sql: string): Row[] {
  const statement = database.prepare(sql);
  try {
    return statement.all() as Row[];
  } finally {
    statement.finalize();
  }
}

function bindingMismatch(cause?: unknown): DatabaseError {
  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database file binding identity does not match its assignment.',
    {
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
      outcome: 'not-started',
    },
  );
}
