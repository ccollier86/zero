/**
 * database-topology-types.ts
 *
 * Defines the public and resolved createApp database-topology contracts. This
 * server-configuration layer depends on Fabric's public actor, placement, and
 * realm types; it does not validate configuration or start database actors.
 */

import type {
  DatabaseActorExecutorPolicy,
  DatabaseActorLaunch,
  DatabaseActorSQLiteConfig,
  DatabaseCoordinatorRestartPolicy,
  DatabaseHotDurability,
  DatabasePlacement,
  DatabasePlacementPolicy,
  DatabasePlacementSelector,
  DatabaseRealm,
  SubprocessDatabaseExecutorFactory,
  NormalizedDatabaseCoordinatorRestartPolicy,
} from '../../databases';
import type { ResourceTenantIsolation } from '../../resources';

/** Historical one-physical-database topology. Omission remains equivalent. */
export interface AppSingleDatabaseTopologyConfig {
  mode?: 'single';
}

/**
 * Production subprocess launch policy for isolated database actors.
 * The child receives only this explicit environment allowlist; Zero never
 * copies the parent process environment implicitly.
 */
export interface AppDatabaseActorConfig {
  readonly launch: DatabaseActorLaunch;
  readonly env?: Readonly<Record<string, string>>;
  readonly executor?: DatabaseActorExecutorPolicy;
}

/** How authenticated tenant application data is physically isolated. */
export type AppTenantDataIsolation = ResourceTenantIsolation;

/** Explicit RAM-active limits and durability for hot database placement. */
export interface AppDatabaseHotPlacementConfig {
  /** Commit-time snapshots are safest and remain the default. */
  readonly durability?: DatabaseHotDurability;
  /** Hard per-database RAM image bound. Required for every explicit hot policy. */
  readonly maxBytes: number;
  /** Periodic snapshot cadence. Valid only with `durability: 'periodic'`. */
  readonly snapshotIntervalMs?: number;
  /** Fatal watchdog for one periodic snapshot. Valid only in periodic mode. */
  readonly snapshotTimeoutMs?: number;
}

/** Declarative file/hot placement policy evaluated from an opaque database ref. */
export interface AppDatabasePlacementPolicyConfig {
  readonly default: DatabasePlacement;
  /**
   * Synchronous selector; Zero validates its result and pins it to the
   * coordinator entry across replacement generations.
   * Build intentional allowlists with createTenantDatabaseRef() or
   * createNamedDatabaseRef(); raw tenant/name strings are not selector refs.
   */
  readonly select?: DatabasePlacementSelector;
  /** Required whenever the default or selector can choose `hot`. */
  readonly hot?: AppDatabaseHotPlacementConfig;
}

/**
 * Public placement configuration.
 *
 * `file` preserves historical behavior. `hot` is bounded shorthand for
 * on-write durability and a 64 MiB per-database limit. Use the object form for
 * explicit limits, durability, or a hybrid selector.
 */
export type AppDatabasePlacementConfig =
  | DatabasePlacement
  | AppDatabasePlacementPolicyConfig;

/**
 * Bounded actor-backed SQLite files sharing one immutable database realm.
 * Logical ids are trusted routing inputs and are mapped to opaque filenames;
 * callers never provide a filesystem path.
 */
export interface AppMultipleDatabaseTopologyConfig {
  mode: 'multiple';
  /** Private parent directory containing only Zero-managed database files. */
  rootDirectory: string;
  /** Side-effect-free schema, migrations, and named actor operations. */
  realm: DatabaseRealm;
  /** Same-entry or explicitly packaged actor launch contract. */
  actors: AppDatabaseActorConfig;
  /** Default: shared-row. tenant-database requires multi-tenant auth. */
  tenantIsolation?: AppTenantDataIsolation;
  /** File, bounded hot, or hybrid physical placement. Default: file. */
  placement?: AppDatabasePlacementConfig;
  /** File-safe SQLite and ReactiveDB tuning applied inside every actor. */
  sqlite?: DatabaseActorSQLiteConfig;
  /** Maximum simultaneously active physical databases. Default: 16. */
  maxDatabases?: number;
  /** Hard cap on Zero-managed physical main database files. Default: 10000. */
  maxDatabaseFiles?: number;
  /** Maximum retained permanent-open failures. Default: 1024. */
  maxBlockedDatabases?: number;
  /** Distinct databases persistent tenant Sync may pin. Reserves one slot when possible. */
  maxTenantSyncDatabases?: number;
  /** Persistent tenant Sync capabilities allowed per database. Default: 64. */
  maxTenantSyncBindingsPerDatabase?: number;
  /** Enable a separate read-only WAL actor for each active file. Default: true. */
  readers?: boolean;
  /** Per-file pending operation bound. Default: 128. */
  maxQueuedPerDatabase?: number;
  /** App-wide pending operation bound. Default: 1024. */
  maxQueuedTotal?: number;
  /** Maximum wait before an operation reaches dispatch. Default: 15000ms. */
  queueTimeoutMs?: number;
  /** Maximum dispatched actor operation duration. Default: 30000ms. */
  operationTimeoutMs?: number;
  /** Bounded exponential actor replacement and circuit-breaker policy. */
  restart?: DatabaseCoordinatorRestartPolicy;
  /** Close an unused database actor generation after this duration. Default: 60000ms. */
  idleTimeoutMs?: number;
  /** Idle sweep cadence, or false to disable automatic sweeping. */
  sweepIntervalMs?: number | false;
}

/** App-level physical-database topology. Omitted configuration stays single. */
export type AppDatabaseTopologyConfig =
  | AppSingleDatabaseTopologyConfig
  | AppMultipleDatabaseTopologyConfig;

/** Normalized historical single-database topology. */
export interface ResolvedAppSingleDatabaseTopologyConfig {
  readonly mode: 'single';
}

/** Normalized immutable actor-backed database topology. */
export interface ResolvedAppMultipleDatabaseTopologyConfig {
  readonly mode: 'multiple';
  readonly rootDirectory: string;
  readonly realm: DatabaseRealm;
  readonly createExecutor: SubprocessDatabaseExecutorFactory;
  readonly tenantIsolation: AppTenantDataIsolation;
  readonly placement: DatabasePlacementPolicy;
  readonly sqlite: DatabaseActorSQLiteConfig;
  readonly maxDatabases: number;
  readonly maxDatabaseFiles: number;
  readonly maxBlockedDatabases: number;
  readonly maxTenantSyncDatabases: number;
  readonly maxTenantSyncBindingsPerDatabase: number;
  readonly readers: boolean;
  readonly maxQueuedPerDatabase: number;
  readonly maxQueuedTotal: number;
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly restart: NormalizedDatabaseCoordinatorRestartPolicy;
  readonly idleTimeoutMs: number;
  readonly sweepIntervalMs: number | false;
}

/** Normalized app-level physical-database topology. */
export type ResolvedAppDatabaseTopologyConfig =
  | ResolvedAppSingleDatabaseTopologyConfig
  | ResolvedAppMultipleDatabaseTopologyConfig;
