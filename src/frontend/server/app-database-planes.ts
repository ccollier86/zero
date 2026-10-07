/** Managed system/application database-plane composition for createApp(). */

import type { AuthPlatformCodeEmitter } from '../../auth/auth-observability';
import { installAuthAuthorityRevision } from '../../auth/auth-authority-revision';
import {
  AuthorityCommitCoordinator,
  DatabaseAuthorityCommitFileFence,
  DatabaseCoordinator,
  DatabaseManager,
  type DatabaseRuntime,
  createDatabaseObservability,
  registerApplicationAuthorityCommitGuard,
  registerDatabaseAuthorityCommitGuard,
} from '../../databases';
import { DatabaseActorAuthorityContext } from '../../databases/database-actor-authority-context';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import type { PlatformSQLiteService } from '../../persistence';
import {
  ZERO_DATABASE_MANAGER,
  ZERO_SYSTEM_DB,
  ZERO_SYSTEM_SQLITE_SERVICE,
} from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { SyncTenantDataPlane } from '../../sync/sync-tenant-data-plane';
import type { ResolvedConfig } from './types';
import type { TenantDatabaseResourceTopology } from './tenant-database-topology';
import { createManagedTenantSyncDataPlane } from './tenant-sync-data-plane';
import { createTenantDatabaseEligibility } from './tenant-database-eligibility';
import {
  createAppIdentityProjectionRuntime,
  type AppIdentityProjectionRuntime,
} from './identity-projection-runtime';
import {
  closeManagedAppDatabaseAutomations,
  createManagedAppDatabaseAutomations,
  type ManagedAppDatabaseAutomations,
} from './app-database-automations';

export interface ManagedAppDatabasePlanes {
  readonly manager: DatabaseManager;
  readonly identityProjection: AppIdentityProjectionRuntime | null;
  readonly tenantDataPlane: SyncTenantDataPlane | undefined;
  readonly automations: ManagedAppDatabaseAutomations;
}

interface CreateManagedAppDatabasePlanesOptions {
  readonly config: ResolvedConfig;
  readonly runtime: ZeroAppRuntime;
  readonly systemRuntime: DatabaseRuntime;
  readonly applicationRuntime: DatabaseRuntime;
  readonly systemSqlite: PlatformSQLiteService;
  readonly observability: PlatformObservabilityRuntime;
  readonly emitCode: AuthPlatformCodeEmitter;
  readonly tenancyMode: 'single' | 'multi';
  readonly tenantResourceTopology: TenantDatabaseResourceTopology | null;
  readonly removeTemporarySystemCleanup: () => void;
  readonly removeTemporaryApplicationCleanup: () => void;
  readonly onManagerCreated: (manager: DatabaseManager) => void;
}

/**
 * Install commit fencing, optional Fabric coordination, identity projection,
 * and pinned database services after both base runtimes are open.
 */
