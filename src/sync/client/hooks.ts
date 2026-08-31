import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createElement,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import type { Row, ClientTableDef, SyncClientConfig } from '../types';
import type { SyncClient } from './sync-client';
import { createSyncClient } from './sync-client';
import type { SyncStoreContext } from './sync-store';
import type { StateClient } from './state-client';
import type { EphemeralClient } from './ephemeral-client';

// ─── Context ───────────────────────────────────────────────────────────────

export interface SyncContextValue {
  syncClient: SyncClient;
  stateClient: StateClient | null;
  ephemeralClient: EphemeralClient | null;
}

export const SyncContext = createContext<SyncContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────

export interface SyncProviderProps {
  /** WebSocket URL (e.g., 'ws://localhost:3000/sync'). Required if `client` not provided. */
  url?: string;
  /** Table definitions. Required if `client` not provided. */
  tables?: Record<string, ClientTableDef>;
  /** Auth token */
  token?: string;
  /** Async access-token provider, such as NativeAuthClient.getAccessToken. */
  getToken?: SyncClientConfig['getToken'];
  /** Force refreshed authentication after a 4001 close. */
  refreshAuth?: SyncClientConfig['refreshAuth'];
  /** Bind auth transitions to socket and cache lifecycle. */
  bindAuthLifecycle?: SyncClientConfig['bindAuthLifecycle'];
  /** Pre-existing SyncClient (from SDK client._syncClient). Skips internal creation. */
  client?: SyncClient;
  /** Pre-existing StateClient (from SDK client.state). */
  stateClient?: StateClient | null;
  /** Pre-existing EphemeralClient (from SDK client.ephemeral). */
  ephemeralClient?: EphemeralClient | null;
  /** Callback on unrecoverable error */
  onError?: (error: string) => void;
  /** Callback after reconnect */
  onReconnect?: () => void;
  /** Mutation ack timeout in ms */
  ackTimeout?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Children */
  children: ReactNode;
}

/**
 * React context provider that wraps a SyncClient for all sync hooks.
 *
 * Can either accept a pre-existing SyncClient (from the SDK client)
 * or create one internally from url + tables.
 */
export function SyncProvider({
  url,
  tables,
  token,
  getToken,
  refreshAuth,
  bindAuthLifecycle,
  client: existingClient,
  stateClient: existingStateClient,
  ephemeralClient: existingEphemeralClient,
  onError,
  onReconnect,
  ackTimeout,
  maxReconnectAttempts,
  children,
}: SyncProviderProps) {
  const ctxRef = useRef<SyncContextValue | null>(null);
  const ownsClient = useRef(false);

  // Create or reuse client on first render
  if (!ctxRef.current) {
    if (existingClient) {
      // Reuse existing SyncClient (e.g., from SDK client._syncClient)
      ctxRef.current = { syncClient: existingClient, stateClient: existingStateClient ?? null, ephemeralClient: existingEphemeralClient ?? null };
      ownsClient.current = false;
    } else if (url && tables) {
      // Create our own SyncClient
      const syncClient = createSyncClient({
        url,
        tables,
        token,
        getToken,
        refreshAuth,
        bindAuthLifecycle,
        onError,
        onReconnect,
        ackTimeout,
        maxReconnectAttempts,
      });
      ctxRef.current = { syncClient, stateClient: null, ephemeralClient: null };
      ownsClient.current = true;
    } else {
      throw new Error('SyncProvider requires either `client` or `url` + `tables` props');
    }
  }

  // Only disconnect on unmount if we own the client
  useEffect(() => {
    return () => {
      if (ownsClient.current) {
        ctxRef.current?.syncClient.disconnect();
        ctxRef.current?.stateClient?.dispose();
        ctxRef.current?.ephemeralClient?.dispose();
      }
      ctxRef.current = null;
    };
  }, []);

  return createElement(
    SyncContext.Provider,
    { value: ctxRef.current },
    children
  );
}

// ─── useSyncClient ─────────────────────────────────────────────────────────

/**
 * Access the SyncClient from context. Throws if used outside SyncProvider.
 */
export function useSyncClient(): SyncClient {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSyncClient must be used within a <SyncProvider>');
  }
  return ctx.syncClient;
}

// ─── Store subscription helpers ────────────────────────────────────────────

/**
 * Subscribe to the @xstate/store for useSyncExternalStore.
 * Adapts the Subscription-based API to the callback-based API React expects.
 */
function useStoreSubscribe(client: SyncClient) {
  return useCallback(
    (onStoreChange: () => void) => {
      const subscription = client.store.subscribe(onStoreChange);
      return () => subscription.unsubscribe();
    },
    [client]
  );
}

