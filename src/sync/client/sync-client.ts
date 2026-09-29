import type {
  SyncClientConfig,
  SyncCatchupMessage,
  SyncDataPlaneName,
  SyncSnapshotMessage,
} from '../types';
import { SYNC_TERMINAL_DATA_CLOSE_CODE } from '../types';
import {
  createSyncStore,
  getSyncPlaneCursor,
  type SyncStoreContext,
} from './sync-store';
import type { SyncClient } from './sync-client-types';
import { SyncAckMonitor } from './sync-ack-monitor';
import { requiresSyncCachePurge } from './sync-authorization-boundary';
import { createSyncMutationActions } from './sync-mutation-actions';
import { SyncMutationQueue } from './sync-mutation-queue';
import { SyncReconnectScheduler } from './sync-reconnect-scheduler';
import { SyncSocketAuthClient } from './sync-socket-auth-client';
import { SyncSocketConnection } from './sync-socket-connection';
import { finishSyncSocketHandshake } from './sync-socket-handshake';
import { routeSyncSocketEvent } from './sync-socket-message-router';
import {
  messageSyncDataPlane,
  resolveSyncClientDataPlaneTopology,
} from './sync-data-planes';
import { SyncSnapshotAssembler } from './sync-snapshot-assembler';

export type { SyncClient } from './sync-client-types';

const DEFAULT_ACK_TIMEOUT = 10_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = Infinity;

/**
 * Create a client for realtime table data, optimistic mutation, reconnect,
 * and optional authentication lifecycle binding.
 */
