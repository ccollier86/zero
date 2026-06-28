import type { Row, ClientTableDef, JsonValue } from '../../sync/types';
import { createSyncClient } from '../../sync/client/sync-client';
import type { SyncClient } from '../../sync/client/sync-client';
import { StateClient } from '../../sync/client/state-client';
import { createStateStore, routeStateMessage } from '../../sync/client/state-store';
import { EphemeralClient } from '../../sync/client/ephemeral-client';
import { createEphemeralStore, routeEphemeralMessage } from '../../sync/client/ephemeral-store';
import { AuthClient, createAuthDisabledError } from './auth-client';
import type { AuthActionTokenInfo, AuthPublicConfig, AuthUser, RegisterParams } from './auth-client';
import { createApi } from './api';
import type { Api } from './api';
import { NOTIFICATION_TABLES } from '../../notifications/types';
import { ROOM_TABLES } from '../../rooms/types';
import { WORKFLOW_TABLES } from '../../workflows/types';
import { STORAGE_TABLES } from '../../storage/types';
import { createCollection, type Collection } from './collection';

/**
 * All platform-internal tables that hooks depend on.
 * Auto-merged into every client — apps never need to import or spread these.
 */
const PLATFORM_TABLES: Record<string, ClientTableDef> = {
  ...NOTIFICATION_TABLES,
  ...ROOM_TABLES,
  ...WORKFLOW_TABLES,
  ...STORAGE_TABLES,
};

export type { SyncClient };

export type { Collection } from './collection';

export type { AuthActionTokenInfo, AuthPublicConfig, AuthUser, RegisterParams };

// ─── FetchError ─────────────────────────────────────────────────────────────

/**
 * Thrown by `client.fetch()` and its shortcuts on non-2xx responses.
 * Carries the HTTP status and parsed response body for programmatic handling.
 */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

// ─── Fetch Types ────────────────────────────────────────────────────────────

export interface FetchInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Abort signal passed through to fetch. */
  signal?: AbortSignal;
  /** If false, returns the raw Response instead of auto-parsing JSON. */
  json?: boolean;
}

// ─── Configuration ─────────────────────────────────────────────────────────

/**
 * Accepted table definition formats:
 * - `ClientTableDef` — raw `{ _pk: 'id', title: 'text', ... }`
 * - `TableDefinition` — output of `defineTable()` (has `.clientTable`)
 */
type TableInput = ClientTableDef | { clientTable: ClientTableDef };

export interface ClientConfig {
  /** Server URL (HTTP or HTTPS). WebSocket URL derived automatically. */
  url: string;

  /**
   * Table definitions — pass `defineTable()` output directly.
   * Auto-detects format and extracts `.clientTable` when needed.
   *
   * @example
   * ```ts
   * import { tables } from './lib/schemas';
   * createClient({ url: '...', tables });
   * ```
   */
  tables?: Record<string, TableInput>;

  /** Enable auth. Default: false, matching createApp(). */
  auth?: boolean;

  /** Enable per-user state sync. Requires auth: true. Default: false */
  stateSync?: boolean;

  /** Connect WebSocket immediately. Default: true */
  autoConnect?: boolean;

  /** Max reconnect attempts. Default: Infinity */
  maxReconnectAttempts?: number;

  /** Called on unrecoverable connection error. */
  onError?: (error: string) => void;

  /** Called after successful reconnect. */
  onReconnect?: () => void;
}

// ─── Client Interface ──────────────────────────────────────────────────────

export interface Client {
  /** Server URL this client connects to. */
  readonly url: string;

  // ─── Auth (top-level shortcuts) ──────────────────────────────────

  /** Current authenticated user, or null. */
  readonly user: AuthUser | null;

  /** Whether the user is authenticated. */
  readonly isAuthenticated: boolean;

  /** Log in. Returns the authenticated user. */
  login(username: string, password: string): Promise<AuthUser>;

  /** Register a new account. Returns the authenticated user. */
  register(params: RegisterParams): Promise<AuthUser>;

  /** Load public auth config for registration/bootstrap UI decisions. */
  getAuthConfig(): Promise<AuthPublicConfig>;

  /** Request a password reset email. Always generic on success. */
  forgotPassword(email: string): Promise<void>;

  /** Inspect a reset/setup token without consuming it. */
  inspectActionToken(token: string): Promise<AuthActionTokenInfo>;

