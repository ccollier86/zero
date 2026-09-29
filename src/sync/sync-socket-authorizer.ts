/** Resolves one socket's identity and current table/resource permissions. */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import { resolveSyncAuthContext, sameSyncAuthContext } from './sync-auth';
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
  additionalTables?: Iterable<string>;
  requireDurableAuthority?: boolean;
  requireComparableReadAuthority?: boolean;
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
  const authorizationGeneration = new WeakMap<
    ServerWebSocket<SyncSocketData>,
    number
  >();

  function authorize(
    socket: ServerWebSocket<SyncSocketData>,
    token?: string,
  ): Promise<boolean> {
    if (socket.data.authResolved) return Promise.resolve(true);
    const existing = pendingBySocket.get(socket);
    if (existing) return existing;

    const generation = (authorizationGeneration.get(socket) ?? 0) + 1;
    authorizationGeneration.set(socket, generation);
    const pending = performAuthorization(socket, token, generation)
      .finally(() => {
        if (pendingBySocket.get(socket) === pending) {
          pendingBySocket.delete(socket);
        }
      });
    pendingBySocket.set(socket, pending);
    return pending;
  }

  async function performAuthorization(
    socket: ServerWebSocket<SyncSocketData>,
    token?: string,
    generation?: number,
  ): Promise<boolean> {
    const auth = await resolveSyncAuthContext(token, options.auth);
    if (authorizationGeneration.get(socket) !== generation) return false;
    if (!auth.ok) {
      socket.close(auth.closeCode, auth.reason);
      return false;
    }

    const data = socket.data;
    data.authContext = auth.authContext;
    data.authToken = token;
    data.authAuthorityReference = null;
    if (token && data.authContext && options.auth) {
      const verifier = options.auth.getTokenVerifier();
      try {
        verifier?.assertCurrentProfile?.();
        const reference = verifier?.captureAuthContextAuthority?.(data.authContext) ?? null;
        const canRevalidate = Boolean(verifier?.resolveAuthContextAuthority);
        if (reference && canRevalidate) data.authAuthorityReference = reference;
      } catch {
        socket.close(1011, 'Sync authority capture failed');
        return false;
      }
      if (options.requireDurableAuthority && !data.authAuthorityReference) {
        socket.close(1011, 'Durable Sync authority unavailable');
        return false;
      }
    }
    try {
      const access = await resolveSyncSocketAccess(options, data.authContext);
      if (authorizationGeneration.get(socket) !== generation) return false;
      const verifier = options.auth?.getTokenVerifier();
      verifier?.assertCurrentProfile?.();
      if (data.authContext && data.authAuthorityReference) {
        const current = verifier?.resolveAuthContextAuthority?.(
          data.authAuthorityReference,
        );
        if (!current || !sameSyncAuthContext(current, data.authContext)) {
          socket.close(4001, 'Auth context changed');
          return false;
        }
      }

      const readFingerprint = access.readAuthorityFingerprint;
      const validateRead = options.resourcePolicy
        ?.validateReadAuthorityAtDelivery;
      const installsRowPolicy = access.rowFilters.size > 0
        || access.rowProjectors.size > 0;
      if ((options.requireComparableReadAuthority || installsRowPolicy)
        && (readFingerprint === null || !validateRead)) {
        socket.close(1011, 'Comparable Sync read authority unavailable');
        return false;
      }
      if (readFingerprint !== null) {
        let current = false;
        try {
          const result = validateRead?.call(
            options.resourcePolicy,
            data.authContext,
            readFingerprint,
          );
          if (result
            && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => undefined);
            socket.close(1011, 'Sync read authority validation must be synchronous');
            return false;
          }
          current = result === true;
        } catch {
          socket.close(1011, 'Sync read authority validation failed');
          return false;
        }
        if (!current) {
          socket.close(4001, 'Sync read authority changed');
          return false;
        }
      }
      data.allowedTables = access.allowedTables;
      data.resourceRowFilters = access.rowFilters;
      data.resourceRowProjectors = access.rowProjectors;
      data.authorizationFingerprint = access.fingerprint;
      data.readAuthorizationFingerprint = readFingerprint;
      data.authorizationScope = createSyncAuthorizationScope(
        data.authContext,
        access.fingerprint,
      );
    } catch {
      socket.close(1011, 'Sync access resolution failed');
      return false;
    }

    if (authorizationGeneration.get(socket) !== generation) return false;
    data.authResolved = true;
    options.onAuthorized(socket, token);
    return true;
  }

  function cancel(socket: ServerWebSocket<SyncSocketData>): void {
    authorizationGeneration.set(
      socket,
      (authorizationGeneration.get(socket) ?? 0) + 1,
    );
    pendingBySocket.delete(socket);
  }

  return { authorize, cancel };
}
