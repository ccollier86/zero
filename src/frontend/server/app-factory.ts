import { Elysia } from 'elysia';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createEmailRuntime, registerEmailRuntime } from '../../email';
import type { AppConfig } from './types';
import type { AuthBehaviorConfig } from '../../auth/types';
import { resolveConfig } from './types';
import {
  OBS_CODES,
  configureObservability,
  emitPlatformCode,
  emitPlatformCodeTo,
} from '../../observability';
import { DatabaseError } from '../../databases';
import {
  assertCanonicalDatabaseDirectoryIsolation,
  resolveControlDatabasePaths,
} from '../../databases/database-directory-isolation';
import {
  resolveAuthBehaviorConfig,
} from '../../auth/auth-config';
import { installAppStopBarrier } from './app-stop-lifecycle';
import { installAppSignalLifecycle } from './app-signal-lifecycle';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_EMAIL_RUNTIME,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../../runtime/service-keys';
import {
  assertCanonicalSeparateDatabaseConfigs,
  resolveSystemDatabaseOwnedPaths,
} from './system-database-config';
import { assertApplicationDatabaseHasNoLegacySystemLayout } from './system-database-layout';
import {
  assertAppIdentityProjectionConfiguration,
} from './identity-projection-runtime';
import { createManagedAppDatabasePlanes } from './app-database-planes';
import { mountPlatformApp } from './app-platform-mount';
import { buildAppAssets } from './app-build-assets';
import { AppDatabaseBootstrap } from './app-database-bootstrap';
import { composeAppResources } from './app-resource-composition';
import { mountAppSyncEngine } from './app-sync-mount';

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
  if (config.databaseTopology.mode === 'multiple') {
    assertCanonicalDatabaseDirectoryIsolation({
      rootDirectory: config.databaseTopology.rootDirectory,
      outDir: config.outDir,
      storageDir: config.storageDir,
      controlDatabasePaths: [
        ...resolveControlDatabasePaths(config.db),
        ...resolveSystemDatabaseOwnedPaths(config.systemDb),
      ],
    });
  }
  assertCanonicalSeparateDatabaseConfigs(config.db, config.systemDb);
  const resourceAuthConfig = resolveAuthBehaviorConfig(
    config.auth === false ? {} : appAuthBehaviorConfig(config.auth),
  );
  assertAppIdentityProjectionConfiguration({
    tables: config.tables,
    authEnabled: config.auth !== false,
    tenancyMode: resourceAuthConfig.tenancy.mode,
  });
  const runtime = new ZeroAppRuntime();
  let systemSyncDB: ReactiveDB | null = null;
  if (config.db.database && !config.db.sqlite) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      '[app] createApp({ db.database }) bypasses the platform SQL service. Pass db.sqlite or a platform storage config instead.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  const observabilityRuntime = configureObservability(config.observability);
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, observabilityRuntime);
  const emitCode: typeof emitPlatformCode = (definition, options) =>
    emitPlatformCodeTo(observabilityRuntime, definition, options);
  const databaseBootstrap = new AppDatabaseBootstrap(
    config,
    runtime,
    observabilityRuntime,
  );
  try {
    const {
      application: sqlite,
      system: controlSqlite,
    } = databaseBootstrap.openSQLiteServices();
    assertApplicationDatabaseHasNoLegacySystemLayout(sqlite);
    const emailRuntime = createEmailRuntime(config.email, config.app, emitCode);
    runtime.set(ZERO_EMAIL_RUNTIME, emailRuntime);
    const emailRuntimeRegistration = registerEmailRuntime(runtime, emailRuntime);
    runtime.addCleanup(() => emailRuntimeRegistration.unregister());
    const {
      registry: resourceRegistry,
      syncPolicy,
      resourceSyncPolicy,
      tenantDatabaseTopology: tenantDatabaseResourceTopology,
    } = await composeAppResources({
      config,
      runtime,
      authConfig: resourceAuthConfig,
      observability: observabilityRuntime,
      getSystemDB: () => systemSyncDB,
    });

    // ─── Build client bundle ────────────────────────────────
    const { clientEntry, cssPath } = await buildAppAssets(config, emitCode);

    // ─── Build the database runtime boundary ───────────────────
    // System authority is opened and migrated before the application plane.
    // `zero.db`/`zero.sql` remain pinned to the application runtime.
    const {
      systemRuntime: openedSystemRuntime,
      applicationRuntime: openedDefaultRuntime,
      removeTemporarySystemCleanup: removeSystemRuntimeCleanup,
      removeTemporaryApplicationCleanup: removeDefaultRuntimeCleanup,
    } = databaseBootstrap.openBaseRuntimes();
    systemSyncDB = openedSystemRuntime.db;
    const databasePlanes = createManagedAppDatabasePlanes({
      config,
      runtime,
      systemRuntime: openedSystemRuntime,
      applicationRuntime: openedDefaultRuntime,
      systemSqlite: controlSqlite,
      observability: observabilityRuntime,
      emitCode,
      tenancyMode: resourceAuthConfig.tenancy.mode,
      tenantResourceTopology: tenantDatabaseResourceTopology,
      removeTemporarySystemCleanup: removeSystemRuntimeCleanup,
      removeTemporaryApplicationCleanup: removeDefaultRuntimeCleanup,
      onManagerCreated(manager) {
        databaseBootstrap.adoptManager(manager);
      },
    });
    const openedDatabaseManager = databasePlanes.manager;
    const identityProjectionRuntime = databasePlanes.identityProjection;
    const tenantDataPlane = databasePlanes.tenantDataPlane;

    // ─── Assemble Elysia app ────────────────────────────────
    const app = new Elysia({ name: 'platform' });

    app.onStart(() => {
      openedDatabaseManager.start();
    });

    const tenantDatabaseTables = tenantDatabaseResourceTopology
      ? new Set(tenantDatabaseResourceTopology.tables)
      : new Set<string>();
    const appSyncDB = mountAppSyncEngine({
      app,
      runtime,
      config,
      applicationSQLite: sqlite,
      applicationDB: openedDefaultRuntime.db,
      systemDB: openedSystemRuntime.db,
      authConfig: resourceAuthConfig,
      syncPolicy,
      resourceSyncPolicy,
      resourceRegistry,
      tenantDatabaseTables,
      tenantDataPlane,
      identityProjectionRuntime,
    });

    const mounted = await mountPlatformApp({
      app,
      runtime,
      syncDB: appSyncDB,
      systemDB: openedSystemRuntime.db,
      config,
      syncPolicy,
      resourceRegistry,
      resourceAuthConfig,
      tenantDatabaseTables: tenantDatabaseResourceTopology
        ? tenantDatabaseTables
        : undefined,
      emailRuntime,
      clientEntry,
      cssPath,
      identityProjectionRuntime,
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
    return databaseBootstrap.fail(error);
  }
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
