/**
 * Resolves and validates the managed system database independently from the
 * application database. This module is intentionally filesystem-neutral;
 * createApp repeats ownership checks through canonical paths before opening
 * either SQLite service.
 */

import { resolveControlDatabasePaths } from '../../databases/database-directory-isolation';
import {
  DATABASE_AUTHORITY_COMMIT_FENCE_SUFFIX,
} from '../../databases/database-authority-commit-file-fence';
import { DatabaseError } from '../../databases/database-error';
import {
  canonicalDatabaseOwnershipPathKey,
  resolvedDatabaseOwnershipPathKey,
} from '../../databases/database-path-ownership';
import { resolveSQLiteStorageConfig } from '../../persistence/storage-config';
import type { ReactiveDBConfig } from '../../sync/types';

const DEFAULT_SYSTEM_DATABASE_PATH = './data/zero.system.db';

/**
 * Public configuration for Zero's managed system database.
 *
 * A caller-owned Bun `Database` handle bypasses the platform SQL service and
 * cannot participate in the system-plane ownership and authority-fence
 * invariants. Keep the forbidden property in the type so values held in
 * variables are rejected as well as object literals.
 */
export type SystemDatabaseConfig = Omit<ReactiveDBConfig, 'database'> & {
  readonly database?: never;
};

/** Resolve the always-separate Zero-owned system database configuration. */
export function resolveSystemDatabaseConfig(
  appDb: ReactiveDBConfig,
  configured: SystemDatabaseConfig | undefined,
): ReactiveDBConfig {
  if (configured?.database) {
    throw invalidSystemDatabaseConfig(
      '[app] systemDb.database bypasses the platform SQL service. Pass systemDb.sqlite or a platform storage config instead.',
    );
  }

  const systemDb = configured ?? defaultSystemDatabaseConfig(appDb);
  assertSeparateDatabaseConfigs(appDb, systemDb);
  return systemDb;
}

/** Reject two logical planes which resolve to one handle or owned path. */
export function assertSeparateDatabaseConfigs(
  appDb: ReactiveDBConfig,
  systemDb: ReactiveDBConfig,
): void {
  if (appDb === systemDb
    || (appDb.sqlite !== undefined && appDb.sqlite === systemDb.sqlite)
    || (appDb.sqlite?.raw !== undefined
      && appDb.sqlite.raw === systemDb.sqlite?.raw)
    || (appDb.database !== undefined && appDb.database === systemDb.database)) {
    throw invalidSystemDatabaseConfig(
      '[app] db and systemDb must use separate SQLite services and database handles.',
    );
  }

  const appPaths = new Set(
    resolveControlDatabasePaths(appDb).map((path) =>
      resolvedDatabaseOwnershipPathKey(path)),
  );
  const collision = resolveSystemDatabaseOwnedPaths(systemDb)
    .map((path) => resolvedDatabaseOwnershipPathKey(path))
    .some((path) => appPaths.has(path));
  if (collision) {
    throw invalidSystemDatabaseConfig(
      '[app] db and systemDb must not share a database, snapshot, companion, or authority-fence path.',
    );
  }
}

/** Repeat plane isolation through existing filesystem aliases before opening. */
export function assertCanonicalSeparateDatabaseConfigs(
  appDb: ReactiveDBConfig,
  systemDb: ReactiveDBConfig,
): void {
  let appPaths: Set<string>;
  let systemPaths: readonly string[];
  try {
    appPaths = new Set(resolveControlDatabasePaths(appDb)
      .map((path) => canonicalDatabaseOwnershipPathKey(path)));
    systemPaths = resolveSystemDatabaseOwnedPaths(systemDb)
      .map((path) => canonicalDatabaseOwnershipPathKey(path));
  } catch (cause) {
    if (cause instanceof DatabaseError) throw cause;
    throw invalidSystemDatabaseConfig(
      '[app] db and systemDb isolation could not be validated.',
      cause,
    );
  }
  if (systemPaths.some((path) => appPaths.has(path))) {
    throw invalidSystemDatabaseConfig(
      '[app] db and systemDb must not share a database, snapshot, companion, or authority-fence path.',
    );
  }
}

/** Resolve every file owned by the system plane, including its commit fence. */
export function resolveSystemDatabaseOwnedPaths(
  systemDb: ReactiveDBConfig,
): readonly string[] {
  const owned = [...resolveControlDatabasePaths(systemDb)];
  const mode = systemDb.sqlite?.mode ?? resolveSQLiteStorageConfig(systemDb).mode;
  const path = systemDb.sqlite?.path ?? resolveSQLiteStorageConfig(systemDb).path;
  if (mode !== 'file' || !path) return Object.freeze(owned);

  owned.push(...resolveControlDatabasePaths({
    mode: 'file',
    // This is the lexical, filesystem-neutral configuration pass, matching
    // resolveControlDatabasePaths above. Runtime construction canonicalizes
    // this same derived pathname before opening the fence; the separate
    // canonical isolation pass resolves aliases for collision detection.
    path: `${path}${DATABASE_AUTHORITY_COMMIT_FENCE_SUFFIX}`,
  }));
  return Object.freeze([...new Set(owned)]);
}

function defaultSystemDatabaseConfig(appDb: ReactiveDBConfig): ReactiveDBConfig {
  const appMode = appDb.sqlite?.mode ?? resolveSQLiteStorageConfig(appDb).mode;
  if (appMode === 'ephemeral') return Object.freeze({ mode: 'ephemeral' });
  return Object.freeze({
    mode: 'file',
    path: DEFAULT_SYSTEM_DATABASE_PATH,
  });
}

function invalidSystemDatabaseConfig(
  message: string,
  cause?: unknown,
): DatabaseError {
  return new DatabaseError('DATABASE_CONFIG_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
    retryable: false,
    outcome: 'not-started',
  });
}
