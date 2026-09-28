import { parse, resolve } from 'node:path';

import {
  SYNC_TABLE_MUTATION_VALIDATOR,
  type ClientTableDef,
  type DeclaredSyncMode,
  type ReactiveDBConfig,
  type SyncMode,
  type SyncTableMutationValidator,
  type TableSchema,
} from '../../sync/types';
import type { SyncPolicy } from '../../sync/sync-policy';
import type { EphemeralTopicPolicy } from '../../sync/ephemeral-policy';
import type { ObservabilityConfig } from '../../observability/types';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import type {
  AuthBehaviorConfig,
  NormalizedAuthBehaviorConfig,
} from '../../auth/types';
import { parseTokenTTL } from '../../tokens/token-utils';
import type { AppIdentityConfig, EmailConfig } from '../../email/types';
import { resolveAIConfig } from '../../ai/ai-env';
import type { AIConfig, ResolvedAIConfig } from '../../ai/ai-types';
import { resolveVectorConfig } from '../../vector/vector-config';
import type { ResolvedVectorConfig, VectorConfig } from '../../vector/vector-types';
import type { ResourceCrudRoutesConfig, ResourceDefinition } from '../../resources';
import type { KvServiceConfig } from '../../kv';
import { resolvePdfConfig } from '../../pdf/pdf-config';
import type { PdfConfig, ResolvedPdfConfig } from '../../pdf/pdf-types';
import {
  normalizeDatabaseActorSQLiteConfig,
  type DatabaseActorSQLiteConfig,
} from '../../databases/database-actor-protocol';
import type { DatabaseRealm } from '../../databases/database-realm';
import {
  createSubprocessDatabaseExecutorFactory,
  type DatabaseActorLaunch,
  type DatabaseActorExecutorPolicy,
  type SubprocessDatabaseExecutorFactory,
} from '../../databases/subprocess-database-executor-factory';
import { createDatabaseRealmOperationCatalog } from '../../databases/database-realm';
import {
  hashSchemaSnapshot,
  snapshotDeclaredTables,
} from '../../migrations/schema-snapshot';
import {
  resolveRouteAuthMode,
  type RouteAuthMode,
} from '../router/auth-policy';

// ─── App Configuration ─────────────────────────────────────────────────────

/** Table input accepted by createApp(). */
export type AppTableInput = TableSchema | {
  serverTable: TableSchema;
  clientTable?: ClientTableDef;
  /** Optional logical websocket-mutation validator for a raw server table. */
  mutationValidator?: SyncTableMutationValidator;
};

/** Historical one-physical-database topology. Omission remains equivalent. */
export interface AppSingleDatabaseTopologyConfig {
  mode?: 'single';
}

/**
 * Production subprocess launch policy for file-backed database actors.
 * The child receives only this explicit environment allowlist; Zero never
 * copies the parent process environment implicitly.
 */
export interface AppDatabaseActorConfig {
  readonly launch: DatabaseActorLaunch;
  readonly env?: Readonly<Record<string, string>>;
  readonly executor?: DatabaseActorExecutorPolicy;
}

/** How authenticated tenant application data is physically isolated. */
export type AppTenantDataIsolation = 'shared-row' | 'tenant-database';

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
  /** Current phase supports durable file/WAL placement only. */
  placement?: 'file';
  /** File-safe SQLite and ReactiveDB tuning applied inside every actor. */
  sqlite?: DatabaseActorSQLiteConfig;
  /** Maximum simultaneously active physical databases. Default: 16. */
  maxDatabases?: number;
  /** Maximum retained permanent-open failures. Default: 1024. */
  maxBlockedDatabases?: number;
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
  /** Close an unused actor pair after this duration. Default: 60000ms. */
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
  readonly placement: 'file';
  readonly sqlite: DatabaseActorSQLiteConfig;
  readonly maxDatabases: number;
  readonly maxBlockedDatabases: number;
  readonly readers: boolean;
  readonly maxQueuedPerDatabase: number;
  readonly maxQueuedTotal: number;
  readonly queueTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly sweepIntervalMs: number | false;
}

/** Normalized app-level physical-database topology. */
export type ResolvedAppDatabaseTopologyConfig =
  | ResolvedAppSingleDatabaseTopologyConfig
  | ResolvedAppMultipleDatabaseTopologyConfig;

