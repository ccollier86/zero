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
  createReactiveDB,
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
import { clearSyncBackpressure, sendSyncWire } from './sync-wire-send';
import { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, warnPlatform } from '../observability/sink';
import {
  clearPlatformSQLiteService,
  setPlatformSQLiteService,
} from '../persistence';
import type {
  SyncAuthConfig,
  SyncAuthContext,
  SyncPluginConfig,
  SyncSocketData,
} from './types';
import { SYNC_TABLE_MUTATION_VALIDATOR } from './types';
import { SYNC_OUTGOING_BACKPRESSURE_LIMIT } from './types';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import { ZERO_SQLITE_SERVICE, ZERO_SYNC_DB } from '../runtime/service-keys';
import type { PlatformCodeDefinition } from '../observability/types';

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
  const databaseDescription = describeSyncDatabase(config.db, db);
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
    activeSockets,
    requireDurableAuthority: config.tenancyMode === 'multi' && Boolean(config.auth),
    onAuthorityInvalidated: () => runtime.ephemeralChannel?.revalidateAll(),
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
      attempt(() => emitPlatformCode(OBS_CODES.SYNC_STOPPED, {
        metadata: { db: databaseDescription },
      }));
    }
    return failures;
  };

  const invalidateSyncRuntime = (
    error: unknown,
    definition: PlatformCodeDefinition,
  ): void => {
    if (runtime.replicaLogInvalid) return;
    runtime.replicaLogInvalid = true;
    emitPlatformCode(definition, { error });
    const sockets = [...openSockets];
    try {
      socketAuth.invalidateAll(1012, 'Sync replica history invalid');
    } catch {
      // Continue closing sockets that have not completed auth/setup.
    }
    for (const socket of sockets) {
      try {
        if (activeSockets.has(socket)) scheduleSocketTermination(socket);
        else closeReplicaInvalidSocket(socket);
      } catch {
        try { socket.terminate(); } catch { /* Already closed. */ }
      }
    }
  };

  const mutationValidators = { ...config.mutationValidators };
  for (const [name, schema] of Object.entries(config.tables)) {
    db.defineTable(name, schema);
    const validator = config.mutationValidators?.[name]
      ?? schema[SYNC_TABLE_MUTATION_VALIDATOR];
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
            invalidateSyncRuntime(error, OBS_CODES.SYNC_POLICY_STATE_FAILED);
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
              emitPlatformCode(OBS_CODES.SYNC_REPLICA_HISTORY_GAP, {
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
            onInvalid: (error) => {
              invalidateSyncRuntime(error, OBS_CODES.SYNC_REPLICA_POLL_FAILED);
            },
            onError: (error) => {
              emitPlatformCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED, { error });
            },
          });
        }
        socketAuth.start();

        if (config.auth?.required && config.auth.modeDefaulted) {
          warnPlatform(OBS_CODES.SYNC_AUTH_REQUIRED_DEFAULTED, {
            metadata: {
              hint: "Set syncAuth: 'public' only when anonymous sync is deliberate.",
            },
          });
        }

        emitPlatformCode(OBS_CODES.SYNC_STARTED, {
          metadata: {
            db: databaseDescription,
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
            void Promise.resolve(stopping).catch((stopError) => {
              emitPlatformCode(OBS_CODES.SYNC_REPLICA_POLL_FAILED, {
                error: stopError,
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
        // Assign unique connection ID
        const connectionId = `conn_${++connectionCounter}`;

        // Initialize per-socket data
        const data = ws.data as unknown as SyncSocketData;
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
        data.authorizationScope = null;
        data.allowedTables = new Set();
        data.resourceRowFilters = new Map();
        data.resourceRowProjectors = new Map();
        data.rowFilteredSubscribedTables = new Set();
        data.stateSubscribed = false;
        data.statePrincipal = null;
        data.stateLastSeq = 0;
        data.ephemeralTopics = new Set();
        data.query = (ws.data as { query?: { token?: string } }).query ?? {};

        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        openSockets.add(socket);
        if (runtime.replicaLogInvalid) {
          closeReplicaInvalidSocket(socket);
          return;
        }
        if (data.query.token) {
          if (!config.auth?.allowLegacyQueryToken) {
            socket.close(4001, 'Query token authentication disabled');
            return;
          }
          await socketAuth.authorize(socket, data.query.token);
          if (runtime.replicaLogInvalid) {
            activeSockets.delete(socket);
            socketAuth.clearSocket(socket);
            closeReplicaInvalidSocket(socket);
          }
          return;
        }

        if (!config.auth) {
          await socketAuth.authorize(socket);
          if (runtime.replicaLogInvalid) {
            activeSockets.delete(socket);
            socketAuth.clearSocket(socket);
            closeReplicaInvalidSocket(socket);
          }
        } else {
          socketAuth.waitForRequiredHandshake(socket);
        }
      },

      async message(ws, message) {
        const data = ws.data as unknown as SyncSocketData;
        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        if (runtime.replicaLogInvalid) {
          closeReplicaInvalidSocket(socket);
          return;
        }
        const wireMessage = message as string | Record<string, unknown>;
        const authMessage = parseSyncAuthMessage(wireMessage);

        if (authMessage.matched) {
          if (!authMessage.ok) {
            socket.close(4001, 'Invalid auth handshake');
            return;
          }

          if (!data.authResolved) {
            const authorized = await socketAuth.authorize(socket, authMessage.token);
            if (!authorized) return;
          }
          if (runtime.replicaLogInvalid) {
            activeSockets.delete(socket);
            socketAuth.clearSocket(socket);
            closeReplicaInvalidSocket(socket);
            return;
          }

          socket.send(JSON.stringify(
            createSyncAuthReadyMessage(data.authContext !== null)
          ));
          return;
        }

        // Legacy no-token clients can still enter deliberately public sync.
        // Required mode fails closed until the explicit auth message arrives.
        if (!data.authResolved) {
          const authorized = await socketAuth.authorize(socket);
          if (!authorized) return;
        } else if (!(await socketAuth.revalidate(socket))) {
          return;
        }
        if (runtime.replicaLogInvalid) {
          activeSockets.delete(socket);
          socketAuth.clearSocket(socket);
          closeReplicaInvalidSocket(socket);
          return;
        }

        // Elysia auto-parses JSON WebSocket messages — `message` is already an object.
        // routeMessage accepts both string and pre-parsed objects.
        await routeMessage(
          ws as any,
          wireMessage,
          db,
          { publish: (topic: string, data: string) => ws.publish(topic, data) },
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
        );
      },

      close(ws, code, reason) {
        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        activeSockets.delete(socket);
        openSockets.delete(socket);
        socketAuth.clearSocket(socket);
        // Bun automatically unsubscribes from all pub/sub topics on close.
        // Clean up ephemeral manager subscriptions and presence data.
        if (runtime.ephemeralChannel) {
          runtime.ephemeralChannel.cleanup(socket);
        } else if (runtime.ephemeralManager) {
          cleanupEphemeralForSocket(ws as any, runtime.ephemeralManager);
        }
      },

      drain(ws) {
        clearSyncBackpressure(ws as unknown as ServerWebSocket<SyncSocketData>);
      },
    });

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

function resolveSyncDatabase(config: SyncPluginConfig): {
  db: ReactiveDB;
  owned: boolean;
} {
  if (!config.reactiveDB) {
    if (config.ownsReactiveDB !== undefined) {
      throw new Error(
        '[sync] ownsReactiveDB is valid only when reactiveDB is provided',
      );
    }
    return {
      db: createReactiveDB(config.db),
      owned: true,
    };
  }

  return {
    db: config.reactiveDB,
    owned: config.ownsReactiveDB ?? false,
  };
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

function resolveReplicaChangePolling(
  config: SyncPluginConfig,
  db: ReactiveDB,
): { intervalMs: number } | null {
  if (config.replicaChangePolling === false) return null;
  if (config.replicaChangePolling) {
    const requestedInterval = config.replicaChangePolling.intervalMs ?? 250;
    if (!Number.isSafeInteger(requestedInterval) || requestedInterval < 1) {
      throw new Error(
        'ReactiveDB replica polling intervalMs must be a positive safe integer',
      );
    }
    return { intervalMs: Math.max(10, requestedInterval) };
  }
  return db.getSQLiteService()?.mode === 'file'
    ? { intervalMs: 250 }
    : null;
}

function validateSyncCommitAuthority(
  auth: SyncAuthConfig | undefined,
  context: SyncAuthContext | null,
  tenancyMode: 'single' | 'multi',
): boolean {
  const verifier = auth?.getTokenVerifier() ?? null;
  try {
    // This runs after ReactiveDB has acquired its immediate transaction lock.
    // Fence anonymous/public mutations too: they still rely on this runtime's
    // installed tenancy and authorization profile.
    verifier?.assertCurrentProfile?.();
  } catch {
    return false;
  }
  if (!context) return tenancyMode === 'single';
  // Pre-boundary single-tenant JWTs intentionally finish their original short
  // TTL without a durable session handle. Preserve that narrow compatibility
  // path; multi-tenant authority is always session-bound and reaches this gate.
  if (!context.sessionKind) return tenancyMode === 'single';
  if (!verifier
    || typeof verifier.captureAuthContextAuthority !== 'function'
    || typeof verifier.resolveAuthContextAuthority !== 'function') {
    // Standalone/legacy verifier compatibility is single-tenant only. A
    // multi-tenant scope without a synchronous durable resolver cannot safely
    // cross a transaction boundary.
    return tenancyMode === 'single';
  }

  try {
    const reference = verifier.captureAuthContextAuthority(context);
    return Boolean(reference && verifier.resolveAuthContextAuthority(reference));
  } catch {
    return false;
  }
}

function assertMultiTenantResourceClassification(config: SyncPluginConfig): void {
  if (config.tenancyMode !== 'multi') return;

  for (const table of Object.keys(config.tables)) {
    if (table.startsWith('_')) continue;
    const realm = config.resourcePolicy?.classifyManagedTableRealm?.(table) ?? null;
    if (realm === 'global' || realm === 'tenant') continue;
    throw new Error(
      `[sync] Multi-tenant table "${table}" must have an explicit global or tenant resource realm before Sync starts. ` +
      'Use defineResource({ realm: globalRealm() | tenantRealm(), ... }) and the resource Sync policy adapter.',
    );
  }

  for (const table of Object.keys(config.tables)) {
    if (table.startsWith('_')) continue;
    const exposure = config.resourcePolicy
      ?.classifyManagedTableExposure?.(table) ?? null;
    if (exposure === 'internal'
      || exposure === 'http'
      || exposure === 'sync'
      || exposure === 'all') continue;
    throw new Error(
      `[sync] Multi-tenant table "${table}" must have an explicit resource exposure before Sync starts. `
      + 'Use defineResource({ exposure: "internal" | "http" | "sync" | "all", ... }).',
    );
  }
}

function assertMutationValidatorMatchesTable(
  table: string,
  validator: NonNullable<SyncPluginConfig['mutationValidators']>[string],
  db: ReactiveDB,
): void {
  const primaryKey = db.getPrimaryKey(table);
  if (validator.primaryKey !== primaryKey) {
    throw new Error(
      `[sync] Mutation validator for table "${table}" declares primary key `
      + `"${validator.primaryKey}", but the SQL table uses "${primaryKey}".`,
    );
  }

  const columns = new Set(db.getColumns(table));
  for (const field of validator.fieldNames) {
    if (!columns.has(field)) {
      throw new Error(
        `[sync] Mutation validator for table "${table}" declares unknown field "${field}".`,
      );
    }
  }
}

function describeSyncDatabase(config: SyncPluginConfig['db'], db: ReactiveDB): string {
  const sqlite = db.getSQLiteService();
  if (sqlite) {
    return sqlite.mode === 'ephemeral'
      ? ':memory:'
      : sqlite.snapshotPath ?? sqlite.path ?? sqlite.mode;
  }

  if (config.database) return '[injected database]';
  if (config.mode === 'memory' || config.mode === ':memory:') return ':memory:';
  return config.path ?? config.mode ?? '[platform sqlite]';
}
