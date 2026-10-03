/** Ordered post-Sync composition for Zero's services and request routes. */

import type { Elysia } from 'elysia';

import type { NormalizedAuthBehaviorConfig } from '../../auth/types';
import type { EmailRuntime } from '../../email';
import type { ResourceRegistry } from '../../resources';
import { ZERO_OBSERVABILITY_RUNTIME } from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { SyncPolicy } from '../../sync/sync-policy';
import { mountPlatformRoutes } from './app-platform-routes';
import type { AppStopHook } from './app-stop-lifecycle';
import { mountPlatformServices } from './app-platform-services';
import { addPlatformSnapshotTables } from './app-platform-tables';
import type { AppIdentityProjectionRuntime } from './identity-projection-runtime';
import {
  applyTableSyncResolution,
  resolveTableSyncModes,
} from './sync-mode-resolver';
import type { ResolvedConfig } from './types';

export interface MountPlatformAppInput {
  app: Elysia;
  runtime: ZeroAppRuntime;
  syncDB: ReactiveDB;
  systemDB: ReactiveDB;
  config: ResolvedConfig;
  syncPolicy: SyncPolicy;
  resourceRegistry: ResourceRegistry;
  resourceAuthConfig: NormalizedAuthBehaviorConfig;
  tenantDatabaseTables?: ReadonlySet<string>;
  emailRuntime: EmailRuntime;
  clientEntry?: string;
  cssPath?: string;
  identityProjectionRuntime: AppIdentityProjectionRuntime | null;
}

export interface MountedPlatformApp {
  readonly app: Elysia;
  /** App-owned extension hooks that must drain before platform services stop. */
  readonly extensionStopHooks: readonly AppStopHook[];
}

/** Mount post-Sync platform plugins in their established dependency order. */
export async function mountPlatformApp({
  app,
  runtime,
  syncDB,
  systemDB,
  config,
  syncPolicy,
  resourceRegistry,
  resourceAuthConfig,
  tenantDatabaseTables,
  emailRuntime,
  clientEntry,
  cssPath,
  identityProjectionRuntime,
}: MountPlatformAppInput): Promise<MountedPlatformApp> {
  app.onStart(() => {
    const resolution = resolveTableSyncModes(config, syncDB, undefined, {
      tenantDatabaseTables,
      metadataDB: systemDB,
      observability: runtime.get(ZERO_OBSERVABILITY_RUNTIME),
    });
    applyTableSyncResolution(config, resolution);
    if (config.auth !== false) {
      addPlatformSnapshotTables(config.snapshotTables, config.workflows !== false);
    }
  });

  await mountPlatformServices({
    app,
    runtime,
    systemDB,
    config,
    resourceAuthConfig,
    emailRuntime,
    identityProjectionRuntime,
  });

  const extensionStopHooks = await mountPlatformRoutes({
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
    identityProjectionRuntime,
  });

  return { app, extensionStopHooks };
}
