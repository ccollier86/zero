import type { Database, Statement } from 'bun:sqlite';
import type { PlatformSQLiteService, SQLiteStorageConfig } from '../persistence';
import type { SyncPolicy } from './sync-policy';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * ReactiveDB configuration.
 *
 * Prefer `sqlite` or `database` when the platform runtime already owns the
 * SQL service. Legacy `mode: 'memory'` and file-path configs remain valid and
 * are routed through the platform persistence foundation internally.
 */
export interface ReactiveDBConfig extends SQLiteStorageConfig {
  /** Platform-owned SQLite service. Preferred for createApp/runtime wiring. */
  sqlite?: PlatformSQLiteService;

  /** Existing Bun SQLite handle. Caller owns PRAGMAs and lifecycle by default. */
  database?: Database;

  /**
   * Legacy mode or new platform storage mode.
   *
   * `memory` and `:memory:` map to ephemeral. Arbitrary strings are treated as
   * SQLite file paths for compatibility.
   */
  mode?: SQLiteStorageConfig['mode'];

  /**
   * Close an injected raw `database` during dispose. Ignored for `sqlite`,
   * where the service owner controls lifecycle. Default: false.
   */
  ownsDatabase?: boolean;

  /**
   * Clear the process-local `_changes` ring buffer during startup.
   *
   * Defaults to true for durable/hot modes and false for ephemeral modes.
   */
  clearChangesOnStart?: boolean;

  /** Ring buffer depth for reconnect replay. Default: 1000 */
  ringBufferDepth?: number;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

/**
 * Table schema definition.
 * Maps column names to SQLite column definitions.
 *
 * The first column whose definition includes 'primary key' (case-insensitive)
 * is treated as the sync primary key. `_identity` optionally declares a
 * natural/business identity whose fields get a unique index and deterministic
 * sync primary key generation.
 *
 * @example
 * {
 *   id: 'text primary key',
 *   title: 'text not null',
 *   done: 'integer default 0',
 * }
 */
export interface TableSchema {
  /** Ordered natural identity fields used for deterministic sync ids. */
  _identity?: string[];
  /** SQLite column definitions (name → SQL column definition). */
  [column: string]: string | string[] | undefined;
}

/**
 * A row of data from any table. Keys are column names.
 */
export type Row = Record<string, unknown>;

/** Resolved table sync behavior used by the client and server. */
export type SyncMode = 'full' | 'lazy';

/** User-declared table sync behavior before startup auto-resolution. */
export type DeclaredSyncMode = SyncMode | 'auto';

// ─── Change Tracking ────────────────────────────────────────────────────────

/** The mutation operation type. */
export type ChangeOp = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * A single tracked change emitted by ReactiveDB.
 * Represents one mutation (insert, update, or delete) on one row.
 */
export interface Change {
  /** Global monotonic sequence number (unique within process lifetime) */
  seq: number;

  /** Name of the table that was mutated */
  table: string;

  /** The type of mutation */
  op: ChangeOp;

  /** Primary key value of the affected row */
  rowId: string;

  /** Full row after mutation (null for DELETE) */
  row: Row | null;

  /** Full row before mutation, used internally for filtered DELETE fanout. */
  previousRow?: Row | null;

  /** Server timestamp in milliseconds (Date.now()) */
  ts: number;
}

/** Listener function for change events. */
export type ChangeListener = (change: Change) => void;

// ─── Internal ───────────────────────────────────────────────────────────────

/**
 * Internal table metadata created by defineTable().
 * Holds the prepared CRUD statements and column metadata.
 */
export interface TableDef {
  /** Table name */
  name: string;

  /** Ordered list of column names */
  columns: string[];

  /** Column identified as the primary key */
  primaryKey: string;

  /** Ordered natural identity columns, when declared. */
  identity?: string[];

  /** Prepared CRUD statements for this table */
  stmts: {
    insert: Statement;
    update: Statement;
    delete: Statement;
    getOne: Statement;
    getAll: Statement;
    getByIdentity?: Statement;
  };
}

/**
 * Prepared statements for the _changes ring buffer table.
 * Created once in the ReactiveDB constructor.
 */
export interface ChangeStatements {
  /** INSERT INTO _changes (seq, tbl, op, row_id, data, ts) VALUES (?, ?, ?, ?, ?, ?) */
  insert: Statement;

