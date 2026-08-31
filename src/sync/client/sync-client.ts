import type {
  SyncCatchupMessage,
  SyncClientConfig,
  SyncSnapshotMessage,
} from '../types';
import { createSyncStore, type SyncStoreContext } from './sync-store';
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
    autoConnect = true,
    onError,
    onAuthFailure,
    onReconnect,
    ackTimeout = DEFAULT_ACK_TIMEOUT,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  } = config;
  const { store, tables: tableDefs } = createSyncStore(tables);
  let disposed = false;
  let isFirstConnect = true;
  let baselineReady = false;
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
      recover: recoverSyncStream,
      synchronized: finishSyncBaseline,
    }, socket, event),
    closed: handleSocketClose,
  });
  const mutations = new SyncMutationQueue({
    apply: (event) => store.send(event as never),
    send: sendMutation,
    epoch: () => (
      store.getSnapshot().context as SyncStoreContext
    )._sync.epoch,
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

  function finishSocketHandshake(socket: WebSocket): void {
    if (!connection.authenticate(socket)) return;
    reconnectScheduler.succeeded();
    finishSyncSocketHandshake({
      socket,
      store,
      tables: tableDefs,
    });
  }

  function finishSyncBaseline(
    message: SyncSnapshotMessage | SyncCatchupMessage,
  ): void {
    if (message.type === 'sync.snapshot' && message.reset === 'purge') {
      sendBuffer.length = 0;
    }
    if (baselineReady) return;
    baselineReady = true;
    mutations.resume();
    const queued = sendBuffer.splice(0);
    for (const message of queued) {
      if (!connection.send(message)) sendBuffer.push(message);
    }
    ackMonitor.start();
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
    baselineReady = false;
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
    baselineReady = false;
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

  function purgeLocalState(): void {
    sendBuffer.length = 0;
    mutations.clear();
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
  }

  const client: SyncClient = {
    get store() { return store; },
    get tables() { return tableDefs; },
    get connected() {
      return (store.getSnapshot().context as SyncStoreContext)._sync.connected;
    },
    insert: actions.insert,
    update: actions.update,
    delete: actions.delete,
    sendRaw(message: object): void {
      sendMessage(JSON.stringify(message));
    },
    connect,
    reconnect,
    reset,
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