function getStoreContext(client: SyncClient): SyncStoreContext {
  return client.store.getSnapshot().context as SyncStoreContext;
}

// ─── useTable ──────────────────────────────────────────────────────────────

export interface UseTableResult<T extends Row> {
  /** All rows keyed by primary key */
  rows: Record<string, T>;
  /** Optimistic insert + send to server */
  insert: (row: T) => void;
  /** Optimistic update + send to server */
  update: (id: string, partial: Partial<T>) => void;
  /** Optimistic delete + send to server */
  remove: (id: string) => void;
}

/**
 * Subscribe to an entire table. Returns all rows plus mutation functions.
 *
 * Re-renders when any row in the table changes. For single-row updates
 * in large tables, prefer `useRow()`.
 */
export function useTable<T extends Row = Row>(
  tableName: string
): UseTableResult<T> {
  const client = useSyncClient();
  const subscribe = useStoreSubscribe(client);

  const getSnapshot = useCallback(
    () => getStoreContext(client)[tableName] as Record<string, T>,
    [client, tableName]
  );

  const rows = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const insert = useCallback(
    (row: T) => client.insert(tableName, row),
    [client, tableName]
  );

  const update = useCallback(
    (id: string, partial: Partial<T>) => client.update(tableName, id, partial),
    [client, tableName]
  );

  const remove = useCallback(
    (id: string) => client.delete(tableName, id),
    [client, tableName]
  );

  return { rows, insert, update, remove };
}

// ─── useRow ────────────────────────────────────────────────────────────────

export interface UseRowResult<T extends Row> {
  /** The row, or null if it doesn't exist */
  row: T | null;
  /** Optimistic update + send to server */
  update: (partial: Partial<T>) => void;
  /** Optimistic delete + send to server */
  remove: () => void;
}

/**
 * Subscribe to a single row by primary key. Only re-renders when
 * that specific row changes — other rows in the same table don't
 * trigger re-renders.
 */
export function useRow<T extends Row = Row>(
  tableName: string,
  id: string
): UseRowResult<T> {
  const client = useSyncClient();
  const subscribe = useStoreSubscribe(client);

  const getSnapshot = useCallback(
    () =>
      ((getStoreContext(client)[tableName] as Record<string, T>)?.[id] ??
        null) as T | null,
    [client, tableName, id]
  );

  const row = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback(
    (partial: Partial<T>) => client.update(tableName, id, partial),
    [client, tableName, id]
  );

  const remove = useCallback(
    () => client.delete(tableName, id),
    [client, tableName, id]
  );

  return { row, update, remove };
}

// ─── useQuery ──────────────────────────────────────────────────────────────

/**
 * Client-side filtered view of a table. Only re-renders when the
 * filtered result changes (shallow array comparison).
 *
 * The filter function should be stable — wrap it in `useCallback`
 * or define it outside the component.
 */
export function useQuery<T extends Row = Row>(
  tableName: string,
  filterFn: (row: T) => boolean
): T[] {
  const client = useSyncClient();
  const subscribe = useStoreSubscribe(client);

  const prevRef = useRef<T[]>([]);

  const selector = useMemo(
    () => (ctx: SyncStoreContext) => {
      const table = ctx[tableName] as Record<string, T> | undefined;
      if (!table) return [];
      return Object.values(table).filter(filterFn);
    },
    [tableName, filterFn]
  );

  const getSnapshot = useCallback(() => {
    const next = selector(getStoreContext(client));
    if (shallowArrayEqual(prevRef.current, next)) {
      return prevRef.current;
    }
    prevRef.current = next;
    return next;
  }, [client, selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── useSyncStatus ─────────────────────────────────────────────────────────

export interface SyncStatus {
  /** Whether the WebSocket is connected */
  connected: boolean;
  /** Number of pending (unacked) optimistic mutations */
  pending: number;
}

/**
 * Subscribe to connection status and pending mutation count.
 * Memoized — only re-renders when connected or pending count changes.
 */
export function useSyncStatus(): SyncStatus {
  const client = useSyncClient();
  const subscribe = useStoreSubscribe(client);

  const prevRef = useRef<SyncStatus>({ connected: false, pending: 0 });

  const getSnapshot = useCallback(() => {
    const sync = getStoreContext(client)._sync;
    const next: SyncStatus = {
      connected: sync.connected,
      pending: sync.pending.length,
    };

    if (
      next.connected === prevRef.current.connected &&
      next.pending === prevRef.current.pending
    ) {
      return prevRef.current;
    }

    prevRef.current = next;
    return next;
  }, [client]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Shallow array equality check — same items (by reference) in same order.
 * Used by useQuery to avoid unnecessary re-renders.
 */
function shallowArrayEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
