/** Revalidates active socket identity and complete effective read policy. */

import type { ServerWebSocket } from 'bun';
import { resolveSyncAuthContext, sameSyncAuthContext } from './sync-auth';
import { resolveSyncSocketAccess } from './sync-socket-access';
import type { SyncAuthContext, SyncSocketData } from './types';
import type { createSyncSocketAuthRuntime } from './sync-socket-auth';

const DEFAULT_REVALIDATION_MS = 30_000;
type Options = Parameters<typeof createSyncSocketAuthRuntime>[0];

/** Create current-account and resource-policy revalidation timers. */
export function createSyncSocketRevalidation(options: Options) {
  const timers = new Map<ServerWebSocket<SyncSocketData>, ReturnType<typeof setInterval>>();
  const pending = new WeakMap<ServerWebSocket<SyncSocketData>, Promise<boolean>>();
  const generations = new WeakMap<ServerWebSocket<SyncSocketData>, number>();
  let authorityTimer: ReturnType<typeof setInterval> | null = null;
  let lastAuthorityRevision: string | number | undefined;
  let authorityRevalidation: Promise<void> | null = null;
  let authorityRevalidationQueued = false;
  let disposed = false;

  const closeInvalidSocket = (
    socket: ServerWebSocket<SyncSocketData>,
    code: number,
    reason: string,
  ): void => {
    try {
      options.onSocketInvalidated?.(socket);
    } catch {
      // Capability cleanup cannot prevent the fail-closed socket reset.
    }
    closeAndReset(socket, code, reason);
  };

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
      closeInvalidSocket(socket, code, reason);
    }
  }

  function revalidate(socket: ServerWebSocket<SyncSocketData>): Promise<boolean> {
    const data = socket.data;
    if (disposed) return Promise.resolve(false);
    if (!options.auth) return Promise.resolve(true);
    if (!assertCurrentProfile(socket)) return Promise.resolve(false);
    if (!data.authResolved) return Promise.resolve(false);
    if (!data.authToken || !data.authContext) return Promise.resolve(true);
    const existing = pending.get(socket);
    if (existing) return existing;
    const generation = generations.get(socket) ?? 0;
    const check = perform(socket, generation).finally(() => {
      if (pending.get(socket) === check) pending.delete(socket);
    });
    pending.set(socket, check);
    return check;
  }

  /**
   * Fence an outgoing change at the last synchronous boundary before send.
   * Zero's durable authority resolver reads the current session, account,
   * tenant membership, and advanced-role generations without retaining or
   * re-verifying the bearer token.
   */
  function validateCurrentAuthority(
    socket: ServerWebSocket<SyncSocketData>,
    expectedContext?: SyncAuthContext,
  ): boolean {
    const data = socket.data;
    if (!options.auth) return true;
    if (!assertCurrentProfile(socket)) return false;
    // `closeAndReset()` clears the context before the WebSocket close callback
    // disposes its long-lived tenant binding. Treat that intermediate state as
    // revoked, not as an anonymous/public socket, or a queued actor operation
    // could pass its final commit fence while shutdown is still propagating.
    if (!data.authResolved) return false;
    if (expectedContext
      && (!data.authContext
        || !sameSyncAuthContext(data.authContext, expectedContext))) {
      closeInvalidSocket(socket, 4001, 'Auth context changed');
      return false;
    }
    if (!data.authContext) return validateReadAuthority(socket);
    const verifier = options.auth.getTokenVerifier();
    const reference = data.authAuthorityReference ?? null;
    if (!reference || !verifier?.resolveAuthContextAuthority) {
      if (!options.requireDurableAuthority) return validateReadAuthority(socket);
      closeInvalidSocket(socket, 1011, 'Durable Sync authority unavailable');
      return false;
    }

    try {
      const current = verifier.resolveAuthContextAuthority(reference);
      if (!current || !sameSyncAuthContext(current, data.authContext)) {
        closeInvalidSocket(socket, 4001, 'Auth context changed');
        return false;
      }
      return validateReadAuthority(socket);
    } catch {
      closeInvalidSocket(socket, 1011, 'Sync authority revalidation failed');
      return false;
    }
  }

  async function perform(
    socket: ServerWebSocket<SyncSocketData>,
    generation: number,
  ): Promise<boolean> {
    const data = socket.data;
    const current = await resolveSyncAuthContext(data.authToken, options.auth);
    if (!isCurrent(socket, generation)) return false;
    if (!current.ok || !current.authContext) {
      closeInvalidSocket(socket, current.ok ? 4001 : current.closeCode,
        current.ok ? 'Auth context changed' : current.reason);
      return false;
    }
    if (!sameSyncAuthContext(current.authContext, data.authContext!)) {
      closeInvalidSocket(socket, 4001, 'Auth context changed');
      return false;
    }
    try {
      const access = await resolveSyncSocketAccess(options, current.authContext);
      if (!isCurrent(socket, generation)) return false;
      options.auth?.getTokenVerifier()?.assertCurrentProfile?.();
      const installsRowPolicy = access.rowFilters.size > 0
        || access.rowProjectors.size > 0;
      const validateRead = options.resourcePolicy?.validateReadAuthorityAtDelivery;
      if ((options.requireComparableReadAuthority || installsRowPolicy)
        && (access.readAuthorityFingerprint === null || !validateRead)) {
        closeInvalidSocket(socket, 1011, 'Comparable Sync read authority unavailable');
        return false;
      }
      if (access.fingerprint === null
        || access.fingerprint !== data.authorizationFingerprint
        || access.readAuthorityFingerprint
          !== (data.readAuthorizationFingerprint ?? null)
        || !validateReadAuthorityFingerprint(
          current.authContext,
          access.readAuthorityFingerprint,
        )) {
        closeInvalidSocket(socket, 4001, 'Sync access changed');
        return false;
      }
      data.allowedTables = access.allowedTables;
      data.resourceRowFilters = access.rowFilters;
      data.resourceRowProjectors = access.rowProjectors;
      data.readAuthorizationFingerprint = access.readAuthorityFingerprint;
      return true;
    } catch {
      if (!isCurrent(socket, generation)) return false;
      closeInvalidSocket(socket, 1011, 'Sync access revalidation failed');
      return false;
    }
  }

  function validateReadAuthority(
    socket: ServerWebSocket<SyncSocketData>,
  ): boolean {
    const expected = socket.data.readAuthorizationFingerprint ?? null;
    if (validateReadAuthorityFingerprint(socket.data.authContext, expected)) {
      return true;
    }
    closeInvalidSocket(socket, 4001, 'Sync read authority changed');
    return false;
  }

  function validateReadAuthorityFingerprint(
    authContext: SyncAuthContext | null,
    expected: string | null,
  ): boolean {
    if (expected === null) return !options.requireComparableReadAuthority;
    const validate = options.resourcePolicy?.validateReadAuthorityAtDelivery;
    if (!validate) return false;
    try {
      const result = validate.call(options.resourcePolicy, authContext, expected);
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => undefined);
        return false;
      }
      return result === true;
    } catch {
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
      closeInvalidSocket(socket, 1011, 'Sync auth profile changed');
      return false;
    }
  }

  function clear(socket: ServerWebSocket<SyncSocketData>): void {
    const timer = timers.get(socket);
    if (timer) clearInterval(timer);
    timers.delete(socket);
    generations.set(socket, (generations.get(socket) ?? 0) + 1);
    pending.delete(socket);
  }

  function dispose(): void {
    disposed = true;
    authorityRevalidationQueued = false;
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    if (authorityTimer) clearInterval(authorityTimer);
    authorityTimer = null;
  }

  function isCurrent(
    socket: ServerWebSocket<SyncSocketData>,
    generation: number,
  ): boolean {
    return !disposed && (generations.get(socket) ?? 0) === generation;
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
  data.readAuthorizationFingerprint = null;
  data.authorizationScope = null;
  socket.close(code, reason);
}
