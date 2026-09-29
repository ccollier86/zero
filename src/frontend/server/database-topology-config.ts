/**
 * database-topology-config.ts
 *
 * Normalizes and validates createApp database-topology configuration without
 * touching the filesystem. This server-configuration layer consumes Fabric's
 * public primitives and app table declarations; it does not create actors,
 * reserve capacity, or own runtime database lifecycle.
 */

import { parse, resolve } from 'node:path';

import {
  DATABASE_COORDINATOR_MAX_DATABASES,
  DATABASE_FILE_PLACEMENT_POLICY,
  DATABASE_HOT_DEFAULT_DURABILITY,
  DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS,
  DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY,
  DATABASE_OBSERVABILITY_COUNT_MAX,
  createDatabaseRealmOperationCatalog,
  createSubprocessDatabaseExecutorFactory,
  defaultDatabaseHotSnapshotTimeoutMs,
  isDatabaseHotDurability,
  isDatabasePlacement,
  normalizeDatabaseActorSQLiteConfig,
  normalizeDatabaseCoordinatorRestartPolicy,
  type DatabaseActorExecutorPolicy,
  type DatabaseActorLaunch,
  type DatabaseHotPlacementConfig,
  type DatabasePlacementPolicy,
  type DatabaseRealm,
  type SubprocessDatabaseExecutorFactory,
} from '../../databases';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../../runtime/timer-limits';
import type { TableSchema } from '../../sync/types';
import { assertTenantDatabaseRealmSchemaSubset } from './tenant-database-topology';
import type {
  AppDatabaseHotPlacementConfig,
  AppDatabasePlacementConfig,
  AppDatabaseTopologyConfig,
  AppMultipleDatabaseTopologyConfig,
  ResolvedAppDatabaseTopologyConfig,
} from './database-topology-types';

const DEFAULT_DATABASE_MAX_DATABASES = 16;
const DEFAULT_DATABASE_MAX_FILES = 10_000;
const DEFAULT_DATABASE_MAX_BLOCKED = 1_024;
const DEFAULT_DATABASE_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE = 64;
const DEFAULT_DATABASE_MAX_QUEUED_PER_DATABASE = 128;
const DEFAULT_DATABASE_MAX_QUEUED_TOTAL = 1_024;
const DEFAULT_DATABASE_QUEUE_TIMEOUT_MS = 15_000;
const DEFAULT_DATABASE_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_DATABASE_IDLE_TIMEOUT_MS = 60_000;
const MIN_DATABASE_SWEEP_INTERVAL_MS = 1_000;
const MAX_DATABASE_SWEEP_INTERVAL_MS = 30_000;
const SINGLE_DATABASE_TOPOLOGY = Object.freeze({
  mode: 'single' as const,
});
const MULTIPLE_DATABASE_TOPOLOGY_FIELDS = new Set([
  'mode',
  'rootDirectory',
  'realm',
  'actors',
  'tenantIsolation',
  'placement',
  'sqlite',
  'maxDatabases',
  'maxDatabaseFiles',
  'maxBlockedDatabases',
  'maxTenantSyncDatabases',
  'maxTenantSyncBindingsPerDatabase',
  'readers',
  'maxQueuedPerDatabase',
  'maxQueuedTotal',
  'queueTimeoutMs',
  'operationTimeoutMs',
  'restart',
  'idleTimeoutMs',
  'sweepIntervalMs',
]);

/**
 * Resolve logical database topology without touching the filesystem.
 *
 * Tenant-database isolation is accepted only for multi-tenant auth and a realm
 * whose tables are a schema-identical subset of the app table declarations.
 */
