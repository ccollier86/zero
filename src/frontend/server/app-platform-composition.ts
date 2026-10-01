import type { Elysia } from 'elysia';
import { createAIPlugin } from '../../ai';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { createAuthMiddleware } from '../../auth/auth.middleware';
import { createAuthPlugin, getAuthStore, getTokenService } from '../../auth/auth.plugin';
import {
  rejectedPageSessionCookieHeader,
  resolvePageSessionAuth,
} from '../../auth/page-session';
import type { configureEmail } from '../../email';
import { createKvPlugin } from '../../kv';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import { createObservabilityPlugin } from '../../observability';
import { createPdfPlugin } from '../../pdf';
import {
  configureResourceRegistry,
  createResourceCrudPlugin,
} from '../../resources';
import { createRoomPlugin } from '../../rooms/room.plugin';
import { createSchedulerPlugin } from '../../scheduler';
import { createStoragePlugin } from '../../storage/storage.plugin';
import { createDataQueryPlugin } from '../../sync/data-query.plugin';
import type { combineSyncPolicies } from '../../sync/sync-policy';
import { getSyncDB } from '../../sync/sync.plugin';
import { createPlatformTokenPlugin } from '../../tokens';
import { createVectorPlugin } from '../../vector';
import { createWorkflowPlugin } from '../../workflows';
import { WORKFLOW_SERVER_TABLE_NAMES } from '../../workflows/types';
import { addPlatformSnapshotTables } from './app-sync-tables';
import { createWorkflowAppLifecycle } from './app-workflow-lifecycle';
import { createRouterPlugin } from './router-plugin';
import { loadServerRoutePlugins } from './server-route-loader';
import { applyTableSyncResolution, resolveTableSyncModes } from './sync-mode-resolver';
import type { resolveConfig } from './types';

interface MountPlatformAppInput {
  app: Elysia;
  config: ReturnType<typeof resolveConfig>;
  syncPolicy: ReturnType<typeof combineSyncPolicies>;
  resourceRegistry: ReturnType<typeof configureResourceRegistry>;
  resourceAuthConfig: ReturnType<typeof resolveAuthBehaviorConfig>;
  emailRuntime: ReturnType<typeof configureEmail>;
  clientEntry?: string;
  cssPath?: string;
  onWorkflowStopCreated?: (stop: () => Promise<void>) => void;
}

