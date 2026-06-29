import type { ClientTableDef, DeclaredSyncMode, SyncMode, TableSchema } from '../../sync/types';
import type { SyncPolicy } from '../../sync/sync-policy';
import type { ObservabilityConfig } from '../../observability/types';
import type { AuthBehaviorConfig } from '../../auth/types';
import type { AppIdentityConfig, EmailConfig } from '../../email/types';
import { resolveAIConfig } from '../../ai/ai-env';
import type { AIConfig, ResolvedAIConfig } from '../../ai/ai-types';
import { resolveVectorConfig } from '../../vector/vector-config';
import type { ResolvedVectorConfig, VectorConfig } from '../../vector/vector-types';

// ─── App Configuration ─────────────────────────────────────────────────────

/** Table input accepted by createApp(). */
export type AppTableInput = TableSchema | {
  serverTable: TableSchema;
  clientTable?: ClientTableDef;
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
    /** Persist auto decisions in the app database. Default: true. */
    persist?: boolean;
  };
  /** Per-table sync overrides. */
  tables?: Record<string, DeclaredSyncMode | TableSyncDefaultConfig>;
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

/**
 * Configuration for createApp() — the single entry point for
 * building a full-stack app with the platform.
 */
export interface AppConfig {
  /** App identity used by system UI and platform emails. */
  app?: AppIdentityConfig;

  /** Database configuration */
  db: {
    /** ':memory:' for RAM-only, or a file path for durable storage */
    mode: 'memory' | (string & {});
    /** Ring buffer depth for reconnect replay. Default: 1000 */
    ringBufferDepth?: number;
  };

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

  /** Enable per-user server-persisted state. Default: false */
  stateSync?: boolean;

  /**
   * Optional sync authorization policy for app-owned tables.
   *
   * Platform-owned tables keep the framework's protective defaults. App rules
   * compose with those defaults using deny-wins semantics.
   */
  syncPolicy?: SyncPolicy;

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
   * Only used when auth is enabled.
   * Default: ['/login', '/register', '/forgot-password']
   */
  publicPaths?: string[];

  /**
   * Redirect target for unauthenticated users.
   * Default: '/login'
   */
  loginPath?: string;
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
  db: { mode: 'memory' | (string & {}); ringBufferDepth?: number };
  tables: Record<string, TableSchema>;
  auth: false | (AuthBehaviorConfig & { accessTokenTTL?: string; refreshTokenTTL?: string });
  email: false | EmailConfig;
  ai: false | ResolvedAIConfig;
  vector: false | ResolvedVectorConfig;
  stateSync: boolean;
  syncPolicy?: SyncPolicy;
  storageDir: string;
  appDir: string;
  outDir: string;
  generatedDir: string;
  serverPluginsDir: string | false;
  serverMiddlewareDir: string | false;
  serverEndpointsDir: string | false;
  serverRoutesDir: string | false;
  port: number;
  migrate: boolean;
  observability?: ObservabilityConfig | false;
  publicPaths: string[];
  loginPath: string;
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
  const email = config.email === true
    ? {}
    : config.email === false || config.email === undefined
      ? false
      : config.email;
  const ai = resolveAIConfig(config.ai, env);
  const vector = resolveVectorConfig(config.vector, env);
  const stateSync = config.stateSync ?? false;

  if (stateSync && auth === false) {
    throw new Error('[app] stateSync requires auth: true because server state is keyed by authenticated user.');
  }

  const syncDefaults = normalizeSyncDefaults(config.syncDefaults);

  // Normalize tables: accept defineTable() output alongside raw TableSchema.
  const normalized: Record<string, TableSchema> = {};
  for (const [name, def] of Object.entries(config.tables)) {
    normalized[name] = 'serverTable' in def ? (def as any).serverTable : def;
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
    tables: normalized,
    auth,
    email,
    ai,
    vector,
    stateSync,
    syncPolicy: config.syncPolicy,
    syncDefaults,
    storageDir: config.storageDir ?? '.storage',
    appDir: config.appDir ?? './app',
    outDir: config.outDir ?? './.build',
    generatedDir: config.generatedDir ?? './.zero/generated',
    serverPluginsDir: config.serverPluginsDir ?? './server/plugins',
    serverMiddlewareDir: config.serverMiddlewareDir ?? './server/middleware',
    serverEndpointsDir: config.serverEndpointsDir ?? './server/endpoints',
    serverRoutesDir: config.serverRoutesDir ?? './server/routes',
    port: config.port ?? 3000,
    migrate: config.migrate ?? true,
    observability: config.observability,
    publicPaths: config.publicPaths ?? ['/login', '/register', '/forgot-password'],
    loginPath: config.loginPath ?? '/login',
    lazyTables,
    snapshotTables,
    declaredSyncModes,
    resolvedSyncModes: {},
    tableColumns,
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