export function resolveAppDatabaseTopology(
  input: AppDatabaseTopologyConfig | undefined,
  authTenancy: 'single' | 'multi',
  appTables: Readonly<Record<string, TableSchema>>,
): ResolvedAppDatabaseTopologyConfig {
  if (input === undefined) return SINGLE_DATABASE_TOPOLOGY;
  assertConfigRecord(input, 'databaseTopology');

  const mode = input.mode ?? 'single';
  if (mode === 'single') {
    assertOnlyConfigFields(input, new Set(['mode']), 'databaseTopology single mode');
    return SINGLE_DATABASE_TOPOLOGY;
  }
  if (mode !== 'multiple') {
    throw new Error(
      `[app] databaseTopology.mode must be "single" or "multiple"; received ${JSON.stringify(mode)}.`,
    );
  }

  const multiple = input as AppMultipleDatabaseTopologyConfig;
  assertOnlyConfigFields(
    multiple,
    MULTIPLE_DATABASE_TOPOLOGY_FIELDS,
    'databaseTopology multiple mode',
  );
  const rootDirectory = normalizeMultipleDatabaseRootDirectory(
    multiple.rootDirectory,
  );
  const realm = normalizeMultipleDatabaseRealm(multiple.realm);
  const createExecutor = normalizeMultipleDatabaseActors(multiple.actors);
  const tenantIsolation = multiple.tenantIsolation ?? 'shared-row';
  if (tenantIsolation !== 'shared-row'
    && tenantIsolation !== 'tenant-database') {
    throw new Error(
      '[app] databaseTopology.tenantIsolation must be "shared-row" or "tenant-database".',
    );
  }
  if (tenantIsolation === 'tenant-database' && authTenancy !== 'multi') {
    throw new Error(
      '[app] databaseTopology tenant-database isolation requires auth.tenancy: "multi".',
    );
  }
  if (tenantIsolation === 'tenant-database') {
    assertTenantDatabaseRealmSchemaSubset(realm, appTables);
  }
  const placement = normalizeDatabasePlacementPolicy(multiple.placement);

  const sqlite = normalizeDatabaseActorSQLiteConfig(multiple.sqlite ?? {});
  const maxDatabases = normalizeBoundedPositiveSafeInteger(
    multiple.maxDatabases ?? DEFAULT_DATABASE_MAX_DATABASES,
    'databaseTopology.maxDatabases',
    DATABASE_COORDINATOR_MAX_DATABASES,
  );
  const maxDatabaseFiles = normalizeBoundedPositiveSafeInteger(
    multiple.maxDatabaseFiles ?? DEFAULT_DATABASE_MAX_FILES,
    'databaseTopology.maxDatabaseFiles',
    DATABASE_OBSERVABILITY_COUNT_MAX,
  );
  const maxBlockedDatabases = normalizeBoundedPositiveSafeInteger(
    multiple.maxBlockedDatabases ?? DEFAULT_DATABASE_MAX_BLOCKED,
    'databaseTopology.maxBlockedDatabases',
    DATABASE_OBSERVABILITY_COUNT_MAX,
  );
  const maxTenantSyncDatabases = normalizeNonNegativeSafeInteger(
    multiple.maxTenantSyncDatabases
      ?? (maxDatabases === 1 ? 1 : maxDatabases - 1),
    'databaseTopology.maxTenantSyncDatabases',
  );
  if (maxTenantSyncDatabases > maxDatabases) {
    throw new Error(
      '[app] databaseTopology.maxTenantSyncDatabases must not exceed databaseTopology.maxDatabases.',
    );
  }
  const maxTenantSyncBindingsPerDatabase = normalizeBoundedPositiveSafeInteger(
    multiple.maxTenantSyncBindingsPerDatabase
      ?? DEFAULT_DATABASE_MAX_TENANT_SYNC_BINDINGS_PER_DATABASE,
    'databaseTopology.maxTenantSyncBindingsPerDatabase',
    DATABASE_OBSERVABILITY_COUNT_MAX,
  );
  const readers = multiple.readers ?? true;
  if (typeof readers !== 'boolean') {
    throw new Error('[app] databaseTopology.readers must be a boolean.');
  }
  const maxQueuedPerDatabase = normalizeBoundedPositiveSafeInteger(
    multiple.maxQueuedPerDatabase
      ?? DEFAULT_DATABASE_MAX_QUEUED_PER_DATABASE,
    'databaseTopology.maxQueuedPerDatabase',
    DATABASE_OBSERVABILITY_COUNT_MAX,
  );
  const maxQueuedTotal = normalizeBoundedPositiveSafeInteger(
    multiple.maxQueuedTotal ?? DEFAULT_DATABASE_MAX_QUEUED_TOTAL,
    'databaseTopology.maxQueuedTotal',
    DATABASE_OBSERVABILITY_COUNT_MAX,
  );
  const queueTimeoutMs = normalizeBoundedPositiveSafeInteger(
    multiple.queueTimeoutMs ?? DEFAULT_DATABASE_QUEUE_TIMEOUT_MS,
    'databaseTopology.queueTimeoutMs',
    MAX_RUNTIME_TIMER_INTERVAL_MS,
  );
  const operationTimeoutMs = normalizeBoundedPositiveSafeInteger(
    multiple.operationTimeoutMs ?? DEFAULT_DATABASE_OPERATION_TIMEOUT_MS,
    'databaseTopology.operationTimeoutMs',
    MAX_RUNTIME_TIMER_INTERVAL_MS,
  );
  const restart = normalizeAppDatabaseRestartPolicy(multiple.restart);
  const idleTimeoutMs = normalizeNonNegativeSafeInteger(
    multiple.idleTimeoutMs ?? DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
    'databaseTopology.idleTimeoutMs',
  );
  const sweepIntervalMs = multiple.sweepIntervalMs === false
    ? false
    : normalizeBoundedPositiveSafeInteger(
      multiple.sweepIntervalMs
        ?? Math.min(
          MAX_DATABASE_SWEEP_INTERVAL_MS,
          Math.max(
            MIN_DATABASE_SWEEP_INTERVAL_MS,
            Math.ceil(idleTimeoutMs / 2),
          ),
        ),
      'databaseTopology.sweepIntervalMs',
      MAX_RUNTIME_TIMER_INTERVAL_MS,
    );

  return Object.freeze({
    mode: 'multiple',
    rootDirectory,
    realm,
    createExecutor,
    tenantIsolation,
    placement,
    sqlite,
    maxDatabases,
    maxDatabaseFiles,
    maxBlockedDatabases,
    maxTenantSyncDatabases,
    maxTenantSyncBindingsPerDatabase,
    readers,
    maxQueuedPerDatabase,
    maxQueuedTotal,
    queueTimeoutMs,
    operationTimeoutMs,
    restart,
    idleTimeoutMs,
    sweepIntervalMs,
  });
}

