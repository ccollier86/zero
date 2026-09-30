import type { PlatformSQLiteService } from '../persistence';
import { Migrator, type Migration } from '../migrations';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { ReactiveDBConfig, TableSchema } from '../sync/types';
import { DatabaseError, isDatabaseError } from './database-error';

/** Stable purpose assigned to one physical database runtime. */
export type DatabaseRuntimeRole = 'system' | 'default' | 'service' | 'named' | 'tenant';

/** ReactiveDB settings that remain meaningful for an injected SQLite service. */
export type DatabaseReactiveConfig = Pick<
  ReactiveDBConfig,
  'clearChangesOnStart' | 'ringBufferDepth' | 'observability'
>;

/** Construction contract for exactly one physical SQLite/ReactiveDB runtime. */
export interface DatabaseRuntimeOptions {
  /** Opaque logical identifier. It is never interpreted as a filesystem path. */
  id: string;
  /** Runtime purpose used by diagnostics and future realm routing. */
  role: DatabaseRuntimeRole;
  /** SQLite service dedicated to this physical database. */
  sqlite: PlatformSQLiteService;
  /** Whether this runtime closes the SQLite service. */
  ownsSQLite: boolean;
  /** Reactive change-log settings for this physical database. */
  reactive?: DatabaseReactiveConfig;
  /** Ordered migration registry assigned specifically to this database role. */
  migrations?: readonly Migration[];
  /** Run the assigned migration registry before ReactiveDB is created. */
  migrate?: boolean;
  /** Optional app tables to initialize before the runtime is published. */
  tables?: Readonly<Record<string, TableSchema>>;
  /** Optional migration-log sink. Actor runtimes provide a silent local sink. */
  migrationLog?: (...args: unknown[]) => void;
}

/** Cheap runtime state suitable for doctor output and lifecycle assertions. */
export interface DatabaseRuntimeDiagnostics {
  id: string;
  role: DatabaseRuntimeRole;
  started: boolean;
  closed: boolean;
  sqlite: ReturnType<PlatformSQLiteService['diagnostics']>;
}

/**
 * One physical Zero database.
 *
 * The runtime owns ordering, not global routing: migrations complete before
 * ReactiveDB prepares its change log, and ReactiveDB is disposed before an
 * owned SQLite handle is closed.
 */
export class DatabaseRuntime {
  readonly id: string;
  readonly role: DatabaseRuntimeRole;
  readonly sqlite: PlatformSQLiteService;
  readonly db: ReactiveDB;

  private readonly ownsSQLite: boolean;
  private started = false;
  private databaseDisposed = false;
  private sqliteClosed = false;
  private closed = false;

  private constructor(
    options: DatabaseRuntimeOptions,
    db: ReactiveDB,
  ) {
    this.id = options.id;
    this.role = options.role;
    this.sqlite = options.sqlite;
    this.ownsSQLite = options.ownsSQLite;
    this.db = db;
  }

