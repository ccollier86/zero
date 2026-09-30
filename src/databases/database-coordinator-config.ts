/** Runtime validation and normalization for DatabaseCoordinator construction. */

import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from './database-actor-authority-context';
import {
  normalizeDatabaseActorSQLiteConfig,
  type DatabaseActorSQLiteConfig,
} from './database-actor-protocol';
import { DATABASE_COORDINATOR_MAX_DATABASES } from './database-capacity';
import type {
  DatabaseCoordinatorOptions,
  DatabaseExecutorFactory,
} from './database-coordinator-contract';
import { DatabaseError } from './database-error';
import type { DatabaseObservability } from './database-observability';
import {
  DATABASE_FILE_PLACEMENT_POLICY,
  type DatabasePlacementPolicy,
} from './database-placement';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import {
  normalizeDatabaseCoordinatorRestartPolicy,
  type NormalizedDatabaseCoordinatorRestartPolicy,
} from './database-restart-policy';
import {
  boundedTimerInterval,
  nonNegativeInteger,
  observablePositiveInteger,
  positiveInteger,
} from './database-coordinator-runtime';
import { normalizeCoordinatorPlacementPolicy } from './database-coordinator-placement';

const DEFAULT_MAX_DATABASES = 16;
const DEFAULT_MAX_DATABASE_FILES = 10_000;
const DEFAULT_MAX_BLOCKED_DATABASES = 1_024;
const DEFAULT_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE = 64;
const DEFAULT_MAX_QUEUED_PER_DATABASE = 128;
const DEFAULT_MAX_QUEUED_TOTAL = 1_024;
const DEFAULT_QUEUE_TIMEOUT_MS = 15_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1_000;
const MAX_SWEEP_INTERVAL_MS = 30_000;

export interface NormalizedDatabaseCoordinatorConfig {
  readonly rootDirectory: string;
  readonly realm: DatabaseRealm;
  readonly operationCatalog: ReturnType<typeof createDatabaseRealmOperationCatalog>;
  readonly createExecutor: DatabaseExecutorFactory;
  readonly placementPolicy: DatabasePlacementPolicy;
  readonly sqlite: DatabaseActorSQLiteConfig;
  readonly readersEnabled: boolean;
  readonly maxDatabases: number;
  readonly maxDatabaseFiles: number;
  readonly maxBlockedDatabases: number;
  readonly maxTenantSyncDatabases: number;
  readonly maxTenantSyncBindingsPerDatabase: number;
  readonly maxQueuedPerDatabase: number;
  readonly maxQueuedTotal: number;
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly restartPolicy: NormalizedDatabaseCoordinatorRestartPolicy;
  readonly idleTimeoutMs: number;
  readonly sweepIntervalMs: number | false;
  readonly observability: DatabaseObservability | null;
  readonly authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  readonly requireCommitAuthority: boolean;
  readonly actorAuthorityContext: DatabaseActorAuthorityContext | null;
  readonly now: () => number;
}

/**
 * Revalidates the public constructor boundary for direct JavaScript callers.
 * The returned record is immutable so collaborators share one pinned policy.
 */