const DATABASE_RESTART_POLICY_FIELDS = new Set([
  'initialDelayMs',
  'maxDelayMs',
  'circuitFailureThreshold',
  'circuitCooldownMs',
]);

function normalizeAppDatabaseRestartPolicy(
  input: AppMultipleDatabaseTopologyConfig['restart'],
) {
  if (input !== undefined) {
    assertConfigRecord(input, 'databaseTopology.restart');
    assertOnlyConfigFields(
      input,
      DATABASE_RESTART_POLICY_FIELDS,
      'databaseTopology.restart',
    );
  }
  try {
    return normalizeDatabaseCoordinatorRestartPolicy(input);
  } catch {
    throw new Error(
      '[app] databaseTopology.restart requires positive bounded delays, '
      + 'circuitFailureThreshold of at least 2, initialDelayMs no greater '
      + 'than maxDelayMs, and circuitCooldownMs at least maxDelayMs.',
    );
  }
}

const DATABASE_PLACEMENT_POLICY_FIELDS = new Set(['default', 'select', 'hot']);
const DATABASE_HOT_PLACEMENT_FIELDS = new Set([
  'durability',
  'maxBytes',
  'snapshotIntervalMs',
  'snapshotTimeoutMs',
]);

/** Normalize public file/hot shorthand and explicit hybrid policy. */
function normalizeDatabasePlacementPolicy(
  input: AppDatabasePlacementConfig | undefined,
): DatabasePlacementPolicy {
  if (input === undefined || input === 'file') {
    return DATABASE_FILE_PLACEMENT_POLICY;
  }
  if (input === 'hot') {
    return DATABASE_HOT_SHORTHAND_PLACEMENT_POLICY;
  }

  assertConfigRecord(input, 'databaseTopology.placement');
  assertOnlyConfigFields(
    input,
    DATABASE_PLACEMENT_POLICY_FIELDS,
    'databaseTopology.placement',
  );

  if (!isDatabasePlacement(input.default)) {
    throw new Error(
      '[app] databaseTopology.placement.default must be "file" or "hot".',
    );
  }
  if (input.select !== undefined && typeof input.select !== 'function') {
    throw new Error(
      '[app] databaseTopology.placement.select must be a synchronous function.',
    );
  }
  if ((input.default === 'hot' || input.select !== undefined) && input.hot === undefined) {
    throw new Error(
      '[app] databaseTopology.placement.hot is required when hot placement can be selected.',
    );
  }

  const hot = input.hot === undefined
    ? null
    : normalizeDatabaseHotPlacement(input.hot);
  return Object.freeze({
    default: input.default,
    ...(input.select === undefined ? {} : { select: input.select }),
    hot,
  });
}

