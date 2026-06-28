import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  createElement,
} from 'react';
import type { ReactNode } from 'react';
import type { Row } from '../../sync/types';
import type { Client, ClientConfig, InternalClient } from './sdk';
import type {
  AuthActionTokenInfo,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthPublicConfig,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
} from './auth-client';
import { createClient, getClient } from './sdk';
import { createAuthDisabledError } from './auth-client';

export type {
  AuthActionTokenInfo,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthPublicConfig,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
};

// Re-export state hooks
export { useServerState, useServerStateReady } from '../../sync/client/state-hooks';

// Re-export router hooks
export { useParams, usePathname, useRouter } from './router-context';

// ─── Client Context ────────────────────────────────────────────────────────

const ClientContext = createContext<Client | null>(null);

function shouldUseSsrFallback(client: Client | null, hookName: string): boolean {
  if (client) return false;

  if (typeof window !== 'undefined') {
    throw new Error(`${hookName} must be used within <AppProvider> or <ClientProvider>.`);
  }

  return true;
}

/**
 * Returns true when running on the server (SSR).
 * During SSR, client-only hooks return safe defaults instead of throwing.
 */
export function useIsServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Get the SDK client from context.
 *
 * During SSR, returns null (no ClientProvider exists on the server).
 * Client-only hooks that depend on this should check for null and
 * return safe defaults during SSR. After hydration, always returns
 * the client instance.
 */
export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client && typeof window !== 'undefined') {
    throw new Error('useClient must be used within <AppProvider> or <ClientProvider>.');
  }
  return client!;
}

/**
 * Safe version of useClient that returns null during SSR
 * instead of throwing. Use this in components that need to
 * render on both server and client.
 */
export function useClientMaybe(): Client | null {
  return useContext(ClientContext);
}

// ─── Client Provider ───────────────────────────────────────────────────────

export interface ClientProviderProps {
  /** Pre-created client instance, OR config to create one. */
  client?: Client;
  /** Config to auto-create a client (ignored if `client` is provided). */
  config?: ClientConfig;
  children: ReactNode;
}

/**
 * Provides the SDK client to all descendant hooks.
 *
 * @example
 * ```tsx
 * // Option 1: pass config — creates client automatically
 * <ClientProvider config={{ url: 'http://localhost:3000', tables }}>
 *   <App />
 * </ClientProvider>
 *
 * // Option 2: pass pre-created client
 * const client = createClient({ url, tables });
 * <ClientProvider client={client}>
 *   <App />
 * </ClientProvider>
 * ```
 */
export function ClientProvider({ client: clientProp, config, children }: ClientProviderProps) {
  const clientRef = useRef<Client | null>(null);

  if (!clientRef.current) {
    if (clientProp) {
      clientRef.current = clientProp;
    } else if (config) {
      clientRef.current = getClient() ?? createClient(config);
    } else {
      throw new Error('ClientProvider requires either `client` or `config` prop');
    }
  }

  return createElement(ClientContext.Provider, { value: clientRef.current }, children);
}

// ─── useAuth ───────────────────────────────────────────────────────────────

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  login: (username: string, password: string) => Promise<void>;
  register: (params: RegisterParams) => Promise<void>;
  getConfig: () => Promise<AuthPublicConfig | null>;
  forgotPassword: (email: string) => Promise<void>;
  inspectActionToken: (token: string) => Promise<AuthActionTokenInfo | null>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  setupPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setProperty: (key: string, value: unknown) => Promise<void>;
  getProperty: (key: string) => Promise<string | null>;
  getProperties: () => Promise<Record<string, string>>;
  deleteProperty: (key: string) => Promise<void>;
}

/** SSR-safe no-op defaults for auth hooks. Actions are no-ops that resolve immediately. */
const SSR_AUTH_NOOP = async () => {};
const SSR_AUTH_DEFAULTS: AuthState & AuthActions = {
  user: null,
  isAuthenticated: false,
  isLoading: false, // must match AuthClient's initial state (false until refresh token found)
  error: null,
  login: SSR_AUTH_NOOP as any,
  register: SSR_AUTH_NOOP as any,
  getConfig: async () => null,
  forgotPassword: SSR_AUTH_NOOP as any,
  inspectActionToken: async () => null,
  resetPassword: SSR_AUTH_NOOP as any,
  setupPassword: SSR_AUTH_NOOP as any,
  logout: SSR_AUTH_NOOP as any,
  refresh: SSR_AUTH_NOOP as any,
  changePassword: SSR_AUTH_NOOP as any,
  setProperty: SSR_AUTH_NOOP as any,
  getProperty: async () => null,
  getProperties: async () => ({}),
  deleteProperty: SSR_AUTH_NOOP as any,
};