/** Action taken when an auto-mode table crosses the row limit. */
export type AutoLazyAction = 'lazy' | 'warn' | 'reject';

/**
 * Per-table sync default override.
 *
 * `mode` controls how an omitted schema/client `_sync` value is interpreted.
 * `rowLimit`, `action`, and `persist` override the global auto-lazy settings
 * for this table only.
 */
export interface TableSyncDefaultConfig {
  mode?: DeclaredSyncMode;
  rowLimit?: number;
  action?: AutoLazyAction;
  persist?: boolean;
}

/**
 * Sync defaults used when a table does not explicitly declare `_sync`.
 *
 * Defaults are intentionally forgiving: omitted table sync mode means `auto`,
 * and `auto` switches a table to lazy once the row limit is crossed.
 */
export interface SyncDefaultsConfig {
  /** How omitted table sync modes are interpreted. Default: 'auto'. */
  defaultMode?: DeclaredSyncMode;
  /** Global auto-lazy behavior. */
  autoLazy?: {
    /** Row count where auto mode should stop full snapshots. Default: 1000. */
    rowLimit?: number;
    /** Behavior when an auto table crosses rowLimit. Default: 'lazy'. */
    action?: AutoLazyAction;
    /** Persist auto decisions in the app database. Default: true. */
    persist?: boolean;
  };
  /** Per-table sync overrides. */
  tables?: Record<string, DeclaredSyncMode | TableSyncDefaultConfig>;
}

/** Sitemap change frequency values accepted by sitemap.xml. */
export type SitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

/** One explicit sitemap entry supplied by app config. */
export interface SitemapEntry {
  href: string;
  lastmod?: string | Date;
  changefreq?: SitemapChangeFrequency;
  priority?: number;
}

/**
 * Automatic sitemap configuration.
 *
 * Static public page routes are discovered from the file router. Use entries
 * only for dynamic pages or deliberate overrides, and exclude for paths that
 * should not appear even when they are public.
 */
export interface SitemapConfig {
  enabled?: boolean;
  path?: string;
  changefreq?: SitemapChangeFrequency;
  priority?: number;
  entries?: readonly SitemapEntry[];
  exclude?: readonly string[];
}

/** App-owned hints for platform doctor checks that cannot be inferred statically. */
export interface AppDoctorConfig {
  /**
   * Non-unique indexes managed by migrations or startup compatibility code.
   * Keys are table names; values are indexed column names.
   */
  indexedFields?: Record<string, readonly string[]>;
}

/** Built-in authenticated file-storage settings used by createApp(). */
export interface AppStorageConfig {
  /**
   * HMAC secret for presigned URLs and upload grants. Explicit config wins
   * over ZERO_STORAGE_SIGNING_SECRET. When both are omitted, Zero persists a
   * random key in the durable app database during storage startup.
   */
  signingSecret?: string;
  /** Default capability expiry in seconds. Default: 3600. */
  defaultPresignedTTL?: number;
}

/** Normalized server-only storage settings. */
export interface ResolvedAppStorageConfig {
  signingSecret?: string;
  defaultPresignedTTL: number;
}

/** Normalized sitemap config consumed by the router plugin. */
export interface ResolvedSitemapConfig {
  path: string;
  changefreq?: SitemapChangeFrequency;
  priority?: number;
  entries: readonly SitemapEntry[];
  exclude: readonly string[];
}

/** Normalized per-table sync defaults. */
export interface ResolvedTableSyncDefault {
  mode?: DeclaredSyncMode;
  rowLimit: number;
  action: AutoLazyAction;
  persist: boolean;
}

/** Normalized sync defaults with all global values filled in. */
export interface ResolvedSyncDefaults {
  defaultMode: DeclaredSyncMode;
  rowLimit: number;
  action: AutoLazyAction;
  persist: boolean;
  tables: Map<string, ResolvedTableSyncDefault>;
}

/** WebSocket sync authentication policy for full-stack platform apps. */
export type SyncAuthMode = 'required' | 'public';

/**
 * Configuration for createApp() — the single entry point for
 * building a full-stack app with the platform.
 */
export interface AppConfig {
  /** App identity used by system UI and platform emails. */
  app?: AppIdentityConfig;

  /** Database configuration. Uses the platform SQLite persistence foundation. */
  db: ReactiveDBConfig;

