/** Frozen tracked-data capability for registered writer command handlers. */

import type {
  ReactiveDB,
  ReactiveDBRowScope,
} from '../sync/reactive-db';
import type { IdentityKey } from '../sync/identity';
import type { Change, Row } from '../sync/types';
import { DatabaseError } from './database-error';

/**
 * Tracked application-data surface available to one registered command.
 *
 * The runtime facade deliberately has a null prototype and never exposes the
 * owning ReactiveDB, SQLite handle, schema/lifecycle methods, listeners, or
 * internal-change APIs.
 */
export interface DatabaseWriteCommandCapability {
  readonly insert: (table: string, row: Row) => Change;
  readonly create: (table: string, row: Row) => Change;
  readonly createStrict: (table: string, row: Row) => Change;
  readonly createScoped: (
    table: string,
    row: Row,
    scope: ReactiveDBRowScope,
  ) => Change;
  readonly update: (
    table: string,
    id: string,
    partial: Partial<Row>,
  ) => Change | null;
  readonly updateIfCurrent: (
    table: string,
    id: string,
    partial: Partial<Row>,
    expectedRow: Row,
  ) => Change | null;
  readonly updateScoped: (
    table: string,
    id: string,
    partial: Partial<Row>,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ) => Change | null;
  readonly delete: (table: string, id: string) => Change | null;
  readonly deleteIfCurrent: (
    table: string,
    id: string,
    expectedRow: Row,
  ) => Change | null;
  readonly deleteScoped: (
    table: string,
    id: string,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ) => Change | null;
  readonly query: (table: string) => Row[];
  readonly list: (table: string) => Row[];
  readonly queryOne: (table: string, id: string) => Row | null;
  readonly get: (table: string, id: string) => Row | null;
  readonly getScoped: (
    table: string,
    id: string,
    scope: ReactiveDBRowScope,
  ) => Row | null;
  readonly getIdentity: (table: string) => string[];
  readonly identityKey: (table: string, key: IdentityKey) => string;
  readonly queryByIdentity: (table: string, key: IdentityKey) => Row | null;
  readonly upsertByIdentity: (table: string, row: Row) => Change;
  readonly updateByIdentity: (
    table: string,
    key: IdentityKey,
    partial: Partial<Row>,
  ) => Change | null;
  readonly deleteByIdentity: (
    table: string,
    key: IdentityKey,
  ) => Change | null;
  readonly transaction: <T>(
    operation: (db: DatabaseWriteCommandCapability) => T,
  ) => T;
  readonly afterCommit: (callback: () => unknown) => void;
}

/** Context supplied only to a registered writer command. */
export interface DatabaseWriteCommandContext {
  readonly db: DatabaseWriteCommandCapability;
}

/** Internal revocable lifetime for one registered-command invocation. */
export interface DatabaseWriteCommandSession {
  readonly context: DatabaseWriteCommandContext;
  close(): void;
}

/**
 * Create a revocable facade whose closures are the only reference to the DB.
 * Framework-owned registered tables remain readable but reject every command
 * mutation path supplied through `readOnlyTables`.
 */
