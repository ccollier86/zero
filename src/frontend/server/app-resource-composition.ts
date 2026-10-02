/** Resource registry and Sync-policy composition for createApp(). */

import type { NormalizedAuthBehaviorConfig } from '../../auth/types';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import {
  createResourceRegistry,
  loadResourceDefinitions,
  registerResourceRegistry,
  ResourceSyncPolicyService,
  type ResourceRegistry,
} from '../../resources';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_RESOURCE_REGISTRY,
} from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ReactiveDB } from '../../sync/reactive-db';
import {
  combineSyncPolicies,
  createDefaultSyncPolicy,
  type SyncPolicy,
} from '../../sync/sync-policy';
import type { SyncResourcePolicyAdapter } from '../../sync/types';
import {
  PLATFORM_SYNC_PRIVATE_TABLES,
  PlatformSyncPolicyService,
} from './platform-sync-policy';
import {
  addPlatformSnapshotTables,
  PLATFORM_SYNC_WRITE_PROTECTED_TABLES,
} from './app-platform-tables';
import { assertResourceExposureLoadingCompatibility } from './resource-loading-compatibility';
import {
  resolveTenantDatabaseResourceTopology,
  type TenantDatabaseResourceTopology,
} from './tenant-database-topology';
import type { ResolvedConfig } from './types';

interface ComposeAppResourcesInput {
  readonly config: ResolvedConfig;
  readonly runtime: ZeroAppRuntime;
  readonly authConfig: NormalizedAuthBehaviorConfig;
  readonly observability: PlatformObservabilityRuntime;
  readonly getSystemDB: () => ReactiveDB | null;
}

export interface AppResourceComposition {
  readonly registry: ResourceRegistry;
  readonly syncPolicy: SyncPolicy;
  readonly resourceSyncPolicy: SyncResourcePolicyAdapter;
  readonly tenantDatabaseTopology: TenantDatabaseResourceTopology | null;
}

/** Build and register app resources before either HTTP or Sync is exposed. */
export async function composeAppResources({
  config,
  runtime,
  authConfig,
  observability,
  getSystemDB,
}: ComposeAppResourcesInput): Promise<AppResourceComposition> {
  addPlatformSnapshotTables(config.snapshotTables, config.workflows !== false);
  const platformSyncPolicy = config.auth !== false
    ? createDefaultSyncPolicy({
        readProtectedTables: PLATFORM_SYNC_PRIVATE_TABLES,
        writeProtectedTables: PLATFORM_SYNC_WRITE_PROTECTED_TABLES,
      })
    : undefined;
  const syncPolicy = combineSyncPolicies(platformSyncPolicy, config.syncPolicy);

  const loadedResources = await loadResourceDefinitions({
    resourcesDir: config.serverResourcesDir,
    observability,
  });
  const managedTables = new Set(Object.keys(config.tables));
  const registry = createResourceRegistry({
    resources: [...config.resources, ...loadedResources],
    tables: config.tables,
    authConfig,
    tenancyMode: authConfig.tenancy.mode,
    tenantIsolation: config.databaseTopology.mode === 'multiple'
      ? config.databaseTopology.tenantIsolation
      : 'shared-row',
    managedTables,
    observability,
  });
  const tenantDatabaseTopology = config.databaseTopology.mode === 'multiple'
    && config.databaseTopology.tenantIsolation === 'tenant-database'
    ? resolveTenantDatabaseResourceTopology(
        registry,
        config.databaseTopology.realm,
      )
    : null;

  assertResourceExposureLoadingCompatibility(
    registry,
    config,
    tenantDatabaseTopology
      ? new Set(tenantDatabaseTopology.tables)
      : undefined,
  );
  runtime.set(ZERO_RESOURCE_REGISTRY, registry);
  const registration = registerResourceRegistry(runtime, registry);
  runtime.addCleanup(() => registration.unregister());

  const appPolicy = new ResourceSyncPolicyService({
    registry,
    authConfig,
    getUserStore: config.auth !== false
      ? () => runtime.get(ZERO_AUTH_STORE)
      : undefined,
    getAuthorizationKernel: config.auth !== false
      ? () => runtime.get(ZERO_AUTHORIZATION_KERNEL)
      : undefined,
    getRoleAssignments: config.auth !== false
      ? () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
      : undefined,
    tenancyMode: authConfig.tenancy.mode,
    managedTables,
  });
  const resourceSyncPolicy = config.auth === false
    ? appPolicy
    : new PlatformSyncPolicyService({
        delegate: appPolicy,
        getDB: getSystemDB,
        getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
        getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
        tenancyMode: authConfig.tenancy.mode,
      });

  return Object.freeze({
    registry,
    syncPolicy,
    resourceSyncPolicy,
    tenantDatabaseTopology,
  });
}