  /** DELETE FROM _changes WHERE seq <= ? */
  prune: Statement;

  /** SELECT * FROM _changes WHERE seq > ? ORDER BY seq */
  after: Statement;

  /** SELECT MIN(seq) AS min_seq FROM _changes */
  oldest: Statement;
}

/**
 * Raw row from the _changes table before deserialization.
 */
export interface ChangeRow {
  seq: number;
  tbl: string;
  op: string;
  row_id: string;
  data: string | null;
  previous_data?: string | null;
  ts: number;
}

// ─── Sync Plugin ────────────────────────────────────────────────────────────

/**
 * Configuration for createSyncPlugin().
 */
export interface SyncPluginConfig {
  /** Database configuration */
  db: ReactiveDBConfig;
  /** Table schemas to define on startup */
  tables: Record<string, TableSchema>;
  /** Enable per-user state sync (requires auth) */
  stateSync?: boolean;
  /**
   * Optional WebSocket auth bridge.
   *
   * When configured, provided tokens are verified before the socket can use
   * sync/state/ephemeral messages. Missing tokens are allowed unless
   * `required` is true, which preserves standalone/public sync mode.
   */
  auth?: SyncAuthConfig;
  /**
   * Optional table policy for WebSocket read and mutation authorization.
   *
   * Missing policy preserves standalone/public sync behavior. Platform apps
   * install a default policy that protects framework-owned tables from direct
   * client mutation.
   */
  policy?: SyncPolicy;
  /**
   * Optional resource-policy adapter for registered Zero resources.
   *
   * Platform apps use this to narrow WebSocket-readable tables and to enforce
   * generated resource policies on direct sync mutations. Standalone sync apps
   * can omit it to keep the original table-policy-only behavior.
   */
  resourcePolicy?: SyncResourcePolicyAdapter;
  /**
   * Optional table allow-list for full snapshot payloads.
   *
   * Platform apps pass a mutable set populated during startup after table
   * sync modes are resolved. Standalone sync without this set preserves the
   * old behavior where any readable table requested in `snapshot` can be sent.
   */
  snapshotTables?: Set<string>;
}

/**
 * Auth context attached to a sync WebSocket after token verification.
 */
export interface SyncAuthContext {
  userId: string;
  email: string;
  role: string;
}

/**
 * Minimal verifier contract consumed by the sync layer.
 *
 * Auth owns token issuance and verification; sync only depends on this narrow
 * interface so it can authenticate WebSocket connections without importing the
 * auth plugin or HTTP middleware.
 */
export interface SyncTokenVerifier {
  /**
   * Resolve the token against current account state. Zero auth implements this
   * so suspended, reset-gated, and superseded auth generations fail closed.
   */
  resolveAuthContext?(token: string): Promise<SyncAuthContext | null>;