  /**
   * Optional app-level database topology. Omission preserves the historical
   * single database represented by `db`; named mode adds isolated lazy files
   * without changing which database backs existing platform services.
   */
  databaseTopology?: AppDatabaseTopologyConfig;

  /**
   * Table definitions — accepts ANY of:
   * 1. Raw SQL schema:      `{ todos: { id: 'text primary key', title: 'text not null' } }`
   * 2. defineTable() output: `{ todos: todosTable }` (auto-extracts `.serverTable`)
   * 3. Mixed
   *
   * @example
   * ```ts
   * import { tables } from './lib/schemas';
   * createApp({ db: { mode: ':memory:' }, tables });
   * ```
   */
  tables: Record<string, AppTableInput>;

  /**
   * Auth configuration.
   * - `false` or omitted: no auth (all connections allowed)
   * - `true`: auth with defaults (15m access, 7d refresh)
   * - object: auth with custom TTLs
   */
  auth?: boolean | (AuthBehaviorConfig & {
    accessTokenTTL?: string;
    refreshTokenTTL?: string;
  });

  /**
   * Platform email configuration.
   *
   * `true` enables the default Resend provider. Object config can select a
   * built-in provider or pass a custom EmailProvider. Default: false.
   */
  email?: boolean | EmailConfig;

  /**
   * Platform AI configuration.
   *
   * `true` enables env-based provider auto-detection. Object config can add
   * explicit providers, aliases, and status endpoint options. Default: false.
   */
  ai?: boolean | AIConfig;

  /**
   * Platform vector-store configuration.
   *
   * `true` enables a default local zvec index. Object config can define named
   * indexes, dimensions, metadata filter fields, and storage paths.
   * Default: false.
   */
  vector?: boolean | VectorConfig;

  /**
   * Platform KV/cache configuration.
   *
   * Enabled by default with durable memory-first recovery under `./data/kv`.
   * Set to false to disable. Tests may explicitly pass `{ durability:
   * 'memory' }`, but generated apps should keep the default journal/checkpoint
   * recovery path.
   */
  kv?: boolean | KvServiceConfig;

  /**
   * Browser-grade HTML-to-PDF rendering.
   *
   * `true` enables secure Chromium defaults. Object config controls print
   * defaults, resource policy, limits, and custom renderer adapters. The
   * browser starts lazily on the first render. Default: false.
   */
  pdf?: boolean | PdfConfig;

  /** Enable per-user server-persisted state. Default: false */
  stateSync?: boolean;

  /**
   * WebSocket sync authentication policy.
   *
   * Auth-enabled apps default to `required` and fail closed. Use `public`
   * explicitly only when anonymous sync access is deliberate. Authless apps
   * always use public sync.
   */
  syncAuth?: SyncAuthMode;

  /**
   * Optional sync authorization policy for app-owned tables.
   *
   * Platform-owned tables keep the framework's protective defaults. App rules
   * compose with those defaults using deny-wins semantics.
   */
  syncPolicy?: SyncPolicy;

  /**
   * Authorization policy for app-owned ephemeral collaboration topics.
   *
   * Auth-enabled apps already reserve `presence:<roomId>`, `typing:<roomId>`,
   * and `user:<currentUserId>:<name>`. This policy classifies any additional
   * topic names and must return a server-derived internal namespace.
   */
  ephemeralPolicy?: EphemeralTopicPolicy;

  /**
   * App-owned resource definitions.
   *
   * Resource definitions are validated at startup and later reused by generated
   * CRUD, `/api/data`, sync policy, and doctor integrations.
   */
  resources?: readonly ResourceDefinition[];

  /**
   * Generated CRUD routes for registered resources.
   *
   * Defaults to enabled at `/api/resources`. Set to false when resources are
   * used only for custom routes or future data/sync policy integration.
   */
  resourceRoutes?: boolean | ResourceCrudRoutesConfig;

  /**
   * Default sync behavior for tables that do not explicitly declare `_sync`.
   *
   * By default omitted mode is `auto`: startup counts rows, keeps small tables
   * in full sync, and switches oversized tables to lazy sync. Explicit
   * `sync: 'full'` and `sync: 'lazy'` declarations always win.
   */
  syncDefaults?: SyncDefaultsConfig;

  /** Base directory for file storage. Default: '.storage'. */
  storageDir?: string;

  /** Signing and expiry policy for built-in authenticated file storage. */
  storage?: AppStorageConfig;

  /** File-based router app directory. Default: './app' */
  appDir?: string;

