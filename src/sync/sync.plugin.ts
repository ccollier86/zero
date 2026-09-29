/**
 * sync.plugin.ts
 *
 * Owns the Elysia lifecycle and WebSocket transport for ReactiveDB sync. This
 * file initializes sync-owned runtime state and routes wire-protocol messages;
 * persistence details live in ReactiveDB, and token verification is delegated
 * through the sync auth contract.
 */

import { Elysia, t } from 'elysia';
import type { ServerWebSocket } from 'bun';
import {
  getReactiveDBLocalChangeOrigin,
  ReactiveDB,
} from './reactive-db';
import {
  routeMessage,
  type SyncMutationOriginContext,
} from './message-handler';
import { StateManager } from './state-manager';
import { resolveStatePrincipal } from './state-handler';
import { EphemeralStateManager } from './ephemeral-manager';
import { cleanupEphemeralForSocket } from './ephemeral-handler';
import { EphemeralChannel } from './ephemeral-channel';
import {
  allowLegacyEphemeralTopicPolicy,
  denyEphemeralTopicPolicy,
} from './ephemeral-policy';
import {
  createSyncAuthReadyMessage,
  parseSyncAuthMessage,
} from './sync-auth-message';
import { createSyncSocketAuthRuntime } from './sync-socket-auth';
import { allowAllSyncPolicy } from './sync-policy';
import { deliverSyncChange } from './sync-change-delivery';
import {
  clearSyncBackpressure,
  rejectSyncDrain,
  sendSyncWire,
} from './sync-wire-send';
import { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, emitPlatformCodeTo } from '../observability/sink';
import {
  clearPlatformSQLiteService,
  setPlatformSQLiteService,
} from '../persistence';
import type {
  SyncPluginConfig,
  SyncSocketData,
} from './types';
import { SYNC_TABLE_MUTATION_VALIDATOR } from './types';
import { SYNC_OUTGOING_BACKPRESSURE_LIMIT } from './types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_SQLITE_SERVICE,
  ZERO_SYNC_DB,
} from '../runtime/service-keys';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import {
  SyncTenantSocketBridge,
} from './sync-tenant-data-plane';
import {
  assertActorMutationValidatorMatchesTable,
  assertMultiTenantResourceClassification,
  assertMutationValidatorMatchesTable,
  assertTenantDataPlaneConfiguration,
  describeSyncDatabaseMode,
  resolveReplicaChangePolling,
  resolveSyncDatabase,
  tenantSyncAuthorityChanged,
  validateSyncCommitAuthority,
  wireUsesTenantDataPlane,
} from './sync-plugin-config';
import {
  SyncSocketIngressQueue,
  syncIngressEncodedBytes,
  type SyncIngressFence,
} from './sync-socket-ingress';

interface SyncRuntime {
  db: ReactiveDB;
  stateManager: StateManager | null;
  ephemeralManager: EphemeralStateManager | null;
  ephemeralChannel: EphemeralChannel | null;
  unsubscribeChange: (() => void) | null;
  unsubscribeExternalChanges: (() => void) | null;
  mutationOrigin: SyncMutationOriginContext;
  /** Latched after a non-retryable durable log/read failure. */
  replicaLogInvalid: boolean;
}

/**
 * Compatibility registry for the legacy no-argument getters. Runtime code
 * never reads this registry; every plugin handler closes over its own runtime.
 */
const compatibilityRuntimes = new CompatibilityProviderRegistry<SyncRuntime>(
  'Sync runtime',
);

/**
 * Get the ReactiveDB instance. Returns null if the sync plugin hasn't been
 * created. createSyncPlugin initializes it during plugin composition so later
 * plugins can define tables against the shared DB before listen().
 */
export function getSyncDB(): ReactiveDB | null {
  return compatibilityRuntimes.get()?.db ?? null;
}

/**
 * Get the EphemeralStateManager instance. Returns null if the sync plugin hasn't started.
 */
export function getEphemeralManager(): EphemeralStateManager | null {
  return compatibilityRuntimes.get()?.ephemeralManager ?? null;
}

