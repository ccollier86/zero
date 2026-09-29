import { Elysia } from 'elysia';
import { createSyncPlugin } from '../../sync/sync.plugin';
import type { ReactiveDB } from '../../sync/reactive-db';
import { combineSyncPolicies, createDefaultSyncPolicy } from '../../sync/sync-policy';
import { createManagedEphemeralTopicPolicy } from '../../sync/ephemeral-managed-policy';
import { createAuthPlugin } from '../../auth/auth.plugin';
import type { AuthRuntime } from '../../auth/auth-runtime';
import { createAuthMiddleware } from '../../auth/auth.middleware';
import {
  rejectedPageSessionCookieHeader,
  resolvePageSessionAuth,
} from '../../auth/page-session';
import { createSchedulerPlugin } from '../../scheduler';
import { SchedulerService } from '../../scheduler/scheduler-service';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { createRoomPlugin } from '../../rooms/room.plugin';
import { ROOM_TABLES } from '../../rooms/types';
import { createWorkflowPlugin } from '../../workflows';
import type { WorkflowService } from '../../workflows/workflow-service';
import { WORKFLOW_TABLES } from '../../workflows/types';
import { createStoragePlugin } from '../../storage/storage.plugin';
import { STORAGE_TABLES } from '../../storage/types';
import { createDataQueryPlugin } from '../../sync/data-query.plugin';
import { createRouterPlugin } from './router-plugin';
import { loadServerRoutePlugins } from './server-route-loader';
import { createWorkflowExecutionServiceProvider } from './workflow-execution-services';
import { buildClientBundle } from './client-bundle';
import { buildPlatformStyles } from './style-bundle';
import { createEmailRuntime, registerEmailRuntime } from '../../email';
import { createAIPlugin } from '../../ai';
import { createKvPlugin, type KvService } from '../../kv';
import { createPdfPlugin } from '../../pdf';
import type { AppConfig } from './types';
import type { AuthBehaviorConfig } from '../../auth/types';
import { resolveConfig } from './types';
import { applyTableSyncResolution, resolveTableSyncModes } from './sync-mode-resolver';
import { Migrator, migrations } from '../../migrations';
import {
  OBS_CODES,
  configureObservability,
  createObservabilityPlugin,
  emitPlatformCode,
  emitPlatformCodeTo,
} from '../../observability';
import { createVectorPlugin } from '../../vector';
import { createPlatformTokenPlugin } from '../../tokens';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../../persistence';
import {
  isPolicyTrustedUserProperty,
  resolveAuthBehaviorConfig,
} from '../../auth/auth-config';
import {
  createResourceRegistry,
  createResourceCrudPlugin,
  assertResourceStorageRealms,
  registerResourceRegistry,
  ResourceSyncPolicyService,
  loadResourceDefinitions,
} from '../../resources';
import { installAppStopBarrier } from './app-stop-lifecycle';
import { installAppSignalLifecycle } from './app-signal-lifecycle';
import {
  PLATFORM_SYNC_PRIVATE_TABLES,
  PlatformSyncPolicyService,
} from './platform-sync-policy';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_EMAIL_RUNTIME,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_RESOURCE_REGISTRY,
  ZERO_ROOM_SERVICE,
} from '../../runtime/service-keys';

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
  const runtime = new ZeroAppRuntime();
  const resourceAuthConfig = resolveAuthBehaviorConfig(
    config.auth === false ? {} : appAuthBehaviorConfig(config.auth),
  );
  const getAppAuthStore = () => runtime.get(ZERO_AUTH_STORE);
  const getAppTokenService = () => runtime.get(ZERO_AUTH_TOKEN_SERVICE);
  const getAppAuthorizationKernel = () => runtime.get(ZERO_AUTHORIZATION_KERNEL);
  const getAppRoleAssignments = () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE);
  let appSyncDB: ReactiveDB | null = null;
  if (config.db.database && !config.db.sqlite) {
    throw new Error('[app] createApp({ db.database }) bypasses the platform SQL service. Pass db.sqlite or a platform storage config instead.');
  }
  const observabilityRuntime = configureObservability(config.observability);
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, observabilityRuntime);
  const emitCode: typeof emitPlatformCode = (definition, options) =>
    emitPlatformCodeTo(observabilityRuntime, definition, options);
  const sqlite = config.db.sqlite ?? createPlatformSQLiteService(config.db);
  const ownsSqlite = !config.db.sqlite;
  try {
    // Register the owned SQL handle first so reverse-order runtime teardown
    // releases every dependent service before the final durability boundary.
    // This also covers createApp() results that are disposed before listen().
    if (ownsSqlite) runtime.addCleanup(() => sqlite.close());
    const emailRuntime = createEmailRuntime(config.email, config.app, emitCode);
    runtime.set(ZERO_EMAIL_RUNTIME, emailRuntime);
    const emailRuntimeRegistration = registerEmailRuntime(runtime, emailRuntime);
    runtime.addCleanup(() => emailRuntimeRegistration.unregister());
    addPlatformSnapshotTables(config.snapshotTables);
    const platformSyncPolicy = config.auth !== false
      ? createDefaultSyncPolicy({
          readProtectedTables: PLATFORM_SYNC_PRIVATE_TABLES,
          writeProtectedTables: PLATFORM_SYNC_WRITE_PROTECTED_TABLES,
        })
      : undefined;
    const syncPolicy = combineSyncPolicies(platformSyncPolicy, config.syncPolicy);
    const loadedResources = await loadResourceDefinitions({
      resourcesDir: config.serverResourcesDir,
    });
    const managedResourceTables = new Set(Object.keys(config.tables));
    const resourceRegistry = createResourceRegistry({
      resources: [...config.resources, ...loadedResources],
      tables: config.tables,
      authConfig: resourceAuthConfig,
      tenancyMode: resourceAuthConfig.tenancy.mode,
      managedTables: managedResourceTables,
    });
    assertResourceExposureLoadingCompatibility(resourceRegistry, config);
    runtime.set(ZERO_RESOURCE_REGISTRY, resourceRegistry);
    const resourceRegistryRegistration = registerResourceRegistry(runtime, resourceRegistry);
    runtime.addCleanup(() => resourceRegistryRegistration.unregister());
    const appResourceSyncPolicy = new ResourceSyncPolicyService({
      registry: resourceRegistry,
      authConfig: resourceAuthConfig,
      getUserStore: config.auth !== false ? getAppAuthStore : undefined,
      getAuthorizationKernel: config.auth !== false
        ? getAppAuthorizationKernel
        : undefined,
      getRoleAssignments: config.auth !== false ? getAppRoleAssignments : undefined,
      tenancyMode: resourceAuthConfig.tenancy.mode,
      managedTables: managedResourceTables,
    });
    const resourceSyncPolicy = config.auth === false
      ? appResourceSyncPolicy
      : new PlatformSyncPolicyService({
          delegate: appResourceSyncPolicy,
          getDB: () => appSyncDB,
          getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
          getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
          tenancyMode: resourceAuthConfig.tenancy.mode,
        });

    // ─── Build client bundle ────────────────────────────────
    let clientEntry: string | undefined;
    let cssPath: string | undefined;
    try {
      const bundle = await buildClientBundle(config.outDir, config.appDir, {
        generatedDir: config.generatedDir,
      });
      clientEntry = bundle.publicPath;
      emitCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, {
        metadata: { publicPath: bundle.publicPath },
      });
    } catch (err) {
      // Client bundle is optional — SSR still works without hydration
      emitCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED, {
        error: err,
        metadata: { outDir: config.outDir, appDir: config.appDir },
      });
    }
    try {
      const styles = await buildPlatformStyles(config.outDir, config.appDir);
      cssPath = styles.publicPath;
      emitCode(OBS_CODES.APP_STYLES_READY, {
        metadata: { publicPath: styles.publicPath },
      });
    } catch (err) {
      emitCode(OBS_CODES.APP_STYLES_FAILED, {
        error: err,
        metadata: { outDir: config.outDir, appDir: config.appDir },
      });
    }

    // ─── Run database migrations ──────────────────────────────
    // Migrations run BEFORE the server starts against the shared platform SQL
    // handle. This keeps backend-only SQL, ReactiveDB, and platform services on
    // the same persistence boundary.
    if (shouldRunMigrations(sqlite, config.migrate)) {
      const migrator = new Migrator({
        database: sqlite.raw,
        dbPath: sqlite.snapshotPath ?? sqlite.path ?? ':memory:',
        migrations,
        applyPragmas: false,
        // Both file and hot modes are durable migration targets. Hot mode is a
        // live in-memory handle, so Migrator snapshots that handle even before
        // its configured snapshot file exists.
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
    const app = new Elysia({ name: 'platform' });

    app.onStart(() => {
      sqlite.start();
    });

    // 1. Sync engine — always first (provides ReactiveDB over shared SQL)
    app.use(
      createSyncPlugin({
        runtime,
        db: {
          ...config.db,
          sqlite,
        },
        onDatabaseCreated(db) {
          appSyncDB = db;
        },
        tables: config.tables,
        mutationValidators: config.mutationValidators,
        stateSync: config.stateSync,
        tenancyMode: resourceAuthConfig.tenancy.mode,
        policy: syncPolicy,
        resourcePolicy: resourceSyncPolicy,
        ephemeralPolicy: config.auth !== false
          ? createManagedEphemeralTopicPolicy({
              getRoomService: () => runtime.get(ZERO_ROOM_SERVICE),
              customPolicy: config.ephemeralPolicy,
              tenancyMode: resourceAuthConfig.tenancy.mode,
            })
          : config.ephemeralPolicy,
        snapshotTables: config.snapshotTables,
        auth: config.auth !== false
          ? {
              required: config.syncAuth === 'required',
              modeDefaulted: config.syncAuthDefaulted,
              // Auth routes are mounted after sync, so the verifier is resolved lazily
              // when a WebSocket opens rather than during plugin composition.
              getTokenVerifier: getAppTokenService,
              invalidationPollIntervalMs: 250,
            }
          : undefined,
      })
    );

    if (!appSyncDB) {
      throw new Error('[app] Sync plugin did not provide its app-local database during composition.');
    }
    // `CREATE TABLE IF NOT EXISTS` preserves old on-disk schemas. Verify the
    // actual SQLite columns before any HTTP or Sync transport can serve a
    // tenant resource, rather than trusting only the current config string.
    assertResourceStorageRealms(resourceRegistry, appSyncDB);

    const mounted = await mountPlatformApp({
      app,
      runtime,
      syncDB: appSyncDB,
      config,
      syncPolicy,
      resourceRegistry,
      resourceAuthConfig,
      emailRuntime,
      clientEntry,
      cssPath,
    });
    const stopped = installAppStopBarrier(
      mounted,
      async () => {
        await runtime.dispose();
      },
      {
        onTransportStopStalled(status) {
          emitPlatformCodeTo(
            observabilityRuntime,
            OBS_CODES.APP_LIFECYCLE_SLOW,
            {
              message: 'Native WebSocket shutdown accounting stalled after the listener closed; Zero is continuing managed teardown.',
              metadata: {
                stage: 'transport-stop',
                runtime: 'bun',
                pendingRequests: status.pendingRequests,
                pendingWebSockets: status.pendingWebSockets,
              },
            },
          );
        },
      },
    );
    return installAppSignalLifecycle(stopped);
  } catch (error) {
    return cleanupFailedAppCreation(error, runtime, sqlite, ownsSqlite);
  }
}

async function cleanupFailedAppCreation(
  startupError: unknown,
  runtime: ZeroAppRuntime,
  sqlite: PlatformSQLiteService,
  ownsSqlite: boolean,
): Promise<never> {
  const failures = [startupError];
  try {
    await runtime.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (ownsSqlite) {
    try {
      sqlite.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw startupError;
  throw new AggregateError(
    failures,
    '[app] App creation failed and one or more owned resources also failed to close.',
  );
}

/**
 * Lazy Sync hydration uses `/api/data`. A sync-only resource deliberately
 * denies that HTTP surface, so it must be guaranteed to remain full-sync.
 */
function assertResourceExposureLoadingCompatibility(
  registry: ReturnType<typeof createResourceRegistry>,
  config: ReturnType<typeof resolveConfig>,
): void {
  for (const resource of registry.list()) {
    if (resource.exposure.kind !== 'sync') continue;
    const mode = config.declaredSyncModes.get(resource.table)
      ?? config.syncDefaults.defaultMode;
    const tableDefault = config.syncDefaults.tables.get(resource.table);
    const autoCanResolveLazy = (tableDefault?.action ?? config.syncDefaults.action) === 'lazy';
    if (mode !== 'lazy' && !(mode === 'auto' && autoCanResolveLazy)) continue;

    throw new Error(
      `[resources] Sync-only resource "${resource.name}" cannot use ${mode} loading because lazy Sync hydration requires /api/data, which exposure: "sync" denies. `
      + 'Use exposure: "all" or configure this table for guaranteed full Sync.',
    );
  }
}

interface MountPlatformAppInput {
  app: Elysia;
  runtime: ZeroAppRuntime;
  syncDB: ReactiveDB;
  config: ReturnType<typeof resolveConfig>;
  syncPolicy: ReturnType<typeof combineSyncPolicies>;
  resourceRegistry: ReturnType<typeof createResourceRegistry>;
  resourceAuthConfig: ReturnType<typeof resolveAuthBehaviorConfig>;
  emailRuntime: ReturnType<typeof createEmailRuntime>;
  clientEntry?: string;
  cssPath?: string;
}

function shouldRunMigrations(sqlite: PlatformSQLiteService, migrate: boolean): boolean {
  return migrate && sqlite.mode !== 'ephemeral';
}

async function mountPlatformApp({
  app,
  runtime,
  syncDB,
  config,
  syncPolicy,
  resourceRegistry,
  resourceAuthConfig,
  emailRuntime,
  clientEntry,
  cssPath,
}: MountPlatformAppInput) {
  const getAppAuthStore = () => runtime.get(ZERO_AUTH_STORE);
  const getAppTokenService = () => runtime.get(ZERO_AUTH_TOKEN_SERVICE);
  const getAppAuthorizationKernel = () => runtime.get(ZERO_AUTHORIZATION_KERNEL);
  const getAppRoleAssignments = () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE);
  const managedStartup: {
    auth: AuthRuntime | null;
    kv: KvService | null;
    workflows: (() => Promise<void>) | null;
  } = { auth: null, kv: null, workflows: null };

  // 1.5. Platform tokens — generic action/resume token service for auth and app flows
  app.use(createPlatformTokenPlugin({ db: syncDB, runtime }));

  app.onStart(() => {
    const resolution = resolveTableSyncModes(config, syncDB);
    applyTableSyncResolution(config, resolution);
    addPlatformSnapshotTables(config.snapshotTables);
  });

  // 2. Auth — optional, mounted before middleware
  if (config.auth !== false) {
    app.use(
      createAuthPlugin({
        db: syncDB,
        runtime,
        emailRuntime,
        accessTokenTTL: config.auth.accessTokenTTL,
        refreshTokenTTL: config.auth.refreshTokenTTL,
        audit: config.auth.audit,
        tenancy: config.auth.tenancy,
        authorization: config.auth.authorization,
        bootstrap: config.auth.bootstrap,
        registration: config.auth.registration,
        requestAdmission: config.auth.requestAdmission,
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
        onRuntimeCreated(created) {
          managedStartup.auth = created;
        },
        loginPath: config.loginPath,
        registrationPath: config.registrationPath,
      })
    );

    // Auth middleware — resolves authContext + requireAuth/requireAdmin globally
    app.use(createAuthMiddleware(getAppTokenService, {
      getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
      getPropertyStore: getAppAuthStore,
      getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
    }));
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
      runtime,
    }));
  }

  // 2.7. Vector store — optional local zvec service for loaders, jobs, workflows, and plugins
  if (config.vector !== false) {
    app.use(createVectorPlugin({
      config: config.vector,
      runtime,
    }));
  }

  // 2.75. PDF — lazy browser-grade renderer for server code and workflows
  if (config.pdf !== false) {
    app.use(createPdfPlugin({ config: config.pdf, runtime }));
  }

  // 2.8. KV/cache — memory-first app cache with journal/checkpoint recovery
  if (config.kv !== false) {
    app.use(createKvPlugin({
      ...config.kv,
      runtime,
      onServiceCreated(service) {
        managedStartup.kv = service;
      },
    }));
  }

  // 3. Scheduler — provides cron job registration for other plugins
  const appScheduler = new SchedulerService();
  app.use(createSchedulerPlugin({
    runtime,
    getTokenService: getAppTokenService,
    service: appScheduler,
  }));

  // 4. Notifications — depends on auth + scheduler
  if (config.auth !== false) {
    app.use(createNotificationPlugin({
      db: syncDB,
      runtime,
      getTokenService: getAppTokenService,
      authorization: {
        getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
        getPropertyStore: getAppAuthStore,
        getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
      },
      getScheduler: () => appScheduler,
    }));
  }

  // 4.5. Rooms — depends on auth
  if (config.auth !== false) {
    app.use(createRoomPlugin({
      db: syncDB,
      runtime,
      getTokenService: getAppTokenService,
      authorization: {
        getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
        getPropertyStore: getAppAuthStore,
        getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
      },
    }));
  }

  // 5. Storage — workflow recovery may need its scoped storage facade
  if (config.auth !== false) {
    app.use(createStoragePlugin({
      db: syncDB,
      localDir: config.storageDir,
      signingSecret: config.storage.signingSecret,
      defaultPresignedTTL: config.storage.defaultPresignedTTL,
      runtime,
      getTokenService: getAppTokenService,
      authorization: {
        getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
        getPropertyStore: getAppAuthStore,
        getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
      },
      getUserProperties: (userId) => getAppAuthStore()?.getProperties(userId) ?? {},
      isPolicyTrustedProperty: (key) => {
        const field = resourceAuthConfig.userProperties[key];
        return field ? isPolicyTrustedUserProperty(field) : false;
      },
    }));
  }

  // 6. Workflows — depends on auth + scheduler + scoped service providers
  if (config.auth !== false) {
    let appWorkflowService: WorkflowService | null = null;
    app.use(createWorkflowPlugin({
      db: syncDB,
      runtime,
      executionServices: createWorkflowExecutionServiceProvider({ runtime }),
      ensureAuthReady: async () => {
        if (!managedStartup.auth) {
          throw new Error('[app] Auth runtime is unavailable for workflow startup.');
        }
        await managedStartup.auth.start();
      },
      getTokenService: getAppTokenService,
      authorization: {
        getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
        getPropertyStore: getAppAuthStore,
        getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
      },
      onServiceCreated(service) {
        appWorkflowService = service;
      },
      onInitializerCreated(initialize) {
        managedStartup.workflows = initialize;
      },
    }));

    // Register workflow polling jobs after scheduler is available
    appScheduler.register({
      name: 'workflow-retries',
      pattern: '* * * * *', // every minute
      run: async () => {
        const svc = appWorkflowService;
        if (svc) await svc.pollRetries();
      },
    });
    appScheduler.register({
      name: 'workflow-timeouts',
      pattern: '* * * * *',
      run: () => {
        const svc = appWorkflowService;
        if (svc) svc.pollTimeouts();
      },
    });
  }

  // 6.7. Data query — lazy-table reads plus registered resource read policy
  app.use(
    createDataQueryPlugin({
      queryableTables: config.lazyTables,
      tableColumns: config.tableColumns,
      policy: syncPolicy,
      getTokenService: config.auth !== false ? getAppTokenService : undefined,
      getUserStore: config.auth !== false ? getAppAuthStore : undefined,
      getAuthorizationKernel: config.auth !== false
        ? getAppAuthorizationKernel
        : undefined,
      getRoleAssignments: config.auth !== false ? getAppRoleAssignments : undefined,
      getDB: () => syncDB,
      resourceRegistry,
      resourceAuthConfig,
      tenancyMode: resourceAuthConfig.tenancy.mode,
      managedTables: new Set(Object.keys(config.tables)),
    })
  );

  // 6.8. Generated resource CRUD — resource policy enforced server-side
  if (config.resourceRoutes !== false) {
    app.use(
      createResourceCrudPlugin({
        registry: resourceRegistry,
        tables: config.tables,
        authConfig: resourceAuthConfig,
        tenancyMode: resourceAuthConfig.tenancy.mode,
        getTokenService: config.auth !== false ? getAppTokenService : undefined,
        getUserStore: config.auth !== false ? getAppAuthStore : undefined,
        getAuthorizationKernel: config.auth !== false
          ? getAppAuthorizationKernel
          : undefined,
        getRoleAssignments: config.auth !== false ? getAppRoleAssignments : undefined,
        getDB: () => syncDB,
        emitCode: (definition, options) => emitPlatformCodeTo(
          runtime.require(ZERO_OBSERVABILITY_RUNTIME),
          definition,
          options,
        ),
        ...config.resourceRoutes,
      })
    );
  }

  // 6.9. App-owned backend extensions — mounted before health and file-router catch-all
  const serverRoutePlugins = await loadServerRoutePlugins({
    runtime,
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
  // URL is derived from each request in the router plugin (not hardcoded)
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
      },
      ...(config.auth !== false
        ? {
            authorization: {
              getKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
              getPropertyStore: getAppAuthStore,
              getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
            },
          }
        : {}),
      // When auth is enabled, protect all page routes by default
      ...(config.auth !== false
        ? {
            authGuard: {
              routeAuth: config.routeAuth,
              publicPaths: config.publicPaths,
              loginPath: config.loginPath,
              resolvePageAuth: async (request: Request) => {
                const auth = await resolvePageSessionAuth(
                  request,
                  getAppTokenService()
                );
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

  // Elysia's Bun adapter does not await async onStart hooks. Managed apps
  // complete every fallible async owner before createApp publishes a
  // listenable server, while each plugin keeps an idempotent onStart hook for
  // standalone composition.
  await managedStartup.auth?.start();
  await managedStartup.kv?.start();
  await managedStartup.workflows?.();

  return app;
}

function nativeIssuerFromPublicUrl(publicUrl: string | undefined): string | undefined {
  return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/auth` : undefined;
}

/** Remove createApp-only token settings before strict auth behavior resolution. */
function appAuthBehaviorConfig(
  config: AuthBehaviorConfig & {
    accessTokenTTL?: string;
    refreshTokenTTL?: string;
  },
): AuthBehaviorConfig {
  const {
    accessTokenTTL: _accessTokenTTL,
    refreshTokenTTL: _refreshTokenTTL,
    ...behavior
  } = config;
  return behavior;
}

/** Type helper — export the app type for Eden Treaty typed client. */
export type App = Awaited<ReturnType<typeof createApp>>;