export function normalizeDatabaseCoordinatorConfig(
  options: DatabaseCoordinatorOptions,
): NormalizedDatabaseCoordinatorConfig {
  if (!options || typeof options !== 'object') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database coordinator options are required.',
    );
  }
  if (typeof options.rootDirectory !== 'string'
    || options.rootDirectory.length === 0) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database root directory is required.',
    );
  }
  if (typeof options.createExecutor !== 'function') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database executor factory is required.',
    );
  }

  const maxDatabases = positiveInteger(
    options.maxDatabases ?? DEFAULT_MAX_DATABASES,
    'maxDatabases',
  );
  if (maxDatabases > DATABASE_COORDINATOR_MAX_DATABASES) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      `maxDatabases must not exceed ${DATABASE_COORDINATOR_MAX_DATABASES}.`,
    );
  }
  const maxDatabaseFiles = observablePositiveInteger(
    options.maxDatabaseFiles ?? DEFAULT_MAX_DATABASE_FILES,
    'maxDatabaseFiles',
  );
  const maxBlockedDatabases = observablePositiveInteger(
    options.maxBlockedDatabases ?? DEFAULT_MAX_BLOCKED_DATABASES,
    'maxBlockedDatabases',
  );
  const maxTenantSyncDatabases = nonNegativeInteger(
    options.maxTenantSyncDatabases
      ?? (maxDatabases === 1 ? 1 : maxDatabases - 1),
    'maxTenantSyncDatabases',
  );
  if (maxTenantSyncDatabases > maxDatabases) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'maxTenantSyncDatabases must not exceed maxDatabases.',
    );
  }
  const maxTenantSyncBindingsPerDatabase = observablePositiveInteger(
    options.maxTenantSyncBindingsPerDatabase
      ?? DEFAULT_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE,
    'maxTenantSyncBindingsPerDatabase',
  );
  const maxQueuedPerDatabase = observablePositiveInteger(
    options.maxQueuedPerDatabase ?? DEFAULT_MAX_QUEUED_PER_DATABASE,
    'maxQueuedPerDatabase',
  );
  const maxQueuedTotal = observablePositiveInteger(
    options.maxQueuedTotal ?? DEFAULT_MAX_QUEUED_TOTAL,
    'maxQueuedTotal',
  );
  const queueTimeoutMs = boundedTimerInterval(
    options.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
    'queueTimeoutMs',
  );
  const operationTimeoutMs = boundedTimerInterval(
    options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
    'operationTimeoutMs',
  );
  const restartPolicy = normalizeDatabaseCoordinatorRestartPolicy(
    options.restart,
  );
  const idleTimeoutMs = nonNegativeInteger(
    options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    'idleTimeoutMs',
  );
  const sweepIntervalMs = options.sweepIntervalMs === false
    ? false
    : boundedTimerInterval(
      options.sweepIntervalMs
        ?? Math.min(
          MAX_SWEEP_INTERVAL_MS,
          Math.max(MIN_SWEEP_INTERVAL_MS, Math.ceil(idleTimeoutMs / 2)),
        ),
      'sweepIntervalMs',
    );

  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database clock must be a function.',
    );
  }
  if (options.requireCommitAuthority !== undefined
    && typeof options.requireCommitAuthority !== 'boolean') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database commit-authority policy must be a boolean.',
    );
  }
  if (options.authorityCommitCoordinator !== undefined
    && !(options.authorityCommitCoordinator instanceof AuthorityCommitCoordinator)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database authority commit coordinator is invalid.',
    );
  }
  if (options.requireCommitAuthority === true
    && !options.authorityCommitCoordinator) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Required database commit authority needs an authority coordinator.',
    );
  }
  if (options.actorAuthorityContext !== undefined
    && !(options.actorAuthorityContext instanceof DatabaseActorAuthorityContext)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database actor authority context is invalid.',
    );
  }
  if (options.actorAuthorityContext
    && (options.requireCommitAuthority !== true
      || !options.authorityCommitCoordinator)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database actor authority context requires commit authority.',
    );
  }
  if (options.readers !== undefined && typeof options.readers !== 'boolean') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database readers policy must be a boolean.',
    );
  }

  const operationCatalog = createDatabaseRealmOperationCatalog(options.realm);
  const placementPolicy = normalizeCoordinatorPlacementPolicy(
    options.placement === undefined
      ? DATABASE_FILE_PLACEMENT_POLICY
      : options.placement,
  );
  let sqlite: DatabaseActorSQLiteConfig;
  try {
    sqlite = normalizeDatabaseActorSQLiteConfig(options.sqlite ?? {});
  } catch {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database actor SQLite configuration is invalid.',
    );
  }

  return Object.freeze({
    rootDirectory: options.rootDirectory,
    realm: options.realm,
    operationCatalog,
    createExecutor: options.createExecutor,
    placementPolicy,
    sqlite,
    readersEnabled: options.readers !== false,
    maxDatabases,
    maxDatabaseFiles,
    maxBlockedDatabases,
    maxTenantSyncDatabases,
    maxTenantSyncBindingsPerDatabase,
    maxQueuedPerDatabase,
    maxQueuedTotal,
    queueTimeoutMs,
    operationTimeoutMs,
    restartPolicy,
    idleTimeoutMs,
    sweepIntervalMs,
    observability: options.observability ?? null,
    authorityCommitCoordinator: options.authorityCommitCoordinator ?? null,
    requireCommitAuthority: options.requireCommitAuthority ?? false,
    actorAuthorityContext: options.actorAuthorityContext ?? null,
    now: options.now ?? Date.now,
  });
}
