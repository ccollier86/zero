/** Exact proof that an open ReactiveDB handle owns one canonical system file. */

import { randomUUID } from 'node:crypto';

import { Database } from 'bun:sqlite';

import { ReactiveDB } from '../sync/reactive-db';
import { DatabaseError } from './database-error';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';
import {
  canonicalizeDatabasePathCandidate,
  databaseOwnershipPathKey,
} from './database-path-ownership';

const SYSTEM_BINDING_TABLE = '_zero_system_database_binding_probe_v1';
const MAX_BINDING_ATTEMPTS = 8;

export interface DatabaseSystemHandleBinding {
  readonly canonicalPath: string;
  readonly fileIdentity: DatabaseFileIdentityProof;
}

/**
 * Prove both pathname identity and live-handle identity.
 *
 * PRAGMA database_list alone is insufficient after a pathname replacement:
 * SQLite may retain the old unlinked inode while reporting the old pathname.
 * A fresh nonce committed through the live handle and read through a retained,
 * no-follow path binding closes that gap. Bounded retries tolerate another
 * legitimate Zero process refreshing the same probe concurrently.
 */
export function proveDatabaseSystemHandleBinding(
  systemDB: ReactiveDB,
  configuredPath: string,
): DatabaseSystemHandleBinding {
  if (!(systemDB instanceof ReactiveDB)
    || typeof configuredPath !== 'string'
    || configuredPath.length === 0) {
    throw bindingInvalid();
  }

  let canonicalConfiguredPath: string;
  let canonicalHandlePath: string;
  try {
    canonicalConfiguredPath = canonicalizeDatabasePathCandidate(configuredPath);
    canonicalHandlePath = canonicalizeDatabasePathCandidate(
      readMainDatabasePath(systemDB.getRawDatabase()),
    );
  } catch {
    throw bindingInvalid();
  }
  if (databaseOwnershipPathKey(canonicalConfiguredPath)
    !== databaseOwnershipPathKey(canonicalHandlePath)) {
    throw bindingInvalid();
  }

  const identity = openDatabaseFileIdentityGuard(canonicalConfiguredPath, {
    access: 'read',
  });
  let reader: Database | null = null;
  let liveStatement: ReturnType<Database['prepare']> | null = null;
  let readStatement: ReturnType<Database['prepare']> | null = null;
  let result: DatabaseSystemHandleBinding | null = null;
  let failure: unknown = null;
  try {
    const live = systemDB.getRawDatabase();
    live.run(`
      CREATE TABLE IF NOT EXISTS ${SYSTEM_BINDING_TABLE} (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        binding_nonce TEXT NOT NULL
      )
    `);
    liveStatement = live.prepare(`
      INSERT INTO ${SYSTEM_BINDING_TABLE} (singleton, binding_nonce)
      VALUES (1, ?)
      ON CONFLICT(singleton) DO UPDATE SET binding_nonce = excluded.binding_nonce
    `);

    reader = new Database(canonicalConfiguredPath, {
      readonly: true,
      strict: true,
    });
    reader.run('PRAGMA busy_timeout = 5000');
    reader.run('PRAGMA query_only = ON');
    identity.assertCurrent();
    readStatement = reader.prepare(`
      SELECT binding_nonce
      FROM ${SYSTEM_BINDING_TABLE}
      WHERE singleton = 1
    `);

    for (let attempt = 0; attempt < MAX_BINDING_ATTEMPTS; attempt += 1) {
      const nonce = randomUUID();
      liveStatement.run(nonce);
      identity.assertCurrent();
      const row = readStatement.get() as { binding_nonce?: unknown } | null;
      identity.assertCurrent();
      if (row?.binding_nonce === nonce) {
        result = Object.freeze({
          canonicalPath: canonicalConfiguredPath,
          fileIdentity: identity.proof,
        });
        break;
      }
    }
    if (!result) failure = bindingInvalid();
  } catch (error) {
    failure = error instanceof DatabaseError ? error : bindingInvalid();
  }

  const cleanupFailed = closeBindingProbe({
    liveStatement,
    readStatement,
    reader,
    releaseIdentity: () => identity.release(),
  });
  if (cleanupFailed) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'System database binding proof cleanup failed.',
      { retryable: false, outcome: 'unknown' },
    );
  }
  if (failure) throw bindingInvalid();
  return result!;
}

function readMainDatabasePath(database: Database): string {
  const rows = database.query('PRAGMA database_list').all() as Array<{
    name?: unknown;
    file?: unknown;
  }>;
  const main = rows.find((row) => row.name === 'main');
  if (typeof main?.file !== 'string' || main.file.length === 0) {
    throw bindingInvalid();
  }
  return main.file;
}

function closeBindingProbe(input: Readonly<{
  liveStatement: ReturnType<Database['prepare']> | null;
  readStatement: ReturnType<Database['prepare']> | null;
  reader: Database | null;
  releaseIdentity: () => void;
}>): boolean {
  let failed = false;
  const close = (operation: () => void): void => {
    try {
      operation();
    } catch {
      failed = true;
    }
  };
  if (input.readStatement) close(() => input.readStatement!.finalize());
  if (input.liveStatement) close(() => input.liveStatement!.finalize());
  if (input.reader) close(() => input.reader!.close(true));
  close(input.releaseIdentity);
  return failed;
}

function bindingInvalid(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'System database handle does not match its configured file binding.',
    { retryable: false, outcome: 'not-started' },
  );
}