/** Validate and freeze the explicit hot-memory durability budget. */
function normalizeDatabaseHotPlacement(
  input: AppDatabaseHotPlacementConfig,
): DatabaseHotPlacementConfig {
  assertConfigRecord(input, 'databaseTopology.placement.hot');
  assertOnlyConfigFields(
    input,
    DATABASE_HOT_PLACEMENT_FIELDS,
    'databaseTopology.placement.hot',
  );

  const durability = input.durability ?? DATABASE_HOT_DEFAULT_DURABILITY;
  if (!isDatabaseHotDurability(durability)) {
    throw new Error(
      '[app] databaseTopology.placement.hot.durability must be "on-write", "periodic", or "final".',
    );
  }
  const maxBytes = normalizePositiveSafeInteger(
    input.maxBytes,
    'databaseTopology.placement.hot.maxBytes',
  );
  if (input.snapshotIntervalMs !== undefined && durability !== 'periodic') {
    throw new Error(
      '[app] databaseTopology.placement.hot.snapshotIntervalMs is only valid with periodic durability.',
    );
  }
  if (input.snapshotTimeoutMs !== undefined && durability !== 'periodic') {
    throw new Error(
      '[app] databaseTopology.placement.hot.snapshotTimeoutMs is only valid with periodic durability.',
    );
  }
  const snapshotIntervalMs = durability === 'periodic'
    ? normalizeBoundedPositiveSafeInteger(
      input.snapshotIntervalMs ?? DATABASE_HOT_DEFAULT_SNAPSHOT_INTERVAL_MS,
      'databaseTopology.placement.hot.snapshotIntervalMs',
      DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS,
    )
    : undefined;
  const snapshotTimeoutMs = durability === 'periodic'
    ? normalizeBoundedPositiveSafeInteger(
      input.snapshotTimeoutMs
        ?? defaultDatabaseHotSnapshotTimeoutMs(snapshotIntervalMs!),
      'databaseTopology.placement.hot.snapshotTimeoutMs',
      DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS,
    )
    : undefined;
  if (snapshotTimeoutMs !== undefined
    && snapshotIntervalMs !== undefined
    && snapshotTimeoutMs < snapshotIntervalMs) {
    throw new Error(
      '[app] databaseTopology.placement.hot.snapshotTimeoutMs must be at least snapshotIntervalMs.',
    );
  }

  return Object.freeze({
    durability,
    maxBytes,
    ...(snapshotIntervalMs === undefined ? {} : { snapshotIntervalMs }),
    ...(snapshotTimeoutMs === undefined ? {} : { snapshotTimeoutMs }),
  });
}

function normalizeMultipleDatabaseRootDirectory(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(
      '[app] databaseTopology.rootDirectory must be a non-empty path without null bytes.',
    );
  }
  if (value.trim() !== value) {
    throw new Error(
      '[app] databaseTopology.rootDirectory must not contain leading or trailing whitespace.',
    );
  }

  const normalized = resolve(value);
  if (normalized === parse(normalized).root) {
    throw new Error('[app] databaseTopology.rootDirectory must not be a filesystem root.');
  }
  return normalized;
}

function normalizeMultipleDatabaseRealm(value: unknown): DatabaseRealm {
  try {
    const realm = value as DatabaseRealm;
    if (!realm || typeof realm !== 'object'
      || typeof realm.fingerprint !== 'string'
      || typeof realm.schemaChecksum !== 'string') {
      throw new TypeError('invalid realm');
    }
    createDatabaseRealmOperationCatalog(realm);
    return realm;
  } catch {
    throw new Error(
      '[app] databaseTopology.realm must be created with defineDatabaseRealm().',
    );
  }
}

function normalizeMultipleDatabaseActors(
  value: unknown,
): SubprocessDatabaseExecutorFactory {
  try {
    assertConfigRecord(value, 'databaseTopology.actors');
    return createSubprocessDatabaseExecutorFactory(value as unknown as {
      launch: DatabaseActorLaunch;
      env?: Readonly<Record<string, string>>;
      executor?: DatabaseActorExecutorPolicy;
    });
  } catch {
    throw new Error(
      '[app] databaseTopology.actors contains an invalid subprocess launch policy.',
    );
  }
}

function normalizePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`[app] ${label} must be a positive safe integer.`);
  }
  return value as number;
}

function normalizeBoundedPositiveSafeInteger(
  value: unknown,
  label: string,
  maximum: number,
): number {
  const normalized = normalizePositiveSafeInteger(value, label);
  if (normalized > maximum) {
    throw new Error(`[app] ${label} must not exceed ${maximum}.`);
  }
  return normalized;
}

function normalizeNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`[app] ${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function assertConfigRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, any> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`[app] ${label} must be an object.`);
  }
}

function assertOnlyConfigFields(
  value: object,
  supported: ReadonlySet<string>,
  label: string,
): void {
  for (const field of Object.keys(value)) {
    if (!supported.has(field)) {
      throw new Error(`[app] ${label} contains unsupported field "${field}".`);
    }
  }
}