export function createSyncClient(config: SyncClientConfig): SyncClient {
  const {
    url,
    tables,
    token,
    getToken,
    refreshAuth,
    stateSync = false,
    autoConnect = true,
    onError,
    onAuthFailure,
    onReconnect,
    ackTimeout = DEFAULT_ACK_TIMEOUT,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  } = config;
  const topology = resolveSyncClientDataPlaneTopology(
    tables,
    config.tableSyncPlanes,
  );
  const { store, tables: tableDefs } = createSyncStore(tables, {
    tableSyncPlanes: topology.tablePlanes,
  });
  const snapshots = new SyncSnapshotAssembler(tableDefs, topology.tablePlanes);
  let disposed = false;
  let authorizationScopeTransition = false;
  let isFirstConnect = true;
  let baselineReady = false;
  const synchronizedPlanes = new Set<SyncDataPlaneName>();
  let unbindAuthLifecycle: (() => void) | undefined;
  const sendBuffer: string[] = [];
  const messageHandlers = new Set<
    (message: { type: string; [key: string]: unknown }) => void
  >();

  const connection = new SyncSocketConnection({
    url,
    message: (socket, event) => routeSyncSocketEvent({
      store,
      ready: (candidate) => connection.isAuthenticated(candidate),
      authenticated: finishSocketHandshake,
      handlers: messageHandlers,
      mutations,
      snapshots,
      tablePlanes: topology.tablePlanes,
      recover: recoverSyncStream,
      synchronized: finishSyncBaseline,
    }, socket, event),
    closed: handleSocketClose,
  });
  const mutations = new SyncMutationQueue({
    apply: (event) => store.send(event as never),
    send: sendMutation,
    route: (table) => {
      const plane = topology.tablePlanes[table];
      const context = store.getSnapshot().context as SyncStoreContext;
      return {
        epoch: getSyncPlaneCursor(context._sync, plane).epoch,
        ...(topology.assertMutationPlanes ? { plane } : {}),
      };
    },
  });
  const ackMonitor = new SyncAckMonitor({
    timeoutMs: ackTimeout,
    pending: () => (
      store.getSnapshot().context as SyncStoreContext
    )._sync.pending,
    timeout: (mutation) => mutations.timeout(mutation),
  });
  const reconnectScheduler = new SyncReconnectScheduler({
    maximumAttempts: maxReconnectAttempts,
    stopped: () => disposed,
    connect,
    error: onError,
  });
  const socketAuth = new SyncSocketAuthClient({
    token,
    getToken,
    refreshAuth,
    stopped: () => disposed,
    socketActive: () => connection.active,
    open: (currentToken) => connection.open(currentToken),
    recovered: () => reconnectScheduler.succeeded(),
    failed: reportAuthFailure,
  });
  const actions = createSyncMutationActions({
    tables: tableDefs,
    queue: mutations,
    stopped: () => disposed,
  });
  const baselineWaiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  function finishSocketHandshake(
    socket: WebSocket,
    authenticated: boolean,
  ): void {
    if (!connection.authenticate(socket)) return;
    reconnectScheduler.succeeded();
    synchronizedPlanes.clear();
    finishSyncSocketHandshake({
      socket,
      store,
      tables: tableDefs,
      expectedPlanes: topology.expectedPlanes,
      stateSync: stateSync && authenticated,
    });
    if (topology.expectedPlanes.size === 0) finishSyncBaseline();
  }

  function finishSyncBaseline(
    message?: SyncSnapshotMessage | SyncCatchupMessage,
  ): void {
    if (message?.type === 'sync.snapshot' && message.reset === 'purge') {
      sendBuffer.length = 0;
    }
    if (message) {
      const plane = messageSyncDataPlane(message);
      if (plane === null || !topology.expectedPlanes.has(plane)) return;
      synchronizedPlanes.add(plane);
      if ([...topology.expectedPlanes].some(
        (expected) => !synchronizedPlanes.has(expected),
      )) return;
    }
    if (baselineReady) return;
    baselineReady = true;
    mutations.resume();
    const queued = sendBuffer.splice(0);
    for (const message of queued) {
      if (!connection.send(message)) sendBuffer.push(message);
    }
    ackMonitor.start();
    for (const waiter of baselineWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    baselineWaiters.clear();
    if (!isFirstConnect) onReconnect?.();
    isFirstConnect = false;
  }

  function connect(): void {
    socketAuth.connect();
  }

  function handleSocketClose(
    currentToken: string | null | undefined,
    event: CloseEvent,
  ): void {
    snapshots.reset();
    baselineReady = false;
    synchronizedPlanes.clear();
    ackMonitor.stop();
    store.send({ type: 'sync.disconnected' });
    if (disposed) return;
    if (event.code === 4001) {
      if (requiresSyncCachePurge(event)) purgeLocalState();
      socketAuth.recover(currentToken, event);
      return;
    }
    if (event.code === 4003) {
      reportAuthFailure(`Auth failed (code ${event.code}): ${event.reason}`);
      return;
    }
    if (event.code === SYNC_TERMINAL_DATA_CLOSE_CODE) {
      onError?.(
        `Sync stopped (code ${event.code}): ${event.reason || 'data configuration is not transportable'}`,
      );
      return;
    }
    reconnectScheduler.schedule();
  }

  function reportAuthFailure(message: string): void {
    if (onAuthFailure) onAuthFailure(message);
    else onError?.(message);
  }

  function sendMessage(message: string): void {
    if (!baselineReady || !connection.send(message)) sendBuffer.push(message);
  }

  function sendMutation(message: string): boolean {
    return baselineReady && connection.send(message);
  }

  function closeSocket(reason = 'Client reconnect'): void {
    snapshots.reset();
    baselineReady = false;
    synchronizedPlanes.clear();
    socketAuth.cancel();
    reconnectScheduler.cancel();
    ackMonitor.stop();
    connection.close(reason);
    store.send({ type: 'sync.disconnected' });
  }

  function reconnect(): void {
    if (disposed) return;
    closeSocket();
    connect();
  }

  function recoverSyncStream(): void {
    if (disposed) return;
    closeSocket('Sync stream recovery');
    reconnectScheduler.schedule();
  }

  function reset(): void {
    if (disposed) return;
    closeSocket('Client reset');
    purgeLocalState();
    reconnectScheduler.reset();
  }

  function beginAuthorizationScopeTransition(): void {
    if (disposed) return;
    authorizationScopeTransition = true;
    reset();
  }

  function completeAuthorizationScopeTransition(shouldConnect: boolean): void {
    if (disposed) return;
    authorizationScopeTransition = false;
    if (shouldConnect) connect();
  }

  function waitForAuthorizationBaseline(timeoutMs = 10_000): Promise<void> {
    if (baselineReady) return Promise.resolve();
    if (disposed) return Promise.reject(new Error('Sync client is disconnected'));
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          baselineWaiters.delete(waiter);
          reject(new Error('Timed out waiting for the replacement authorization scope'));
        }, timeoutMs),
      };
      baselineWaiters.add(waiter);
    });
  }

  function assertScopeWritesAvailable(): void {
    if (authorizationScopeTransition) {
      throw new Error(
        '[sync] Writes are unavailable during an authorization scope transition.',
      );
    }
  }

  function purgeLocalState(): void {
    sendBuffer.length = 0;
    mutations.clear();
    synchronizedPlanes.clear();
    isFirstConnect = true;
    store.send({ type: 'sync.reset' });
  }

  function disconnect(): void {
    if (disposed) return;
    disposed = true;
    unbindAuthLifecycle?.();
    unbindAuthLifecycle = undefined;
    closeSocket('Client disconnect');
    sendBuffer.length = 0;
    mutations.clear();
    for (const waiter of baselineWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Sync client disconnected before authorization completed'));
    }
    baselineWaiters.clear();
  }

  const client: SyncClient = {
    get store() { return store; },
    get tables() { return tableDefs; },
    get connected() {
      return (store.getSnapshot().context as SyncStoreContext)._sync.connected;
    },
    insert(table, row): void {
      assertScopeWritesAvailable();
      actions.insert(table, row);
    },
    update(table, id, partial): void {
      assertScopeWritesAvailable();
      actions.update(table, id, partial);
    },
    delete(table, id): void {
      assertScopeWritesAvailable();
      actions.delete(table, id);
    },
    sendRaw(message: object): void {
      assertScopeWritesAvailable();
      sendMessage(JSON.stringify(message));
    },
    connect,
    reconnect,
    reset,
    beginAuthorizationScopeTransition,
    completeAuthorizationScopeTransition,
    waitForAuthorizationBaseline,
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => { messageHandlers.delete(handler); };
    },
    disconnect,
  };
  if (config.bindAuthLifecycle) {
    unbindAuthLifecycle = config.bindAuthLifecycle(client, autoConnect) ?? undefined;
  } else if (autoConnect) connect();
  return client;
}
