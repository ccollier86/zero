import type { Database, Statement } from 'bun:sqlite';
import type { ReactiveDB } from './reactive-db';
import type { PlatformSQLiteService, SQLiteStorageConfig } from '../persistence';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { SyncPolicy } from './sync-policy';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../observability/types';
import type {
  EphemeralErrorMessage,
  EphemeralTopicPolicy,
} from './ephemeral-policy';

// ─── Configuration ──────────────────────────────────────────────────────────

/** App-bound observability boundary used by ReactiveDB callback reporting. */
export type ReactiveDBPlatformCodeEmitter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => unknown;

/**
 * ReactiveDB configuration.
 *
 * Prefer `sqlite` or `database` when the platform runtime already owns the
 * SQL service. Legacy `mode: 'memory'` and file-path configs remain valid and
 * are routed through the platform persistence foundation internally.
 */
export interface ReactiveDBConfig extends SQLiteStorageConfig {
  /** App-local telemetry target for persistence and ReactiveDB events. */
  observability?: PlatformObservabilityRuntime | null;

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
   * Clear retained positive `_changes` rows during startup without reusing the
   * monotonic database cursor. Older cursors then require a fresh snapshot.
   *
   * This is a destructive stop-all maintenance escape hatch. Default: false.
   */
  clearChangesOnStart?: boolean;

  /** Ring buffer depth for reconnect replay. Default: 1000 */
  ringBufferDepth?: number;

  /**
   * App-local platform-code emitter. Managed composition roots should inject
   * their observability runtime; direct construction retains the historical
   * process-wide emitter when this is omitted.
   */
  emitCode?: ReactiveDBPlatformCodeEmitter;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

/**
 * Server-table metadata key used to carry logical row validation into Sync.
 *
 * Symbols are ignored by SQL column enumeration and JSON serialization, so
 * validation metadata never becomes a database column or browser policy
 * payload.
 */
export const SYNC_TABLE_MUTATION_VALIDATOR: unique symbol = Symbol.for(
  '@zero/framework/sync-table-mutation-validator',
) as any;

export interface SyncMutationValidationIssue {
  path?: string;
  message: string;
}

export type SyncRowValidationResult =
  | { success: true; output: Row }
  | { success: false; issues: readonly SyncMutationValidationIssue[] };

/** Logical schema boundary applied to websocket mutations for one table. */
export interface SyncTableMutationValidator {
  /** Configured sync primary key, including custom generated keys. */
  readonly primaryKey: string;
  /** Logical schema fields. Generated primary keys may be absent from this list. */
  readonly fieldNames: readonly string[];
  /** Decode SQLite/wire values into the logical schema representation. */
  decodeRow(row: Row): Row;
  /** Encode a validated logical row for ReactiveDB/SQLite. */
  encodeRow(row: Row): Row;
  /** Validate and normalize one complete logical row. */
  validateRow(row: Row): SyncRowValidationResult;
}

/**
 * Table schema definition.
 * Maps column names to SQLite column definitions.
 *
 * Exactly one isolated column definition must declare a top-level PRIMARY KEY.
 * Its declared SQLite affinity must be TEXT or INTEGER; INTEGER values must
 * remain safe integers and are canonicalized to string row IDs at the
 * Sync/Fabric boundary. `_identity` optionally declares a natural/business
 * identity whose fields get a unique index and deterministic sync primary key
 * generation. Mutating referential actions (`CASCADE`, `SET NULL`, or
 * `SET DEFAULT`) are rejected because they could change a tracked row without
 * a matching durable event.
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
  /** Server-only logical mutation validator carried outside string-key columns. */
  [SYNC_TABLE_MUTATION_VALIDATOR]?: SyncTableMutationValidator;
  /** SQLite column definitions (name → non-cascading SQL column definition). */
  [column: string]: string | string[] | undefined;
}

/**
 * A row of data from any table. Keys are column names.
 */
export type Row = Record<string, unknown>;

/** Resolved table sync behavior used by the client and server. */
export type SyncMode = 'full' | 'lazy';

/** Independent durable data logs multiplexed over one Sync WebSocket. */
export type SyncDataPlaneName = 'default' | 'system' | 'tenant';

