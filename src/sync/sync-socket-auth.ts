/** Coordinates socket auth handshakes, authorization, and revalidation. */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import { createSyncSocketAuthorizer } from './sync-socket-authorizer';
import { createSyncSocketRevalidation } from './sync-socket-revalidation';
import type { SyncPolicy } from './sync-policy';
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
  activeSockets: Set<ServerWebSocket<SyncSocketData>>;
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
      if (!socket.data.authResolved) socket.close(4001, 'Auth handshake timed out');
    }, HANDSHAKE_TIMEOUT_MS);
    handshakeTimers.set(socket, timer);
  }

  function clearSocket(socket: ServerWebSocket<SyncSocketData>): void {
    clearHandshake(socket);
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
    revalidate: revalidation.revalidate,
    waitForRequiredHandshake,
  };
}
