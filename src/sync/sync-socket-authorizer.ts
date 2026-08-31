/** Resolves one socket's identity and current table/resource permissions. */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import { resolveSyncAuthContext } from './sync-auth';
import type { SyncPolicy } from './sync-policy';
import { resolveSyncSocketAccess } from './sync-socket-access';
import { createSyncAuthorizationScope } from './sync-authorization-scope';
import type {
  SyncAuthConfig,
  SyncResourcePolicyAdapter,
  SyncSocketData,
} from './types';

interface SocketAuthorizerOptions {
  auth?: SyncAuthConfig;
  db: ReactiveDB;
  policy: SyncPolicy;
  resourcePolicy?: SyncResourcePolicyAdapter;
  onAuthorized: (
    socket: ServerWebSocket<SyncSocketData>,
    token?: string,
  ) => void;
}

/** Create a single-flight authorization boundary for each socket. */
export function createSyncSocketAuthorizer(options: SocketAuthorizerOptions) {
  const pendingBySocket = new WeakMap<
    ServerWebSocket<SyncSocketData>,
    Promise<boolean>
  >();

  function authorize(
    socket: ServerWebSocket<SyncSocketData>,
    token?: string,
  ): Promise<boolean> {
    if (socket.data.authResolved) return Promise.resolve(true);
    const existing = pendingBySocket.get(socket);
    if (existing) return existing;

    const pending = performAuthorization(socket, token)
      .finally(() => pendingBySocket.delete(socket));
    pendingBySocket.set(socket, pending);
    return pending;
  }

  async function performAuthorization(
    socket: ServerWebSocket<SyncSocketData>,
    token?: string,
  ): Promise<boolean> {
    const auth = await resolveSyncAuthContext(token, options.auth);
    if (!auth.ok) {
      socket.close(auth.closeCode, auth.reason);
      return false;
    }

    const data = socket.data;
    data.authContext = auth.authContext;
    data.authToken = token;
    try {
      const access = await resolveSyncSocketAccess(options, data.authContext);
      data.allowedTables = access.allowedTables;
      data.resourceRowFilters = access.rowFilters;
      data.authorizationFingerprint = access.fingerprint;
      data.authorizationScope = createSyncAuthorizationScope(
        data.authContext,
        access.fingerprint,
      );
    } catch {
      socket.close(1011, 'Sync access resolution failed');
      return false;
    }

    data.authResolved = true;
    options.onAuthorized(socket, token);
    return true;
  }

  return { authorize };
}
