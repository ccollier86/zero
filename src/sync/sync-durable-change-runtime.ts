/** Ordered durable-change ingestion, policy observation, and socket delivery. */

import { OBS_CODES } from '../observability/codes';
import {
  getReactiveDBLocalChangeOrigin,
  type ReactiveDB,
} from './reactive-db';
import { resolveStatePrincipal } from './state-handler';
import { deliverSyncChange } from './sync-change-delivery';
import {
  isSyncPromiseLike,
  syncLifecycleError,
} from './sync-lifecycle-error';
import type {
  SyncPlatformCodeReporter,
  SyncPluginRuntimeState,
} from './sync-plugin-runtime-state';
import type {
  SyncSocketCollections,
  SyncSocketController,
} from './sync-socket-controller';
import type { createSyncSocketAuthRuntime } from './sync-socket-auth';
import { sendSyncWire } from './sync-wire-send';
import type {
  Change,
  ChangeDeliveryMetadata,
  SyncPluginConfig,
} from './types';

type SyncSocketAuthRuntime = ReturnType<typeof createSyncSocketAuthRuntime>;

export type SyncReplicaPolling = { intervalMs: number } | null;

interface SyncDurableChangeRuntimeOptions {
  readonly config: SyncPluginConfig;
  readonly runtime: SyncPluginRuntimeState;
  readonly db: ReactiveDB;
  readonly stateDB: ReactiveDB;
  readonly secondaryDB: ReactiveDB | null;
  readonly secondaryPlane: 'system' | 'state';
  readonly systemTables: ReadonlySet<string>;
  readonly replicaPolling: SyncReplicaPolling;
  readonly secondaryReplicaPolling: SyncReplicaPolling;
  readonly socketAuth: SyncSocketAuthRuntime;
  readonly sockets: SyncSocketCollections;
  readonly socketController: SyncSocketController;
  readonly reportSyncCode: SyncPlatformCodeReporter;
}

export interface SyncDurableChangeRuntime {
  /** Install ordered local/system listeners before sockets can be admitted. */
  startDelivery(): void;
  /** Start cross-runtime polling after all delivery dependencies exist. */
  startReplicaPolling(): void;
  /** Remove pollers and listeners in reverse registration order. */
  dispose(attempt: (cleanup: () => void) => void): void;
}

