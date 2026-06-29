import { Elysia } from 'elysia';
import { createSyncPlugin } from '../../sync/sync.plugin';
import { combineSyncPolicies, createDefaultSyncPolicy } from '../../sync/sync-policy';
import { createAuthPlugin, getTokenService } from '../../auth/auth.plugin';
import { createAuthMiddleware } from '../../auth/auth.middleware';
import { getSyncDB } from '../../sync/sync.plugin';
import { createSchedulerPlugin, getScheduler } from '../../scheduler';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { createRoomPlugin } from '../../rooms/room.plugin';
import { ROOM_TABLES } from '../../rooms/types';
import { createWorkflowPlugin, getWorkflowService } from '../../workflows';
import { WORKFLOW_TABLES } from '../../workflows/types';
import { createStoragePlugin } from '../../storage/storage.plugin';
import { STORAGE_TABLES } from '../../storage/types';
import { createDataQueryPlugin } from '../../sync/data-query.plugin';
import { createRouterPlugin } from './router-plugin';
import { loadServerRoutePlugins } from './server-route-loader';
import { buildClientBundle } from './client-bundle';
import { buildPlatformStyles } from './style-bundle';
import { configureEmail } from '../../email';
import { createAIPlugin } from '../../ai';
import type { AppConfig } from './types';
import { resolveConfig } from './types';
import { applyTableSyncResolution, resolveTableSyncModes } from './sync-mode-resolver';
import { Migrator, migrations } from '../../migrations';
import { OBS_CODES, configureObservability, createObservabilityPlugin, emitPlatformCode } from '../../observability';
import { createVectorPlugin } from '../../vector';

// ─── App Factory ───────────────────────────────────────────────────────────

const PLATFORM_SYNC_WRITE_PROTECTED_TABLES = new Set([
  'users',
  ...Object.keys(NOTIFICATION_TABLES),
  ...Object.keys(ROOM_TABLES),
  ...Object.keys(WORKFLOW_TABLES),
  ...Object.keys(STORAGE_TABLES),
]);

const PLATFORM_CLIENT_TABLES = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};