/** Non-retryable Sync data/configuration failure requiring operator action. */
export const SYNC_TERMINAL_DATA_CLOSE_CODE = 4_004 as const;

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
  /** Database-wide monotonic sequence number for the retained change history. */
  seq: number;

  /** Name of the table that was mutated */
  table: string;

  /** The type of mutation */
  op: ChangeOp;

  /** Canonical string form of the affected row's primary key. */
  rowId: string;

  /** Canonical full row after mutation (null for DELETE). */
  row: Row | null;

  /** Full row before mutation, used internally for filtered DELETE fanout. */
  previousRow?: Row | null;

  /** Server timestamp in milliseconds (Date.now()) */
  ts: number;
}

/** Process-local delivery context copied for one listener invocation. */
export interface ChangeDeliveryMetadata {
  /** Whether this ReactiveDB handle or another SQLite connection wrote the row. */
  source: 'local' | 'external';
}

/** Why a replica dispatcher cannot continue incremental delivery. */
export interface SyncHistoryGap {
  /** Retention, a missing sequence, or an undecodable/future-format row. */
  kind: 'retention' | 'continuity' | 'format';
  afterSeq: number;
  oldestSeq: number;
  currentSeq: number;
}

/**
 * Synchronous listener for committed changes.
 *
 * Each invocation receives its own canonical Change and delivery-metadata
 * copies. Returning a Promise/thenable is a reported contract violation; it is
 * never awaited and its eventual rejection is consumed.
 */
export type ChangeListener = (
  change: Change,
  delivery: ChangeDeliveryMetadata,
) => void;

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
  /** Read main/temp schema versions for protected-trigger and managed-table fences. */
  mainSchemaVersion: Statement;
  tempSchemaVersion: Statement;

  /** Atomically increments and returns the database-owned sequence value. */
  allocate: Statement;

  /** SELECT the current durable log state. */
  current: Statement;

  /** INSERT one explicit-format row and RETURN its sequence for exact confirmation. */
  insert: Statement;

  /** Advance the durable pruning watermark; callers verify its exact result. */
  advancePrune: Statement;

  /** DELETE positive _changes rows through the verified watermark. */
  prune: Statement;

  /** Detect a positive row that a suppressed prune left through the watermark. */
  unprunedThrough: Statement;

  /** SELECT * FROM _changes WHERE seq > ? ORDER BY seq */
  after: Statement;

  /** Bounded SELECT * FROM _changes WHERE seq > ? ORDER BY seq LIMIT ? */
  afterPage: Statement;

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
  /** Process-local writer identity used to suppress duplicate local fanout. */
  origin?: string | null;
  /** NULL is retained legacy-v0 history; every new row explicitly uses v1. */
  format_version?: number | null;
  /** SQLite storage class selected alongside format_version. */
  format_version_type?: string;
}

// ─── Sync Plugin ────────────────────────────────────────────────────────────

/**
 * Configuration for createSyncPlugin().
 */
export interface SyncPluginConfig {
  /** Database configuration */
  db: ReactiveDBConfig;
  /**
   * Existing ReactiveDB used by this Sync transport.
   *
   * Omit this for the historical standalone behavior where createSyncPlugin()
   * creates and owns its database from `db`. Injected databases remain owned by
   * their caller unless `ownsReactiveDB` is explicitly true.
   */
  reactiveDB?: import('./reactive-db').ReactiveDB;
  /**
   * Dispose an injected `reactiveDB` when Sync tears down. Default: false.
   *
   * This option is valid only with `reactiveDB`; databases created from `db`
   * are always owned by the Sync plugin.
   */
  ownsReactiveDB?: boolean;
  /** App-local runtime used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /**
   * Composition hook invoked synchronously with this plugin's active ReactiveDB.
   *
   * Platform factories use this to close authorization services over the
   * app-local database instead of the legacy process-global compatibility
   * getter. Most standalone callers should omit it.
   */
  onDatabaseCreated?: (db: import('./reactive-db').ReactiveDB) => void;
  /** Table schemas to define on startup */
  tables: Record<string, TableSchema>;
  /**
   * Optional explicit logical validators keyed by table.
   *
   * Schema-generated tables carry these automatically. Raw SQL tables retain
   * their historical permissive mutation behavior unless a validator is set.
   */
  mutationValidators?: Record<string, SyncTableMutationValidator>;
  /** Enable per-user state sync (requires auth) */
  stateSync?: boolean;
  /** Managed state boundary. Multi mode requires a tenant-bound identity. */
  tenancyMode?: 'single' | 'multi';
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
   * Managed default-plane Guardian FK barrier. It runs only after mutation
   * policy succeeds and before validation/commit; Sync revalidates the socket
   * authority again after any asynchronous reconciliation.
   */
  ensureMutationReady?: (input: Readonly<{
    table: string;
    authContext: SyncAuthContext | null;
  }>) => void | Promise<void>;
  /**
   * Authorization and namespace policy for ephemeral collaboration topics.
   *
   * Authenticated plugins fail closed when this is omitted. Standalone
   * authless plugins retain the historical unrestricted topic behavior.
   */
  ephemeralPolicy?: EphemeralTopicPolicy;
  /**
   * Optional table allow-list for full snapshot payloads.
   *
   * Platform apps pass a mutable set populated during startup after table
   * sync modes are resolved. Standalone sync without this set preserves the
   * old behavior where any readable table requested in `snapshot` can be sent.
   */
  snapshotTables?: Set<string>;
  /**
   * Durable change polling for multiple runtimes sharing one SQLite file.
   * File-mode databases enable it automatically. Set false only when a single
   * runtime owns the file; pass an object to enable/configure injected DBs.
   * `intervalMs` must be a positive safe integer; values below 10 are clamped.
   */
  replicaChangePolling?: false | { intervalMs?: number };
  /**
   * Optional actor-backed tenant data plane for physically isolated app data.
   *
   * The provider receives only the already-verified socket authority. Tenant
   * or database selectors are never accepted from the Sync wire protocol.
   * Ephemeral collaboration remains process-local. Managed framework tables
   * and State Sync use the separately configured system/state planes.
   */
  tenantDataPlane?: import('./sync-tenant-data-plane').SyncTenantDataPlane;

