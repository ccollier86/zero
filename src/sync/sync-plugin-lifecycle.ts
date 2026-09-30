/** Startup and reverse-order teardown for one composed Sync plugin runtime. */

import { OBS_CODES } from '../observability/codes';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import {
  clearPlatformSQLiteService,
  type PlatformSQLiteService,
} from '../persistence';
import {
  ZERO_SQLITE_SERVICE,
  ZERO_SYNC_DB,
} from '../runtime/service-keys';
import { EphemeralChannel } from './ephemeral-channel';
import { EphemeralStateManager } from './ephemeral-manager';
import {
  allowLegacyEphemeralTopicPolicy,
  denyEphemeralTopicPolicy,
} from './ephemeral-policy';
import type { ReactiveDB } from './reactive-db';
import { StateManager } from './state-manager';
import {
  createSyncDurableChangeRuntime,
  type SyncReplicaPolling,
} from './sync-durable-change-runtime';
import { isSyncPromiseLike } from './sync-lifecycle-error';
import type {
  SyncPlatformCodeReporter,
  SyncPluginRuntimeState,
} from './sync-plugin-runtime-state';
import type { SyncSocketController, SyncSocketCollections } from './sync-socket-controller';
import type { createSyncSocketAuthRuntime } from './sync-socket-auth';
import type {
  ReactiveDBPlatformCodeEmitter,
  SyncPluginConfig,
} from './types';

type SyncSocketAuthRuntime = ReturnType<typeof createSyncSocketAuthRuntime>;
type SyncDatabaseMode = 'ephemeral' | 'file' | 'hot' | 'injected' | 'platform';

interface SyncLifecycleContext {
  readonly server?: {
    stop(force?: boolean): unknown;
  } | null;
}

interface SyncPluginLifecycleOptions {
  readonly config: SyncPluginConfig;
  readonly runtime: SyncPluginRuntimeState;
  readonly db: ReactiveDB;
  readonly stateDB: ReactiveDB;
  readonly systemDB: ReactiveDB | null;
  readonly secondaryDB: ReactiveDB | null;
  readonly systemTables: ReadonlySet<string>;
  readonly replicaPolling: SyncReplicaPolling;
  readonly secondaryReplicaPolling: SyncReplicaPolling;
  readonly socketAuth: SyncSocketAuthRuntime;
  readonly sockets: SyncSocketCollections;
  readonly socketController: SyncSocketController;
  readonly sqlite: PlatformSQLiteService | null;
  readonly ownsDatabase: boolean;
  readonly databaseMode: SyncDatabaseMode;
  readonly unregisterCompatibilityRuntime: () => void;
  readonly reportSyncCode: SyncPlatformCodeReporter;
}

export interface SyncPluginLifecycle {
  start(context: SyncLifecycleContext): void;
  stop(): void;
  teardown(): readonly unknown[];
  setRuntimeCleanupRemoval(remove: (() => void) | null): void;
}

