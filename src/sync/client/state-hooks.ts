import { useSyncExternalStore, useCallback, useContext } from 'react';
import type { JsonValue } from '../types';
import type { StateClient } from './state-client';
import { SyncContext } from './hooks';

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

  const value = useSyncExternalStore(
    (cb) => client.subscribe(key, cb),
    () => client.get(key, defaultValue),
    () => defaultValue,
  );

  const setValue = useCallback(
    (newValue: T) => client.set(key, newValue),
    [client, key]
  );

  return [value as T, setValue];
}

/**
 * Check if the state snapshot has been loaded from the server.
 * Rarely needed — typically <100ms gap on initial connect.
 */
export function useServerStateReady(): boolean {
  const client = useStateClient();

  return useSyncExternalStore(
    (cb) => client.subscribe((event) => cb()),
    () => client.ready,
    () => false,
  );
}