  /** Client bundle output directory. Default: './.build' */
  outDir?: string;

  /** Generated framework/app glue directory. Default: './.zero/generated' */
  generatedDir?: string;

  /**
   * App-owned Zero/Elysia plugin module directory. Default: './server/plugins'.
   *
   * Modules may export `defineZeroPlugin()` output, raw Elysia plugins, or
   * plugin callbacks. Set to false to disable plugin discovery.
   */
  serverPluginsDir?: string | false;

  /**
   * App-owned Zero middleware module directory. Default: './server/middleware'.
   *
   * Modules may export `defineMiddleware()` output or arrays of middleware.
   * Set to false to disable middleware discovery.
   */
  serverMiddlewareDir?: string | false;

  /**
   * App-owned Zero endpoint module directory. Default: './server/endpoints'.
   *
   * Modules may export `defineEndpoint()` output or arrays of endpoints.
   * Set to false to disable endpoint discovery.
   */
  serverEndpointsDir?: string | false;

  /**
   * App-owned Zero/Elysia route module directory. Default: './server/routes'.
   *
   * Modules may export `defineRouter()` output, raw Elysia plugins, plugin
   * callbacks, or arrays of routes. Set to false to disable route discovery.
   */
  serverRoutesDir?: string | false;

  /**
   * App-owned Zero resource module directory. Default: './server/resources'.
   *
   * Modules may export `defineResource()` output or arrays from default,
   * resource, or resources. Set to false to disable resource discovery.
   */
  serverResourcesDir?: string | false;

  /** Port to listen on. Default: 3000 */
  port?: number;

  /**
   * Run database migrations on startup. Default: true for file-backed DBs.
   * Set to false to skip migrations (e.g., if running `bun run src/migrations/run.ts` separately).
   */
  migrate?: boolean;

  /**
   * Platform observability configuration.
   *
   * Defaults to console logging plus a bounded in-memory event store exposed
   * through the protected `/api/_zero/observability` endpoint.
   */
  observability?: ObservabilityConfig | false;

  /**
   * Paths that don't require authentication (exact + prefix match).
   * Only used by the global protected-by-default auth guard.
   * The default includes the resolved login/registration paths plus account
   * lifecycle pages. An explicitly supplied list remains authoritative.
   */
  publicPaths?: string[];

  /**
   * Auth strategy for page routes when auth is enabled.
   *
   * - `protected-by-default`: all page routes require auth unless publicPaths match.
   * - `explicit`: routes are public unless a page/layout exports config.auth.
   *
   * Default: `protected-by-default` for backwards compatibility.
   */
  routeAuth?: RouteAuthMode;

  /**
   * Automatically serve a sitemap from public static page routes.
   *
   * `true` mounts `/sitemap.xml`. Object config can change the path, default
   * priority/changefreq, add manual dynamic entries, or exclude public paths.
   * Default: false.
   */
  sitemap?: boolean | SitemapConfig;

  /**
   * Redirect target for unauthenticated users.
   * Default: '/login'
   */
  loginPath?: string;

  /** Registration route used by native-app browser authorization. Default: '/register'. */
  registrationPath?: string;

  /** App-owned hints for platform doctor checks. */
  doctor?: AppDoctorConfig;
}

/**
 * Define a Zero app config while preserving literal inference.
 *
 * This helper is intentionally runtime-neutral: it returns the same object
 * passed in, and `createApp()` remains responsible for applying defaults and
 * validating cross-feature constraints.
 */
export function defineZeroConfig<const TConfig extends AppConfig>(config: TConfig): TConfig {
  return config;
}

// ─── Internal ──────────────────────────────────────────────────────────────