  /**
   * Optional read-only framework control plane. Its tables live in the
   * dedicated Zero system database while application tables remain on the
   * default/application plane. Client mutations never route to this plane;
   * framework HTTP plugins own all control-plane writes.
   */
  systemDataPlane?: Readonly<{
    db: ReactiveDB;
    tables: readonly string[] | Readonly<Record<string, unknown>>;
    /**
     * Durable cross-runtime change polling for the system database. Omission
     * inherits the top-level polling setting and otherwise auto-enables for a
     * file-backed system database. Configure this independently when the app
     * and system planes have different replica ownership.
     */
    replicaChangePolling?: false | { intervalMs?: number };
  }>;

  /**
   * Reactive database used by per-user State Sync. Omission preserves the
   * standalone single-database contract. Managed apps bind this to system.db.
   */
  stateDB?: ReactiveDB;
}

/**
 * Auth context attached to a sync WebSocket after token verification.
 */
export interface SyncAuthContext {
  userId: string;
  email: string;
  role: string;
  /** Managed Zero contexts always populate this exact security generation. */
  authGeneration?: number;
  /** Present when authority belongs to a registered native public client. */
  clientId?: string;
  /** Browser access remains web; native access is explicitly attributed. */
  sessionKind?: 'web' | 'native';
  /** OIDC identity scopes for native sessions. */
  scope?: readonly string[];
  /** Durable authority fields are optional for standalone/legacy verifiers. */
  sessionId?: string;
  /** Server-resolved durable MFA assurance for this session family. */
  mfaVerifiedAt?: number;
  sessionGeneration?: number;
  sessionScopeKind?: 'application' | 'tenant';
  sessionScopeId?: string;
  tenantId?: string;
  /** Server-resolved tenant purpose; never accepted from socket input. */
  tenantKind?: 'organization' | 'administration';
  membershipId?: string;
  tenantRole?: string | null;
  tenantAuthorizationGeneration?: number;
  membershipAuthorizationGeneration?: number;
  /** Live advanced-role assignment revision resolved server-side. */
  authorizationAssignmentRevision?: string;
}

/** Secret-free durable authority handle exposed by Zero's token service. */
export interface SyncAuthContextAuthorityReference {
  readonly version: 1;
  readonly userId: string;
  readonly platformRole: string;
  readonly authGeneration: number;
  readonly sessionKind: 'web' | 'native';
  readonly sessionId: string;
  readonly mfaVerifiedAt: number | null;
  readonly sessionGeneration: number | null;
  readonly clientId: string | null;
  readonly identityScopes: readonly string[];
  readonly sessionScopeKind: 'application' | 'tenant';
  readonly sessionScopeId: string;
  readonly tenantId: string | null;
  readonly tenantKind: 'organization' | 'administration' | null;
  readonly membershipId: string | null;
  readonly tenantRole: string | null;
  readonly tenantAuthorizationGeneration: number | null;
  readonly membershipAuthorizationGeneration: number | null;
  readonly authorizationAssignmentRevision: string | null;
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
   * Fail closed when this verifier belongs to an auth runtime whose installed
   * profile has since changed. Managed Zero auth supplies this fence; the
   * optional shape preserves standalone verifier compatibility.
   */
  assertCurrentProfile?(): void;