export function createManagedAppDatabasePlanes({
  config,
  runtime,
  systemRuntime,
  applicationRuntime,
  systemSqlite,
  observability,
  emitCode,
  tenancyMode,
  tenantResourceTopology,
  removeTemporarySystemCleanup,
  removeTemporaryApplicationCleanup,
  onManagerCreated,
}: CreateManagedAppDatabasePlanesOptions): ManagedAppDatabasePlanes {
  const multipleTopology = config.databaseTopology.mode === 'multiple'
    ? config.databaseTopology
    : null;
  const authorityCommitCoordinator = config.auth !== false
    ? new AuthorityCommitCoordinator()
    : undefined;
  // Establish the durable clock before installing commit guards. Fresh auth
  // schemas are completed by Guardian startup below; existing schemas also
  // receive their exact authority triggers here. A guard must never begin its
  // lifetime with a missing singleton where null-to-null could fail open.
  if (authorityCommitCoordinator) {
    installAuthAuthorityRevision(systemRuntime.db);
  }
  const actorAuthorityContext = authorityCommitCoordinator
    && systemSqlite.mode === 'file'
    && systemSqlite.path
    ? new DatabaseActorAuthorityContext(systemRuntime.db, systemSqlite.path)
    : undefined;
  const authorityCommitFileFence = actorAuthorityContext
    ? new DatabaseAuthorityCommitFileFence(
        actorAuthorityContext.actorBinding().systemDatabasePath,
      )
    : undefined;
  const tenantAuthorityCommitCoordinator = multipleTopology?.tenantIsolation
    === 'tenant-database'
    ? authorityCommitCoordinator
    : undefined;

  const automations = createManagedAppDatabaseAutomations({
    config,
    systemRuntime,
    applicationRuntime,
  });
  // Until DatabaseManager adopts the catalog and the runtime adopts the
  // pinned interceptor, construction failure must still release both before
  // the base database handles are disposed.
  const removeTemporaryAutomationCleanup = runtime.addCleanup(
    () => closeManagedAppDatabaseAutomations(automations),
  );

  if (authorityCommitCoordinator) {
    runtime.addCleanup(() => authorityCommitCoordinator.close());
    if (authorityCommitFileFence) {
      runtime.addCleanup(() => authorityCommitFileFence.close());
    }
    runtime.addCleanup(registerDatabaseAuthorityCommitGuard(
      systemRuntime.db,
      authorityCommitCoordinator,
      authorityCommitFileFence,
    ));
    runtime.addCleanup(registerApplicationAuthorityCommitGuard(
      applicationRuntime.db,
      systemRuntime.db,
      authorityCommitCoordinator,
      authorityCommitFileFence,
    ));
  }

  const coordinator = multipleTopology
    ? new DatabaseCoordinator({
        rootDirectory: multipleTopology.rootDirectory,
        realm: multipleTopology.realm,
        createExecutor: multipleTopology.createExecutor,
        placement: multipleTopology.placement,
        sqlite: multipleTopology.sqlite,
        maxDatabases: multipleTopology.maxDatabases,
        maxDatabaseFiles: multipleTopology.maxDatabaseFiles,
        maxBlockedDatabases: multipleTopology.maxBlockedDatabases,
        maxTenantSyncDatabases: multipleTopology.maxTenantSyncDatabases,
        maxTenantSyncBindingsPerDatabase:
          multipleTopology.maxTenantSyncBindingsPerDatabase,
        readers: multipleTopology.readers,
        maxQueuedPerDatabase: multipleTopology.maxQueuedPerDatabase,
        maxQueuedTotal: multipleTopology.maxQueuedTotal,
        queueTimeoutMs: multipleTopology.queueTimeoutMs,
        operationTimeoutMs: multipleTopology.operationTimeoutMs,
        restart: multipleTopology.restart,
        idleTimeoutMs: multipleTopology.idleTimeoutMs,
        sweepIntervalMs: multipleTopology.sweepIntervalMs,
        observability: createDatabaseObservability(observability),
        ...(tenantAuthorityCommitCoordinator
          ? {
              authorityCommitCoordinator: tenantAuthorityCommitCoordinator,
              requireCommitAuthority: true,
              ...(actorAuthorityContext
                ? { actorAuthorityContext }
                : {}),
            }
          : {}),
      })
    : undefined;

  let manager: DatabaseManager | null = null;
  const identityProjection = config.auth !== false
    ? createAppIdentityProjectionRuntime({
        systemDB: systemRuntime.db,
        applicationDB: applicationRuntime.db,
        tables: config.tables,
        tenantDatabaseTables: tenantResourceTopology
          ? new Set(tenantResourceTopology.tables)
          : undefined,
        eligibleTenantKinds: tenantResourceTopology?.eligibleTenantKinds,
        tenancyMode,
        getDatabaseManager: () => manager,
        emitCode,
      })
    : null;

  let openedManager: DatabaseManager;
  try {
    openedManager = new DatabaseManager({
      systemRuntime,
      appRuntime: applicationRuntime,
      ...(authorityCommitCoordinator ? { authorityCommitCoordinator } : {}),
      ...(automations.catalog
        ? { automationSourceCatalog: automations.catalog }
        : {}),
      multiple: coordinator
        ? {
            coordinator,
            ...(tenantAuthorityCommitCoordinator
              ? {
                  authorityCommitCoordinator: tenantAuthorityCommitCoordinator,
                  tenantDatabases: true,
                  ...(tenantResourceTopology
                    ? {
                        tenantDatabaseEligibility: createTenantDatabaseEligibility(
                          systemRuntime.db,
                          config.auth !== false && config.auth.presence?.enabled === true
                            ? [...new Set([...tenantResourceTopology.eligibleTenantKinds, 'organization' as const, 'administration' as const])]
                            : tenantResourceTopology.eligibleTenantKinds,
                        ),
                      }
                    : {}),
                }
              : {}),
            ...(identityProjection?.tenantManagerOptions
              ? { tenantIdentityProjection: identityProjection.tenantManagerOptions }
              : {}),
          }
        : undefined,
    });
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      automations.application?.close();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    try {
      automations.catalog?.close();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(
      failures,
      'Database manager and automation cleanup failed.',
    );
  }
  manager = openedManager;
  onManagerCreated(openedManager);

  runtime.set(ZERO_DATABASE_MANAGER, openedManager);
  runtime.addCleanup(() => {
    runtime.clear(ZERO_DATABASE_MANAGER, openedManager);
    return openedManager.close();
  });
  if (automations.application) {
    runtime.addCleanup(() => automations.application!.close());
  }
  removeTemporaryAutomationCleanup();
  removeTemporaryApplicationCleanup();
  removeTemporarySystemCleanup();

  runtime.set(ZERO_SYSTEM_DB, systemRuntime.db);
  runtime.set(ZERO_SYSTEM_SQLITE_SERVICE, systemSqlite);
  runtime.addCleanup(() => {
    runtime.clear(ZERO_SYSTEM_DB, systemRuntime.db);
    runtime.clear(ZERO_SYSTEM_SQLITE_SERVICE, systemSqlite);
  });

  const tenantDataPlane = tenantResourceTopology
    ? createManagedTenantSyncDataPlane({
        manager: openedManager,
        tables: tenantResourceTopology.syncCatalog,
      })
    : undefined;

  return Object.freeze({
    manager: openedManager,
    identityProjection,
    tenantDataPlane,
    automations,
  });
}