  /** Open, migrate, and initialize one runtime without starting background loops. */
  static open(options: DatabaseRuntimeOptions): DatabaseRuntime {
    assertDatabaseRuntimeOptions(options);
    let db: ReactiveDB | null = null;
    let phase: DatabaseRuntimeStartupPhase = 'storage-limit';

    try {
      const hotPageBudget = captureHotPageBudget(options.sqlite);
      if (options.migrate && options.sqlite.mode !== 'ephemeral') {
        phase = 'migration';
        runRuntimeMigrations(options);
        phase = 'storage-limit';
        enforceHotPageBudget(options.sqlite, hotPageBudget);
        phase = 'migration-durability';
        establishMigrationDurability(options.sqlite);
      }

      phase = 'reactive-schema';
      db = createReactiveDB({
        ...options.reactive,
        sqlite: options.sqlite,
      });

      for (const [table, schema] of Object.entries(options.tables ?? {})) {
        db.defineTable(table, schema);
      }
      phase = 'storage-limit';
      enforceHotPageBudget(options.sqlite, hotPageBudget);

      return new DatabaseRuntime(options, db);
    } catch (startupError) {
      const classifiedError = classifyStartupError(
        startupError,
        phase,
        options.sqlite.mode,
      );
      const failures: unknown[] = [classifiedError];
      if (db) {
        try {
          db.dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (options.ownsSQLite) {
        if (options.sqlite.abort) {
          try {
            options.sqlite.abort();
          } catch (error) {
            failures.push(error);
          }
        } else if (options.sqlite.mode === 'ephemeral') {
          try {
            options.sqlite.close();
          } catch (error) {
            failures.push(error);
          }
        } else {
          // A compatibility implementation without the additive abort seam
          // cannot safely close rejected durable startup state: close may
          // publish a hot snapshot or checkpoint partially initialized work.
          // Preserve the ambiguous owned authority for actor quarantine.
          failures.push(new Error(
            'Owned durable SQLite startup state cannot be discarded safely.',
          ));
        }
      }
      if (failures.length === 1) throw classifiedError;
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database runtime startup cleanup failed.',
        {
          cause: new AggregateError(
            failures,
            'Database runtime startup and cleanup failed.',
          ),
          retryable: false,
          outcome: 'unknown',
        },
      );
    }
  }

  /** Start background checkpoint/snapshot work exactly once. */
  start(): void {
    if (this.closed) {
      throw new DatabaseError(
        'DATABASE_CLOSED',
        'Database runtime is closed.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    if (this.started) return;
    try {
      this.sqlite.start();
    } catch (cause) {
      if (isDatabaseError(cause)) throw cause;
      throw new DatabaseError(
        'DATABASE_OPEN_FAILED',
        'Database runtime background services could not start.',
        { cause, retryable: true, outcome: 'not-started' },
      );
    }
    this.started = true;
  }

  /**
   * Dispose ReactiveDB before closing an owned SQLite service.
   *
   * If ReactiveDB refuses disposal because work is still active, the SQLite
   * handle remains open so callers cannot observe a half-closed connection.
   */
  close(): void {
    if (this.closed) return;

    if (!this.databaseDisposed) {
      this.db.dispose();
      this.databaseDisposed = true;
    }

    if (this.ownsSQLite && !this.sqliteClosed) {
      try {
        this.sqlite.close();
      } catch (cause) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database runtime cleanup failed.',
          { cause, retryable: false, outcome: 'unknown' },
        );
      }
      this.sqliteClosed = true;
    }

    this.started = false;
    this.closed = true;
  }

  diagnostics(): DatabaseRuntimeDiagnostics {
    return {
      id: this.id,
      role: this.role,
      started: this.started,
      closed: this.closed,
      sqlite: this.sqlite.diagnostics(),
    };
  }
}

type DatabaseRuntimeStartupPhase =
  | 'storage-limit'
  | 'migration'
  | 'migration-durability'
  | 'reactive-schema';

function classifyStartupError(
  error: unknown,
  phase: DatabaseRuntimeStartupPhase,
  storageMode: PlatformSQLiteService['mode'],
): DatabaseError {
  // Cleanup ambiguity must remain an unknown outcome, but DatabaseRuntime is a
  // package-exported boundary and must not leak an untyped AggregateError.
  if (error instanceof AggregateError) {
    return new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database runtime startup cleanup failed.',
      { cause: error, retryable: false, outcome: 'unknown' },
    );
  }
  if (error instanceof DatabaseError && error.outcome === 'unknown') {
    return error;
  }
  if (error instanceof DatabaseError && error.code === 'DATABASE_CONFIG_INVALID') {
    return error;
  }

  if (storageMode === 'hot' && isSQLiteFull(error)) {
    return hotRuntimeLimitExceeded(phase);
  }

  if (phase === 'storage-limit') {
    return new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Database storage limits could not be established.',
      {
        cause: error,
        retryable: true,
        outcome: 'not-started',
        details: { phase: 'configure' },
      },
    );
  }

  if (phase === 'migration') {
    return new DatabaseError(
      'DATABASE_MIGRATION_FAILED',
      'Database migration failed.',
      {
        cause: error,
        retryable: false,
        outcome: 'not-started',
        details: { phase: 'migration' },
      },
    );
  }

  if (phase === 'migration-durability') {
    return new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Database migration durability could not be established.',
      {
        cause: error,
        retryable: true,
        outcome: 'not-started',
        details: { phase: 'durability' },
      },
    );
  }

  return new DatabaseError(
    'DATABASE_SCHEMA_MISMATCH',
    'Database schema is incompatible with the configured runtime.',
    {
      cause: error,
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'reactive-schema' },
    },
  );
}

function runRuntimeMigrations(options: DatabaseRuntimeOptions): void {
  let migrator: Migrator | null = null;
  let migrationFailure: unknown | null = null;
  try {
    migrator = new Migrator({
      database: options.sqlite.raw,
      dbPath: options.sqlite.snapshotPath ?? options.sqlite.path ?? ':memory:',
      migrations: [...(options.migrations ?? [])],
      applyPragmas: false,
      createBackups: options.sqlite.mode !== 'ephemeral',
      ...(options.migrationLog === undefined
        ? {}
        : { log: options.migrationLog }),
    });
    migrator.run();
  } catch (error) {
    migrationFailure = error;
  }

  if (migrator) {
    try {
      migrator.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        migrationFailure === null
          ? [cleanupError]
          : [migrationFailure, cleanupError],
        'Database migration cleanup failed.',
      );
    }
  }

  if (migrationFailure !== null) throw migrationFailure;
}

function establishMigrationDurability(sqlite: PlatformSQLiteService): void {
  if (!sqlite.snapshot?.isEnabled) return;
  const snapshot = sqlite.snapshot.snapshotSyncDetailed();
  if (snapshot.status !== 'written') {
    throw new Error(
      'Database migrations could not establish their durability boundary.',
      snapshot.status === 'failed' ? { cause: snapshot.error } : undefined,
    );
  }
}

interface HotPageBudget {
  readonly maxBytes: number;
}