  /**
   * Resolve the token against current account state. Zero auth implements this
   * so suspended, reset-gated, and superseded auth generations fail closed.
   */
  resolveAuthContext?(token: string): Promise<SyncAuthContext | null>;

  /** Zero auth's synchronous durable-authority commit boundary. */
  captureAuthContextAuthority?(
    context: SyncAuthContext,
  ): SyncAuthContextAuthorityReference | null;
  resolveAuthContextAuthority?(
    reference: SyncAuthContextAuthorityReference,
  ): SyncAuthContext | null;

  /** Monotonic shared authority revision for event-driven socket revalidation. */
  getAuthorityRevision?(): string | number | null;

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
  /** Poll cadence for the shared authority revision. Omit to disable. */
  invalidationPollIntervalMs?: number;
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
  /** True while an atomic default-plane snapshot transfer owns Sync ordering. */
  syncSnapshotInFlight?: boolean;
  /** Ordered live changes deferred until the default snapshot end frame drains. */
  syncDeferredChanges?: Array<{
    change: Change;
    epoch: string;
    origin: string;
  }>;
  /** True once this socket subscribes to both independent durable data logs. */
  syncMultiplexed?: boolean;
  /** Auth context derived from token (null if no auth) */
  authContext: SyncAuthContext | null;
  /** Bearer token retained in server memory for current-account revalidation. */
  authToken?: string;
  /** Secret-free, synchronously revalidated authority captured at handshake. */
  authAuthorityReference?: SyncAuthContextAuthorityReference | null;
  /** True after the WebSocket auth bridge has allowed this connection to proceed. */
  authResolved: boolean;
  /** Comparable effective read-policy snapshot used by live revalidation. */
  authorizationFingerprint: string | null;
  /** Trusted user/property/RBAC snapshot used to build current read filters. */
  readAuthorizationFingerprint?: string | null;
  /** Opaque stable hash sent to clients to detect authorization-scope changes. */
  authorizationScope: string | null;
  /** Unique connection identifier for origin tracking */
  connectionId: string;
  /** Query parameters from the WS upgrade request */
  query: { token?: string };
  /** Whether this socket has subscribed to state sync */
  stateSubscribed: boolean;
  /** Exact server-derived state principal represented by this subscription. */
  statePrincipal?: string | null;
  /** Durable sequence already represented by the latest state snapshot/change. */
  stateLastSeq?: number;
  /** Ephemeral topics this socket has subscribed to */
  ephemeralTopics: Set<string>;
  /** Tables with row-filtered resource sync access for this socket. */
  resourceRowFilters: Map<string, SyncRowFilter>;
  /** Optional per-table projection applied after row-policy evaluation. */
  resourceRowProjectors?: Map<string, SyncRowProjector>;
  /** Row-filtered tables this socket requested over sync.subscribe. */
  rowFilteredSubscribedTables: Set<string>;
}

/** Context passed to resource-aware sync table filtering. */
export interface SyncResourceTableAccessContext {
  tableNames: Iterable<string>;
  authContext: SyncAuthContext | null;
}

/** Synchronous row predicate returned by a resource policy adapter. */
export interface SyncRowFilter {
  matches(row: Row): boolean;
}

/** Synchronous client-row projection returned by a resource policy adapter. */
export interface SyncRowProjector {
  project(row: Row): Row;
}

/** Connection-time table access resolved from resource policy. */
export interface SyncResourceTableAccess {
  readableTables: Set<string>;
  rowFilters: Map<string, SyncRowFilter>;
  /** Projectors run only after filters inspect the complete server row. */
  rowProjectors?: Map<string, SyncRowProjector>;
  /** Stable representation of effective row-filter policy for revalidation. */
  policyFingerprint?: string;
  /**
   * Synchronously comparable trusted authority used to build this policy.
   * Physical tenant Sync requires this value so an async read cannot deliver
   * rows after trusted properties or live RBAC assignments change.
   */
  readAuthorityFingerprint?: string;
}

/** Context passed to resource-aware sync mutation authorization. */
export interface SyncResourceMutationContext {
  table: string;
  op: ChangeOp;
  rowId?: string;
  row?: Row | Partial<Row>;
  authContext: SyncAuthContext | null;
  /** Physical tenant databases may require an actor read. */
  loadRow: (
    table: string,
    rowId: string,
  ) => Row | null | Promise<Row | null>;
}