/** Resolved config with defaults filled in. */
export interface ResolvedConfig {
  app: AppIdentityConfig;
  db: ReactiveDBConfig;
  databaseTopology: ResolvedAppDatabaseTopologyConfig;
  tables: Record<string, TableSchema>;
  /** Server-only logical validators used by websocket mutation handling. */
  mutationValidators: Record<string, SyncTableMutationValidator>;
  auth: false | (AuthBehaviorConfig & { accessTokenTTL?: string; refreshTokenTTL?: string });
  email: false | EmailConfig;
  ai: false | ResolvedAIConfig;
  vector: false | ResolvedVectorConfig;
  kv: false | KvServiceConfig;
  pdf: false | ResolvedPdfConfig;
  stateSync: boolean;
  syncAuth: SyncAuthMode;
  /** Whether an auth-enabled app inherited the secure required-sync default. */
  syncAuthDefaulted: boolean;
  syncPolicy?: SyncPolicy;
  ephemeralPolicy?: EphemeralTopicPolicy;
  resources: readonly ResourceDefinition[];
  resourceRoutes: false | ResourceCrudRoutesConfig;
  storageDir: string;
  storage: ResolvedAppStorageConfig;
  appDir: string;
  outDir: string;
  generatedDir: string;
  serverPluginsDir: string | false;
  serverMiddlewareDir: string | false;
  serverEndpointsDir: string | false;
  serverRoutesDir: string | false;
  serverResourcesDir: string | false;
  port: number;
  migrate: boolean;
  observability?: ObservabilityConfig | false;
  publicPaths: string[];
  routeAuth: RouteAuthMode;
  sitemap: false | ResolvedSitemapConfig;
  loginPath: string;
  registrationPath: string;
  doctor: AppDoctorConfig;
  /** Table names with lazy sync mode — auto-registered for /api/data queries. */
  lazyTables: Set<string>;
  /** Table names that may be included in websocket snapshot payloads. */
  snapshotTables: Set<string>;
  /** Declared table sync mode before startup auto-resolution. */
  declaredSyncModes: Map<string, DeclaredSyncMode>;
  /** Resolved table sync modes injected into browser AppProvider config. */
  resolvedSyncModes: Record<string, SyncMode>;
  /** Normalized sync default policy. */
  syncDefaults: ResolvedSyncDefaults;
  /** Column names per table — used for SQL injection prevention in data queries. */
  tableColumns: Map<string, string[]>;
}

