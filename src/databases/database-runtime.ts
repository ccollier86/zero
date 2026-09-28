import type { PlatformSQLiteService } from '../persistence';
import { Migrator, type Migration } from '../migrations';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import type { ReactiveDBConfig, TableSchema } from '../sync/types';

/** Stable purpose assigned to one physical database runtime. */
export type DatabaseRuntimeRole = 'default' | 'named' | 'tenant';

/** ReactiveDB settings that remain meaningful for an injected SQLite service. */
export type DatabaseReactiveConfig = Pick<
  ReactiveDBConfig,
  'clearChangesOnStart' | 'ringBufferDepth'
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

    try {
      if (options.migrate && options.sqlite.mode !== 'ephemeral') {
        runRuntimeMigrations(options);
      }

      db = createReactiveDB({
        ...options.reactive,
        sqlite: options.sqlite,
      });

      for (const [table, schema] of Object.entries(options.tables ?? {})) {
        db.defineTable(table, schema);
      }

      return new DatabaseRuntime(options, db);
    } catch (startupError) {
      const failures: unknown[] = [startupError];
      if (db) {
        try {
          db.dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (options.ownsSQLite) {
        try {
          options.sqlite.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw startupError;
      throw new AggregateError(
        failures,
        `[databases] Database runtime "${options.id}" failed to open and cleanup also failed.`,
      );
    }
  }

  /** Start background checkpoint/snapshot work exactly once. */
  start(): void {
    if (this.closed) {
      throw new Error(`[databases] Database runtime "${this.id}" is closed.`);
    }
    if (this.started) return;
    this.sqlite.start();
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
      this.sqlite.close();
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

function runRuntimeMigrations(options: DatabaseRuntimeOptions): void {
  const migrator = new Migrator({
    database: options.sqlite.raw,
    dbPath: options.sqlite.snapshotPath ?? options.sqlite.path ?? ':memory:',
    migrations: [...(options.migrations ?? [])],
    applyPragmas: false,
    createBackups: options.sqlite.mode !== 'ephemeral',
  });
  try {
    migrator.run();
  } finally {
    migrator.dispose();
  }
  options.sqlite.snapshot?.snapshotSync();
}

function assertDatabaseRuntimeOptions(options: DatabaseRuntimeOptions): void {
  if (!options.id.trim()) {
    throw new Error('[databases] Database runtime id must not be empty.');
  }
  if (options.sqlite.mode === 'ephemeral' && options.migrate) {
    // Preserve createApp's historical behavior: migrations are durable setup,
    // while ephemeral schemas are initialized through ReactiveDB definitions.
    return;
  }
  if (options.migrate && !options.migrations) {
    throw new Error(
      `[databases] Database runtime "${options.id}" enables migrations without a migration registry.`,
    );
  }
}
