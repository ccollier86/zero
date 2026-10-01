import { Elysia } from 'elysia';
import { createSyncPlugin } from '../../sync/sync.plugin';
import { combineSyncPolicies, createDefaultSyncPolicy } from '../../sync/sync-policy';
import { getAuthStore, getTokenService } from '../../auth/auth.plugin';
import { getSyncDB } from '../../sync/sync.plugin';
import { WORKFLOW_SERVER_TABLE_NAMES } from '../../workflows/types';
import { createWorkflowSyncPolicyAdapter } from '../../workflows/workflow-sync-policy';
import { buildClientBundle } from './client-bundle';
import { buildPlatformStyles } from './style-bundle';
import { configureEmail } from '../../email';
import type { AppConfig } from './types';
import { resolveConfig } from './types';
import { Migrator, migrations } from '../../migrations';
import { OBS_CODES, configureObservability, emitPlatformCode } from '../../observability';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../../persistence';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import {
  configureResourceRegistry,
  ResourceSyncPolicyService,
  loadResourceDefinitions,
} from '../../resources';
import {
  getAppStopHooks,
  installAppStopBarrier,
  type AppStopHook,
} from './app-stop-lifecycle';
import { installAppSignalLifecycle } from './app-signal-lifecycle';
import { mountPlatformApp } from './app-platform-composition';
import {
  addPlatformSnapshotTables,
  PLATFORM_SYNC_WRITE_PROTECTED_TABLES,
} from './app-sync-tables';

// ─── App Factory ───────────────────────────────────────────────────────────

/**
 * Create a full-stack Elysia application.
 *
 * Wires together:
 * - Sync engine (ReactiveDB + WebSocket pub/sub)
 * - Auth (JWT, user store, token rotation) — optional
 * - State sync (per-user KV) — optional
 * - File-based router (SSR + API routes)
 * - Client bundle (built with Bun.build)
 *
 * @example
 * ```ts
 * import { createApp } from '@zero/framework/server';
 *
 * const app = await createApp({
 *   db: { mode: 'memory' },
 *   tables: {
 *     todos: { id: 'text primary key', title: 'text not null', done: 'integer default 0' },
 *   },
 *   auth: true,
 *   stateSync: true,
 * });
 *
 * app.listen(3000);
 * ```
 */