  /** Legacy standalone verifier fallback. Prefer `resolveAuthContext`. */
  verifyAccessToken(token: string): Promise<{
    sub: string;
    email?: string;
    role?: string;
  } | null>;
}

/**
 * Auth configuration for the sync WebSocket.
 */
export interface SyncAuthConfig {
  /** Whether missing tokens should close the WebSocket with an auth failure. */
  required?: boolean;
  /** Internal migration signal: required mode came from the secure app default. */
  modeDefaulted?: boolean;
  /** Lazily returns the active token verifier, or null before auth is ready. */
  getTokenVerifier: () => SyncTokenVerifier | null;
  /** Current-account revalidation cadence for active authenticated sockets. */
  revalidateIntervalMs?: number;
  /** Temporary migration escape hatch. Query-string bearer tokens are rejected by default. */
  allowLegacyQueryToken?: boolean;
}

/**
 * Per-WebSocket connection data. Typed, available in all WS lifecycle handlers.
 */
export interface SyncSocketData {
  /** Tables this connection is allowed to subscribe to and snapshot */
  allowedTables: Set<string>;
  /** Bun pub/sub topics this socket has subscribed to */
  subscribedTopics: Set<string>;
  /** Last seq sent to this client */
  lastSeq: number;
  /** Tables selected by the latest completed sync.subscribe handshake. */
  syncSubscribedTables: Set<string>;
  /** True while Bun has queued outbound data behind socket backpressure. */
  syncBackpressured: boolean;
  /** Auth context derived from token (null if no auth) */
  authContext: SyncAuthContext | null;
  /** Bearer token retained in server memory for current-account revalidation. */
  authToken?: string;
  /** True after the WebSocket auth bridge has allowed this connection to proceed. */
  authResolved: boolean;
  /** Comparable effective read-policy snapshot used by live revalidation. */
  authorizationFingerprint: string | null;
  /** Opaque stable hash sent to clients to detect authorization-scope changes. */
  authorizationScope: string | null;
  /** Unique connection identifier for origin tracking */
  connectionId: string;
  /** Query parameters from the WS upgrade request */
  query: { token?: string };
  /** Whether this socket has subscribed to state sync */
  stateSubscribed: boolean;
  /** Ephemeral topics this socket has subscribed to */
  ephemeralTopics: Set<string>;
  /** Tables with row-filtered resource sync access for this socket. */
  resourceRowFilters: Map<string, SyncRowFilter>;
  /** Row-filtered tables this socket requested over sync.subscribe. */
  rowFilteredSubscribedTables: Set<string>;
}

/** Context passed to resource-aware sync table filtering. */
export interface SyncResourceTableAccessContext {
  tableNames: Iterable<string>;
  authContext: SyncAuthContext | null;
}

/** Synchronous row boundary returned by a resource policy adapter. */
export interface SyncRowFilter {
  /** Evaluated against the full server row before any projection. */
  matches(row: Row): boolean;
  /**
   * Optional wire projection for an already-authorized row. It must be pure,
   * must preserve the table's primary key, and must not grant row visibility.
   */
  project?(row: Row): Row;
}

/** Connection-time table access resolved from resource policy. */
export interface SyncResourceTableAccess {
  readableTables: Set<string>;
  rowFilters: Map<string, SyncRowFilter>;
  /** Stable representation of effective row-filter policy for revalidation. */
  policyFingerprint?: string;
}

/** Context passed to resource-aware sync mutation authorization. */
export interface SyncResourceMutationContext {
  table: string;
  op: ChangeOp;
  rowId?: string;
  row?: Row | Partial<Row>;
  authContext: SyncAuthContext | null;
  loadRow: (table: string, rowId: string) => Row | null;
}

/** Resource-aware sync mutation authorization result. */
export type SyncResourceMutationDecision =
  | { ok: true; row?: Row | Partial<Row> }
  | { ok: false; reason: string; code?: string };

/**
 * Adapter consumed by the sync layer to enforce registered resource policy.
 *
 * The sync package owns WebSocket transport; resource modules implement this
 * boundary so sync does not depend on app resource definitions directly.
 */
export interface SyncResourcePolicyAdapter {
  resolveTableAccess(
    context: SyncResourceTableAccessContext
  ): Promise<SyncResourceTableAccess>;
  authorizeMutation(
    context: SyncResourceMutationContext
  ): Promise<SyncResourceMutationDecision>;
}

// ─── Wire Protocol Messages ─────────────────────────────────────────────────

// Server → Client

/** Confirms that the server accepted the socket authentication handshake. */
export interface SyncAuthReadyMessage {
  type: 'sync.auth.ready';
  authenticated: boolean;
}

export interface SyncSnapshotMessage {
  type: 'sync.snapshot';
  tables: Record<string, Record<string, Row>>;
  seq: number;
  /** ReactiveDB process epoch. A change requires authoritative cache replacement. */
  epoch?: string;
  /** Opaque identity + read-policy scope. */
  scope?: string | null;
  /** Whether this snapshot replaces every local full and lazy table cache. */
  reset?: 'preserve-pending' | 'purge';
}

export interface SyncChangeMessage {
  type: 'sync.change';
  seq: number;
  /** Last sequence successfully queued to this socket before this change. */
  prevSeq?: number;
  /** ReactiveDB process epoch. */
  epoch?: string;
  /** Opaque identity + read-policy scope. */
  scope?: string | null;
  table: string;
  op: ChangeOp;
  rowId: string;
  row: Row | null;
  origin: string;
  ts: number;
}

export interface SyncAckMessage {
  type: 'sync.ack';
  ref: string;
  seq: number | null;
  ok: boolean;
  error?: string;
  /** Canonical mutation result, included so receipt replay cannot leave optimistic drift. */
  change?: {
    table: string;
    op: ChangeOp;
    rowId: string;
    row: Row | null;
  };
}

export interface SyncCatchupMessage {
  type: 'sync.catchup';
  changes: Array<{
    seq: number;
    table: string;
    op: ChangeOp;
    rowId: string;
    row: Row | null;
    origin: string;
    ts: number;
  }>;
  seq: number;
  /** Client cursor from which this atomic catchup was built. */
  prevSeq?: number;
  /** ReactiveDB process epoch. */
  epoch?: string;
  /** Opaque identity + read-policy scope. */
  scope?: string | null;
}

// Client → Server

/** First client message used to authenticate without exposing a token in the URL. */
export interface SyncAuthMessage {
  type: 'sync.auth';
  token?: string;
}

export interface SyncSubscribeMessage {
  type: 'sync.subscribe';
  /** Tables to subscribe to for live changes (all tables). */
  tables: string[];
  /** Tables to include in the initial snapshot. */
  snapshot?: string[];
  lastSeq: number;
  /** Last server epoch accepted by the client. Omit only on a fresh client. */
  epoch?: string;
  /** Last opaque authorization scope accepted by the client. */
  scope?: string | null;
}

export interface SyncMutateMessage {
  type: 'sync.mutate';
  ref: string;
  table: string;
  op: ChangeOp;
  rowId?: string;
  row?: Row | Partial<Row>;
  /** Server epoch used for the first transport attempt. */
  epoch?: string;
  /** Monotonic transport attempt; attempts after one require a durable receipt. */
  attempt?: number;
}

/** Any message that can arrive from the client over the sync WebSocket. */
export type ClientMessage =
  | SyncAuthMessage
  | SyncSubscribeMessage
  | SyncMutateMessage
  | StateSubscribeMessage
  | StateSetMessage
  | StateDeleteMessage
  | StateClearMessage
  | EphemeralSubscribeMessage
  | EphemeralUnsubscribeMessage
  | EphemeralSetMessage
  | EphemeralDeleteMessage;

/** Any message that the server can send to a client. */
export type ServerMessage =
  | SyncAuthReadyMessage
  | SyncSnapshotMessage
  | SyncChangeMessage
  | SyncAckMessage
  | SyncCatchupMessage
  | StateSnapshotMessage
  | StateAckMessage
  | StateChangeMessage
  | EphemeralSnapshotMessage
  | EphemeralChangeMessage;

// ─── Client Store ───────────────────────────────────────────────────────────

/**
 * A pending optimistic mutation awaiting server confirmation.
 */
export interface PendingMutation {
  /** Correlation ID matching the sync.mutate ref */
  ref: string;
  /** Table name */
  table: string;
  /** Operation type */
  op: ChangeOp;
  /** Primary key of the affected row */
  rowId: string;
  /** Row state before optimistic apply — used for rollback */
  previousState: Row | null;
  /** The state we applied optimistically */
  optimisticState: Row | null;
  /** Original insert/update fields, retained when rebasing onto server state. */
  optimisticPatch?: Partial<Row>;
  /** Timestamp when mutation was sent */
  sentAt: number;
  /** Number of successful WebSocket transport attempts. */
  attempts: number;
}

/**
 * Client-side table definition for the sync store.
 */
export interface ClientTableDef {
  /** Which field is the primary key */
  _pk: string;
  /**
   * Sync mode:
   * - `'full'` (default) — all rows sent in initial snapshot, always in sync
   * - `'lazy'` — NOT included in snapshot. Data loaded on demand via `collection.load()`.
   *   Live changes still arrive via WebSocket and apply if the row exists in the store.
   * - `'auto'` — server startup resolves to `'full'` or `'lazy'` based on
   *   configured row limits. Browser apps receive the resolved mode.
   */
  _sync?: DeclaredSyncMode;
  /** Ordered natural identity fields used for deterministic sync ids. */
  _identity?: string[];
  /** Column definitions (name → type hint) */
  [column: string]: string | string[] | undefined;
}

/** Narrow lifecycle surface used by authentication adapters. */
export interface SyncClientLifecycleTarget {
  readonly connected: boolean;
  connect(): void;
  reset(): void;
}

export type SyncAuthLifecycleBinder = (
  client: SyncClientLifecycleTarget,
  autoConnect: boolean,
) => void | (() => void);

/**
 * Configuration for createSyncClient().
 */
export interface SyncClientConfig {
  /** WebSocket URL (e.g., 'ws://localhost:3000/sync') */
  url: string;
  /** Table definitions for type information */
  tables: Record<string, ClientTableDef>;
  /** Auth token to send on connect */
  token?: string;
  /** Return the current auth token at connection time. May refresh asynchronously. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Force an auth refresh after a 4001 close and return the replacement access token. */
  refreshAuth?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Bind auth state changes to socket and local-cache lifecycle. */
  bindAuthLifecycle?: SyncAuthLifecycleBinder;
  /** Connect WebSocket immediately. Default: true */
  autoConnect?: boolean;
  /** Callback on unrecoverable error */
  onError?: (error: string) => void;
  /** Callback when the socket is closed for auth failure. */
  onAuthFailure?: (error: string) => void;
  /** Callback after successful reconnect */
  onReconnect?: () => void;
  /** Mutation ack timeout in ms. Default: 10000 */
  ackTimeout?: number;
  /** Max reconnect attempts. Default: Infinity */
  maxReconnectAttempts?: number;
}

// ─── State Sync ──────────────────────────────────────────────────────────

/** JSON-serializable value for state sync. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Event emitted by state client subscriptions. */
export interface StateChangeEvent {
  type: 'set' | 'delete' | 'clear';
  key: string | null;
  value: JsonValue | undefined;
  source: 'local' | 'remote';
}

/** Per-user state sync limits. */
export const STATE_LIMITS = {
  /** Max value size in bytes (64 KB) */
  maxValueSize: 65_536,
  /** Max keys per user */
  maxKeys: 1_000,
  /** Max key length in characters */
  maxKeyLength: 256,
  /** Max total state per user in bytes (10 MB) */
  maxTotalSize: 10_485_760,
} as const;

/** Machine-readable error codes for state operations. */
export type StateErrorCode =
  | 'VALUE_TOO_LARGE'
  | 'TOO_MANY_KEYS'
  | 'KEY_TOO_LONG'
  | 'TOTAL_SIZE_EXCEEDED'
  | 'UNAUTHORIZED';

// ─── State Wire Protocol ─────────────────────────────────────────────────

// Client → Server

export interface StateSubscribeMessage {
  type: 'state.subscribe';
}

export interface StateSetMessage {
  type: 'state.set';
  ref: string;
  key: string;
  value: JsonValue;
}

export interface StateDeleteMessage {
  type: 'state.delete';
  ref: string;
  key: string;
}

export interface StateClearMessage {
  type: 'state.clear';
  ref: string;
}

// Server → Client

export interface StateSnapshotMessage {
  type: 'state.snapshot';
  entries: Record<string, JsonValue>;
}

export interface StateAckMessage {
  type: 'state.ack';
  ref: string;
  ok: boolean;
  error?: StateErrorCode;
}

export interface StateChangeMessage {
  type: 'state.change';
  key: string | null;
  value: JsonValue | undefined;
  op: 'set' | 'delete' | 'clear';
}

// ─── State Client Store ──────────────────────────────────────────────────

// ─── Ephemeral Wire Protocol ──────────────────────────────────────────────

// Client → Server

export interface EphemeralSubscribeMessage {
  type: 'ephemeral.subscribe';
  topic: string;
}

export interface EphemeralUnsubscribeMessage {
  type: 'ephemeral.unsubscribe';
  topic: string;
}

export interface EphemeralSetMessage {
  type: 'ephemeral.set';
  topic: string;
  key: string;
  value: JsonValue;
  /** TTL in milliseconds. Default: 30000 */
  ttl?: number;
}

export interface EphemeralDeleteMessage {
  type: 'ephemeral.delete';
  topic: string;
  key: string;
}

// Server → Client

export interface EphemeralSnapshotMessage {
  type: 'ephemeral.snapshot';
  topic: string;
  entries: Record<string, { value: JsonValue; userId: string }>;
}

export interface EphemeralChangeMessage {
  type: 'ephemeral.change';
  topic: string;
  key: string;
  value: JsonValue | null;
  userId: string;
  op: 'set' | 'delete';
}

// ─── State Client Store ──────────────────────────────────────────────────

/** A pending optimistic state operation awaiting server ack. */
export interface PendingStateOp {
  ref: string;
  op: 'set' | 'delete' | 'clear';
  key: string | null;
  /** Previous value for rollback on failure */
  previousValue: JsonValue | undefined;
  /** For clear: snapshot of all entries before clear */
  previousEntries: Record<string, JsonValue> | null;
}
