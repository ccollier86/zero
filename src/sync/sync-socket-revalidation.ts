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

  function start(socket: ServerWebSocket<SyncSocketData>): void {
    clear(socket);
    const intervalMs = Math.max(
      10,
      options.auth?.revalidateIntervalMs ?? DEFAULT_REVALIDATION_MS,
    );
    timers.set(socket, setInterval(() => { void revalidate(socket); }, intervalMs));
  }

  function revalidate(socket: ServerWebSocket<SyncSocketData>): Promise<boolean> {
    const data = socket.data;
    if (!options.auth || !data.authToken || !data.authContext) return Promise.resolve(true);
    const existing = pending.get(socket);
    if (existing) return existing;
    const check = perform(socket).finally(() => pending.delete(socket));
    pending.set(socket, check);
    return check;
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
      if (access.fingerprint === null
        || access.fingerprint !== data.authorizationFingerprint) {
        closeAndReset(socket, 4001, 'Sync access changed');
        return false;
      }
      data.allowedTables = access.allowedTables;
      data.resourceRowFilters = access.rowFilters;
      return true;
    } catch {
      closeAndReset(socket, 1011, 'Sync access revalidation failed');
      return false;
    }
  }

  function clear(socket: ServerWebSocket<SyncSocketData>): void {
    const timer = timers.get(socket);
    if (timer) clearInterval(timer);
    timers.delete(socket);
  }

  function dispose(): void {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  }

  return { clear, dispose, revalidate, start };
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
  data.rowFilteredSubscribedTables.clear();
  data.syncSubscribedTables.clear();
  data.authorizationFingerprint = null;
  data.authorizationScope = null;
  socket.close(code, reason);
}

function sameAuthContext(left: NonNullable<SyncSocketData['authContext']>, right: typeof left): boolean {
  return left.userId === right.userId && left.email === right.email && left.role === right.role;
}