/**
 * Create the sync engine Elysia plugin.
 *
 * - Uses an injected ReactiveDB or creates one during plugin composition
 * - Defines app tables from config before dependent plugins compose
 * - Registers the ordered onChange listener used for direct socket delivery
 * - Exposes WS endpoint at /sync
 * - Derives `syncDB` into global Elysia context for all routes
 */
export function createSyncPlugin(config: SyncPluginConfig) {
  assertMultiTenantResourceClassification(config);
  assertTenantDataPlaneConfiguration(config);
  const observability = config.runtime?.get(ZERO_OBSERVABILITY_RUNTIME) ?? null;
  const emitSyncCode = (
    definition: PlatformCodeDefinition,
    options: PlatformCodeEmitOptions = {},
  ) => observability
    ? emitPlatformCodeTo(observability, definition, options)
    : emitPlatformCode(definition, options);
  let connectionCounter = 0;
  const policy = config.policy ?? allowAllSyncPolicy;
  const databaseRuntime = resolveSyncDatabase(config);
  const db = databaseRuntime.db;
  const cleanupOnCompositionFailure: Array<() => void> = [];
  if (databaseRuntime.owned) {
    cleanupOnCompositionFailure.push(() => db.dispose());
  }

  try {
  const databaseCreated = config.onDatabaseCreated?.(db);
  if (isPromiseLike(databaseCreated)) {
    void Promise.resolve(databaseCreated).catch(() => {});
    throw new Error('[sync] onDatabaseCreated must be synchronous');
  }
  const sqlite = db.getSQLiteService();
  const databaseMode = describeSyncDatabaseMode(config.db, db);
  const replicaPolling = resolveReplicaChangePolling(config, db);
  const runtime: SyncRuntime = {
    db,
    stateManager: null,
    ephemeralManager: null,
    ephemeralChannel: null,
    unsubscribeChange: null,
    unsubscribeExternalChanges: null,
    mutationOrigin: { current: null },
    replicaLogInvalid: false,
  };
  const activeSockets = new Set<ServerWebSocket<SyncSocketData>>();
  const openSockets = new Set<ServerWebSocket<SyncSocketData>>();
  const tenantDataSockets = new Map<
    ServerWebSocket<SyncSocketData>,
    SyncTenantSocketBridge
  >();
  const ingressQueues = new Map<
    ServerWebSocket<SyncSocketData>,
    SyncSocketIngressQueue
  >();
  const compatibilityOwner = {};
  const compatibilityRegistration = compatibilityRuntimes.register(
    compatibilityOwner,
    () => runtime,
  );
  cleanupOnCompositionFailure.push(() => compatibilityRegistration.unregister());
  const socketAuth = createSyncSocketAuthRuntime({
    auth: config.auth,
    db,
    policy,
    resourcePolicy: config.resourcePolicy,
    additionalTables: Object.keys(config.tenantDataPlane?.tables ?? {}),
    observability,
    activeSockets,
    requireDurableAuthority: config.tenancyMode === 'multi' && Boolean(config.auth),
    requireComparableReadAuthority: Boolean(config.tenantDataPlane),
    onAuthorityInvalidated: () => runtime.ephemeralChannel?.revalidateAll(),
    onSocketInvalidated(socket) {
      releaseSocketCapabilities(socket);
    },
  });
  cleanupOnCompositionFailure.push(() => socketAuth.dispose());
  let teardownComplete = false;
  let startEventEmitted = false;
  let removeRuntimeCleanup: (() => void) | null = null;

  const teardown = (): unknown[] => {
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

    const unsubscribeExternalChanges = runtime.unsubscribeExternalChanges;
    runtime.unsubscribeExternalChanges = null;
    if (unsubscribeExternalChanges) attempt(unsubscribeExternalChanges);
    const unsubscribeChange = runtime.unsubscribeChange;
    runtime.unsubscribeChange = null;
    if (unsubscribeChange) attempt(unsubscribeChange);

    for (const bridge of tenantDataSockets.values()) {
      attempt(() => bridge.dispose());
    }
    tenantDataSockets.clear();
    for (const queue of ingressQueues.values()) queue.dispose();
    ingressQueues.clear();

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
    activeSockets.clear();
    openSockets.clear();

    const removeCleanup = removeRuntimeCleanup;
    removeRuntimeCleanup = null;
    if (removeCleanup) attempt(removeCleanup);
    attempt(() => config.runtime?.clear(ZERO_SYNC_DB, db));
    if (sqlite) attempt(() => config.runtime?.clear(ZERO_SQLITE_SERVICE, sqlite));
    attempt(() => compatibilityRegistration.unregister());
    if (sqlite) attempt(() => clearPlatformSQLiteService(sqlite));
    if (databaseRuntime.owned) attempt(() => db.dispose());
    if (startEventEmitted) {
      attempt(() => emitSyncCode(OBS_CODES.SYNC_STOPPED, {
        metadata: { databaseMode },
      }));
    }
    return failures;
  };

  const invalidateSyncRuntime = (definition: PlatformCodeDefinition): void => {
    if (runtime.replicaLogInvalid) return;
    runtime.replicaLogInvalid = true;
    emitSyncCode(definition);
    const sockets = [...openSockets];
    try {
      socketAuth.invalidateAll(1012, 'Sync replica history invalid');
    } catch {
      // Continue closing sockets that have not completed auth/setup.
    }
    for (const socket of sockets) {
      try {
        releaseSocketCapabilities(socket);
        closeReplicaInvalidSocket(socket);
      } catch {
        try { socket.terminate(); } catch { /* Already closed. */ }
      }
    }
  };

  const mutationValidators = { ...config.mutationValidators };
  for (const [name, schema] of Object.entries(config.tables)) {
    const validator = config.mutationValidators?.[name]
      ?? schema[SYNC_TABLE_MUTATION_VALIDATOR];
    const actorTable = config.tenantDataPlane?.tables[name];
    const tenantOwned = config.resourcePolicy
      ?.classifyManagedTableDataPlane?.(name) === 'tenant';
    if (tenantOwned) {
      if (actorTable && validator) {
        assertActorMutationValidatorMatchesTable(name, validator, actorTable);
        mutationValidators[name] = validator;
      }
      // Every physical tenant table belongs exclusively to the actor realm.
      // HTTP/internal tables are intentionally absent from the Sync wire
      // catalog, but must still never acquire a default-database shadow.
      continue;
    }

    db.defineTable(name, schema);
    if (!validator) continue;

    assertMutationValidatorMatchesTable(name, validator, db);
    mutationValidators[name] = validator;
  }
  const mutationReceipts = new SyncMutationReceiptStore(db);

  if (config.runtime) {
    config.runtime.set(ZERO_SYNC_DB, db);
    cleanupOnCompositionFailure.push(() => config.runtime?.clear(ZERO_SYNC_DB, db));
    if (sqlite) {
      config.runtime.set(ZERO_SQLITE_SERVICE, sqlite);
      cleanupOnCompositionFailure.push(
        () => config.runtime?.clear(ZERO_SQLITE_SERVICE, sqlite),
      );
    }
    removeRuntimeCleanup = config.runtime.addCleanup(() => {
      raiseLifecycleCleanupFailures(
        teardown(),
        '[sync] Runtime cleanup failed.',
      );
    });
    cleanupOnCompositionFailure.push(removeRuntimeCleanup);
  }
  if (sqlite) {
    setPlatformSQLiteService(sqlite);
    cleanupOnCompositionFailure.push(() => clearPlatformSQLiteService(sqlite));
  }

  const plugin = new Elysia({ name: 'sync' })

    // ─── Lifecycle ──────────────────────────────────────
    .onStart((lifecycle) => {
      try {
        // StateManager must exist before durable listener delivery begins so
        // local and external state events can be decoded for socket delivery.
        if (config.stateSync) {
          runtime.stateManager = new StateManager(db);
        }

        // Register onChange BEFORE any connections arrive.
        // This is the single ordered delivery path for WS mutations, HTTP route
        // writes, background jobs, transactions, and external-runtime commits.
        runtime.unsubscribeChange = db.onChange((change, delivery) => {
          if (runtime.replicaLogInvalid) return;
          try {
            const mutationOrigin = delivery.source === 'local'
              ? getReactiveDBLocalChangeOrigin(db, change.seq)
              : null;
            if (change.table === '_user_state') {
              // Another state-enabled runtime may share this SQLite file. A plugin
              // with State Sync disabled must ignore its internal stream.
              if (!runtime.stateManager) return;
              const stateChange = runtime.stateManager.applyCommittedChange(change);
              if (!stateChange) {
                throw new Error(`Invalid durable State Sync change at seq ${change.seq}`);
              }

              // Both local and external state events use this ordered, per-socket
              // path. The local mutation origin receives only its ack; every other
              // recipient is exact-principal scoped and durably revalidated at send.
              for (const socket of activeSockets) {
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
              return;
            }

            // Don't publish changes for _ prefix tables (internal)
            if (change.table.startsWith('_')) return;
            // Authorization state must observe changes before table-subscription
            // filtering. Otherwise a client could omit a policy-owning table and
            // retain a stale row-filter cache until periodic revalidation.
            const observer = config.resourcePolicy?.observeChange as
              | ((value: typeof change) => unknown)
              | undefined;
            const observation = observer?.call(config.resourcePolicy, change);
            if (isPromiseLike(observation)) {
              void Promise.resolve(observation).catch(() => {});
              throw new Error(
                'ZERO_SYNC_POLICY_OBSERVER_ASYNC: observeChange must be synchronous',
              );
            }
            if (change.table === 'room_members') {
              // Room membership is live read authority, not just row data.
              // Re-evaluate every authenticated socket even when it did not
              // subscribe to room_members; the final delivery fence protects
              // changes while the asynchronous resolver is in flight.
              void socketAuth.revalidateAll().catch(() => {
                socketAuth.invalidateAll(1011, 'Sync authority revalidation failed');
              });
              void runtime.ephemeralChannel?.revalidateAll();
            }
            // Row filters/projectors are authorization code. Any exception must
            // invalidate the runtime rather than silently skip an ordered row.
            deliverSyncChange(
              activeSockets,
              change,
              db.syncEpoch,
              delivery.source === 'local'
                ? mutationOrigin ?? ''
                : '',
              socketAuth.validateCurrentAuthority,
            );
          } catch (error) {
            invalidateSyncRuntime(OBS_CODES.SYNC_POLICY_STATE_FAILED);
          }
        });

        // Always create EphemeralStateManager for ephemeral KV + presence
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
          },
        );

        if (replicaPolling) {
          runtime.unsubscribeExternalChanges = db.startExternalChangePolling({
            intervalMs: replicaPolling.intervalMs,
            onGap: (gap) => {
              emitSyncCode(OBS_CODES.SYNC_REPLICA_HISTORY_GAP, {
                metadata: { ...gap },
              });
              if (config.resourcePolicy?.observeChange
                && !config.resourcePolicy.onHistoryGap) {
                throw new Error(
                  'ZERO_SYNC_POLICY_HISTORY_GAP_UNHANDLED: stateful resource policy cannot rebuild',
                );
              }
              const reset = config.resourcePolicy?.onHistoryGap as
                | ((value: typeof gap) => unknown)
                | undefined;
              const outcome = reset?.call(config.resourcePolicy, gap);
              if (isPromiseLike(outcome)) {
                void Promise.resolve(outcome).catch(() => {});
                throw new Error(
                  'ZERO_SYNC_POLICY_HISTORY_GAP_ASYNC: policy reset must be synchronous',
                );
              }
              socketAuth.invalidateAll(1012, 'Sync replica history gap');
            },
            onInvalid: () => {
              invalidateSyncRuntime(OBS_CODES.SYNC_REPLICA_POLL_FAILED);
            },
            onError: () => {
              emitSyncCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED);
            },
          });
        }
        socketAuth.start();

        if (config.auth?.required && config.auth.modeDefaulted) {
          emitSyncCode(OBS_CODES.SYNC_AUTH_REQUIRED_DEFAULTED, {
            level: 'warn',
            metadata: {
              hint: "Set syncAuth: 'public' only when anonymous sync is deliberate.",
            },
          });
        }

        emitSyncCode(OBS_CODES.SYNC_STARTED, {
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
          const stopping = lifecycle.server?.stop(true);
          if (isPromiseLike(stopping)) {
            void Promise.resolve(stopping).catch(() => {
              emitSyncCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED, {
                metadata: { stage: 'startup-cleanup' },
              });
            });
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
    })

    .onStop(() => {
      raiseLifecycleCleanupFailures(
        teardown(),
        '[sync] Plugin shutdown failed.',
      );
    })

    // ─── Derive: expose syncDB globally ─────────────────
    .derive({ as: 'global' }, () => ({
      syncDB: db,
    }))

    // ─── WebSocket handler at /sync ─────────────────────
    .ws('/sync', {
      // Kept in the schema only for the explicit, temporary compatibility flag.
      query: t.Object({
        token: t.Optional(t.String()),
      }),

      // Bun WebSocket config
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: 1_048_576, // 1MB
      backpressureLimit: SYNC_OUTGOING_BACKPRESSURE_LIMIT,
      closeOnBackpressureLimit: true,
      publishToSelf: true,
      perMessageDeflate: false,

      async open(ws) {
        const socket = syncTransportSocket(ws);
        ingressQueues.set(socket, new SyncSocketIngressQueue());
        // Assign unique connection ID
        const connectionId = `conn_${++connectionCounter}`;

        // Initialize per-socket data
        const data = socket.data;
        data.connectionId = connectionId;
        data.subscribedTopics = new Set();
        data.lastSeq = 0;
        data.syncSubscribedTables = new Set();
        data.syncBackpressured = false;
        data.authContext = null;
        data.authToken = undefined;
        data.authAuthorityReference = null;
        data.authResolved = false;
        data.authorizationFingerprint = null;
        data.readAuthorizationFingerprint = null;
        data.authorizationScope = null;
        data.allowedTables = new Set();
        data.resourceRowFilters = new Map();
        data.resourceRowProjectors = new Map();
        data.rowFilteredSubscribedTables = new Set();
        data.stateSubscribed = false;
        data.statePrincipal = null;
        data.stateLastSeq = 0;
        data.ephemeralTopics = new Set();
        data.query = (socket.data as SyncSocketData & {
          query?: { token?: string };
        }).query ?? {};

        openSockets.add(socket);
        if (runtime.replicaLogInvalid) {
          releaseSocketCapabilities(socket);
          closeReplicaInvalidSocket(socket);
          return;
        }
        if (data.query.token) {
          if (!config.auth?.allowLegacyQueryToken) {
            releaseSocketCapabilities(socket);
            socket.close(4001, 'Query token authentication disabled');
            return;
          }
          const admission = ingressQueues.get(socket)?.admit(0, async (fence) => {
            const authorized = await socketAuth.authorize(socket, data.query.token);
            if (!authorized) {
              releaseSocketCapabilities(socket);
              return;
            }
            if (!fence.active) return;
            if (runtime.replicaLogInvalid) {
              releaseSocketCapabilities(socket);
              closeReplicaInvalidSocket(socket);
            }
          });
          if (admission?.accepted) await admission.completion;
          return;
        }

        if (!config.auth) {
          const admission = ingressQueues.get(socket)?.admit(0, async (fence) => {
            const authorized = await socketAuth.authorize(socket);
            if (!authorized) {
              releaseSocketCapabilities(socket);
              return;
            }
            if (!fence.active) return;
            if (runtime.replicaLogInvalid) {
              releaseSocketCapabilities(socket);
              closeReplicaInvalidSocket(socket);
            }
          });
          if (admission?.accepted) await admission.completion;
        } else {
          socketAuth.waitForRequiredHandshake(socket);
        }
      },

      async message(ws, message) {
        const socket = syncTransportSocket(ws);
        const queue = ingressQueues.get(socket);
        const encodedBytes = syncIngressEncodedBytes(message);
        if (!queue || encodedBytes === null) {
          releaseSocketCapabilities(socket);
          socket.close(1008, 'Invalid Sync message');
          return;
        }
        const wireMessage = message as string | Record<string, unknown>;
        const admission = queue.admit(encodedBytes, async (fence) => {
          await processSocketMessage(socket, wireMessage, fence);
        });
        if (!admission.accepted) {
          if (admission.reason === 'capacity') {
            emitSyncCode(OBS_CODES.SYNC_INGRESS_ADMISSION_REJECTED, {
              metadata: { reason: 'capacity' },
            });
          }
          releaseSocketCapabilities(socket);
          socket.close(
            admission.reason === 'capacity' ? 1013 : 1008,
            admission.reason === 'capacity'
              ? 'Sync ingress capacity exceeded'
              : 'Invalid Sync message',
          );
          return;
        }
        try {
          await admission.completion;
        } catch {
          if (!queue.active) return;
          releaseSocketCapabilities(socket);
          socket.close(1011, 'Sync message handling failed');
        }
      },

      close(ws, code, reason) {
        const socket = syncTransportSocket(ws);
        releaseSocketCapabilities(socket);
      },

      drain(ws) {
        const socket = syncTransportSocket(ws);
        clearSyncBackpressure(socket);
        tenantDataSockets.get(socket)?.resume();
      },
    });

  async function processSocketMessage(
    socket: ServerWebSocket<SyncSocketData>,
    wireMessage: string | Record<string, unknown>,
    ingress: SyncIngressFence,
  ): Promise<void> {
    if (!ingress.active) return;
    const data = socket.data;
    if (runtime.replicaLogInvalid) {
      closeReplicaInvalidSocket(socket);
      return;
    }
    const authMessage = parseSyncAuthMessage(wireMessage);

    if (authMessage.matched) {
      if (!authMessage.ok) {
        releaseSocketCapabilities(socket);
        socket.close(4001, 'Invalid auth handshake');
        return;
      }
      if (!data.authResolved) {
        const authorized = await socketAuth.authorize(socket, authMessage.token);
        if (!authorized) {
          releaseSocketCapabilities(socket);
          return;
        }
        if (!ingress.active) return;
      }
      if (runtime.replicaLogInvalid) {
        releaseSocketCapabilities(socket);
        closeReplicaInvalidSocket(socket);
        return;
      }
      if (ingress.active) {
        socket.send(JSON.stringify(
          createSyncAuthReadyMessage(data.authContext !== null),
        ));
      }
      return;
    }

    // Legacy no-token clients can still enter deliberately public sync.
    // Required mode fails closed until the explicit auth message arrives.
    if (!data.authResolved) {
      const authorized = await socketAuth.authorize(socket);
      if (!authorized) {
        releaseSocketCapabilities(socket);
        return;
      }
      if (!ingress.active) return;
    } else {
      const authorized = await socketAuth.revalidate(socket);
      if (!authorized || !ingress.active) return;
    }
    if (runtime.replicaLogInvalid) {
      releaseSocketCapabilities(socket);
      closeReplicaInvalidSocket(socket);
      return;
    }

    let tenantDataPlane = tenantDataSockets.get(socket);
    if (config.tenantDataPlane
      && wireUsesTenantDataPlane(wireMessage, config.tenantDataPlane)) {
      if (!tenantDataPlane) {
        const authContext = data.authContext;
        if (!authContext) {
          releaseSocketCapabilities(socket);
          socket.close(4001, 'Tenant Sync requires authentication');
          return;
        }
        try {
          tenantDataPlane = new SyncTenantSocketBridge({
            socket,
            plane: config.tenantDataPlane,
            observability,
            authContext,
            snapshotTables: config.snapshotTables,
            assertCurrentAuthoritySync: () => {
              if (!socketAuth.validateCurrentAuthority(socket, authContext)) {
                throw tenantSyncAuthorityChanged();
              }
              return undefined;
            },
            assertCurrentReadAuthoritySync: () => {
              if (!socketAuth.validateCurrentAuthority(socket, authContext)) {
                throw tenantSyncAuthorityChanged();
              }
              return undefined;
            },
            assertMutationAuthoritySync: (fingerprint) => {
              if (!socketAuth.validateCurrentAuthority(socket, authContext)
                || !(config.resourcePolicy
                  ?.validateMutationAuthorityAtCommit?.(
                    data.authContext,
                    fingerprint,
                  ) ?? true)) {
                throw tenantSyncAuthorityChanged();
              }
              return undefined;
            },
          });
          tenantDataSockets.set(socket, tenantDataPlane);
        } catch {
          releaseSocketCapabilities(socket);
          socket.close(4001, 'Tenant Sync authority is not tenant scoped');
          return;
        }
      }
    }
    if (!ingress.active) return;

    await routeMessage(
      socket,
      wireMessage,
      db,
      { publish: (topic: string, data: string) => socket.publish(topic, data) },
      runtime.stateManager,
      runtime.ephemeralManager,
      policy,
      config.snapshotTables,
      config.resourcePolicy,
      mutationReceipts,
      runtime.mutationOrigin,
      mutationValidators,
      runtime.ephemeralChannel,
      config.tenancyMode ?? 'single',
      () => socketAuth.revalidate(socket),
      () => validateSyncCommitAuthority(
        config.auth,
        data.authContext,
        config.tenancyMode ?? 'single',
      ),
      tenantDataPlane,
      observability,
      () => {
        if (!socketAuth.validateCurrentAuthority(
          socket,
          data.authContext ?? undefined,
        )) {
          throw tenantSyncAuthorityChanged();
        }
      },
    );
  }

  function releaseSocketCapabilities(
    socket: ServerWebSocket<SyncSocketData>,
  ): void {
    ingressQueues.get(socket)?.dispose();
    ingressQueues.delete(socket);
    rejectSyncDrain(socket);
    activeSockets.delete(socket);
    openSockets.delete(socket);
    tenantDataSockets.get(socket)?.dispose();
    tenantDataSockets.delete(socket);
    socketAuth.clearSocket(socket);
    // Bun automatically unsubscribes from pub/sub on close. Explicit manager
    // cleanup is still required for presence and in-process subscriptions.
    if (runtime.ephemeralChannel) {
      runtime.ephemeralChannel.cleanup(socket);
    } else if (runtime.ephemeralManager) {
      cleanupEphemeralForSocket(socket, runtime.ephemeralManager);
    }
  }

  cleanupOnCompositionFailure.length = 0;
  return plugin;
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    for (const cleanup of cleanupOnCompositionFailure.reverse()) {
      try {
        cleanup();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        error instanceof Error
          ? error.message
          : '[sync] Plugin composition failed and cleanup also failed.',
      );
    }
    throw error;
  }
}

/**
 * Elysia constructs a fresh `ElysiaWS` facade for each lifecycle callback.
 * Bun's underlying socket is stable for the lifetime of the connection and is
 * therefore the only safe identity for per-connection maps, timers, and
 * tenant-data-plane ownership. Standalone/unit-test sockets have no `raw`
 * facade and already provide that stable identity directly.
 */
function syncTransportSocket(
  socket: unknown,
): ServerWebSocket<SyncSocketData> {
  const raw = (socket as { raw?: unknown } | null)?.raw;
  return (raw ?? socket) as ServerWebSocket<SyncSocketData>;
}

function closeReplicaInvalidSocket(socket: ServerWebSocket<SyncSocketData>): void {
  socket.close(1012, 'Sync replica history invalid');
  scheduleSocketTermination(socket);
}

function scheduleSocketTermination(socket: ServerWebSocket<SyncSocketData>): void {
  // A peer can ignore the close handshake. Give the 1012 frame a chance to
  // flush, then sever any half-closed socket so a fatally invalid runtime does
  // not retain connections until the ordinary idle timeout.
  const timer = setTimeout(() => {
    try {
      socket.terminate();
    } catch {
      // Already-closed sockets need no further action.
    }
  }, 250);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

function raiseLifecycleCleanupFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