/** Trusted row predicate carried from resource authorization to persistence. */
export interface SyncResourceMutationScope {
  field: string;
  value: string | number;
}

/** Resource-aware sync mutation authorization result. */
export type SyncResourceMutationDecision =
  | {
    ok: true;
    row?: Row | Partial<Row>;
    /** Registered CREATE must reject a primary-key collision, never replace. */
    createOnly?: boolean;
    /** Row snapshot evaluated by policy; persistence compares it atomically. */
    expectedRow?: Row;
    /** Exact identity/property snapshot used by the resource policy. */
    authorityFingerprint?: string;
    /** Enforced by ReactiveDB in the actual INSERT/UPDATE/DELETE boundary. */
    scope?: SyncResourceMutationScope;
  }
  | { ok: false; reason: string; code?: string };

/**
 * Adapter consumed by the sync layer to enforce registered resource policy.
 *
 * The sync package owns WebSocket transport; resource modules implement this
 * boundary so sync does not depend on app resource definitions directly.
 */
export interface SyncResourcePolicyAdapter {
  /**
   * Return the explicit non-discretionary realm for an app-managed table.
   * Multi-tenant Sync startup rejects every configured app table when this
   * proof is missing; a custom policy callback is not a realm declaration.
   */
  classifyManagedTableRealm?(table: string): 'global' | 'tenant' | null;
  /**
   * Return the immutable managed-client exposure classification. Multi-tenant
   * Sync startup requires this proof independently from realm classification.
   */
  classifyManagedTableExposure?(
    table: string,
  ): 'internal' | 'http' | 'sync' | 'all' | null;
  /** Trusted storage routing classification used only at plugin composition. */
  classifyManagedTableDataPlane?(table: string): 'default' | 'tenant' | null;
  resolveTableAccess(
    context: SyncResourceTableAccessContext
  ): Promise<SyncResourceTableAccess>;
  authorizeMutation(
    context: SyncResourceMutationContext
  ): Promise<SyncResourceMutationDecision>;
  /** Re-read policy identity/properties inside the SQLite commit transaction. */
  validateMutationAuthorityAtCommit?(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean;
  /** Re-read trusted read-policy authority at the final delivery edge. */
  validateReadAuthorityAtDelivery?(
    authContext: SyncAuthContext | null,
    expectedFingerprint: string,
  ): boolean;
  /**
   * Observe every committed database change before socket subscription
   * filtering. Stateful authorization adapters use this to invalidate cached
   * scope independently of which data tables a client requested. This hook
   * must complete synchronously; a throw or Promise invalidates the runtime.
   */
  observeChange?(change: Change): void;
  /**
   * Synchronously invalidate/reset state derived only from observeChange
   * before clients reconnect after skipped history. Expensive reconstruction
   * should be lazy in the next access-resolution call. Returning a Promise or
   * throwing permanently invalidates the Sync runtime.
   */
  onHistoryGap?(gap: SyncHistoryGap): void;
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
  /** Omitted by the historical single/default-plane protocol. */
  plane?: SyncDataPlaneName;
  tables: Record<string, Record<string, Row>>;
  seq: number;
  /** ReactiveDB process epoch. A change requires authoritative cache replacement. */
  epoch?: string;
  /** Opaque identity + read-policy scope. */
  scope?: string | null;
  /** Whether this snapshot replaces every local full and lazy table cache. */
  reset?: 'preserve-pending' | 'purge';
}

/** Begins one bounded-frame authoritative snapshot transfer. */
export interface SyncSnapshotBeginMessage {
  type: 'sync.snapshot.begin';
  snapshotId: string;
  /** Omitted only by the historical single/default-plane protocol. */
  plane?: SyncDataPlaneName;
  /** Exact tables replaced when the matching end frame is accepted. */
  tables: string[];
  seq: number;
  epoch?: string;
  scope?: string | null;
  reset: 'preserve-pending' | 'purge';
}

/** One wire-bounded table fragment belonging to a snapshot transfer. */
export interface SyncSnapshotChunkMessage {
  type: 'sync.snapshot.chunk';
  snapshotId: string;
  plane?: SyncDataPlaneName;
  table: string;
  rows: Record<string, Row>;
}

/** Commits the staged snapshot atomically into the client store. */
export interface SyncSnapshotEndMessage {
  type: 'sync.snapshot.end';
  snapshotId: string;
  plane?: SyncDataPlaneName;
}

export interface SyncChangeMessage {
  type: 'sync.change';
  plane?: SyncDataPlaneName;
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

/** Stable machine-readable Sync mutation rejection codes. */
export const SYNC_ACK_ERROR_CODES = Object.freeze({
  mutationReceiptExpired: 'SYNC_MUTATION_RECEIPT_EXPIRED',
  mutationCapacityExhausted: 'SYNC_MUTATION_CAPACITY_EXHAUSTED',
  dataRealmNotReady: 'SYNC_DATA_REALM_NOT_READY',
  dataRealmUnavailable: 'SYNC_DATA_REALM_UNAVAILABLE',
} as const);

export type SyncAckErrorCode =
  (typeof SYNC_ACK_ERROR_CODES)[keyof typeof SYNC_ACK_ERROR_CODES];

/**
 * A rejected optimistic mutation after its local row has been rolled back.
 *
 * Applications should branch on `errorCode`; `error` is a safe display value,
 * not a stable machine contract.
 */
export interface SyncMutationRejection {
  ref: string;
  table: string;
  op: ChangeOp;
  rowId: string;
  plane?: SyncDataPlaneName;
  error?: string;
  errorCode?: SyncAckErrorCode;
  source: 'server' | 'timeout';
}

export interface SyncAckMessage {
  type: 'sync.ack';
  plane?: SyncDataPlaneName;
  ref: string;
  seq: number | null;
  ok: boolean;
  error?: string;
  errorCode?: SyncAckErrorCode;
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
  plane?: SyncDataPlaneName;
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
  /**
   * Independent reconnect cursors for multiplexed physical-tenant Sync.
   * Legacy clients omit this and retain the scalar default-plane cursor.
   */
  cursors?: Partial<Record<SyncDataPlaneName, Readonly<{
    lastSeq: number;
    epoch?: string;
    scope?: string | null;
  }>>>;
}

export interface SyncMutateMessage {
  type: 'sync.mutate';
  /** Optional protocol assertion; routing is always derived from server catalog. */
  plane?: SyncDataPlaneName;
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
  | SyncSnapshotBeginMessage
  | SyncSnapshotChunkMessage
  | SyncSnapshotEndMessage
  | SyncChangeMessage
  | SyncAckMessage
  | SyncCatchupMessage
  | StateSnapshotMessage
  | StateAckMessage
  | StateChangeMessage
  | EphemeralSnapshotMessage
  | EphemeralChangeMessage
  | EphemeralErrorMessage;

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
  /** Boolean columns encoded as SQLite integers in the sync store. */
  _booleanFields?: string[];
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
  /**
   * Exact server-authored route for every configured table. Supplying this
   * enables default/tenant data-plane multiplexing and mutation assertions;
   * omission preserves the historical all-default protocol.
   */
  tableSyncPlanes?: Readonly<Record<string, SyncDataPlaneName>>;
  /** Auth token to send on connect */
  token?: string;
  /** Return the current auth token at connection time. May refresh asynchronously. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Force an auth refresh after a 4001 close and return the replacement access token. */
  refreshAuth?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Bind auth state changes to socket and local-cache lifecycle. */
  bindAuthLifecycle?: SyncAuthLifecycleBinder;
  /**
   * Subscribe to scoped-user State Sync after each accepted socket auth
   * handshake. Default: false. This enables only the wire subscription;
   * low-level callers still own state-message routing and storage.
   */
  stateSync?: boolean;
  /** Connect WebSocket immediately. Default: true */
  autoConnect?: boolean;
  /** Callback on unrecoverable error */
  onError?: (error: string) => void;
  /** Callback when the socket is closed for auth failure. */
  onAuthFailure?: (error: string) => void;
  /** Callback after successful reconnect */
  onReconnect?: () => void;
  /** Called after a rejected optimistic mutation has been rolled back. */
  onMutationRejected?: (rejection: SyncMutationRejection) => void;
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

/**
 * Outgoing Sync queue ceiling. The maximum State snapshot is below 12 MiB:
 * 10 MiB of stored key/value bytes plus worst-case JSON escaping for at most
 * 1,000 keys. Sixteen MiB leaves bounded headroom without raising the 1 MiB
 * inbound WebSocket payload limit.
 */
export const SYNC_OUTGOING_BACKPRESSURE_LIMIT = 16 * 1_024 * 1_024;

/** Machine-readable error codes for state operations. */
export type StateErrorCode =
  | 'INVALID_REQUEST'
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
