/**
 * connection-health-hooks.ts
 *
 * Composed frontend hook for auth, sync, and optimistic mutation health. This
 * file owns UI-facing connection state only; reconnect, token refresh, and
 * mutation queues remain inside the SDK and sync client.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { InternalClient } from './sdk';
import type { SyncStoreContext } from '../../sync/client/sync-store';
import { useAuth } from './auth-hooks';
import { useClientMaybe } from './client-context';
import { useStatus } from './data-hooks';

const NOOP_UNSUB = () => {};

export interface ConnectionHealth {
  connected: boolean;
  authenticated: boolean;
  authLoading: boolean;
  offline: boolean;
  pendingMutations: number;
  lastSeq: number;
  healthy: boolean;
}

function getPendingMutationCount(client: InternalClient | null): number {
  if (!client) return 0;
  const context = client._syncClient.store.getSnapshot().context as SyncStoreContext;
  return context._sync.pending.length;
}

function getLastSeq(client: InternalClient | null): number {
  if (!client) return 0;
  const context = client._syncClient.store.getSnapshot().context as SyncStoreContext;
  return context._sync.lastSeq;
}

function subscribeOnlineStatus(callback: () => void): () => void {
  if (typeof window === 'undefined') return NOOP_UNSUB;
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/**
 * Return a compact app-ready health object for auth, sync, and local mutations.
 *
 * This hook is intended for banners, disabled states, and diagnostics. It does
 * not control reconnect behavior or session policy.
 */
export function useConnectionHealth(): ConnectionHealth {
  const client = useClientMaybe() as InternalClient | null;
  const status = useStatus();
  const auth = useAuth();
  const online = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!client) return NOOP_UNSUB;
      const subscription = client._syncClient.store.subscribe(callback);
      return () => subscription.unsubscribe();
    },
    [client],
  );

  const pendingMutations = useSyncExternalStore(
    subscribe,
    () => getPendingMutationCount(client),
    () => 0,
  );

  const lastSeq = useSyncExternalStore(
    subscribe,
    () => getLastSeq(client),
    () => 0,
  );

  return useMemo(
    () => ({
      connected: status.connected,
      authenticated: auth.isAuthenticated,
      authLoading: auth.isLoading,
      offline: !online,
      pendingMutations,
      lastSeq,
      healthy: status.connected && !auth.isLoading,
    }),
    [auth.isAuthenticated, auth.isLoading, lastSeq, online, pendingMutations, status.connected],
  );
}