export function createSyncDurableChangeRuntime(
  options: SyncDurableChangeRuntimeOptions,
): SyncDurableChangeRuntime {
  const {
    config,
    runtime,
    db,
    stateDB,
    secondaryDB,
    secondaryPlane,
    systemTables,
    replicaPolling,
    secondaryReplicaPolling,
    socketAuth,
    sockets,
    socketController,
    reportSyncCode,
  } = options;

  let unsubscribeDefaultChanges: (() => void) | null = null;
  let unsubscribeSecondaryChanges: (() => void) | null = null;
  let unsubscribeDefaultPolling: (() => void) | null = null;
  let unsubscribeSecondaryPolling: (() => void) | null = null;

  return Object.freeze({
    startDelivery() {
      // Register listeners before any connection arrives. This is the single
      // ordered delivery path for WS, HTTP, jobs, transactions, and replicas.
      unsubscribeDefaultChanges = db.onChange((change, delivery) => {
        if (runtime.replicaLogInvalid) return;
        try {
          const mutationOrigin = delivery.source === 'local'
            ? getReactiveDBLocalChangeOrigin(db, change.seq)
            : null;
          if (deliverCommittedStateChange(db, change, delivery)) return;

          if (change.table.startsWith('_')) return;
          observePolicyChange(change);
          revalidateRoomAuthority(change);
          deliverSyncChange(
            sockets.activeSockets,
            change,
            db.syncEpoch,
            delivery.source === 'local' ? mutationOrigin ?? '' : '',
            socketAuth.validateCurrentAuthority,
          );
        } catch (error) {
          invalidateSyncRuntime(OBS_CODES.SYNC_POLICY_STATE_FAILED, error);
        }
      });

      if (!secondaryDB) return;
      unsubscribeSecondaryChanges = secondaryDB.onChange((change, delivery) => {
        if (runtime.replicaLogInvalid) return;
        try {
          if (deliverCommittedStateChange(secondaryDB, change, delivery)) return;
          if (change.table.startsWith('_') || !systemTables.has(change.table)) return;

          observePolicyChange(change);
          revalidateRoomAuthority(change);
          const mutationOrigin = delivery.source === 'local'
            ? getReactiveDBLocalChangeOrigin(secondaryDB, change.seq) ?? ''
            : '';
          for (const [socket, bridge] of sockets.systemDataSockets) {
            bridge.deliver(
              change,
              mutationOrigin,
              () => socketAuth.validateCurrentAuthority(socket),
            );
          }
        } catch (error) {
          invalidateSyncRuntime(OBS_CODES.SYNC_POLICY_STATE_FAILED, error);
        }
      });
    },

    startReplicaPolling() {
      if (replicaPolling) {
        unsubscribeDefaultPolling = installReplicaPolling(
          db,
          replicaPolling,
          'default',
        );
      }
      if (secondaryDB && secondaryReplicaPolling) {
        unsubscribeSecondaryPolling = installReplicaPolling(
          secondaryDB,
          secondaryReplicaPolling,
          secondaryPlane,
        );
      }
    },

    dispose(attempt: (cleanup: () => void) => void) {
      const secondaryPolling = unsubscribeSecondaryPolling;
      unsubscribeSecondaryPolling = null;
      if (secondaryPolling) attempt(secondaryPolling);

      const defaultPolling = unsubscribeDefaultPolling;
      unsubscribeDefaultPolling = null;
      if (defaultPolling) attempt(defaultPolling);

      const secondaryChanges = unsubscribeSecondaryChanges;
      unsubscribeSecondaryChanges = null;
      if (secondaryChanges) attempt(secondaryChanges);

      const defaultChanges = unsubscribeDefaultChanges;
      unsubscribeDefaultChanges = null;
      if (defaultChanges) attempt(defaultChanges);
    },
  });

  function invalidateSyncRuntime(
    definition: Parameters<SyncPlatformCodeReporter>[0],
    error?: unknown,
  ): void {
    if (runtime.replicaLogInvalid) return;
    runtime.replicaLogInvalid = true;
    reportSyncCode(definition, error === undefined ? undefined : { error });
    socketController.invalidateReplicaConnections(() => {
      socketAuth.invalidateAll(1012, 'Sync replica history invalid');
    });
  }

  function installReplicaPolling(
    sourceDB: ReactiveDB,
    polling: { intervalMs: number },
    plane: 'default' | 'system' | 'state',
  ): () => void {
    return sourceDB.startExternalChangePolling({
      intervalMs: polling.intervalMs,
      onGap: (gap) => {
        reportSyncCode(OBS_CODES.SYNC_REPLICA_HISTORY_GAP, {
          metadata: plane === 'default' ? { ...gap } : { ...gap, plane },
        });
        if (config.resourcePolicy?.observeChange
          && !config.resourcePolicy.onHistoryGap) {
          throw syncLifecycleError('SYNC_POLICY_HISTORY_GAP_UNHANDLED');
        }
        const reset = config.resourcePolicy?.onHistoryGap as
          | ((value: typeof gap) => unknown)
          | undefined;
        const outcome = reset?.call(config.resourcePolicy, gap);
        if (isSyncPromiseLike(outcome)) {
          void Promise.resolve(outcome).catch(() => {});
          throw syncLifecycleError('SYNC_POLICY_HISTORY_GAP_ASYNC');
        }
        socketAuth.invalidateAll(1012, 'Sync replica history gap');
      },
      onInvalid: (error) => {
        invalidateSyncRuntime(OBS_CODES.SYNC_REPLICA_POLL_FAILED, error);
      },
      onError: (error) => {
        reportSyncCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED, plane === 'default'
          ? { error }
          : { error, metadata: { plane } });
      },
    });
  }

  function deliverCommittedStateChange(
    sourceDB: ReactiveDB,
    change: Change,
    delivery: ChangeDeliveryMetadata,
  ): boolean {
    if (change.table !== '_user_state') return false;
    if (sourceDB !== stateDB || !runtime.stateManager) return true;
    const mutationOrigin = delivery.source === 'local'
      ? getReactiveDBLocalChangeOrigin(sourceDB, change.seq)
      : null;
    const stateChange = runtime.stateManager.applyCommittedChange(change);
    if (!stateChange) throw syncLifecycleError('SYNC_STATE_CHANGE_INVALID');

    for (const socket of sockets.activeSockets) {
      if (mutationOrigin && socket.data.connectionId === mutationOrigin) continue;
      if (!socket.data.stateSubscribed
        || socket.data.statePrincipal !== stateChange.principal
        || stateChange.seq <= (socket.data.stateLastSeq ?? 0)) continue;
      const currentPrincipal = resolveStatePrincipal(
        socket.data.authContext,
        config.tenancyMode ?? 'single',
      );
      if (currentPrincipal !== stateChange.principal
        || !socketAuth.validateCurrentAuthority(socket)) continue;
      if (sendSyncWire(socket, stateChange.message)) {
        socket.data.stateLastSeq = stateChange.seq;
      }
    }
    return true;
  }

  function observePolicyChange(change: Change): void {
    // Authorization state observes changes before subscription filtering.
    const observer = config.resourcePolicy?.observeChange as
      | ((value: Change) => unknown)
      | undefined;
    const observation = observer?.call(config.resourcePolicy, change);
    if (isSyncPromiseLike(observation)) {
      void Promise.resolve(observation).catch(() => {});
      throw syncLifecycleError('SYNC_POLICY_OBSERVER_ASYNC');
    }
  }

  function revalidateRoomAuthority(change: Change): void {
    if (change.table !== 'room_members') return;
    void socketAuth.revalidateAll().catch((error) => {
      try {
        reportSyncCode(OBS_CODES.SYNC_AUTH_REVALIDATION_FAILED, {
          error,
          metadata: {
            channel: 'socket',
            trigger: 'room-members-change',
          },
        });
      } catch {
        // Observability cannot prevent fail-closed socket invalidation.
      }
      socketAuth.invalidateAll(1011, 'Sync authority revalidation failed');
    }).catch(() => undefined);
    runtime.ephemeralChannel?.requestRevalidation('room-members-change');
  }
}
