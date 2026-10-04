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
import type { AIService } from '../../ai/ai-service';
import type { AIConfig, ResolvedAIConfig } from '../../ai/ai-types';
import { resolveVectorConfig } from '../../vector/vector-config';
import type { ResolvedVectorConfig, VectorConfig } from '../../vector/vector-types';
import type {
  ResourceCrudRoutesConfig,
  ResourceDefinition,
} from '../../resources';
import type { DatabaseAutomationRegistry } from '../../database-automations/database-automations';
import { admitDatabaseRealmAutomations } from '../../databases/database-realm-automation-admission';
import { DatabaseError } from '../../databases/database-error';
import { resolveSQLiteStorageConfig } from '../../persistence/storage-config';
import type { KvServiceConfig } from '../../kv';
import { resolvePdfConfig } from '../../pdf/pdf-config';
import type { PdfConfig, ResolvedPdfConfig } from '../../pdf/pdf-types';
import type { WorkflowRegistry } from '../../workflows/workflow-registry';
import type { WorkflowInteractionAuthority } from '../../workflows/workflow-interaction-authority';
import type { WorkflowService } from '../../workflows/workflow-service';
import {
  assertDatabaseDirectoryIsolation,
  resolveControlDatabasePaths,
} from '../../databases/database-directory-isolation';
import {
  databaseColumnDefinitionAffinity,
  isSupportedDatabaseRowIdentityAffinity,
  isIsolatedDatabaseColumnDefinition,
} from '../../sync/row-identity';
import { tableColumnDeclaresPrimaryKey } from '../../resources/resource-schema';
import {
  resolveRouteAuthMode,
  type RouteAuthMode,
} from '../router/auth-policy';
import { resolveAppDatabaseTopology } from './database-topology-config';
import type {
  AppDatabaseTopologyConfig,
  ResolvedAppDatabaseTopologyConfig,
} from './database-topology-types';
import {
  comparableAuthPathname,
  configuredAuthPathname,
  normalizeConfiguredAuthPath,
} from '../router/auth-navigation';
import {
  resolveSystemDatabaseConfig,
  resolveSystemDatabaseOwnedPaths,
  type SystemDatabaseConfig,
} from './system-database-config';
import {
  resolveAppStorageConfig,
  type AppStorageConfig,
  type ResolvedAppStorageConfig,
} from '../../storage/storage-config';

export type { SystemDatabaseConfig } from './system-database-config';
export type {
  AppStorageConfig,
  ResolvedAppStorageConfig,
  ResolvedStorageStudioConfig,
  ResolvedStorageStudioLimits,
  ResolvedStorageStudioPublicAccess,
  StorageStudioConfig,
  StorageStudioDefaultGrantConfig,
  StorageStudioIsolation,
  StorageStudioLimitsConfig,
  StorageStudioPublicAccessConfig,
} from '../../storage/storage-config';

export type {
  AppDatabaseActorConfig,
  AppDatabaseHotPlacementConfig,
  AppDatabasePlacementConfig,
  AppDatabasePlacementPolicyConfig,
  AppDatabaseTopologyConfig,
  AppMultipleDatabaseTopologyConfig,
  AppSingleDatabaseTopologyConfig,
  AppTenantDataIsolation,
  ResolvedAppDatabaseTopologyConfig,
  ResolvedAppMultipleDatabaseTopologyConfig,
  ResolvedAppSingleDatabaseTopologyConfig,
} from './database-topology-types';

// ─── App Configuration ─────────────────────────────────────────────────────

/** Table input accepted by createApp(). */
export type AppTableInput = TableSchema | {
  serverTable: TableSchema;
  clientTable?: ClientTableDef;
  /** Optional logical websocket-mutation validator for a raw server table. */
  mutationValidator?: SyncTableMutationValidator;
};

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
    /** Persist auto decisions in the managed system database. Default: true. */
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

/** Managed durable-workflow registration for a full-stack app. */
export interface AppWorkflowRegistrationContext {
  /** This app's isolated AI service, or null when the AI layer is disabled. */
  readonly ai: AIService | null;
}

/** Managed durable-workflow registration for a full-stack app. */
export interface AppWorkflowsConfig {
  /**
   * Register handlers and definitions during app composition. Async setup is
   * awaited before crash recovery and service publication.
   */
  register?: (
    registry: WorkflowRegistry,
    context: AppWorkflowRegistrationContext,
  ) => void | Promise<void>;
  /**
   * Observe this app's recovered, published Torrent service.
   *
   * Use this synchronous binding seam for app-local integrations that need
   * both the registry created in `register` and the live service. Throwing
   * aborts workflow publication and rolls startup back.
   */
  onServiceCreated?: (service: WorkflowService) => void;
  /** Maximum shutdown wait for handlers that ignore cancellation. Default: 30s. */
  shutdownGraceMs?: number;
  /** Guardian/app policy adapter for human or agent interaction responders. */
  interactionAuthority?: WorkflowInteractionAuthority;
}

/**
 * Configuration for createApp() — the single entry point for
 * building a full-stack app with the platform.
 */
export interface AppConfig {
  /** App identity used by system UI and platform emails. */
  app?: AppIdentityConfig;

  /** Application database configuration exposed through `zero.db` and `zero.sql`. */
  db: ReactiveDBConfig;

  /**
   * Zero-owned control-plane database. Guardian, platform tokens, and built-in
   * service state use this database and never share the application handle.
   * Defaults to an independent ephemeral database when `db` is ephemeral and
   * to `./data/zero.system.db` otherwise.
   */
  systemDb?: SystemDatabaseConfig;