/** Capture the effective connection-local hot limit before app code can alter it. */
function captureHotPageBudget(
  sqlite: PlatformSQLiteService,
): HotPageBudget | null {
  if (sqlite.mode !== 'hot') return null;
  const pageSize = readPositivePragmaInteger(sqlite, 'page_size');
  const maxPages = readPositivePragmaInteger(sqlite, 'max_page_count');
  const maxBytes = pageSize * maxPages;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < pageSize) {
    throw new Error('SQLite reported an invalid hot page budget.');
  }
  return Object.freeze({ maxBytes });
}

/** Restore the captured byte budget after migrations and table initialization. */
function enforceHotPageBudget(
  sqlite: PlatformSQLiteService,
  budget: HotPageBudget | null,
): void {
  if (budget === null) return;
  const pageSize = readPositivePragmaInteger(sqlite, 'page_size');
  const pageCount = readNonNegativePragmaInteger(sqlite, 'page_count');
  const currentMaxPages = readPositivePragmaInteger(sqlite, 'max_page_count');
  const budgetPages = Math.floor(budget.maxBytes / pageSize);
  const targetPages = Math.min(currentMaxPages, budgetPages);
  if (targetPages < 1 || pageCount > targetPages) {
    throw hotRuntimeLimitExceeded('storage-limit');
  }
  const applied = readNonNegativePragmaInteger(
    sqlite,
    `max_page_count = ${targetPages}`,
  );
  if (applied < pageCount || applied > targetPages) {
    throw hotRuntimeLimitExceeded('storage-limit');
  }
}

function readPositivePragmaInteger(
  sqlite: PlatformSQLiteService,
  pragma: string,
): number {
  const value = readPragmaInteger(sqlite, pragma);
  if (value <= 0) throw new Error('SQLite did not report a positive pragma value.');
  return value;
}

function readNonNegativePragmaInteger(
  sqlite: PlatformSQLiteService,
  pragma: string,
): number {
  const value = readPragmaInteger(sqlite, pragma);
  if (value < 0) throw new Error('SQLite did not report a non-negative pragma value.');
  return value;
}

function readPragmaInteger(
  sqlite: PlatformSQLiteService,
  pragma: string,
): number {
  const row = sqlite.raw.query(`PRAGMA ${pragma}`).get() as
    | Record<string, unknown>
    | null;
  const value = row ? Object.values(row)[0] : null;
  if (!Number.isSafeInteger(value)) {
    throw new Error('SQLite did not report a bounded pragma value.');
  }
  return value as number;
}

function hotRuntimeLimitExceeded(
  phase: DatabaseRuntimeStartupPhase,
): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Hot SQLite database exceeds the configured memory limit.',
    {
      retryable: false,
      outcome: 'not-started',
      details: {
        phase: phase === 'migration' ? 'migration' : 'runtime-schema',
        reason: 'max-bytes',
      },
    },
  );
}

function isSQLiteFull(error: unknown): boolean {
  let cursor: unknown = error;
  for (let depth = 0; cursor && depth < 6; depth += 1) {
    if (safeErrorCode(cursor)?.startsWith('SQLITE_FULL') === true) return true;
    cursor = safeErrorCause(cursor);
  }
  return false;
}

function safeErrorCode(error: unknown): string | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && 'value' in descriptor
      && typeof descriptor.value === 'string'
      && /^SQLITE_[A-Z0-9_]{1,64}$/u.test(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function safeErrorCause(error: unknown): unknown {
  try {
    if (!error || typeof error !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'cause');
    return descriptor && 'value' in descriptor ? descriptor.value : null;
  } catch {
    return null;
  }
}

function assertDatabaseRuntimeOptions(options: DatabaseRuntimeOptions): void {
  if (!options.id.trim()) {
    throw invalidRuntimeConfig('Database runtime id must not be empty.');
  }
  if (options.role !== 'system'
    && options.role !== 'default'
    && options.role !== 'service'
    && options.role !== 'named'
    && options.role !== 'tenant') {
    throw invalidRuntimeConfig('Database runtime role is invalid.');
  }
  if (options.reactive?.ringBufferDepth !== undefined
    && (!Number.isSafeInteger(options.reactive.ringBufferDepth)
      || options.reactive.ringBufferDepth < 1)) {
    throw invalidRuntimeConfig(
      'Database runtime ring-buffer depth must be a positive safe integer.',
    );
  }
  if (options.migrationLog !== undefined
    && typeof options.migrationLog !== 'function') {
    throw invalidRuntimeConfig('Database runtime migration logger is invalid.');
  }
  if (options.sqlite.mode === 'ephemeral' && options.migrate) {
    // Preserve createApp's historical behavior: migrations are durable setup,
    // while ephemeral schemas are initialized through ReactiveDB definitions.
    return;
  }
  if (options.migrate && !options.migrations) {
    throw invalidRuntimeConfig(
      'Database runtime migrations require a migration registry.',
    );
  }
}

function invalidRuntimeConfig(message: string): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    message,
    { retryable: false, outcome: 'not-started' },
  );
}
