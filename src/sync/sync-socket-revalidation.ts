/** Revalidates active socket identity and complete effective read policy. */

import type { ServerWebSocket } from 'bun';
import { resolveSyncAuthContext } from './sync-auth';
import { resolveSyncSocketAccess } from './sync-socket-access';
import type { SyncSocketData } from './types';
import type { createSyncSocketAuthRuntime } from './sync-socket-auth';

const DEFAULT_REVALIDATION_MS = 30_000;
type Options = Parameters<typeof createSyncSocketAuthRuntime>[0];

/** Create current-account and resource-policy revalidation timers. */
export function createSyncSocketRevalidation(options: Options) {
  const timers = new Map<ServerWebSocket<SyncSocketData>, ReturnType<typeof setInterval>>();
  const pending = new WeakMap<ServerWebSocket<SyncSocketData>, Promise<boolean>>();
  let authorityTimer: ReturnType<typeof setInterval> | null = null;
  let lastAuthorityRevision: string | number | undefined;
  let authorityRevalidation: Promise<void> | null = null;
  let authorityRevalidationQueued = false;
  let disposed = false;

  function start(socket: ServerWebSocket<SyncSocketData>): void {
    clear(socket);
    pollAuthorityRevision();
    const intervalMs = Math.max(
      10,
      options.auth?.revalidateIntervalMs ?? DEFAULT_REVALIDATION_MS,
    );
    timers.set(socket, setInterval(() => { void revalidate(socket); }, intervalMs));
  }

  function startAuthorityPolling(): void {
    if (authorityTimer || !options.auth?.invalidationPollIntervalMs) return;
    pollAuthorityRevision();
    const intervalMs = Math.max(10, options.auth.invalidationPollIntervalMs);
    authorityTimer = setInterval(pollAuthorityRevision, intervalMs);
    (authorityTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
  }

  function pollAuthorityRevision(): void {
    if (!options.auth) return;
    try {
      const verifier = options.auth.getTokenVerifier();
      verifier?.assertCurrentProfile?.();
      const revision = verifier?.getAuthorityRevision?.();
      if (revision === null || revision === undefined) return;
      if (lastAuthorityRevision === undefined) {
        lastAuthorityRevision = revision;
        // Managed Auth is mounted after Sync, so the shared clock may become
        // readable only after a socket has completed its token handshake. A
        // revocation can race between that token check and this first baseline
        // read. Revalidate any already-authorized sockets when establishing
        // the baseline so that race cannot be mistaken for a clean starting
        // point and survive until the slower periodic fallback.
        if (options.activeSockets.size > 0) scheduleAuthorityRevalidation();
        return;
      }
      if (revision === lastAuthorityRevision) return;
      lastAuthorityRevision = revision;
      void options.onAuthorityInvalidated?.();
      scheduleAuthorityRevalidation();
    } catch {
      // A configured durable revision that cannot be read is not a safe stale
      // cache boundary. Clients reconnect once the authority store recovers.
      invalidateAll(1011, 'Sync authority invalidation unavailable');
    }
  }

  async function revalidateAll(): Promise<void> {
    await Promise.all([...options.activeSockets].map((socket) => revalidate(socket)));
  }

  /**
   * Coalesce authority events without losing one that arrives while a prior
   * socket pass is still resolving. Per-socket revalidation is single-flight;
   * the queued follow-up is therefore required to observe mutations committed
   * after that in-flight resolver took its database snapshot.
   */
  function scheduleAuthorityRevalidation(): void {
    if (disposed) return;
    authorityRevalidationQueued = true;
    if (authorityRevalidation) return;

    const task = (async () => {
      while (authorityRevalidationQueued && !disposed) {
        authorityRevalidationQueued = false;
        await revalidateAll();
      }
    })();
    authorityRevalidation = task;
    const finish = () => {
      if (authorityRevalidation === task) authorityRevalidation = null;
      if (authorityRevalidationQueued && !disposed) scheduleAuthorityRevalidation();
    };
    void task.then(finish, () => {
      authorityRevalidationQueued = false;
      invalidateAll(1011, 'Sync authority revalidation failed');
      finish();
    });
  }

  function invalidateAll(code: number, reason: string): void {
    for (const socket of [...options.activeSockets]) {
      closeAndReset(socket, code, reason);
    }
  }

  function revalidate(socket: ServerWebSocket<SyncSocketData>): Promise<boolean> {
    const data = socket.data;
    if (!options.auth) return Promise.resolve(true);
    if (!assertCurrentProfile(socket)) return Promise.resolve(false);
    if (!data.authToken || !data.authContext) return Promise.resolve(true);
    const existing = pending.get(socket);
    if (existing) return existing;
    const check = perform(socket).finally(() => pending.delete(socket));
    pending.set(socket, check);
    return check;
  }

  /**
   * Fence an outgoing change at the last synchronous boundary before send.
   * Zero's durable authority resolver reads the current session, account,
   * tenant membership, and advanced-role generations without retaining or
   * re-verifying the bearer token.
   */
  function validateCurrentAuthority(socket: ServerWebSocket<SyncSocketData>): boolean {
    const data = socket.data;
    if (!options.auth) return true;
    if (!assertCurrentProfile(socket)) return false;
    if (!data.authContext) return true;
    const verifier = options.auth.getTokenVerifier();
    const reference = data.authAuthorityReference ?? null;
    if (!reference || !verifier?.resolveAuthContextAuthority) {
      if (!options.requireDurableAuthority) return true;
      closeAndReset(socket, 1011, 'Durable Sync authority unavailable');
      return false;
    }

    try {
      const current = verifier.resolveAuthContextAuthority(reference);
      if (!current || !sameAuthContext(current, data.authContext)) {
        closeAndReset(socket, 4001, 'Auth context changed');
        return false;
      }
      return true;
    } catch {
      closeAndReset(socket, 1011, 'Sync authority revalidation failed');
      return false;
    }
  }

  async function perform(socket: ServerWebSocket<SyncSocketData>): Promise<boolean> {
    const data = socket.data;
    const current = await resolveSyncAuthContext(data.authToken, options.auth);
    if (!current.ok || !current.authContext) {
      closeAndReset(socket, current.ok ? 4001 : current.closeCode,
        current.ok ? 'Auth context changed' : current.reason);
      return false;
    }
    if (!sameAuthContext(current.authContext, data.authContext!)) {
      closeAndReset(socket, 4001, 'Auth context changed');
      return false;
    }
    try {
      const access = await resolveSyncSocketAccess(options, current.authContext);
      options.auth?.getTokenVerifier()?.assertCurrentProfile?.();
      if (access.fingerprint === null
        || access.fingerprint !== data.authorizationFingerprint) {
        closeAndReset(socket, 4001, 'Sync access changed');
        return false;
      }
      data.allowedTables = access.allowedTables;
      data.resourceRowFilters = access.rowFilters;
      data.resourceRowProjectors = access.rowProjectors;
      return true;
    } catch {
      closeAndReset(socket, 1011, 'Sync access revalidation failed');
      return false;
    }
  }

  function assertCurrentProfile(
    socket: ServerWebSocket<SyncSocketData>,
  ): boolean {
    try {
      options.auth?.getTokenVerifier()?.assertCurrentProfile?.();
      return true;
    } catch {
      closeAndReset(socket, 1011, 'Sync auth profile changed');
      return false;
    }
  }

  function clear(socket: ServerWebSocket<SyncSocketData>): void {
    const timer = timers.get(socket);
    if (timer) clearInterval(timer);
    timers.delete(socket);
  }

  function dispose(): void {
    disposed = true;
    authorityRevalidationQueued = false;
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    if (authorityTimer) clearInterval(authorityTimer);
    authorityTimer = null;
  }

  return {
    clear,
    dispose,
    invalidateAll,
    revalidate,
    revalidateAll,
    start,
    startAuthorityPolling,
    validateCurrentAuthority,
  };
}

function closeAndReset(socket: ServerWebSocket<SyncSocketData>, code: number, reason: string): void {
  const data = socket.data;
  for (const topic of [...data.subscribedTopics]) {
    if (!topic.startsWith('sync:')) continue;
    socket.unsubscribe(topic);
    data.subscribedTopics.delete(topic);
  }
  data.allowedTables.clear();
  data.resourceRowFilters.clear();
  data.resourceRowProjectors?.clear();
  data.rowFilteredSubscribedTables.clear();
  data.syncSubscribedTables.clear();
  data.authResolved = false;
  data.authContext = null;
  data.authToken = undefined;
  data.authAuthorityReference = null;
  data.authorizationFingerprint = null;
  data.authorizationScope = null;
  socket.close(code, reason);
}

function sameAuthContext(left: NonNullable<SyncSocketData['authContext']>, right: typeof left): boolean {
  return left.userId === right.userId
    && left.email === right.email
    && left.role === right.role
    && left.clientId === right.clientId
    && left.sessionKind === right.sessionKind
    && JSON.stringify([...(left.scope ?? [])].sort())
      === JSON.stringify([...(right.scope ?? [])].sort())
    && left.sessionId === right.sessionId
    && left.mfaVerifiedAt === right.mfaVerifiedAt
    && left.sessionGeneration === right.sessionGeneration
    && left.sessionScopeKind === right.sessionScopeKind
    && left.sessionScopeId === right.sessionScopeId
    && left.tenantId === right.tenantId
    && left.tenantKind === right.tenantKind
    && left.membershipId === right.membershipId
    && left.tenantRole === right.tenantRole
    && left.tenantAuthorizationGeneration === right.tenantAuthorizationGeneration
    && left.membershipAuthorizationGeneration === right.membershipAuthorizationGeneration
    && left.authorizationAssignmentRevision === right.authorizationAssignmentRevision;
}