/** Compose platform services and routes after the shared Sync runtime exists. */
export async function mountPlatformApp({
  app,
  config,
  syncPolicy,
  resourceRegistry,
  resourceAuthConfig,
  emailRuntime,
  clientEntry,
  cssPath,
  onWorkflowStopCreated,
}: MountPlatformAppInput) {
  const workflowLifecycle = createWorkflowAppLifecycle(
    app,
    () => Boolean(getTokenService()),
  );

  // 1.5. Platform tokens — generic action/resume token service for auth and app flows
  app.use(createPlatformTokenPlugin({ db: getSyncDB()! }));

  app.onStart(() => {
    const db = getSyncDB();
    if (!db) {
      throw new Error('[app] Sync plugin must start before sync mode resolution.');
    }

    const resolution = resolveTableSyncModes(config, db);
    applyTableSyncResolution(config, resolution);
    addPlatformSnapshotTables(config.snapshotTables, config.workflows !== false);
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
        account: config.auth.account,
        mfa: config.auth.mfa,
        accountEmails: config.auth.accountEmails,
        branding: config.auth.branding,
        emails: config.auth.emails,
        userProperties: config.auth.userProperties,
        strictUserProperties: config.auth.strictUserProperties,
        nativeApps: config.auth.nativeApps,
        nativeIssuer: resourceAuthConfig.nativeApps.issuer
          ?? nativeIssuerFromPublicUrl(config.app.publicUrl),
        nativeAudience: config.app.publicUrl?.replace(/\/+$/, ''),
        loginPath: config.loginPath,
        registrationPath: config.registrationPath,
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
    app.use(createVectorPlugin({ config: config.vector }));
  }

  // 2.75. PDF — lazy browser-grade renderer for server code and workflows
  if (config.pdf !== false) {
    app.use(createPdfPlugin({ config: config.pdf }));
  }

  // 2.8. KV/cache — memory-first app cache with journal/checkpoint recovery
  if (config.kv !== false) {
    app.use(createKvPlugin(config.kv));
  }

  // 3. Scheduler — provides cron job registration for other plugins
  app.use(createSchedulerPlugin());

  // 4. Notifications — depends on auth + scheduler
  if (config.auth !== false) {
    app.use(createNotificationPlugin({ db: getSyncDB()! }));
  }

  // 4.5. Rooms — depends on auth
  if (config.auth !== false) {
    app.use(createRoomPlugin({ db: getSyncDB()! }));
  }

  // 5. Workflows — depends on auth + scheduler
  if (config.workflows !== false) {
    // Freeze workflow dependencies here. Extensions mounted below are allowed
    // to wait for workflow readiness and therefore cannot be part of this set.
    workflowLifecycle.captureDependencyBoundary();
    app.use(createWorkflowPlugin({
      db: getSyncDB()!,
      register: config.workflows.register,
      shutdownGraceMs: config.workflows.shutdownGraceMs,
      ensureAuthReady: workflowLifecycle.ensureDependenciesReady,
    }, {
      managedStartup: true,
      onInitializerCreated: workflowLifecycle.captureInitializer,
      onStopCreated(stop) {
        workflowLifecycle.captureStopper(stop);
        onWorkflowStopCreated?.(workflowLifecycle.stopOwnedRuntime);
      },
    }));
    workflowLifecycle.installStartupBoundary();
  }

  // 6. Storage — depends on auth (for permissions)
  if (config.auth !== false) {
    app.use(createStoragePlugin({ db: getSyncDB()!, localDir: config.storageDir }));
  }

  // 6.7. Data query — lazy-table reads plus registered resource read policy
  const dataQueryableTables = new Set(config.lazyTables);
  // Workflow rows use their dedicated owner-aware transport. Generic lazy
  // reads cannot express parent-derived ownership for steps and events.
  for (const table of WORKFLOW_SERVER_TABLE_NAMES) dataQueryableTables.delete(table);
  app.use(
    createDataQueryPlugin({
      queryableTables: dataQueryableTables,
      tableColumns: config.tableColumns,
      policy: syncPolicy,
      getTokenService: config.auth !== false ? getTokenService : undefined,
      getUserStore: config.auth !== false ? getAuthStore : undefined,
      resourceRegistry,
      resourceAuthConfig,
    })
  );

  // 6.8. Generated resource CRUD — resource policy enforced server-side
  if (config.resourceRoutes !== false) {
    app.use(
      createResourceCrudPlugin({
        registry: resourceRegistry,
        tables: config.tables,
        authConfig: resourceAuthConfig,
        getTokenService: config.auth !== false ? getTokenService : undefined,
        getUserStore: config.auth !== false ? getAuthStore : undefined,
        ...config.resourceRoutes,
      })
    );
  }

  // 6.9. App-owned backend extensions — mounted before health and file-router catch-all
  const serverRoutePlugins = await loadServerRoutePlugins({
    extensionDirs: [
      { kind: 'plugins', dir: config.serverPluginsDir },
      { kind: 'middleware', dir: config.serverMiddlewareDir },
      { kind: 'endpoints', dir: config.serverEndpointsDir },
      { kind: 'routes', dir: config.serverRoutesDir },
    ],
  });
  for (const serverRoutePlugin of serverRoutePlugins) {
    app.use(serverRoutePlugin as any);
  }

  // 7. Health check — always available
  app.get('/api/health', () => ({ status: 'ok', uptime: process.uptime() }));

  // 8. File-based router — LAST (catch-all)
  app.use(
    createRouterPlugin({
      appDir: config.appDir,
      outDir: config.outDir,
      clientEntry,
      cssPath,
      platformConfig: {
        url: '', // Derived from request.url at runtime
        auth: config.auth !== false,
        email: emailRuntime.enabled,
        stateSync: config.stateSync,
        tableSyncModes: config.resolvedSyncModes,
        publicPaths: config.publicPaths,
        routeAuth: config.routeAuth,
        loginPath: config.loginPath,
        postLoginPath: config.postLoginPath,
      },
      ...(config.auth !== false
        ? {
            authGuard: {
              routeAuth: config.routeAuth,
              publicPaths: config.publicPaths,
              loginPath: config.loginPath,
              postLoginPath: config.postLoginPath,
              resolvePageAuth: async (request: Request) => {
                const auth = await resolvePageSessionAuth(request, getTokenService());
                return auth ? { ...auth } : null;
              },
              clearRejectedPageSession: rejectedPageSessionCookieHeader,
            },
          }
        : {}),
      ...(config.sitemap
        ? {
            sitemap: {
              config: config.sitemap,
              publicUrl: config.app.publicUrl,
              routeAuth: config.routeAuth,
              publicPaths: config.publicPaths,
            },
          }
        : {}),
    })
  );

  return app;
}

function nativeIssuerFromPublicUrl(publicUrl: string | undefined): string | undefined {
  return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/auth` : undefined;
}
