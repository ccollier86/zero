/**
 * Path-free, read-only SQL capability for registered realm query handlers.
 *
 * The public facade never exposes Bun's Database/Statement objects. SQL is
 * admitted as one SELECT/WITH read statement and executes on either an actual
 * readonly handle or an identity-verified writer handle fenced by query_only.
 */

import {
  Database,
  type SQLQueryBindings,
  type Statement,
} from 'bun:sqlite';
import { DatabaseError } from './database-error';
import type { DatabaseRuntime } from './database-runtime';
import { assertDatabaseReadQuerySql } from './database-read-query-sql';

export { assertDatabaseReadQuerySql } from './database-read-query-sql';

type NormalizedQueryParams<
  TParams extends SQLQueryBindings | SQLQueryBindings[],
> = TParams extends any[] ? TParams : [TParams];

/** Read-result-only prepared statement exposed to registered query handlers. */
export interface DatabaseReadQueryStatement<
  TRow = unknown,
  TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[],
> {
  readonly all: (...params: NormalizedQueryParams<TParams>) => TRow[];
  readonly get: (...params: NormalizedQueryParams<TParams>) => TRow | null;
  readonly iterate: (
    ...params: NormalizedQueryParams<TParams>
  ) => IterableIterator<TRow>;
  readonly values: (
    ...params: NormalizedQueryParams<TParams>
  ) => Array<Array<string | bigint | number | boolean | Uint8Array>>;
  readonly raw: (
    ...params: NormalizedQueryParams<TParams>
  ) => Array<Array<Uint8Array | null>>;
}

/** Path-free SQL compiler exposing no mutable or native database surface. */
export interface DatabaseReadQueryConnection {
  readonly query: <
    TRow = unknown,
    TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[],
  >(sql: string) => DatabaseReadQueryStatement<TRow, TParams>;
  readonly prepare: <
    TRow = unknown,
    TParams extends SQLQueryBindings | SQLQueryBindings[] = SQLQueryBindings[],
  >(
    sql: string,
    params?: TParams,
  ) => DatabaseReadQueryStatement<TRow, TParams>;
}

/** Context supplied to one synchronous registered read handler. */
export interface DatabaseReadQueryContext {
  readonly database: DatabaseReadQueryConnection;
}

/** Internal per-handler statement/connection lifetime. */
export interface DatabaseReadQuerySession {
  readonly context: DatabaseReadQueryContext;
  close(): void;
}

/** Wrap an existing actor-owned readonly connection without exposing it. */
export function createDatabaseReadQuerySession(
  database: Database,
): DatabaseReadQuerySession {
  return new ReadQuerySession(database, false);
}

/**
 * Create a readonly query session for a writer-lane handler. File runtimes
 * retain the actor's already verified handle while its serialized read boundary
 * has query_only enabled; hot/ephemeral runtimes use a readonly deserialized
 * image of the exact current database state.
 */
export function openDatabaseWriterReadQuerySession(
  runtime: DatabaseRuntime,
): DatabaseReadQuerySession {
  let database: Database | null = null;
  let primaryFailure: unknown | null = null;
  try {
    if (runtime.sqlite.mode === 'file') {
      assertWriterQueryOnly(runtime.sqlite.raw);
      // Never reopen the canonical pathname here. The actor binding has already
      // proved this exact native handle's physical and logical identity, while a
      // pathname can be renamed or replaced after that proof.
      return new ReadQuerySession(runtime.sqlite.raw, false);
    }

    const image = runtime.sqlite.raw.serialize();
    database = Database.deserialize(image, {
      readonly: true,
      strict: true,
    });
    return new ReadQuerySession(database, true);
  } catch (error) {
    primaryFailure = error;
  }

  const cleanupFailures: unknown[] = [];
  if (database) {
    try {
      database.close(true);
    } catch (error) {
      cleanupFailures.push(error);
      try { database.close(false); } catch (fallback) {
        cleanupFailures.push(fallback);
      }
    }
  }
  if (cleanupFailures.length > 0) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database registered-query connection cleanup failed.',
      {
        cause: new AggregateError(
          [primaryFailure, ...cleanupFailures],
          'Registered-query connection open and cleanup failed.',
        ),
        retryable: false,
        outcome: null,
      },
    );
  }
  if (primaryFailure instanceof DatabaseError) throw primaryFailure;
  throw new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database registered-query connection could not be opened.',
    { cause: primaryFailure, retryable: false, outcome: null },
  );
}

/** Close every prepared statement while preserving a primary query failure. */
export function withDatabaseReadQuerySession<T>(
  session: DatabaseReadQuerySession,
  run: (context: DatabaseReadQueryContext) => T,
): T {
  let failed = false;
  let primaryFailure: unknown;
  let result!: T;
  try {
    result = run(session.context);
  } catch (error) {
    failed = true;
    primaryFailure = error;
  }
  try {
    session.close();
  } catch (cleanupFailure) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database registered-query cleanup failed.',
      {
        cause: failed
          ? new AggregateError(
            [primaryFailure, cleanupFailure],
            'Registered query and cleanup failed.',
          )
          : cleanupFailure,
        retryable: false,
        outcome: null,
      },
    );
  }
  if (failed) throw primaryFailure;
  return result;
}