  /**
   * Optional app-level database topology. Omission preserves the historical
   * single database represented by `db`; multiple mode adds isolated lazy files
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
   * ReactiveDB functions and AFTER triggers installed on the pinned application
   * database. Fabric realms declare their actor-local automations on the realm
   * itself so every isolated file receives the same admitted registry.
   */
  databaseAutomations?: DatabaseAutomationRegistry;

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
   * Durable workflows. Enabled with auth by default. Pass a registration
   * callback for app handlers/definitions, or false to omit the subsystem.
   */
  workflows?: false | AppWorkflowsConfig;

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

  /**
   * Fallback destination after login, and for authenticated visits to the
   * login page. A safe `redirect` return path takes precedence. Default: '/'.
   */
  postLoginPath?: string;

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
  systemDb: ReactiveDBConfig;
  databaseTopology: ResolvedAppDatabaseTopologyConfig;
  tables: Record<string, TableSchema>;
  /** Schema-admitted functions/triggers for the pinned application database. */
  databaseAutomations?: DatabaseAutomationRegistry;
  /** Server-only logical validators used by websocket mutation handling. */
  mutationValidators: Record<string, SyncTableMutationValidator>;
  auth: false | (AuthBehaviorConfig & { accessTokenTTL?: string; refreshTokenTTL?: string });
  workflows: false | AppWorkflowsConfig;
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
  postLoginPath: string;
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
  const workflows = config.workflows === false || auth === false
    ? false
    : config.workflows ?? {};
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
  const loginPath = normalizeConfiguredAuthPath(
    config.loginPath ?? '/login',
    'loginPath',
  );
  const registrationPath = normalizeConfiguredAuthPath(
    config.registrationPath ?? '/register',
    'registrationPath',
  );
  const postLoginPath = normalizeConfiguredAuthPath(
    config.postLoginPath ?? '/',
    'postLoginPath',
  );
  if (
    config.postLoginPath !== undefined
    &&
    comparableAuthPathname(configuredAuthPathname(postLoginPath, 'postLoginPath'))
    === comparableAuthPathname(configuredAuthPathname(loginPath, 'loginPath'))
  ) {
    throw new Error('[app] postLoginPath must not resolve to loginPath.');
  }
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
  if (auth === false && config.workflows !== undefined && config.workflows !== false) {
    throw new Error('[app] workflows require auth: true.');
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
  assertSupportedAppTableRowIdentities(normalized);

  const databaseAutomations = admitDatabaseRealmAutomations(
    config.databaseAutomations,
    normalized,
  );

  const databaseTopology = resolveAppDatabaseTopology(
    config.databaseTopology,
    authBehavior?.tenancy.mode ?? 'single',
    normalized,
  );
  const systemDb = resolveSystemDatabaseConfig(config.db, config.systemDb);
  const durableDatabaseAutomations = registryHasDurableFunctions(databaseAutomations)
    || (databaseTopology.mode === 'multiple'
      && registryHasDurableFunctions(databaseTopology.realm.automations));
  const systemDatabaseMode = systemDb.sqlite?.mode
    ?? resolveSQLiteStorageConfig(systemDb).mode;
  if (durableDatabaseAutomations && systemDatabaseMode === 'ephemeral') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Durable database functions require a crash-durable system database for source recovery.',
      {
        retryable: false,
        outcome: 'not-started',
        details: { component: 'database-automations' },
      },
    );
  }
  const storageDir = config.storageDir ?? '.storage';
  const outDir = config.outDir ?? './.build';
  if (databaseTopology.mode === 'multiple') {
    assertDatabaseDirectoryIsolation({
      rootDirectory: databaseTopology.rootDirectory,
      outDir,
      storageDir,
      controlDatabasePaths: [
        ...resolveControlDatabasePaths(config.db),
        ...resolveSystemDatabaseOwnedPaths(systemDb),
      ],
    });
  }

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
    systemDb,
    databaseTopology,
    tables: normalized,
    ...(databaseAutomations === undefined ? {} : { databaseAutomations }),
    mutationValidators,
    auth,
    workflows,
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
    storageDir,
    storage,
    appDir: config.appDir ?? './app',
    outDir,
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
    postLoginPath,
    doctor: config.doctor ?? {},
    lazyTables,
    snapshotTables,
    declaredSyncModes,
    resolvedSyncModes: {},
    tableColumns,
  };
}

function registryHasDurableFunctions(
  registry: DatabaseAutomationRegistry | undefined,
): boolean {
  return registry?.listFunctions().some(({ mode }) => mode === 'durable') ?? false;
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
  return configuredAuthPathname(value?.trim() || fallback, label);
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

/** Reject app schemas whose row identity cannot cross Sync losslessly. */
function assertSupportedAppTableRowIdentities(
  tables: Readonly<Record<string, TableSchema>>,
): void {
  for (const [table, schema] of Object.entries(tables)) {
    for (const [column, definition] of Object.entries(schema)) {
      if (column === '_identity' || typeof definition !== 'string') continue;
      if (!isIsolatedDatabaseColumnDefinition(definition)) {
        throw new Error(
          `[app] Table "${table}" column "${column}" must describe exactly one isolated SQL column.`,
        );
      }
    }
    const primaryKeys = Object.keys(schema).filter((column) =>
      tableColumnDeclaresPrimaryKey(schema, column));
    if (primaryKeys.length !== 1) {
      throw new Error(
        `[app] Table "${table}" must declare exactly one primary-key column.`,
      );
    }
    const primaryKey = primaryKeys[0]!;
    const affinity = databaseColumnDefinitionAffinity(schema[primaryKey]);
    if (isSupportedDatabaseRowIdentityAffinity(affinity)) continue;
    throw new Error(
      `[app] Table "${table}" primary key "${primaryKey}" must declare `
      + `TEXT or INTEGER affinity; received ${affinity}.`,
    );
  }
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