export function resolveConfig(
  config: AppConfig,
  env?: Record<string, string | undefined>
): ResolvedConfig {
  const auth = config.auth === true
    ? {}
    : config.auth === false || config.auth === undefined
      ? false
      : config.auth;
  const authBehavior = auth === false ? null : validateAppAuthConfig(auth);
  const email = config.email === true
    ? {}
    : config.email === false || config.email === undefined
      ? false
      : config.email;
  const ai = resolveAIConfig(config.ai, env);
  const vector = resolveVectorConfig(config.vector, env);
  const kv = resolveKvConfig(config.kv);
  const pdf = resolvePdfConfig(config.pdf, env);
  const storage = resolveAppStorageConfig(config.storage, env);
  const stateSync = config.stateSync ?? false;
  const syncAuth = config.syncAuth ?? (auth === false ? 'public' : 'required');
  const syncAuthDefaulted = auth !== false && config.syncAuth === undefined;
  const routeAuth = resolveRouteAuthMode(config.routeAuth, auth !== false);
  const sitemap = resolveSitemapConfig(config.sitemap);
  const loginPath = config.loginPath ?? '/login';
  const registrationPath = config.registrationPath ?? '/register';
  const publicPaths = config.publicPaths ?? defaultPublicPaths(
    loginPath,
    registrationPath,
    auth
  );

  if (stateSync && auth === false) {
    throw new Error('[app] stateSync requires auth: true because server state is keyed by authenticated user.');
  }
  if (auth === false && syncAuth === 'required') {
    throw new Error('[app] syncAuth: \'required\' requires auth: true.');
  }

  const syncDefaults = normalizeSyncDefaults(config.syncDefaults);

  // Normalize tables: accept defineTable() output alongside raw TableSchema.
  const normalized: Record<string, TableSchema> = {};
  const mutationValidators: Record<string, SyncTableMutationValidator> = {};
  for (const [name, def] of Object.entries(config.tables)) {
    const wrapped = 'serverTable' in def
      ? def as Exclude<AppTableInput, TableSchema>
      : undefined;
    const serverTable = wrapped?.serverTable ?? def as TableSchema;
    normalized[name] = serverTable;

    const validator = wrapped?.mutationValidator
      ?? serverTable[SYNC_TABLE_MUTATION_VALIDATOR];
    if (validator) mutationValidators[name] = validator;
  }

  const databaseTopology = resolveAppDatabaseTopology(
    config.databaseTopology,
    authBehavior?.tenancy.mode ?? 'single',
    normalized,
  );

  // Preserve declared modes so startup can resolve omitted/auto modes with DB row counts.
  const declaredSyncModes = new Map<string, DeclaredSyncMode>();
  for (const [name, def] of Object.entries(config.tables)) {
    const tableDefault = syncDefaults.tables.get(name);
    const explicitConfigMode = tableDefault?.mode;
    const schemaMode = getClientTableSyncMode(def);
    declaredSyncModes.set(name, explicitConfigMode ?? schemaMode ?? syncDefaults.defaultMode);
  }

  // Seed explicit lazy/full tables before startup resolution. Auto tables are
  // finalized by resolveTableSyncModes() once the ReactiveDB tables exist.
  const lazyTables = new Set<string>();
  const snapshotTables = new Set<string>();
  for (const [name, def] of Object.entries(config.tables)) {
    const mode = declaredSyncModes.get(name);
    if (mode === 'lazy') {
      lazyTables.add(name);
    } else if (mode === 'full') {
      snapshotTables.add(name);
    }
  }

  // Derive column names per table from normalized schemas (keys of TableSchema)
  const tableColumns = new Map<string, string[]>();
  for (const [name, schema] of Object.entries(normalized)) {
    tableColumns.set(name, getTableColumnNames(schema));
  }

  return {
    app: config.app ?? {},
    db: config.db,
    databaseTopology,
    tables: normalized,
    mutationValidators,
    auth,
    email,
    ai,
    vector,
    kv,
    pdf,
    stateSync,
    syncAuth,
    syncAuthDefaulted,
    syncPolicy: config.syncPolicy,
    ephemeralPolicy: config.ephemeralPolicy,
    resources: config.resources ?? [],
    resourceRoutes: config.resourceRoutes === false
      ? false
      : config.resourceRoutes === true || config.resourceRoutes === undefined
        ? {}
        : config.resourceRoutes,
    syncDefaults,
    storageDir: config.storageDir ?? '.storage',
    storage,
    appDir: config.appDir ?? './app',
    outDir: config.outDir ?? './.build',
    generatedDir: config.generatedDir ?? './.zero/generated',
    serverPluginsDir: config.serverPluginsDir ?? './server/plugins',
    serverMiddlewareDir: config.serverMiddlewareDir ?? './server/middleware',
    serverEndpointsDir: config.serverEndpointsDir ?? './server/endpoints',
    serverRoutesDir: config.serverRoutesDir ?? './server/routes',
    serverResourcesDir: config.serverResourcesDir ?? './server/resources',
    port: config.port ?? 3000,
    migrate: config.migrate ?? true,
    observability: config.observability,
    publicPaths,
    routeAuth,
    sitemap,
    loginPath,
    registrationPath,
    doctor: config.doctor ?? {},
    lazyTables,
    snapshotTables,
    declaredSyncModes,
    resolvedSyncModes: {},
    tableColumns,
  };
}

const DEFAULT_DATABASE_MAX_DATABASES = 16;
const DEFAULT_DATABASE_MAX_BLOCKED = 1_024;
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
  'maxBlockedDatabases',
  'readers',
  'maxQueuedPerDatabase',
  'maxQueuedTotal',
  'queueTimeoutMs',
  'operationTimeoutMs',
  'idleTimeoutMs',
  'sweepIntervalMs',
]);

