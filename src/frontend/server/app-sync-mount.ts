/** ReactiveDB and WebSocket Sync composition for createApp(). */

import type { Elysia } from 'elysia';

import type { NormalizedAuthBehaviorConfig } from '../../auth/types';
import { DatabaseError } from '../../databases/database-error';
import type { PlatformSQLiteService } from '../../persistence';
import type { ResourceRegistry } from '../../resources';
import { assertResourceStorageRealms } from '../../resources';
import {
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_ROOM_SERVICE,
} from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createManagedEphemeralTopicPolicy } from '../../sync/ephemeral-managed-policy';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createSyncPlugin } from '../../sync/sync.plugin';
import type { SyncPolicy } from '../../sync/sync-policy';
import type { SyncTenantDataPlane } from '../../sync/sync-tenant-data-plane';
import type { SyncResourcePolicyAdapter } from '../../sync/types';
import type { AppIdentityProjectionRuntime } from './identity-projection-runtime';
import { assertApplicationGuardianReferenceStorage } from './identity-projection-runtime';
import { resolvePlatformClientTables } from './app-platform-tables';
import type { ResolvedConfig } from './types';
import { ZERO_GUARDIAN_PRESENCE } from '../../presence/presence-service';
import { createPresenceSyncTransport } from '../../presence/presence-sync-transport';

interface MountAppSyncEngineInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly config: ResolvedConfig;
  readonly applicationSQLite: PlatformSQLiteService;
  readonly applicationDB: ReactiveDB;
  readonly systemDB: ReactiveDB;
  readonly authConfig: NormalizedAuthBehaviorConfig;
  readonly syncPolicy: SyncPolicy;
  readonly resourceSyncPolicy: SyncResourcePolicyAdapter;
  readonly resourceRegistry: ResourceRegistry;
  readonly tenantDatabaseTables: ReadonlySet<string>;
  readonly tenantDataPlane?: SyncTenantDataPlane;
  readonly identityProjectionRuntime: AppIdentityProjectionRuntime | null;
}

/** Mount Sync first and validate its physical resource storage before serving. */
export function mountAppSyncEngine({
  app,
  runtime,
  config,
  applicationSQLite,
  applicationDB,
  systemDB,
  authConfig,
  syncPolicy,
  resourceSyncPolicy,
  resourceRegistry,
  tenantDatabaseTables,
  tenantDataPlane,
  identityProjectionRuntime,
}: MountAppSyncEngineInput): ReactiveDB {
  let syncDB: ReactiveDB | null = null;
  app.use(createSyncPlugin({
    runtime,
    db: {
      ...config.db,
      sqlite: applicationSQLite,
    },
    reactiveDB: applicationDB,
    ownsReactiveDB: false,
    onDatabaseCreated(db) {
      syncDB = db;
    },
    tables: config.tables,
    ...(config.auth !== false
      ? {
          systemDataPlane: {
            db: systemDB,
            tables: resolvePlatformClientTables(config.workflows !== false, authConfig.presence.enabled),
          },
        }
      : {}),
    ...(config.stateSync ? { stateDB: systemDB } : {}),
    mutationValidators: config.mutationValidators,
    stateSync: config.stateSync,
    tenancyMode: authConfig.tenancy.mode,
    policy: syncPolicy,
    resourcePolicy: resourceSyncPolicy,
    ensureMutationReady: identityProjectionRuntime
      ? ({ table, authContext }) =>
          identityProjectionRuntime.ensureApplicationIdentityAnchors(
            table,
            authContext,
          )
      : undefined,
    ephemeralPolicy: config.auth !== false
      ? createManagedEphemeralTopicPolicy({
          getRoomService: () => runtime.get(ZERO_ROOM_SERVICE),
          customPolicy: config.ephemeralPolicy,
          tenancyMode: authConfig.tenancy.mode,
        })
      : config.ephemeralPolicy,
    presenceTransport: config.auth !== false ? createPresenceSyncTransport(() => runtime.get(ZERO_GUARDIAN_PRESENCE), authConfig.tenancy.mode) : undefined,
    snapshotTables: config.snapshotTables,
    tenantDataPlane,
    auth: config.auth !== false
      ? {
          required: config.syncAuth === 'required',
          modeDefaulted: config.syncAuthDefaulted,
          getTokenVerifier: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE),
          invalidationPollIntervalMs: 250,
        }
      : undefined,
  }));

  if (!syncDB) {
    throw new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Application Sync database did not initialize during composition.',
      {
        retryable: false,
        outcome: 'not-started',
        details: { component: 'app-sync-mount' },
      },
    );
  }
  assertResourceStorageRealms(resourceRegistry, syncDB);
  assertApplicationGuardianReferenceStorage({
    database: syncDB,
    tables: config.tables,
    tenantTables: tenantDatabaseTables,
  });
  return syncDB;
}