  /** Complete a password reset from an emailed reset token. */
  resetPassword(token: string, newPassword: string): Promise<AuthUser>;

  /** Complete first-password setup from an emailed setup token. */
  setupPassword(token: string, newPassword: string): Promise<AuthUser>;

  /** Log out and clear tokens. */
  logout(): Promise<void>;

  /** Current auth token (for passing to WS or other services). */
  readonly token: string | null;

  /** Change the current user's password. Issues fresh tokens on success. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  /** Refresh the access token. Deduplicates concurrent calls. */
  refresh(): Promise<void>;

  /** Set a user property (key-value). */
  setProperty(key: string, value: unknown): Promise<void>;

  /** Get a user property by key. Returns null if not found. */
  getProperty(key: string): Promise<string | null>;

  /** Get all user properties. */
  getProperties(): Promise<Record<string, string>>;

  /** Delete a user property by key. */
  deleteProperty(key: string): Promise<void>;

  // ─── HTTP (authenticated JSON fetch) ─────────────────────────────

  /**
   * Authenticated fetch with auto-JSON handling.
   * - Prepends server URL to relative paths (e.g., '/api/users' → 'http://localhost:3000/api/users')
   * - Auto-sets Content-Type and JSON.stringifies body objects
   * - Auto-parses JSON response
   * - Throws FetchError on non-2xx responses
   * - Auto-refreshes token on 401
   *
   * @example
   * ```ts
   * const { users } = await client.fetch<{ users: User[] }>('/api/users');
   * ```
   */
  fetch<T = unknown>(path: string, init?: FetchInit): Promise<T>;

  /** GET shortcut. `await client.get('/api/users')` */
  get<T = unknown>(path: string): Promise<T>;

  /** POST shortcut. `await client.post('/api/users', { name: 'Alice' })` */
  post<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** PUT shortcut. `await client.put('/api/users/1', { name: 'Bob' })` */
  put<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** PATCH shortcut. `await client.patch('/api/users/1', { role: 'admin' })` */
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;

  /** DELETE shortcut. `await client.delete('/api/users/1')` */
  delete<T = unknown>(path: string): Promise<T>;

  // ─── Typed API (Eden Treaty) ─────────────────────────────────────

  /**
   * Fully typed API client — auto-completed from server route definitions.
   * Uses Eden Treaty. Auth headers injected automatically with 401 auto-refresh.
   *
   * @example
   * ```ts
   * // Rooms
   * const { data } = await client.api.rooms.post({ name: 'Game Room' });
   * const { data: { rooms } } = await client.api.rooms.get();
   * await client.api.rooms[roomId].join.post();
   *
   * // Workflows
   * const { data } = await client.api.workflows.post({ name: 'onboarding', input: {} });
   * await client.api.workflows[id].cancel.post();
   *
   * // Auth
   * const { data: me } = await client.api.auth.me.get();
   * ```
   */
  readonly api: Api;

  // ─── Data ────────────────────────────────────────────────────────

  /** Get a typed collection for a table. */
  collection<T extends Row = Row>(name: string): Collection<T>;

  // ─── Connection ──────────────────────────────────────────────────

  /** Connect the WebSocket when autoConnect was disabled. */
  connect(): void;

  /** Whether the WebSocket is currently connected. */
  readonly connected: boolean;

  /** Subscribe to connection state changes. Returns unsubscribe. */
  onConnectionChange(callback: (connected: boolean) => void): () => void;

  /** Disconnect everything — WS, auth, state. */
  disconnect(): void;
}

/**
 * @internal Full client type — includes internal properties not in the public Client interface.
 * Used by SDK-internal code (AppProvider, hooks, room-hooks) that needs access to
 * the underlying auth, state, ephemeral, and sync clients.
 */
export interface InternalClient extends Client {
  /** @internal */
  readonly auth: AuthClient | null;
  /** @internal */
  readonly state: StateClient | null;
  /** @internal */
  readonly ephemeral: EphemeralClient;
  /** @internal */
  readonly _syncClient: SyncClient;
}

// ─── Singleton Guard ───────────────────────────────────────────────────────