export function createDatabaseWriteCommandSession(
  database: ReactiveDB,
  readOnlyTables: readonly string[] = [],
): DatabaseWriteCommandSession {
  let active = true;
  let capability!: DatabaseWriteCommandCapability;
  const protectedTables = new Set(readOnlyTables.map((table) => table.toLowerCase()));
  const methods = Object.create(null) as Record<string, unknown>;
  const assertActive = (): void => {
    if (!active) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database registered-command capability is closed.',
      );
    }
  };
  const activeMethod = <TArgs extends any[], TResult>(
    method: (...args: TArgs) => TResult,
  ) => (...args: TArgs): TResult => {
    assertActive();
    return method(...args);
  };
  const assertWritableTable = (table: string): void => {
    if (typeof table === 'string' && protectedTables.has(table.toLowerCase())) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database registered-command table is read-only.',
      );
    }
  };

  defineMethod(methods, 'insert', activeMethod((table: string, row: Row) => {
    assertWritableTable(table);
    return database.insert(table, row);
  }));
  defineMethod(methods, 'create', activeMethod((table: string, row: Row) => {
    assertWritableTable(table);
    return database.create(table, row);
  }));
  defineMethod(methods, 'createStrict', activeMethod((table: string, row: Row) => {
    assertWritableTable(table);
    return database.createStrict(table, row);
  }));
  defineMethod(methods, 'createScoped', activeMethod((
    table: string,
    row: Row,
    scope: ReactiveDBRowScope,
  ) => {
    assertWritableTable(table);
    return database.createScoped(table, row, scope);
  }));
  defineMethod(methods, 'update', activeMethod((
    table: string,
    id: string,
    partial: Partial<Row>,
  ) => {
    assertWritableTable(table);
    return database.update(table, id, partial);
  }));
  defineMethod(methods, 'updateIfCurrent', activeMethod((
    table: string,
    id: string,
    partial: Partial<Row>,
    expectedRow: Row,
  ) => {
    assertWritableTable(table);
    return database.updateIfCurrent(table, id, partial, expectedRow);
  }));
  defineMethod(methods, 'updateScoped', activeMethod((
    table: string,
    id: string,
    partial: Partial<Row>,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ) => {
    assertWritableTable(table);
    return database.updateScoped(table, id, partial, scope, expectedRow);
  }));
  defineMethod(methods, 'delete', activeMethod((table: string, id: string) => {
    assertWritableTable(table);
    return database.delete(table, id);
  }));
  defineMethod(methods, 'deleteIfCurrent', activeMethod((
    table: string,
    id: string,
    expectedRow: Row,
  ) => {
    assertWritableTable(table);
    return database.deleteIfCurrent(table, id, expectedRow);
  }));
  defineMethod(methods, 'deleteScoped', activeMethod((
    table: string,
    id: string,
    scope: ReactiveDBRowScope,
    expectedRow?: Row,
  ) => {
    assertWritableTable(table);
    return database.deleteScoped(table, id, scope, expectedRow);
  }));
  defineMethod(methods, 'query', activeMethod(
    (table: string) => database.query(table),
  ));
  defineMethod(methods, 'list', activeMethod(
    (table: string) => database.list(table),
  ));
  defineMethod(methods, 'queryOne', activeMethod((table: string, id: string) =>
    database.queryOne(table, id)));
  defineMethod(methods, 'get', activeMethod((table: string, id: string) =>
    database.get(table, id)));
  defineMethod(methods, 'getScoped', activeMethod((
    table: string,
    id: string,
    scope: ReactiveDBRowScope,
  ) => database.getScoped(table, id, scope)));
  defineMethod(methods, 'getIdentity', activeMethod(
    (table: string) => database.getIdentity(table),
  ));
  defineMethod(methods, 'identityKey', activeMethod(
    (table: string, key: IdentityKey) => database.identityKey(table, key),
  ));
  defineMethod(methods, 'queryByIdentity', activeMethod((
    table: string,
    key: IdentityKey,
  ) => database.queryByIdentity(table, key)));
  defineMethod(methods, 'upsertByIdentity', activeMethod((
    table: string,
    row: Row,
  ) => {
    assertWritableTable(table);
    return database.upsertByIdentity(table, row);
  }));
  defineMethod(methods, 'updateByIdentity', activeMethod((
    table: string,
    key: IdentityKey,
    partial: Partial<Row>,
  ) => {
    assertWritableTable(table);
    return database.updateByIdentity(table, key, partial);
  }));
  defineMethod(methods, 'deleteByIdentity', activeMethod((
    table: string,
    key: IdentityKey,
  ) => {
    assertWritableTable(table);
    return database.deleteByIdentity(table, key);
  }));
  defineMethod(methods, 'transaction', activeMethod(<T>(
    operation: (db: DatabaseWriteCommandCapability) => T,
  ): T => {
    if (typeof operation !== 'function') {
      throw new TypeError('Database command transaction requires a function.');
    }
    return database.transaction(() => {
      assertActive();
      return operation(capability);
    });
  }));
  defineMethod(methods, 'afterCommit', activeMethod(
    (callback: () => unknown) => database.afterCommit(callback),
  ));

  capability = Object.freeze(methods) as unknown as DatabaseWriteCommandCapability;
  const context = Object.create(null) as { db: DatabaseWriteCommandCapability };
  Object.defineProperty(context, 'db', {
    value: capability,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return Object.freeze({
    context: Object.freeze(context),
    close(): void {
      active = false;
    },
  });
}

function defineMethod<T extends (...args: any[]) => unknown>(
  target: Record<string, unknown>,
  name: string,
  method: T,
): void {
  Object.defineProperty(target, name, {
    value: Object.freeze(method),
    enumerable: true,
    configurable: false,
    writable: false,
  });
}