export function createSyncPluginLifecycle(
  options: SyncPluginLifecycleOptions,
): SyncPluginLifecycle {
  const {
    config,
    runtime,
    db,
    stateDB,
    systemDB,
    secondaryDB,
    systemTables,
    replicaPolling,
    secondaryReplicaPolling,
    socketAuth,
    sockets,
    socketController,
    sqlite,
    ownsDatabase,
    databaseMode,
    unregisterCompatibilityRuntime,
    reportSyncCode,
  } = options;
  let teardownComplete = false;
  let startEventEmitted = false;
  let removeRuntimeCleanup: (() => void) | null = null;
  const durableChanges = createSyncDurableChangeRuntime({
    config,
    runtime,
    db,
    stateDB,
    secondaryDB,
    secondaryPlane: systemDB ? 'system' : 'state',
    systemTables,
    replicaPolling,
    secondaryReplicaPolling,
    socketAuth,
    sockets,
    socketController,
    reportSyncCode,
  });

  const lifecycle: SyncPluginLifecycle = {
    start(context) {
      try {
        // StateManager must exist before durable listener delivery begins so
        // local and external state events can be decoded for socket delivery.
        if (config.stateSync) runtime.stateManager = new StateManager(stateDB);

        durableChanges.startDelivery();

        // Always create EphemeralStateManager for ephemeral KV + presence.
        runtime.ephemeralManager = new EphemeralStateManager();
        runtime.ephemeralChannel = new EphemeralChannel(
          runtime.ephemeralManager,
          config.ephemeralPolicy
            ?? (config.auth
              ? denyEphemeralTopicPolicy
              : allowLegacyEphemeralTopicPolicy),
          {
            // Authless legacy topics have no live authorization to recheck.
            revalidateIntervalMs: config.auth
              ? config.auth.revalidateIntervalMs
              : 0,
            onRevalidationFailure(error, trigger) {
              reportSyncCode(OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED, {
                error,
                metadata: { channel: 'ephemeral', trigger },
              });
              socketAuth.invalidateAll(
                1011,
                'Ephemeral authority revalidation failed',
              );
            },
          },
        );

        durableChanges.startReplicaPolling();
        socketAuth.start();

        if (config.auth?.required && config.auth.modeDefaulted) {
          reportSyncCode(OBS_CODES.SYNC_AUTH_REQUIRED_DEFAULTED, {
            level: 'warn',
            metadata: {
              hint: "Set syncAuth: 'public' only when anonymous sync is deliberate.",
            },
          });
        }

        reportSyncCode(OBS_CODES.SYNC_STARTED, {
          metadata: {
            databaseMode,
            tables: Object.keys(config.tables),
            stateSync: Boolean(config.stateSync),
            authMode: config.auth
              ? config.auth.required ? 'required' : 'public'
              : 'disabled',
          },
        });
        startEventEmitted = true;
      } catch (error) {
        const cleanupFailures = teardown();
        try {
          const stopping = context.server?.stop(true);
          if (isSyncPromiseLike(stopping)) {
            void Promise.resolve(stopping).catch((stopError) => {
              reportSyncCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED, {
                error: stopError,
                metadata: { stage: 'startup-cleanup' },
              });
            }).catch(() => undefined);
          }
        } catch (stopError) {
          cleanupFailures.push(stopError);
        }
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [error, ...cleanupFailures],
            error instanceof Error
              ? error.message
              : '[sync] Startup failed and cleanup also failed.',
          );
        }
        throw error;
      }
    },

    stop() {
      raiseSyncLifecycleCleanupFailures(
        teardown(),
        '[sync] Plugin shutdown failed.',
      );
    },

    teardown,

    setRuntimeCleanupRemoval(remove) {
      removeRuntimeCleanup = remove;
    },
  };

  return lifecycle;

  function teardown(): unknown[] {
    if (teardownComplete) return [];
    teardownComplete = true;
    const failures: unknown[] = [];
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    };

    durableChanges.dispose(attempt);

    socketController.disposeCapabilities(attempt);

    const stateManager = runtime.stateManager;
    runtime.stateManager = null;
    if (stateManager) attempt(() => stateManager.dispose());
    const ephemeralChannel = runtime.ephemeralChannel;
    runtime.ephemeralChannel = null;
    if (ephemeralChannel) attempt(() => ephemeralChannel.dispose());
    const ephemeralManager = runtime.ephemeralManager;
    runtime.ephemeralManager = null;
    if (ephemeralManager) attempt(() => ephemeralManager.dispose());

    attempt(() => socketAuth.dispose());
    // The native server transport is stopped before managed runtime cleanup.
    // Closing or terminating sockets here first can leave Bun's subsequent
    // server.stop(true) promise pending indefinitely.
    socketController.clearConnections();

    const removeCleanup = removeRuntimeCleanup;
    removeRuntimeCleanup = null;
    if (removeCleanup) attempt(removeCleanup);
    attempt(() => config.runtime?.clear(ZERO_SYNC_DB, db));
    if (sqlite) attempt(() => config.runtime?.clear(ZERO_SQLITE_SERVICE, sqlite));
    attempt(unregisterCompatibilityRuntime);
    if (sqlite) attempt(() => clearPlatformSQLiteService(sqlite));
    if (ownsDatabase) attempt(() => db.dispose());
    if (startEventEmitted) {
      attempt(() => reportSyncCode(OBS_CODES.SYNC_STOPPED, {
        metadata: { databaseMode },
      }));
    }
    return failures;
  }
}

export function createSyncCodeReporter(
  emitCode: ReactiveDBPlatformCodeEmitter,
): SyncPlatformCodeReporter {
  return (
    definition: PlatformCodeDefinition,
    options?: PlatformCodeEmitOptions,
  ): void => {
    try {
      const outcome = emitCode(definition, options);
      if (isSyncPromiseLike(outcome)) {
        void Promise.resolve(outcome).catch(() => {});
      }
    } catch {
      // Observability is best-effort and cannot disrupt Sync lifecycle work.
    }
  };
}

export { isSyncPromiseLike } from './sync-lifecycle-error';

export function raiseSyncLifecycleCleanupFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