let _instance: Client | null = null;

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create the SDK client. One client per app.
 *
 * Wires together:
 * - **SyncClient** — WebSocket connection, optimistic mutations, @xstate/store
 * - **AuthClient** — login/register/logout, token lifecycle, auto-refresh
 * - **StateClient** — per-user persistent KV (optional)
 * - **Collection<T>** — typed per-table API
 *
 * @example
 * ```ts
 * const client = createClient({
 *   url: 'http://localhost:3000',
 *   tables: { todos: { _pk: 'id', id: 'text', title: 'text', done: 'integer' } },
 * });
 *
 * // Auth — top-level
 * await client.login('alice', 'password123');
 * console.log(client.user?.username);
 *
 * // HTTP — one-liner authenticated requests
 * const { todos } = await client.get('/api/todos');
 * const { todo } = await client.post('/api/todos', { title: 'Buy milk' });
 * await client.patch('/api/todos/1', { done: true });
 * await client.delete('/api/todos/1');
 *
 * // Collections — real-time sync
 * const col = client.collection('todos');
 * col.insert({ id: crypto.randomUUID(), title: 'Buy milk', done: 0 });
 * ```
 */
export function createClient(config: ClientConfig): Client {
  if (_instance) {
    throw new Error(
      'createClient() called twice. Only one client per app. ' +
      'Call client.disconnect() first if you need to recreate.'
    );
  }

  const {
    url,
    tables: rawTables,
    auth: authEnabled = false,
    stateSync = false,
    autoConnect = true,
    maxReconnectAttempts,
    onError,
    onReconnect,
  } = config;

  if (stateSync && !authEnabled) {
    throw new Error('[client] stateSync requires auth: true because server state is keyed by authenticated user.');
  }

  // Normalize app tables — accept raw ClientTableDef or defineTable() output.
  // defineTable() returns { clientTable: ClientTableDef, ... } — extract .clientTable.
  const appTables: Record<string, ClientTableDef> = {};
  for (const [name, def] of Object.entries(rawTables ?? {})) {
    appTables[name] = 'clientTable' in def ? (def as { clientTable: ClientTableDef }).clientTable : def as ClientTableDef;
  }

  // Merge platform-internal tables with normalized app tables.
  // Platform tables (notifications, rooms, workflows, storage) are
  // auto-registered so apps never need to import or spread them.
  // App tables spread last so they can override if needed.
  const tables: Record<string, ClientTableDef> = {
    ...PLATFORM_TABLES,
    ...appTables,
  };

  // ─── Auth ─────────────────────────────────────────────────────────
  const authClient = authEnabled ? new AuthClient(url) : null;

  function requireAuthClient(): AuthClient {
    if (!authClient) throw createAuthDisabledError();
    return authClient;
  }

  // ─── Derive WS URL ────────────────────────────────────────────────
  function getWsUrl(): string {
    const u = new URL(url);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/sync';
    const token = authClient?.accessToken;
    if (token) u.searchParams.set('token', token);
    return u.toString();
  }

  // ─── Sync Client (always created — owns the WebSocket) ────────────
  const syncClient: SyncClient = createSyncClient({
    url: getWsUrl(),
    tables,
    token: authClient?.accessToken ?? undefined,
    autoConnect,
    onError,
    onReconnect,
    maxReconnectAttempts,
  });

  // ─── State Client (optional) ──────────────────────────────────────
  let stateClient: StateClient | null = null;
  if (stateSync) {
    const stateStore = createStateStore();
    stateClient = new StateClient(
      (msg) => syncClient.sendRaw(msg),
      stateStore
    );

    // Route incoming state messages from WS to state store + client
    syncClient.onMessage((msg) => {
      const handled = routeStateMessage(stateStore, msg);
      if (handled) {
        // Notify StateClient subscribers for remote changes
        if (msg.type === 'state.snapshot') {
          stateClient!.handleSnapshot();
        } else if (msg.type === 'state.change') {
          stateClient!.handleRemoteChange(
            msg.op as 'set' | 'delete' | 'clear',
            msg.key as string | null,
            msg.value as JsonValue | undefined,
          );
        }
      }
    });
  }

  // ─── Ephemeral Client (always created) ───────────────────────────
  const ephemeralStore = createEphemeralStore();
  const ephemeralClient = new EphemeralClient(
    (msg) => syncClient.sendRaw(msg),
    ephemeralStore
  );

  // Route incoming ephemeral messages from WS to ephemeral store
  syncClient.onMessage((msg) => {
    routeEphemeralMessage(ephemeralStore, msg);
  });

  // ─── Collection Cache ─────────────────────────────────────────────
  const collections = new Map<string, Collection<any>>();

  function getCollection<T extends Row>(name: string): Collection<T> {
    if (!tables[name]) throw new Error(`Unknown table: ${name}`);

    let col = collections.get(name);
    if (col) return col as Collection<T>;

    col = createCollection<T>(name, syncClient, tables[name]);
    collections.set(name, col);
    return col as Collection<T>;
  }

  // ─── Authenticated Fetch ────────────────────────────────────────
  async function clientFetch<T = unknown>(path: string, init?: FetchInit): Promise<T> {
    const fullUrl = path.startsWith('http') ? path : `${url}${path}`;
    const hasBody = init?.body !== undefined && init?.body !== null;

    const requestInit: RequestInit = {
      method: init?.method ?? (hasBody ? 'POST' : 'GET'),
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: init?.signal,
      ...(hasBody ? { body: JSON.stringify(init!.body) } : {}),
    };

    const res = authClient
      ? await authClient.fetchWithAuth(fullUrl, requestInit)
      : await fetch(fullUrl, requestInit);

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const message = (body as Record<string, unknown>)?.error ?? res.statusText;
      throw new FetchError(String(message), res.status, body);
    }

    if (init?.json === false) return res as unknown as T;

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // ─── Eden Treaty API ────────────────────────────────────────────
  const api = createApi(url, authClient);

  // ─── Client Instance ──────────────────────────────────────────────
  const client = {
    get url() { return url; },
    /** @internal */
    get auth() { return authClient; },
    get state() { return stateClient; },
    get ephemeral() { return ephemeralClient; },

    /** The underlying SyncClient — exposed for SyncProvider wiring. */
    get _syncClient() { return syncClient; },

    // ─── Typed API ─────────────────────────────────────────────────
    get api() { return api; },

    // ─── Auth (top-level) ──────────────────────────────────────────
    get user() { return authClient?.user ?? null; },
    get isAuthenticated() { return authClient?.isAuthenticated ?? false; },
    get token() { return authClient?.accessToken ?? null; },
    login: async (username: string, password: string) => requireAuthClient().login(username, password),
    register: async (params: RegisterParams) => requireAuthClient().register(params),
    getAuthConfig: async () => requireAuthClient().getConfig(),
    forgotPassword: async (email: string) => requireAuthClient().forgotPassword(email),
    inspectActionToken: async (token: string) => requireAuthClient().inspectActionToken(token),
    resetPassword: async (token: string, newPassword: string) => requireAuthClient().resetPassword(token, newPassword),
    setupPassword: async (token: string, newPassword: string) => requireAuthClient().setupPassword(token, newPassword),
    logout: async () => requireAuthClient().logout(),
    changePassword: async (currentPassword: string, newPassword: string) => requireAuthClient().changePassword(currentPassword, newPassword),
    refresh: async () => { await requireAuthClient().refresh(); },
    setProperty: async (key: string, value: unknown) => requireAuthClient().setProperty(key, value),
    getProperty: async (key: string) => requireAuthClient().getProperty(key),
    getProperties: async () => requireAuthClient().getProperties(),
    deleteProperty: async (key: string) => requireAuthClient().deleteProperty(key),

    // ─── HTTP ──────────────────────────────────────────────────────
    fetch: clientFetch,
    get: <T = unknown>(path: string) => clientFetch<T>(path, { method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'POST', body }),
    put: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'PUT', body }),
    patch: <T = unknown>(path: string, body?: unknown) => clientFetch<T>(path, { method: 'PATCH', body }),
    delete: <T = unknown>(path: string) => clientFetch<T>(path, { method: 'DELETE' }),

    // ─── Data ──────────────────────────────────────────────────────
    collection<T extends Row>(name: string): Collection<T> {
      return getCollection<T>(name);
    },

    get connected() {
      return syncClient.connected;
    },

    connect() {
      syncClient.connect();
    },

    onConnectionChange(callback: (connected: boolean) => void): () => void {
      let prev = syncClient.connected;
      const sub = syncClient.store.subscribe(() => {
        const next = syncClient.connected;
        if (next !== prev) {
          prev = next;
          callback(next);
        }
      });
      return () => sub.unsubscribe();
    },

    disconnect() {
      syncClient.disconnect();
      stateClient?.dispose();
      ephemeralClient.dispose();
      collections.clear();
      _instance = null;
    },
  };

  _instance = client;
  return client;
}

/**
 * Get the current client instance, or null if not created.
 * Useful for accessing the client outside React (e.g., in route loaders).
 */
export function getClient(): Client | null {
  return _instance;
}
