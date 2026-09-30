/** Coordinates socket auth handshakes, authorization, and revalidation. */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import { createSyncSocketAuthorizer } from './sync-socket-authorizer';
import { createSyncSocketRevalidation } from './sync-socket-revalidation';
import type { SyncPolicy } from './sync-policy';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type {
  SyncAuthConfig,
  SyncResourcePolicyAdapter,
  SyncSocketData,
} from './types';

const HANDSHAKE_TIMEOUT_MS = 10_000;

interface SyncSocketAuthRuntimeOptions {
  auth?: SyncAuthConfig;
  db: ReactiveDB;
  policy: SyncPolicy;
  resourcePolicy?: SyncResourcePolicyAdapter;
  additionalTables?: Iterable<string>;
  observability?: PlatformObservabilityRuntime | null;
  activeSockets: Set<ServerWebSocket<SyncSocketData>>;
  /** Multi-tenant managed Sync cannot admit a bearer without a durable fence. */
  requireDurableAuthority?: boolean;
  /** Actor-backed tenant reads require a synchronously comparable policy snapshot. */
  requireComparableReadAuthority?: boolean;
  /** Synchronously schedule managed ephemeral revalidation after a revision. */
  onAuthorityInvalidated?: () => void;
  /** Release socket-owned capabilities before an invalidated socket is closed. */
  onSocketInvalidated?: (socket: ServerWebSocket<SyncSocketData>) => void;
  /** Observe unexpected background revalidation failures before fail-closed cleanup. */
  onRevalidationFailure?: (
    error: unknown,
    trigger: 'authority-revision' | 'periodic',
  ) => void;
}

/** Create the per-plugin lifecycle owner for socket authentication. */
export function createSyncSocketAuthRuntime(
  options: SyncSocketAuthRuntimeOptions,
) {
  const handshakeTimers = new Map<
    ServerWebSocket<SyncSocketData>,
    ReturnType<typeof setTimeout>
  >();
  const revalidation = createSyncSocketRevalidation(options);
  const authorizer = createSyncSocketAuthorizer({
    ...options,
    onAuthorized(socket, token) {
      clearHandshake(socket);
      options.activeSockets.add(socket);
      if (token && socket.data.authContext && options.auth) {
        revalidation.start(socket);
      }
    },
  });

  function waitForRequiredHandshake(
    socket: ServerWebSocket<SyncSocketData>,
  ): void {
    if (!options.auth?.required) return;
    const timer = setTimeout(() => {
      if (!socket.data.authResolved) {
        authorizer.cancel(socket);
        socket.close(4001, 'Auth handshake timed out');
      }
    }, HANDSHAKE_TIMEOUT_MS);
    handshakeTimers.set(socket, timer);
  }

  function clearSocket(socket: ServerWebSocket<SyncSocketData>): void {
    clearHandshake(socket);
    authorizer.cancel(socket);
    revalidation.clear(socket);
  }

  function clearHandshake(socket: ServerWebSocket<SyncSocketData>): void {
    const timer = handshakeTimers.get(socket);
    if (timer) clearTimeout(timer);
    handshakeTimers.delete(socket);
  }

  function dispose(): void {
    for (const timer of handshakeTimers.values()) clearTimeout(timer);
    handshakeTimers.clear();
    revalidation.dispose();
  }

  return {
    authorize: authorizer.authorize,
    clearSocket,
    dispose,
    invalidateAll: revalidation.invalidateAll,
    revalidate: revalidation.revalidate,
    revalidateAll: revalidation.revalidateAll,
    start: revalidation.startAuthorityPolling,
    validateCurrentAuthority: revalidation.validateCurrentAuthority,
    waitForRequiredHandshake,
  };
}
