import { useSyncExternalStore, useCallback, useContext, useRef } from 'react';
import type { JsonValue } from '../types';
import type { StateClient } from './state-client';
import { SyncContext } from './hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from '../../frontend/client/authorization-scope-hooks';

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Get the StateClient from the SyncContext.
 * Throws if used outside SyncProvider or if state sync is not enabled.
 */
function useStateClient(): StateClient {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useServerState must be used within a <SyncProvider>');
  }
  if (!ctx.stateClient) {
    throw new Error('State sync is not enabled. Pass stateSync: true to createSyncClient.');
  }
  return ctx.stateClient;
}

/**
 * Like `useState`, but persisted on the server and synced across devices.
 *
 * - Reads are local (from @xstate/store via useSyncExternalStore)
 * - Writes are optimistic (instant local update, background sync to server)
 * - Tear-free via useSyncExternalStore
 *
 * @example
 * ```tsx
 * function Sidebar() {
 *   const [open, setOpen] = useServerState('sidebar.open', true);
 *   return <button onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>;
 * }
 * ```
 */
export function useServerState<T extends JsonValue>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const client = useStateClient();
  const platformClient = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(platformClient);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;

  const value = useSyncExternalStore(
    useCallback(
      (cb: () => void) => authorizationBoundary.ready
        ? client.subscribe(key, cb)
        : NOOP_UNSUBSCRIBE,
      [authorizationBoundary.key, authorizationBoundary.ready, client, key],
    ),
    () => authorizationBoundary.ready ? client.get(key, defaultValue) : defaultValue,
    () => defaultValue,
  );

  const setValue = useCallback(
    (newValue: T) => {
      if (!isAuthorizationScopeCallbackCurrent(
        boundaryKeyRef.current,
        boundaryReadyRef.current,
        callbackBoundaryKey,
      )) return;
      client.set(key, newValue);
    },
    [callbackBoundaryKey, client, key]
  );

  return [value as T, setValue];
}

/**
 * Check if the state snapshot has been loaded from the server.
 * Rarely needed — typically <100ms gap on initial connect.
 */
export function useServerStateReady(): boolean {
  const client = useStateClient();
  const platformClient = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(platformClient);

  return useSyncExternalStore(
    useCallback(
      (cb: () => void) => authorizationBoundary.ready
        ? client.subscribe(() => cb())
        : NOOP_UNSUBSCRIBE,
      [authorizationBoundary.key, authorizationBoundary.ready, client],
    ),
    () => authorizationBoundary.ready && client.ready,
    () => false,
  );
}