class ReadQuerySession implements DatabaseReadQuerySession {
  readonly context: DatabaseReadQueryContext;
  readonly #database: Database;
  readonly #ownsDatabase: boolean;
  readonly #statements = new Set<Statement<unknown, any[]>>();
  #closing = false;
  #databaseClosed = false;
  #closed = false;

  constructor(database: Database, ownsDatabase: boolean) {
    this.#database = database;
    this.#ownsDatabase = ownsDatabase;
    const connection = nullPrototypeObject<DatabaseReadQueryConnection>({
      query: <TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(
        sql: string,
      ) => this.#prepare<TRow, TParams>(sql),
      prepare: <TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(
        sql: string,
        params?: TParams,
      ) => this.#prepare<TRow, TParams>(sql, params),
    });
    this.context = nullPrototypeObject({ database: connection });
  }

  close(): void {
    if (this.#closed) return;
    this.#closing = true;
    const failures: unknown[] = [];
    for (const statement of [...this.#statements]) {
      try {
        statement.finalize();
        this.#statements.delete(statement);
      } catch (error) {
        failures.push(error);
      }
    }
    // An owned connection is the final authority for all of its statements.
    // Try to close it even when an explicit statement finalizer failed: the
    // forced fallback is the only remaining way to release that native handle.
    if (this.#ownsDatabase && !this.#databaseClosed) {
      try {
        this.#database.close(true);
        this.#databaseClosed = true;
        this.#statements.clear();
      } catch (error) {
        failures.push(error);
        try {
          this.#database.close(false);
          this.#databaseClosed = true;
          this.#statements.clear();
        } catch (fallback) {
          failures.push(fallback);
        }
      }
    }
    // A cleanup error must never resurrect a capability whose backing
    // resources are partially or fully released.
    this.#closed = true;
    if (failures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database registered-query resources could not be released.',
        {
          cause: failures.length === 1
            ? failures[0]
            : new AggregateError(failures, 'Registered-query cleanup failed.'),
          retryable: false,
          outcome: null,
        },
      );
    }
  }

  #prepare<
    TRow,
    TParams extends SQLQueryBindings | SQLQueryBindings[],
  >(
    sql: string,
    params?: TParams,
  ): DatabaseReadQueryStatement<TRow, TParams> {
    this.#assertOpen();
    assertDatabaseReadQuerySql(sql);
    let statement: Statement<unknown, any[]>;
    try {
      statement = params === undefined
        ? this.#database.prepare(sql)
        : this.#database.prepare(sql, params);
    } catch (cause) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database registered query could not be prepared.',
        { cause, retryable: false, outcome: null },
      );
    }
    this.#statements.add(statement);
    return createStatementFacade<TRow, TParams>(
      statement,
      () => this.#assertOpen(),
    );
  }

  #assertOpen(): void {
    if (this.#closing || this.#closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database registered-query capability is closed.',
      );
    }
  }
}

function createStatementFacade<
  TRow,
  TParams extends SQLQueryBindings | SQLQueryBindings[],
>(
  statement: Statement<unknown, any[]>,
  assertOpen: () => void,
): DatabaseReadQueryStatement<TRow, TParams> {
  type Params = NormalizedQueryParams<TParams>;
  const execute = <T>(run: () => T): T => {
    assertOpen();
    try {
      return run();
    } catch (cause) {
      if (cause instanceof DatabaseError) throw cause;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database registered query execution failed.',
        { cause, retryable: false, outcome: null },
      );
    }
  };
  return nullPrototypeObject<DatabaseReadQueryStatement<TRow, TParams>>({
    all: (...params: Params) => execute(
      () => statement.all(...params) as TRow[],
    ),
    get: (...params: Params) => execute(
      () => statement.get(...params) as TRow | null,
    ),
    iterate: (...params: Params) => guardedIterator(
      statement,
      params,
      assertOpen,
    ) as IterableIterator<TRow>,
    values: (...params: Params) => execute(
      () => statement.values(...params),
    ),
    raw: (...params: Params) => execute(
      () => statement.raw(...params),
    ),
  });
}

function* guardedIterator(
  statement: Statement<unknown, any[]>,
  params: readonly SQLQueryBindings[],
  assertOpen: () => void,
): IterableIterator<unknown> {
  assertOpen();
  let iterator: IterableIterator<unknown>;
  try {
    iterator = statement.iterate(...params);
  } catch (cause) {
    throw queryExecutionFailed(cause);
  }
  while (true) {
    assertOpen();
    let next: IteratorResult<unknown>;
    try {
      next = iterator.next();
    } catch (cause) {
      throw queryExecutionFailed(cause);
    }
    if (next.done) return;
    yield next.value;
  }
}

function nullPrototypeObject<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, fields));
}

function queryExecutionFailed(cause: unknown): DatabaseError {
  if (cause instanceof DatabaseError) return cause;
  return new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database registered query execution failed.',
    { cause, retryable: false, outcome: null },
  );
}

function assertWriterQueryOnly(database: Database): void {
  const row = database.query('PRAGMA query_only').get() as Record<
    string,
    unknown
  > | null;
  const value = row ? Object.values(row)[0] : null;
  if (value === 1) return;
  throw new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database registered-query writer guard is unavailable.',
    { retryable: false, outcome: null },
  );
}
