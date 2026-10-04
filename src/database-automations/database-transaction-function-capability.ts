/**
 * database-transaction-function-capability.ts
 *
 * Narrows Zero's revocable writer-command capability for same-commit database
 * functions. In particular, it omits `afterCommit`: external or awaitable
 * effects belong in durable functions and their source-local outbox.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import {
  createDatabaseWriteCommandSession,
  type DatabaseWriteCommandCapability,
} from '../databases/database-write-command-capability';

export interface DatabaseTransactionFunctionCapability extends Omit<
  DatabaseWriteCommandCapability,
  'afterCommit' | 'transaction'
> {
  readonly transaction: <T>(
    operation: (db: DatabaseTransactionFunctionCapability) => T,
  ) => T;
}

export interface DatabaseTransactionFunctionSession {
  readonly capability: DatabaseTransactionFunctionCapability;
  close(): void;
}

const CAPABILITY_METHODS = Object.freeze([
  'insert',
  'create',
  'createStrict',
  'createScoped',
  'update',
  'updateIfCurrent',
  'updateScoped',
  'delete',
  'deleteIfCurrent',
  'deleteScoped',
  'query',
  'list',
  'queryOne',
  'get',
  'getScoped',
  'getIdentity',
  'identityKey',
  'queryByIdentity',
  'upsertByIdentity',
  'updateByIdentity',
  'deleteByIdentity',
] as const satisfies readonly Exclude<
  keyof DatabaseTransactionFunctionCapability,
  'transaction'
>[]);

/** Create a revocable, null-prototype facade for one handler invocation. */
export function createDatabaseTransactionFunctionSession(
  db: ReactiveDB,
  readOnlyTables: readonly string[] = [],
): DatabaseTransactionFunctionSession {
  const session = createDatabaseWriteCommandSession(db, readOnlyTables);
  const projected = Object.create(null) as Record<string, unknown>;
  for (const method of CAPABILITY_METHODS) {
    Object.defineProperty(projected, method, {
      value: session.context.db[method],
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  let capability!: DatabaseTransactionFunctionCapability;
  Object.defineProperty(projected, 'transaction', {
    value: <T>(operation: (db: DatabaseTransactionFunctionCapability) => T): T => {
      if (typeof operation !== 'function') {
        throw new TypeError('Database function transaction requires a function.');
      }
      return session.context.db.transaction(() => operation(capability));
    },
    enumerable: true,
    configurable: false,
    writable: false,
  });
  capability = Object.freeze(projected) as unknown as DatabaseTransactionFunctionCapability;
  return Object.freeze({
    capability,
    close: () => session.close(),
  });
}