/** Include framework-owned full-sync tables in the websocket snapshot allow-list. */
function addPlatformSnapshotTables(snapshotTables: Set<string>): void {
  for (const [table, def] of Object.entries(PLATFORM_CLIENT_TABLES)) {
    if (def._sync !== 'lazy') snapshotTables.add(table);
  }
}

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
  configureObservability(config.observability);
  const emailRuntime = configureEmail(config.email, config.app);
  addPlatformSnapshotTables(config.snapshotTables);
  const platformSyncPolicy = config.auth !== false
    ? createDefaultSyncPolicy({
        writeProtectedTables: PLATFORM_SYNC_WRITE_PROTECTED_TABLES,
      })
    : undefined;
  const syncPolicy = combineSyncPolicies(platformSyncPolicy, config.syncPolicy);

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

  // ─── Run database migrations ──────────────────────────────
  // Migrations run BEFORE the server starts, on the raw database file.
  // This ensures schema is up to date even if plugins haven't loaded yet.
  // Skipped for in-memory databases (they start fresh every time).
  if (config.db.mode !== 'memory' && config.migrate) {
    const migrator = new Migrator({
      dbPath: config.db.mode,
      migrations,
    });
    try {
      migrator.run();
    } finally {
      migrator.dispose();
    }
  }

  // ─── Assemble Elysia app ────────────────────────────────
  const app = new Elysia({ name: 'platform' });

  // 1. Sync engine — always first (provides the DB)
  app.use(
    createSyncPlugin({
      db: config.db,
      tables: config.tables,
      stateSync: config.stateSync,
      policy: syncPolicy,
      snapshotTables: config.snapshotTables,
      auth: config.auth !== false
        ? {
            // Auth routes are mounted after sync, so the verifier is resolved lazily
            // when a WebSocket opens rather than during plugin composition.
            getTokenVerifier: getTokenService,
          }
        : undefined,
    })
  );

  app.onStart(() => {
    const db = getSyncDB();
    if (!db) {
      throw new Error('[app] Sync plugin must start before sync mode resolution.');
    }

    const resolution = resolveTableSyncModes(config, db);
    applyTableSyncResolution(config, resolution);
    addPlatformSnapshotTables(config.snapshotTables);
  });

  // 2. Auth — optional, mounted before middleware
  if (config.auth !== false) {
    const db = getSyncDB();
    if (!db) {
      throw new Error('[app] Sync plugin must start before auth. This should not happen.');
    }

    app.use(
      createAuthPlugin({
        db,
        accessTokenTTL: config.auth.accessTokenTTL,
        refreshTokenTTL: config.auth.refreshTokenTTL,
        registration: config.auth.registration,
        accountEmails: config.auth.accountEmails,
        userProperties: config.auth.userProperties,
        strictUserProperties: config.auth.strictUserProperties,
      })
    );

    // Auth middleware — resolves authContext + requireAuth/requireAdmin globally
    app.use(createAuthMiddleware(getTokenService));
  }

  // 2.5. Observability — default sink endpoint + global error reporting
  app.use(createObservabilityPlugin({
    config: config.observability,
    authEnabled: config.auth !== false,
  }));

  // 2.6. AI — optional internal provider service for loaders, jobs, workflows, and plugins
  if (config.ai !== false) {
    app.use(createAIPlugin({
      config: config.ai,
      authEnabled: config.auth !== false,
    }));
  }

  // 2.7. Vector store — optional local zvec service for loaders, jobs, workflows, and plugins
  if (config.vector !== false) {
    app.use(createVectorPlugin({
      config: config.vector,
    }));
  }

  // 3. Scheduler — provides cron job registration for other plugins
  app.use(createSchedulerPlugin());

  // 4. Notifications — depends on auth + scheduler
  if (config.auth !== false) {
    const db = getSyncDB()!;
    app.use(createNotificationPlugin({ db }));
  }

  // 4.5. Rooms — depends on auth
  if (config.auth !== false) {
    const db = getSyncDB()!;
    app.use(createRoomPlugin({ db }));
  }

  // 5. Workflows — depends on auth + scheduler
  if (config.auth !== false) {
    const db = getSyncDB()!;
    app.use(createWorkflowPlugin({ db }));

    // Register workflow polling jobs after scheduler is available
    const scheduler = getScheduler();
    if (scheduler) {
      scheduler.register({
        name: 'workflow-retries',
        pattern: '* * * * *', // every minute
        run: async () => {
          const svc = getWorkflowService();
          if (svc) await svc.pollRetries();
        },
      });
      scheduler.register({
        name: 'workflow-timeouts',
        pattern: '* * * * *',
        run: () => {
          const svc = getWorkflowService();
          if (svc) svc.pollTimeouts();
        },
      });
    }
  }

  // 6. Storage — depends on auth (for permissions)
  if (config.auth !== false) {
    const db = getSyncDB()!;
    app.use(createStoragePlugin({ db, localDir: config.storageDir }));
  }

  // 6.5. Data query — auto-registers /api/data for resolved lazy-synced tables
  app.use(
    createDataQueryPlugin({
      queryableTables: config.lazyTables,
      tableColumns: config.tableColumns,
      policy: syncPolicy,
      getTokenService: config.auth !== false ? getTokenService : undefined,
    })
  );

  // 6.6. App-owned Elysia routes — mounted before health and file-router catch-all
  if (config.serverRoutesDir !== false) {
    const serverRoutePlugins = await loadServerRoutePlugins({
      routesDir: config.serverRoutesDir,
    });
    for (const serverRoutePlugin of serverRoutePlugins) {
      app.use(serverRoutePlugin as any);
    }
  }

  // ─── Process-level WAL safety net ───────────────────────
  // Catches SIGINT/SIGTERM and ensures app.stop() runs (triggers WAL checkpoint).
  // Without this, Ctrl+C or container SIGTERM may skip onStop hooks.
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    emitPlatformCode(OBS_CODES.APP_SHUTDOWN_SIGNAL, {
      metadata: { signal },
    });
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 7. Health check — always available
  app.get('/api/health', () => ({ status: 'ok', uptime: process.uptime() }));

  // 8. File-based router — LAST (catch-all)
  // URL is derived from each request in the router plugin (not hardcoded)
  app.use(
    createRouterPlugin({
      appDir: config.appDir,
      clientEntry,
      cssPath,
      platformConfig: {
        url: '', // Derived from request.url at runtime
        auth: config.auth !== false,
        email: emailRuntime.enabled,
        stateSync: config.stateSync,
        tableSyncModes: config.resolvedSyncModes,
        publicPaths: config.publicPaths,
        loginPath: config.loginPath,
      },
      // When auth is enabled, protect all page routes by default
      ...(config.auth !== false
        ? {
            authGuard: {
              publicPaths: config.publicPaths,
              loginPath: config.loginPath,
            },
          }
        : {}),
    })
  );

  return app;
}

/** Type helper — export the app type for Eden Treaty typed client. */
export type App = Awaited<ReturnType<typeof createApp>>;