/** Resolve logical database topology without touching the filesystem. */
function resolveAppDatabaseTopology(
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
  if (tenantIsolation === 'tenant-database'
    && realm.schemaChecksum !== hashSchemaSnapshot(snapshotDeclaredTables(
      appTables as Record<string, TableSchema>,
    ))) {
    throw new Error(
      '[app] databaseTopology tenant realm tables must match createApp({ tables }).',
    );
  }
  if (multiple.placement !== undefined && multiple.placement !== 'file') {
    throw new Error(
      '[app] databaseTopology.placement currently supports only "file".',
    );
  }

  const sqlite = normalizeDatabaseActorSQLiteConfig(multiple.sqlite ?? {});
  const maxDatabases = normalizePositiveSafeInteger(
    multiple.maxDatabases ?? DEFAULT_DATABASE_MAX_DATABASES,
    'databaseTopology.maxDatabases',
  );
  const maxBlockedDatabases = normalizePositiveSafeInteger(
    multiple.maxBlockedDatabases ?? DEFAULT_DATABASE_MAX_BLOCKED,
    'databaseTopology.maxBlockedDatabases',
  );
  const readers = multiple.readers ?? true;
  if (typeof readers !== 'boolean') {
    throw new Error('[app] databaseTopology.readers must be a boolean.');
  }
  const maxQueuedPerDatabase = normalizePositiveSafeInteger(
    multiple.maxQueuedPerDatabase
      ?? DEFAULT_DATABASE_MAX_QUEUED_PER_DATABASE,
    'databaseTopology.maxQueuedPerDatabase',
  );
  const maxQueuedTotal = normalizePositiveSafeInteger(
    multiple.maxQueuedTotal ?? DEFAULT_DATABASE_MAX_QUEUED_TOTAL,
    'databaseTopology.maxQueuedTotal',
  );
  const queueTimeoutMs = normalizePositiveSafeInteger(
    multiple.queueTimeoutMs ?? DEFAULT_DATABASE_QUEUE_TIMEOUT_MS,
    'databaseTopology.queueTimeoutMs',
  );
  const operationTimeoutMs = normalizePositiveSafeInteger(
    multiple.operationTimeoutMs ?? DEFAULT_DATABASE_OPERATION_TIMEOUT_MS,
    'databaseTopology.operationTimeoutMs',
  );
  const idleTimeoutMs = normalizeNonNegativeSafeInteger(
    multiple.idleTimeoutMs ?? DEFAULT_DATABASE_IDLE_TIMEOUT_MS,
    'databaseTopology.idleTimeoutMs',
  );
  const sweepIntervalMs = multiple.sweepIntervalMs === false
    ? false
    : normalizePositiveSafeInteger(
      multiple.sweepIntervalMs
        ?? Math.min(
          MAX_DATABASE_SWEEP_INTERVAL_MS,
          Math.max(
            MIN_DATABASE_SWEEP_INTERVAL_MS,
            Math.ceil(idleTimeoutMs / 2),
          ),
        ),
      'databaseTopology.sweepIntervalMs',
    );

  return Object.freeze({
    mode: 'multiple',
    rootDirectory,
    realm,
    createExecutor,
    tenantIsolation,
    placement: 'file',
    sqlite,
    maxDatabases,
    maxBlockedDatabases,
    readers,
    maxQueuedPerDatabase,
    maxQueuedTotal,
    queueTimeoutMs,
    operationTimeoutMs,
    idleTimeoutMs,
    sweepIntervalMs,
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

/** Validate behavior and app-only token fields before config reaches startup. */
function validateAppAuthConfig(
  config: AuthBehaviorConfig & {
    accessTokenTTL?: string;
    refreshTokenTTL?: string;
  },
): NormalizedAuthBehaviorConfig {
  if (
    config === null
    || typeof config !== 'object'
    || Array.isArray(config)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(config))
  ) {
    throw new Error('[auth] Auth config must be an object.');
  }
  const {
    accessTokenTTL,
    refreshTokenTTL,
    ...behavior
  } = config;
  const normalized = resolveAuthBehaviorConfig(behavior);
  validateAuthTokenTTL(accessTokenTTL, 'accessTokenTTL');
  validateAuthTokenTTL(refreshTokenTTL, 'refreshTokenTTL');
  return normalized;
}

function validateAuthTokenTTL(value: unknown, field: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    throw new Error(`[auth] ${field} must be a duration string.`);
  }
  parseTokenTTL(value, field);
}

/** Normalize built-in file-storage settings without exposing them client-side. */
function resolveAppStorageConfig(
  config: AppStorageConfig | undefined,
  env: Record<string, string | undefined> = Bun.env,
): ResolvedAppStorageConfig {
  if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) {
    throw new Error('[app] storage must be an object when configured.');
  }

  const configuredSecret = config?.signingSecret;
  if (configuredSecret !== undefined && (
    typeof configuredSecret !== 'string' || configuredSecret.trim().length === 0
  )) {
    throw new Error('[app] storage.signingSecret must be a non-empty string.');
  }
  const envSecret = env.ZERO_STORAGE_SIGNING_SECRET;
  const signingSecret = configuredSecret
    ?? (typeof envSecret === 'string' && envSecret.trim().length > 0 ? envSecret : undefined);
  const defaultPresignedTTL = config?.defaultPresignedTTL ?? 3600;
  if (!Number.isInteger(defaultPresignedTTL) || defaultPresignedTTL < 1) {
    throw new Error('[app] storage.defaultPresignedTTL must be a positive integer.');
  }

  return { signingSecret, defaultPresignedTTL };
}

