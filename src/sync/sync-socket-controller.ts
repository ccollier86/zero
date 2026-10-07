/** Per-connection ownership and ordered WebSocket ingress for Sync. */

import type { ServerWebSocket } from 'bun';
import { OBS_CODES } from '../observability/codes';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { cleanupEphemeralForSocket } from './ephemeral-handler';
import { routeMessage } from './message-handler';
import type { ReactiveDB } from './reactive-db';
import { createSyncAuthReadyMessage, parseSyncAuthMessage } from './sync-auth-message';
import {
  tenantSyncAuthorityChanged,
  validateSyncCommitAuthority,
  wireUsesTenantDataPlane,
} from './sync-plugin-config';
import type {
  SyncPlatformCodeReporter,
  SyncPluginRuntimeState,
} from './sync-plugin-runtime-state';
import type { SyncPolicy } from './sync-policy';
import type { createSyncSocketAuthRuntime } from './sync-socket-auth';
import {
  SyncSocketIngressQueue,
  syncIngressEncodedBytes,
  type SyncIngressFence,
} from './sync-socket-ingress';
import { SyncSystemSocketBridge } from './sync-system-data-plane';
import { SyncTenantSocketBridge } from './sync-tenant-data-plane';
import { SyncTenantDataPlaneError } from './sync-tenant-data-plane-error';
import type { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import {
  clearSyncBackpressure,
  rejectSyncDrain,
} from './sync-wire-send';
import type {
  SyncPluginConfig,
  SyncSocketData,
  SyncTableMutationValidator,
} from './types';

type SyncSocketAuthRuntime = ReturnType<typeof createSyncSocketAuthRuntime>;

export interface SyncSocketCollections {
  readonly activeSockets: Set<ServerWebSocket<SyncSocketData>>;
  readonly openSockets: Set<ServerWebSocket<SyncSocketData>>;
  readonly tenantDataSockets: Map<
    ServerWebSocket<SyncSocketData>,
    SyncTenantSocketBridge
  >;
  readonly systemDataSockets: Map<
    ServerWebSocket<SyncSocketData>,
    SyncSystemSocketBridge
  >;
  readonly ingressQueues: Map<
    ServerWebSocket<SyncSocketData>,
    SyncSocketIngressQueue
  >;
}

export interface SyncSocketController {
  open(socket: unknown): Promise<void>;
  message(socket: unknown, message: unknown): Promise<void>;
  close(socket: unknown): void;
  drain(socket: unknown): void;
  release(socket: ServerWebSocket<SyncSocketData>): void;
  invalidateReplicaConnections(invalidateAuth: () => void): void;
  disposeCapabilities(attempt: (cleanup: () => void) => void): void;
  clearConnections(): void;
}

interface SyncSocketControllerOptions {
  readonly config: SyncPluginConfig;
  readonly db: ReactiveDB;
  readonly stateDB: ReactiveDB;
  readonly systemTables: ReadonlySet<string>;
  readonly observability: PlatformObservabilityRuntime | null;
  readonly runtime: SyncPluginRuntimeState;
  readonly policy: SyncPolicy;
  readonly mutationReceipts: SyncMutationReceiptStore;
  readonly mutationValidators: Readonly<Record<string, SyncTableMutationValidator>>;
  readonly socketAuth: SyncSocketAuthRuntime;
  readonly sockets: SyncSocketCollections;
  readonly reportSyncCode: SyncPlatformCodeReporter;
}

export function createSyncSocketCollections(): SyncSocketCollections {
  return {
    activeSockets: new Set(),
    openSockets: new Set(),
    tenantDataSockets: new Map(),
    systemDataSockets: new Map(),
    ingressQueues: new Map(),
  };
}

export function createSyncSocketController(
  options: SyncSocketControllerOptions,
): SyncSocketController {
  const {
    config,
    db,
    stateDB,
    systemTables,
    observability,
    runtime,
    policy,
    mutationReceipts,
    mutationValidators,
    socketAuth,
    sockets,
    reportSyncCode,
  } = options;
  let connectionCounter = 0;

  const release = (socket: ServerWebSocket<SyncSocketData>): void => {
    sockets.ingressQueues.get(socket)?.dispose();
    sockets.ingressQueues.delete(socket);
    rejectSyncDrain(socket);
    sockets.activeSockets.delete(socket);
    sockets.openSockets.delete(socket);
    sockets.tenantDataSockets.get(socket)?.dispose();
    sockets.tenantDataSockets.delete(socket);
    sockets.systemDataSockets.get(socket)?.dispose();
    sockets.systemDataSockets.delete(socket);
    try { config.presenceTransport?.release(socket.data.connectionId); }
    catch (error) { reportSyncCode(OBS_CODES.SYNC_MESSAGE_HANDLING_FAILED, { error, metadata: { stage: 'presence-release' } }); }
    socketAuth.clearSocket(socket);
    // Bun automatically unsubscribes from pub/sub on close. Explicit manager
    // cleanup is still required for presence and in-process subscriptions.
    if (runtime.ephemeralChannel) {
      runtime.ephemeralChannel.cleanup(socket);
    } else if (runtime.ephemeralManager) {
      cleanupEphemeralForSocket(socket, runtime.ephemeralManager);
    }
  };

  const controller: SyncSocketController = {
    async open(rawSocket) {
      const socket = syncTransportSocket(rawSocket);
      sockets.ingressQueues.set(socket, new SyncSocketIngressQueue());
      const connectionId = `conn_${++connectionCounter}`;

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

      sockets.openSockets.add(socket);
      if (runtime.replicaLogInvalid) {
        release(socket);
        closeReplicaInvalidSocket(socket);
        return;
      }
      if (data.query.token) {
        if (!config.auth?.allowLegacyQueryToken) {
          release(socket);
          socket.close(4001, 'Query token authentication disabled');
          return;
        }
        const admission = sockets.ingressQueues.get(socket)?.admit(
          0,
          async (fence) => {
            const authorized = await socketAuth.authorize(socket, data.query.token);
            if (!authorized) {
              release(socket);
              return;
            }
            if (!fence.active) return;
            if (runtime.replicaLogInvalid) {
              release(socket);
              closeReplicaInvalidSocket(socket);
            }
          },
        );
        if (admission?.accepted) await admission.completion;
        return;
      }

      if (!config.auth) {
        const admission = sockets.ingressQueues.get(socket)?.admit(
          0,
          async (fence) => {
            const authorized = await socketAuth.authorize(socket);
            if (!authorized) {
              release(socket);
              return;
            }
            if (!fence.active) return;
            if (runtime.replicaLogInvalid) {
              release(socket);
              closeReplicaInvalidSocket(socket);
            }
          },
        );
        if (admission?.accepted) await admission.completion;
      } else {
        socketAuth.waitForRequiredHandshake(socket);
      }
    },

    async message(rawSocket, message) {
      const socket = syncTransportSocket(rawSocket);
      const queue = sockets.ingressQueues.get(socket);
      const encodedBytes = syncIngressEncodedBytes(message);
      if (!queue || encodedBytes === null) {
        release(socket);
        socket.close(1008, 'Invalid Sync message');
        return;
      }
      const wireMessage = message as string | Record<string, unknown>;
      const admission = queue.admit(encodedBytes, async (fence) => {
        await processSocketMessage(socket, wireMessage, fence);
      });
      if (!admission.accepted) {
        if (admission.reason === 'capacity') {
          reportSyncCode(OBS_CODES.SYNC_INGRESS_ADMISSION_REJECTED, {
            metadata: { reason: 'capacity' },
          });
        }
        release(socket);
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
      } catch (error) {
        if (!queue.active) return;
        reportSyncCode(OBS_CODES.SYNC_MESSAGE_HANDLING_FAILED, { error });
        release(socket);
        socket.close(1011, 'Sync message handling failed');
      }
    },

    close(rawSocket) {
      release(syncTransportSocket(rawSocket));
    },

    drain(rawSocket) {
      const socket = syncTransportSocket(rawSocket);
      clearSyncBackpressure(socket);
      sockets.systemDataSockets.get(socket)?.resume();
      sockets.tenantDataSockets.get(socket)?.resume();
    },

    release,

    invalidateReplicaConnections(invalidateAuth) {
      const openSockets = [...sockets.openSockets];
      try {
        invalidateAuth();
      } catch {
        // Continue closing sockets that have not completed auth/setup.
      }
      for (const socket of openSockets) {
        try {
          release(socket);
          closeReplicaInvalidSocket(socket);
        } catch {
          try { socket.terminate(); } catch { /* Already closed. */ }
        }
      }
    },

    disposeCapabilities(attempt) {
      for (const bridge of sockets.tenantDataSockets.values()) {
        attempt(() => bridge.dispose());
      }
      sockets.tenantDataSockets.clear();
      for (const bridge of sockets.systemDataSockets.values()) {
        attempt(() => bridge.dispose());
      }
      sockets.systemDataSockets.clear();
      for (const queue of sockets.ingressQueues.values()) queue.dispose();
      sockets.ingressQueues.clear();
    },

    clearConnections() {
      sockets.activeSockets.clear();
      sockets.openSockets.clear();
    },
  };

  return controller;

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
        release(socket);
        socket.close(4001, 'Invalid auth handshake');
        return;
      }
      if (!data.authResolved) {
        const authorized = await socketAuth.authorize(socket, authMessage.token);
        if (!authorized) {
          release(socket);
          return;
        }
        if (!ingress.active) return;
      }
      if (runtime.replicaLogInvalid) {
        release(socket);
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
        release(socket);
        return;
      }
      if (!ingress.active) return;
    } else {
      const authorized = await socketAuth.revalidate(socket);
      if (!authorized || !ingress.active) return;
    }
    if (runtime.replicaLogInvalid) {
      release(socket);
      closeReplicaInvalidSocket(socket);
      return;
    }

    let systemDataPlane = sockets.systemDataSockets.get(socket);
    if (config.systemDataPlane && !systemDataPlane) {
      systemDataPlane = new SyncSystemSocketBridge({
        socket,
        db: config.systemDataPlane.db,
        tables: systemTables,
        snapshotTables: config.snapshotTables,
        observability,
        assertCurrentAuthority: () => {
          if (!socketAuth.validateCurrentAuthority(
            socket,
            data.authContext ?? undefined,
          )) {
            throw tenantSyncAuthorityChanged();
          }
        },
      });
      sockets.systemDataSockets.set(socket, systemDataPlane);
    }

    let tenantDataPlane = sockets.tenantDataSockets.get(socket);
    if (config.tenantDataPlane
      && wireUsesTenantDataPlane(wireMessage, config.tenantDataPlane)) {
      if (!tenantDataPlane) {
        const authContext = data.authContext;
        if (!authContext) {
          release(socket);
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
          sockets.tenantDataSockets.set(socket, tenantDataPlane);
        } catch (error) {
          if (error instanceof SyncTenantDataPlaneError
            && error.code === 'SYNC_TENANT_AUTHORITY_REQUIRED') {
            release(socket);
            socket.close(4001, 'Tenant Sync authority is not tenant scoped');
            return;
          }
          // Catalog/protocol/configuration defects are server failures. Let
          // the ingress owner report the standardized failure and close 1011
          // instead of disguising them as a caller authentication problem.
          throw error;
        }
      }
    }
    if (!ingress.active) return;

    let presenceMessage: Record<string, unknown> | null = null;
    try { presenceMessage = typeof wireMessage === 'string' ? JSON.parse(wireMessage) : wireMessage; } catch { /* Normal parser owns malformed input. */ }
    if (presenceMessage && typeof presenceMessage === 'object' && !Array.isArray(presenceMessage)
      && presenceMessage.topic === 'guardian:presence' && config.presenceTransport) {
      try {
        config.presenceTransport.handle(presenceMessage, data.authContext, data.connectionId, () => {
          if (!ingress.active || !sockets.openSockets.has(socket)
            || !socketAuth.validateCurrentAuthority(socket, data.authContext ?? undefined)) throw tenantSyncAuthorityChanged();
        });
      } catch {
        socket.send(JSON.stringify({ type: 'ephemeral.error', operation: 'set', topic: 'guardian:presence', key: 'self',
          code: 'EPHEMERAL_FORBIDDEN', message: 'Presence report was not admitted' }));
      }
      return;
    }

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
      systemDataPlane,
      stateDB,
      config.ensureMutationReady,
    );
  }
}

/** Resolve the stable Bun socket identity hidden behind Elysia's WS facade. */
function syncTransportSocket(socket: unknown): ServerWebSocket<SyncSocketData> {
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