/**
 * Full auth state + actions from the shared client.
 * All components share the same auth state — login in one,
 * every other component sees it instantly.
 *
 * SSR-safe: returns loading defaults on the server so components
 * can render a loading state without throwing.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   const { user, isAuthenticated, isLoading, error, login, logout } = useAuth();
 *   if (isAuthenticated) return <p>Hello, {user!.username}</p>;
 *   return <button onClick={() => login('admin', 'password')}>Login</button>;
 * }
 * ```
 */
// Stable no-op for useSyncExternalStore subscribe during SSR
const NOOP_UNSUB = () => {};
const SSR_AUTH_SNAPSHOT = { user: null, accessToken: null, refreshToken: null, isLoading: false as boolean, error: null };

export function useAuth(): AuthState & AuthActions {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authDisabled = client !== null && authClient === null;

  // All hooks called unconditionally (Rules of Hooks)
  const subscribe = useCallback(
    (cb: () => void) => authClient ? authClient.subscribe(cb) : NOOP_UNSUB,
    [authClient],
  );

  const state = useSyncExternalStore(
    subscribe,
    () => authClient ? authClient.store.getSnapshot().context : SSR_AUTH_SNAPSHOT,
    () => SSR_AUTH_SNAPSHOT,
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (authClient) await authClient.login(username, password);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const register = useCallback(
    async (params: RegisterParams) => {
      if (authClient) await authClient.register(params);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const logout = useCallback(
    async () => {
      if (authClient) await authClient.logout();
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const getConfig = useCallback(
    async () => {
      if (authClient) return authClient.getConfig();
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const forgotPassword = useCallback(
    async (email: string) => {
      if (authClient) await authClient.forgotPassword(email);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const inspectActionToken = useCallback(
    async (token: string) => {
      if (authClient) return authClient.inspectActionToken(token);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const resetPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (authClient) await authClient.resetPassword(token, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const setupPassword = useCallback(
    async (token: string, newPassword: string) => {
      if (authClient) await authClient.setupPassword(token, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const refresh = useCallback(
    async () => {
      if (authClient) await authClient.refresh();
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (authClient) await authClient.changePassword(currentPassword, newPassword);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const setProperty = useCallback(
    async (key: string, value: unknown) => {
      if (authClient) await authClient.setProperty(key, value);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  const getProperty = useCallback(
    async (key: string) => {
      if (authClient) return authClient.getProperty(key);
      if (authDisabled) throw createAuthDisabledError();
      return null;
    },
    [authClient, authDisabled],
  );

  const getProperties = useCallback(
    async () => {
      if (authClient) return authClient.getProperties();
      if (authDisabled) throw createAuthDisabledError();
      return {};
    },
    [authClient, authDisabled],
  );

  const deleteProperty = useCallback(
    async (key: string) => {
      if (authClient) await authClient.deleteProperty(key);
      else if (authDisabled) throw createAuthDisabledError();
    },
    [authClient, authDisabled],
  );

  if (!authClient && !authDisabled && shouldUseSsrFallback(client, 'useAuth')) {
    return SSR_AUTH_DEFAULTS;
  }

  return {
    user: state.user,
    isAuthenticated: state.user !== null,
    isLoading: state.isLoading,
    error: state.error,
    login,
    register,
    getConfig,
    forgotPassword,
    inspectActionToken,
    resetPassword,
    setupPassword,
    logout,
    refresh,
    changePassword,
    setProperty,
    getProperty,
    getProperties,
    deleteProperty,
  };
}

export interface AuthConfigState {
  config: AuthPublicConfig | null;
  isLoading: boolean;
  error: string | null;
  canRegister: boolean;
  bootstrapRequired: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads the public auth config used by auth UI to mirror backend policy.
 *
 * Returns null config during SSR or when auth has not been configured yet.
 * Components should treat a loaded `canRegister: false` as authoritative.
 */
export function useAuthConfig(): AuthConfigState {
  const client = useClientMaybe() as InternalClient | null;
  const authClient = client?.auth ?? null;
  const authDisabled = client !== null && authClient === null;
  const [config, setConfig] = useState<AuthPublicConfig | null>(null);
  const [isLoading, setIsLoading] = useState(() => authClient !== null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!authClient) {
      setConfig(null);
      setIsLoading(false);
      setError(authDisabled ? createAuthDisabledError().message : null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      setConfig(await authClient.getConfig());
    } catch (err) {
      setConfig(null);
      setError(err instanceof Error ? err.message : 'Failed to load auth config');
    } finally {
      setIsLoading(false);
    }
  }, [authClient, authDisabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (shouldUseSsrFallback(client, 'useAuthConfig')) {
    return {
      config: null,
      isLoading: false,
      error: null,
      canRegister: false,
      bootstrapRequired: false,
      reload,
    };
  }

  return {
    config,
    isLoading,
    error,
    canRegister: config?.registration.publicRegistrationEnabled ?? false,
    bootstrapRequired: config?.registration.bootstrapRequired ?? false,
    reload,
  };
}

/**
 * Shorthand — just the current user or null.
 */
export function useCurrentUser(): AuthUser | null {
  const { user } = useAuth();
  return user;
}

/**
 * Require authentication. Redirects to the given path if not authenticated.
 * Returns the authenticated user (non-null) or null during redirect.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const user = useRequireAuth('/login');
 *   if (!user) return null; // redirecting...
 *   return <h1>Welcome, {user.username}</h1>;
 * }
 * ```
 */
export function useRequireAuth(redirectTo = '/login'): AuthUser | null {
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && typeof window !== 'undefined') {
      window.history.pushState(null, '', redirectTo);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [isLoading, isAuthenticated, redirectTo]);

  return user;
}

// ─── useCollection ─────────────────────────────────────────────────────────

export interface CollectionResult<T extends Row> {
  /** All rows as an array. */
  data: T[];
  /** All rows as a map (id → row) for O(1) lookups. */
  byId: Record<string, T>;
  /** Number of rows. */
  count: number;
  /** Insert a new row. */
  insert: (row: T) => void;
  /** Update a row by ID. */
  update: (id: string, partial: Partial<T>) => void;
  /** Remove a row by ID. */
  remove: (id: string) => void;
  /** Bulk-load rows into the store (for lazy tables). Merges by default. */
  load: (rows: T[], options?: { replace?: boolean }) => void;
  /** Clear all rows from this table in the local store. */
  clear: () => void;
}

/**
 * Primary hook for reactive data with built-in mutations.
 *
 * - **Reads**: `data`, `byId`, `count` — reactive, re-renders on changes
 * - **Writes**: `insert`, `update`, `remove` — optimistic, synced to server
 * - **Lazy**: `load`, `clear` — for lazy-synced tables
 *
 * PK is auto-generated on insert if not provided.
 *
 * @example
 * ```tsx
 * const { data, insert, update, remove } = useCollection<Todo>('todos');
 *
 * insert({ title: 'Buy milk', done: 0 });          // PK auto-generated
 * update(todoId, { done: 1 });
 * remove(todoId);
 * ```
 */
const EMPTY_RECORD: Record<string, never> = {};
const EMPTY_ARRAY: never[] = [];

export function useCollection<T extends Row = Row>(name: string): CollectionResult<T> {
  const client = useClientMaybe();
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const byId = useSyncExternalStore(
    subscribe,
    () => col ? col.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const data = useMemo(() => col ? Object.values(byId) : EMPTY_ARRAY as T[], [byId, col]);

  const insert = useCallback((row: T) => col?.insert(row), [col]);
  const update = useCallback((id: string, partial: Partial<T>) => col?.update(id, partial), [col]);
  const remove = useCallback((id: string) => col?.remove(id), [col]);
  const load = useCallback((r: T[], opts?: { replace?: boolean }) => col?.load(r, opts), [col]);
  const clear = useCallback(() => col?.clear(), [col]);

  shouldUseSsrFallback(client, 'useCollection');

  return { data, byId, count: data.length, insert, update, remove, load, clear };
}

// ─── useLazyCollection ──────────────────────────────────────────────────────

export interface LazyCollectionResult<T extends Row> extends CollectionResult<T> {
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export interface LazyCollectionOptions {
  /** Column to sort by. Defaults to backend table order when omitted. */
  order?: string;
  /** Sort direction for `order`. Defaults to `desc` on the backend. */
  dir?: 'asc' | 'desc';
  /** Maximum number of rows to fetch. Capped by backend `/api/data` limits. */
  limit?: number;
  /** Number of matching rows to skip for offset pagination. */
  offset?: number;
}

/**
 * Hook for lazy-synced tables. Fetches rows from the platform's
 * `/api/data` endpoint on mount, loads them into the reactive store,
 * then returns the live collection.
 *
 * After initial load, WebSocket changes still arrive in real-time.
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useLazyCollection<ClientRow>('clients');
 *
 * // With filters:
 * const { data: notes } = useLazyCollection<NoteRow>('client_notes', {
 *   client_id: clientId,
 * });
 * ```
 */
export function useLazyCollection<T extends Row = Row>(
  table: string,
  filters?: Record<string, string>,
  opts?: LazyCollectionOptions,
): LazyCollectionResult<T> {
  const client = useClientMaybe();
  const collection = useCollection<T>(table);
  const { load } = collection;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadedRef = useRef<string>('');
  const requestIdRef = useRef(0);

  const filterKey = filters
    ? Object.entries(filters).sort().map(([k, v]) => `${k}:${v}`).join('|')
    : '';
  const cacheKey = [
    table,
    filterKey,
    opts?.order ?? '',
    opts?.dir ?? '',
    opts?.limit ?? '',
    opts?.offset ?? '',
  ].join('|');

  const doFetch = useCallback(() => {
    if (!client) return;
    const requestId = ++requestIdRef.current;

    const params = new URLSearchParams({ table });
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        params.append('filter', `${field}:${value}`);
      }
    }
    if (opts?.order) params.set('order', opts.order);
    if (opts?.dir) params.set('dir', opts.dir);
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset));

    setIsLoading(true);
    setError(null);

    client.get<{ rows: T[] }>(`/api/data?${params}`)
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        load(data.rows, { replace: !!filters });
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setIsLoading(false);
      });
  }, [client, table, filterKey, opts?.order, opts?.dir, opts?.limit, opts?.offset, load]);

  useEffect(() => {
    if (!client) return;
    if (loadedRef.current === cacheKey) return;
    loadedRef.current = cacheKey;
    doFetch();
  }, [client, cacheKey, doFetch]);

  const refresh = useCallback(() => {
    loadedRef.current = '';
    doFetch();
  }, [doFetch]);

  shouldUseSsrFallback(client, 'useLazyCollection');

  return { ...collection, isLoading, error, refresh };
}

// ─── useRow ─────────────────────────────────────────────────────────────────

/**
 * Live-updating single row hook. Re-renders when the row changes.
 * Returns `null` if the row doesn't exist.
 *
 * @example
 * ```tsx
 * function TodoDetail({ id }: { id: string }) {
 *   const todo = useRow<Todo>('todos', id);
 *   if (!todo) return <p>Not found</p>;
 *   return <h1>{todo.title}</h1>;
 * }
 * ```
 */
export function useRow<T extends Row = Row>(name: string, id: string): T | null {
  const client = useClientMaybe();
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const row = useSyncExternalStore(
    subscribe,
    () => col ? col.getOne(id) : null,
    () => null,
  );

  shouldUseSsrFallback(client, 'useRow');

  return row;
}

// ─── useQuery ───────────────────────────────────────────────────────────────

/**
 * Live-updating filtered collection. Re-renders when matching rows change.
 *
 * @example
 * ```tsx
 * function CompletedTodos() {
 *   const done = useQuery<Todo>('todos', todo => todo.done === 1);
 *   return <ul>{done.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
 * }
 * ```
 */
export function useQuery<T extends Row = Row>(
  name: string,
  predicate: (row: T) => boolean,
): T[] {
  const client = useClientMaybe();
  const col = useMemo(() => client?.collection<T>(name) ?? null, [client, name]);

  const subscribe = useCallback(
    (cb: () => void) => col ? col.subscribe(cb) : NOOP_UNSUB,
    [col],
  );

  const rows = useSyncExternalStore(
    subscribe,
    () => col ? col.getAll() : EMPTY_RECORD as Record<string, T>,
    () => EMPTY_RECORD as Record<string, T>,
  );

  const result = useMemo(
    () => col ? Object.values(rows).filter(predicate) : EMPTY_ARRAY as T[],
    [rows, predicate, col],
  );

  shouldUseSsrFallback(client, 'useQuery');

  return result;
}

// ─── useStatus ─────────────────────────────────────────────────────────────

/**
 * Subscribe to WebSocket connection state.
 */
export function useStatus(): { connected: boolean } {
  const client = useClientMaybe();

  const subscribe = useCallback(
    (cb: () => void) => client ? client.onConnectionChange(cb) : NOOP_UNSUB,
    [client],
  );

  const connected = useSyncExternalStore(
    subscribe,
    () => client ? client.connected : false,
    () => false,
  );

  const status = useMemo(() => ({ connected }), [connected]);

  shouldUseSsrFallback(client, 'useStatus');

  return status;
}

// ─── Notification Hooks ───────────────────────────────────────────────────────

export {
  useNotifications,
  useUnreadCount,
  useOnNewNotification,
} from './notification-hooks';
export type {
  Notification,
  NotificationReceipt,
  NotificationWithStatus,
  UseNotificationsResult,
} from './notification-hooks';

// ─── Room + Presence Hooks ────────────────────────────────────────────────────

export {
  useRoom,
  useRoomMembers,
  useRooms,
  useRoomActions,
  useRoomData,
  usePresence,
} from './room-hooks';
export type {
  UseRoomResult,
  RoomActions,
  PresenceMember,
  UsePresenceResult,
} from './room-hooks';

// ─── Ephemeral Hooks (re-exported from sync/client) ─────────────────────────

export { useEphemeral, useEphemeralTopic } from '../../sync/client/ephemeral-hooks';