function defaultPublicPaths(
  loginPath: string,
  registrationPath: string,
  auth: false | AuthBehaviorConfig
): string[] {
  const account = auth === false ? undefined : auth.account;
  const accountEmails = auth === false ? undefined : auth.accountEmails;

  return [...new Set([
    authRoutePathname(loginPath, '/login', 'loginPath'),
    authRoutePathname(registrationPath, '/register', 'registrationPath'),
    '/forgot-password',
    authRoutePathname(
      accountEmails?.resetPath,
      '/reset-password',
      'accountEmails.resetPath'
    ),
    authRoutePathname(
      accountEmails?.setupPath,
      '/setup-password',
      'accountEmails.setupPath'
    ),
    authRoutePathname(
      account?.emailVerificationPath,
      '/verify-email',
      'account.emailVerificationPath'
    ),
  ])];
}

function authRoutePathname(
  value: string | undefined,
  fallback: string,
  label: string
): string {
  const configured = value?.trim() || fallback;
  const suffix = configured.search(/[?#]/);
  const path = suffix === -1 ? configured : configured.slice(0, suffix);
  const localPath = path.startsWith('/') ? path : `/${path}`;
  if (
    !path
    || localPath.startsWith('//')
    || /^[a-z][a-z\d+.-]*:/i.test(path)
    || /[\\\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error(`[app] ${label} must be a safe local path.`);
  }
  return new URL(localPath, 'https://zero.local').pathname;
}

/** Normalize sitemap config while keeping the feature opt-in. */
function resolveSitemapConfig(config: AppConfig['sitemap']): false | ResolvedSitemapConfig {
  if (config === undefined || config === false) return false;
  const explicit = config === true ? {} : config;
  if (explicit.enabled === false) return false;

  return {
    path: normalizeSitemapPath(explicit.path),
    changefreq: explicit.changefreq,
    priority: explicit.priority,
    entries: explicit.entries ?? [],
    exclude: explicit.exclude ?? [],
  };
}

function normalizeSitemapPath(path: string | undefined): string {
  if (!path) return '/sitemap.xml';
  return path.startsWith('/') ? path : `/${path}`;
}

/** Normalize app KV config while keeping the default durable, not ephemeral. */
function resolveKvConfig(config: AppConfig['kv']): false | KvServiceConfig {
  if (config === false) return false;
  const explicit = config === true || config === undefined ? {} : config;
  return {
    baseDir: './data/kv',
    durability: 'everysec',
    ...explicit,
  };
}

/** Return real SQL column names from a table schema, excluding metadata keys. */
function getTableColumnNames(schema: TableSchema): string[] {
  return Object.entries(schema)
    .filter(([key, value]) => key !== '_identity' && typeof value === 'string')
    .map(([key]) => key);
}

/**
 * Normalize sync default options so downstream startup logic can resolve table
 * modes without repeatedly applying fallback values.
 */
function normalizeSyncDefaults(config?: SyncDefaultsConfig): ResolvedSyncDefaults {
  const rowLimit = normalizeRowLimit(config?.autoLazy?.rowLimit, 1000);
  const action = config?.autoLazy?.action ?? 'lazy';
  const persist = config?.autoLazy?.persist ?? true;
  const tables = new Map<string, ResolvedTableSyncDefault>();

  for (const [table, value] of Object.entries(config?.tables ?? {})) {
    if (typeof value === 'string') {
      tables.set(table, { mode: value, rowLimit, action, persist });
    } else {
      tables.set(table, {
        mode: value.mode,
        rowLimit: normalizeRowLimit(value.rowLimit, rowLimit),
        action: value.action ?? action,
        persist: value.persist ?? persist,
      });
    }
  }

  return {
    defaultMode: config?.defaultMode ?? 'auto',
    rowLimit,
    action,
    persist,
    tables,
  };
}

/** Return a safe positive integer row limit. */
function normalizeRowLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/** Extract a table's client `_sync` declaration when createApp received it. */
function getClientTableSyncMode(def: AppTableInput): DeclaredSyncMode | undefined {
  if (def && typeof def === 'object') {
    const clientTable = (def as { clientTable?: unknown }).clientTable;
    if (clientTable && typeof clientTable === 'object') {
      return (clientTable as ClientTableDef)._sync;
    }
  }
  return undefined;
}