export async function createApp(userConfig: AppConfig) {
  const config = resolveConfig(userConfig);
  if (config.db.database && !config.db.sqlite) {
    throw new Error('[app] createApp({ db.database }) bypasses the platform SQL service. Pass db.sqlite or a platform storage config instead.');
  }
  configureObservability(config.observability);
  const sqlite = config.db.sqlite ?? createPlatformSQLiteService(config.db);
  const ownsSqlite = !config.db.sqlite;
  let lifecycleApp: Elysia | null = null;
  let sqliteClosed = false;
  let stopOwnedWorkflows: (() => Promise<void>) | null = null;
  const closeOwnedSQLite = (): void => {
    if (!ownsSqlite || sqliteClosed) return;
    sqliteClosed = true;
    sqlite.close();
  };

  try {
    const emailRuntime = configureEmail(config.email, config.app);
    addPlatformSnapshotTables(config.snapshotTables, config.workflows !== false);
    const platformSyncPolicy = createDefaultSyncPolicy({
      // Disabling the runtime must not reopen historical workflow data. When
      // enabled, definitions remain server-only while runtime rows are narrowed
      // by the owner-aware resource adapter below.
      readProtectedTables: config.workflows === false
        ? WORKFLOW_SERVER_TABLE_NAMES
        : ['workflow_definitions'],
      writeProtectedTables: config.auth !== false
        ? PLATFORM_SYNC_WRITE_PROTECTED_TABLES
        : WORKFLOW_SERVER_TABLE_NAMES,
    });
    const syncPolicy = combineSyncPolicies(platformSyncPolicy, config.syncPolicy);
    const loadedResources = await loadResourceDefinitions({
      resourcesDir: config.serverResourcesDir,
    });
    const resourceAuthConfig = resolveAuthBehaviorConfig(
      config.auth === false ? {} : config.auth,
    );
    const resourceRegistry = configureResourceRegistry({
      resources: [...config.resources, ...loadedResources],
      tables: config.tables,
      authConfig: resourceAuthConfig,
    });
    const resourceSyncPolicy = new ResourceSyncPolicyService({
      registry: resourceRegistry,
      authConfig: resourceAuthConfig,
      getUserStore: config.auth !== false ? getAuthStore : undefined,
    });
    let workflowSyncDB: ReturnType<typeof getSyncDB> = null;
    const syncResourcePolicy = config.workflows === false
      ? resourceSyncPolicy
      : createWorkflowSyncPolicyAdapter({
          getDB: () => workflowSyncDB,
          delegate: resourceSyncPolicy,
        });

    // ─── Build client bundle ────────────────────────────────
    let clientEntry: string | undefined;
    let cssPath: string | undefined;
    try {
      const bundle = await buildClientBundle(config.outDir, config.appDir, {
        generatedDir: config.generatedDir,
      });
      clientEntry = bundle.publicPath;
      emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, {
        metadata: { publicPath: bundle.publicPath },
      });
    } catch (err) {
      // Client bundle is optional — SSR still works without hydration
      emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED, {
        error: err,
        metadata: { outDir: config.outDir, appDir: config.appDir },
      });
    }
    try {
      const styles = await buildPlatformStyles(config.outDir, config.appDir);
      cssPath = styles.publicPath;
      emitPlatformCode(OBS_CODES.APP_STYLES_READY, {
        metadata: { publicPath: styles.publicPath },
      });
    } catch (err) {
      emitPlatformCode(OBS_CODES.APP_STYLES_FAILED, {
        error: err,
        metadata: { outDir: config.outDir, appDir: config.appDir },
      });
    }

    // Migrations run before listen against the shared platform SQL handle.
    if (shouldRunMigrations(sqlite, config.migrate)) {
      const migrator = new Migrator({
        database: sqlite.raw,
        dbPath: sqlite.snapshotPath ?? sqlite.path ?? ':memory:',
        migrations,
        applyPragmas: false,
        createBackups: sqlite.mode !== 'ephemeral',
      });
      try {
        migrator.run();
      } finally {
        migrator.dispose();
      }
      sqlite.snapshot?.snapshotSync();
    }

    // ─── Assemble Elysia app ────────────────────────────────
    const terminalStopHooks: AppStopHook[] = [];
    const app = installAppStopBarrier(new Elysia({ name: 'platform' }), {
      beforeHooks: async () => { await stopOwnedWorkflows?.(); },
      // Sync releases ReactiveDB before the platform-owned SQL handle closes.
      lastHooks: terminalStopHooks,
    });
    lifecycleApp = app;

    app.onStart(() => { sqlite.start(); });
    let hookCount = getAppStopHooks(app).length;
    app.onStop(closeOwnedSQLite);
    terminalStopHooks.push(...getAppStopHooks(app).slice(hookCount));

    // 1. Sync engine — always first (provides ReactiveDB over shared SQL)
    hookCount = getAppStopHooks(app).length;
    app.use(createSyncPlugin({
      db: { ...config.db, sqlite },
      tables: config.tables,
      stateSync: config.stateSync,
      policy: syncPolicy,
      resourcePolicy: syncResourcePolicy,
      snapshotTables: config.snapshotTables,
      auth: config.auth !== false
        ? {
            required: config.syncAuth === 'required',
            modeDefaulted: config.syncAuthDefaulted,
            getTokenVerifier: getTokenService,
          }
        : undefined,
    }));
    terminalStopHooks.unshift(...getAppStopHooks(app).slice(hookCount));
    workflowSyncDB = getSyncDB();
    if (!workflowSyncDB) {
      throw new Error('[app] Sync plugin did not publish its app-local database.');
    }

    const mounted = await mountPlatformApp({
      app,
      config,
      syncPolicy,
      resourceRegistry,
      resourceAuthConfig,
      emailRuntime,
      clientEntry,
      cssPath,
      onWorkflowStopCreated(stop) { stopOwnedWorkflows = stop; },
    });
    return installAppSignalLifecycle(mounted);
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      if (lifecycleApp) await lifecycleApp.stop();
      else closeOwnedSQLite();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, 'Application construction and cleanup failed');
  }
}

function shouldRunMigrations(sqlite: PlatformSQLiteService, migrate: boolean): boolean {
  return migrate && sqlite.mode !== 'ephemeral';
}

/** Type helper — export the app type for Eden Treaty typed client. */
export type App = Awaited<ReturnType<typeof createApp>>;
