/** Construction-time ownership for the system and application database runtimes. */

import {
  DatabaseError,
  DatabaseManager,
  DatabaseRuntime,
} from '../../databases';
import { migrations } from '../../migrations';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import {
  createPlatformSQLiteService,
  type PlatformSQLiteService,
} from '../../persistence';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ResolvedConfig } from './types';

export interface OpenedBaseDatabaseRuntimes {
  readonly systemRuntime: DatabaseRuntime;
  readonly applicationRuntime: DatabaseRuntime;
  readonly removeTemporarySystemCleanup: () => void;
  readonly removeTemporaryApplicationCleanup: () => void;
}

/**
 * Tracks ownership through createApp's construction window so every partial
 * failure closes exactly the resources that were acquired before publication.
 */
export class AppDatabaseBootstrap {
  readonly ownsApplicationSQLite: boolean;
  readonly ownsSystemSQLite: boolean;

  applicationSQLite: PlatformSQLiteService | null = null;
  systemSQLite: PlatformSQLiteService | null = null;
  applicationRuntime: DatabaseRuntime | null = null;
  systemRuntime: DatabaseRuntime | null = null;

  private applicationRuntimeOpenAttempted = false;
  private systemRuntimeOpenAttempted = false;
  private manager: DatabaseManager | null = null;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly runtime: ZeroAppRuntime,
    private readonly observability: PlatformObservabilityRuntime,
  ) {
    this.ownsApplicationSQLite = !config.db.sqlite;
    this.ownsSystemSQLite = !config.systemDb.sqlite;
  }

  openSQLiteServices(): {
    readonly application: PlatformSQLiteService;
    readonly system: PlatformSQLiteService;
  } {
    this.applicationSQLite = this.config.db.sqlite
      ?? createPlatformSQLiteService(this.config.db, {
        observability: this.observability,
      });
    this.systemSQLite = this.config.systemDb.sqlite
      ?? createPlatformSQLiteService(this.config.systemDb, {
        observability: this.observability,
      });
    return {
      application: this.applicationSQLite,
      system: this.systemSQLite,
    };
  }

  openBaseRuntimes(): OpenedBaseDatabaseRuntimes {
    const applicationSQLite = this.requireApplicationSQLite();
    const systemSQLite = this.requireSystemSQLite();

    this.systemRuntimeOpenAttempted = true;
    let openedSystemRuntime: DatabaseRuntime;
    try {
      openedSystemRuntime = DatabaseRuntime.open({
        id: 'system',
        role: 'system',
        sqlite: systemSQLite,
        ownsSQLite: this.ownsSystemSQLite,
        reactive: {
          clearChangesOnStart: this.config.systemDb.clearChangesOnStart,
          ringBufferDepth: this.config.systemDb.ringBufferDepth,
          observability: this.observability,
        },
        migrations,
        migrate: shouldRunMigrations(systemSQLite, this.config.migrate),
      });
    } catch (error) {
      if (isPreOwnershipDatabaseConfigurationError(error)) {
        this.systemRuntimeOpenAttempted = false;
      }
      throw error;
    }
    this.systemRuntime = openedSystemRuntime;
    const removeTemporarySystemCleanup = this.runtime.addCleanup(
      () => openedSystemRuntime.close(),
    );

    this.applicationRuntimeOpenAttempted = true;
    let openedApplicationRuntime: DatabaseRuntime;
    try {
      openedApplicationRuntime = DatabaseRuntime.open({
        id: 'default',
        role: 'default',
        sqlite: applicationSQLite,
        ownsSQLite: this.ownsApplicationSQLite,
        reactive: {
          clearChangesOnStart: this.config.db.clearChangesOnStart,
          ringBufferDepth: this.config.db.ringBufferDepth,
          observability: this.observability,
        },
        migrate: false,
      });
    } catch (error) {
      if (isPreOwnershipDatabaseConfigurationError(error)) {
        this.applicationRuntimeOpenAttempted = false;
      }
      throw error;
    }
    this.applicationRuntime = openedApplicationRuntime;
    const removeTemporaryApplicationCleanup = this.runtime.addCleanup(
      () => openedApplicationRuntime.close(),
    );

    return {
      systemRuntime: openedSystemRuntime,
      applicationRuntime: openedApplicationRuntime,
      removeTemporarySystemCleanup,
      removeTemporaryApplicationCleanup,
    };
  }

  adoptManager(manager: DatabaseManager): void {
    this.manager = manager;
  }

  async fail(startupError: unknown): Promise<never> {
    const failures = [startupError];
    try {
      await this.runtime.dispose();
    } catch (error) {
      failures.push(error);
    }

    if (this.manager) {
      try {
        await this.manager.close();
      } catch (error) {
        failures.push(error);
      }
    } else {
      closeFailedRuntime(
        this.applicationRuntime,
        this.applicationSQLite,
        this.ownsApplicationSQLite,
        this.applicationRuntimeOpenAttempted,
        failures,
      );
      closeFailedRuntime(
        this.systemRuntime,
        this.systemSQLite,
        this.ownsSystemSQLite,
        this.systemRuntimeOpenAttempted,
        failures,
      );
    }

    if (failures.length === 1) throw startupError;
    throw new AggregateError(
      failures,
      '[app] App creation failed and one or more owned resources also failed to close.',
    );
  }

  private requireApplicationSQLite(): PlatformSQLiteService {
    if (!this.applicationSQLite) {
      throw startupInvariant(
        'Application SQLite service is unavailable during database startup.',
      );
    }
    return this.applicationSQLite;
  }

  private requireSystemSQLite(): PlatformSQLiteService {
    if (!this.systemSQLite) {
      throw startupInvariant(
        'System SQLite service is unavailable during database startup.',
      );
    }
    return this.systemSQLite;
  }
}

function closeFailedRuntime(
  databaseRuntime: DatabaseRuntime | null,
  sqlite: PlatformSQLiteService | null,
  ownsSQLite: boolean,
  runtimeOpenAttempted: boolean,
  failures: unknown[],
): void {
  try {
    if (databaseRuntime) databaseRuntime.close();
    else if (sqlite && ownsSQLite && !runtimeOpenAttempted) sqlite.close();
  } catch (error) {
    failures.push(error);
  }
}

function isPreOwnershipDatabaseConfigurationError(error: unknown): boolean {
  return error instanceof DatabaseError && error.code === 'DATABASE_CONFIG_INVALID';
}

function shouldRunMigrations(
  sqlite: PlatformSQLiteService,
  migrate: boolean,
): boolean {
  return migrate && sqlite.mode !== 'ephemeral';
}

function startupInvariant(message: string): DatabaseError {
  return new DatabaseError('DATABASE_OPEN_FAILED', message, {
    retryable: false,
    outcome: 'not-started',
    details: { component: 'app-database-bootstrap' },
  });
}
