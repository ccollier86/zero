/**
 * sync.plugin.ts
 *
 * Owns the Elysia lifecycle and WebSocket transport for ReactiveDB sync. This
 * file initializes sync-owned runtime state and routes wire-protocol messages;
 * persistence details live in ReactiveDB, and token verification is delegated
 * through the sync auth contract.
 */

import { Elysia, t } from 'elysia';
import type { ServerWebSocket } from 'bun';
import { createReactiveDB, ReactiveDB } from './reactive-db';
import { routeMessage, currentMutationOrigin } from './message-handler';
import { StateManager } from './state-manager';
import { EphemeralStateManager } from './ephemeral-manager';
import { cleanupEphemeralForSocket } from './ephemeral-handler';
import { resolveSyncAuthContext } from './sync-auth';
import { allowAllSyncPolicy, getReadableSyncTables } from './sync-policy';
import { projectSyncChange } from './row-filter';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  clearPlatformSQLiteService,
  setPlatformSQLiteService,
} from '../persistence';
import type {
  Change,
  SyncPluginConfig,
  SyncSocketData,
  SyncChangeMessage,
  TableSchema,
} from './types';

/** Module-level DB reference for cross-plugin access. */
let _db: ReactiveDB | null = null;
let _stateManager: StateManager | null = null;
let _ephemeralManager: EphemeralStateManager | null = null;
let _unsubChange: (() => void) | null = null;

/**
 * Get the ReactiveDB instance. Returns null if the sync plugin hasn't been
 * created. createSyncPlugin initializes it during plugin composition so later
 * plugins can define tables against the shared DB before listen().
 */
export function getSyncDB(): ReactiveDB | null {
  return _db;
}

/**
 * Get the EphemeralStateManager instance. Returns null if the sync plugin hasn't started.
 */
export function getEphemeralManager(): EphemeralStateManager | null {
  return _ephemeralManager;
}

/**
 * Create the sync engine Elysia plugin.
 *
 * - Creates ReactiveDB during plugin composition for cross-plugin access
 * - Defines app tables from config before dependent plugins compose
 * - Registers onChange listener that publishes to Bun pub/sub topics
 * - Exposes WS endpoint at /sync
 * - Derives `syncDB` into global Elysia context for all routes
 */
export function createSyncPlugin(config: SyncPluginConfig) {
  let connectionCounter = 0;
  const policy = config.policy ?? allowAllSyncPolicy;
  const db = createReactiveDB(config.db);
  const sqlite = db.getSQLiteService();
  const activeSockets = new Set<ServerWebSocket<SyncSocketData>>();

  for (const [name, schema] of Object.entries(config.tables)) {
    db.defineTable(name, schema);
  }

  _db = db;
  if (sqlite) setPlatformSQLiteService(sqlite);

  return new Elysia({ name: 'sync' })

    // ─── Lifecycle ──────────────────────────────────────
    .onStart(({ server }) => {
      // Register onChange BEFORE any connections arrive.
      // Every write to ReactiveDB publishes to the appropriate topic.
      // This is the single broadcast path — works for WS mutations,
      // HTTP route writes, background jobs, transactions — everything.
      _db = db;
      _unsubChange = db.onChange((change) => {
        if (!server) return;

        // Don't publish changes for _ prefix tables (internal)
        if (change.table.startsWith('_')) return;

        const msg = createSyncChangeMessage(change);

        // server.publish sends to all broad table subscribers. Row-filtered
        // subscribers are not subscribed to this topic; they receive a direct
        // filtered message below.
        server.publish(`sync:${change.table}`, JSON.stringify(msg));

        publishFilteredChange(activeSockets, change);
      });

      // Create StateManager if state sync is enabled
      if (config.stateSync) {
        _stateManager = new StateManager(db);
      }

      // Always create EphemeralStateManager for ephemeral KV + presence
      _ephemeralManager = new EphemeralStateManager();

      emitPlatformCode(OBS_CODES.SYNC_STARTED, {
        metadata: {
          db: describeSyncDatabase(config.db, db),
          tables: Object.keys(config.tables),
          stateSync: Boolean(config.stateSync),
        },
      });
    })

    .onStop(() => {
      _unsubChange?.();
      _unsubChange = null;
      _stateManager = null;
      _ephemeralManager?.dispose();
      _ephemeralManager = null;
      activeSockets.clear();
      db.dispose();
      if (_db === db) _db = null;
      if (sqlite) clearPlatformSQLiteService(sqlite);
      emitPlatformCode(OBS_CODES.SYNC_STOPPED, {
        metadata: { db: describeSyncDatabase(config.db, db) },
      });
    })

    // ─── Derive: expose syncDB globally ─────────────────
    .derive({ as: 'global' }, () => ({
      syncDB: db,
    }))

    // ─── WebSocket handler at /sync ─────────────────────
    .ws('/sync', {
      // Query params: only `token` for auth
      query: t.Object({
        token: t.Optional(t.String()),
      }),

      // Bun WebSocket config
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: 1_048_576, // 1MB
      publishToSelf: true,
      perMessageDeflate: false,

      async open(ws) {
        // Assign unique connection ID
        const connectionId = `conn_${++connectionCounter}`;

        // Initialize per-socket data
        const data = ws.data as unknown as SyncSocketData;
        data.connectionId = connectionId;
        data.subscribedTopics = new Set();
        data.lastSeq = 0;
        data.authContext = null;
        data.authResolved = false;
        data.allowedTables = new Set();
        data.resourceRowFilters = new Map();
        data.rowFilteredSubscribedTables = new Set();
        data.stateSubscribed = false;
        data.ephemeralTopics = new Set();
        data.query = (ws.data as { query?: { token?: string } }).query ?? {};

        const auth = await resolveSyncAuthContext(data.query.token, config.auth);
        if (!auth.ok) {
          ws.close(auth.closeCode, auth.reason);
          return;
        }
        data.authContext = auth.authContext;
        data.authResolved = true;

        const syncReadableTables = getReadableSyncTables(
          db.getTableNames().filter((table) => !table.startsWith('_')),
          data.authContext,
          policy
        );
        if (config.resourcePolicy) {
          const access = await config.resourcePolicy.resolveTableAccess({
            tableNames: syncReadableTables,
            authContext: data.authContext,
          });
          data.allowedTables = access.readableTables;
          data.resourceRowFilters = access.rowFilters;
        } else {
          data.allowedTables = syncReadableTables;
        }

        activeSockets.add(ws as unknown as ServerWebSocket<SyncSocketData>);
      },

      async message(ws, message) {
        const data = ws.data as unknown as SyncSocketData;
        if (!data.authResolved) return;

        // Elysia auto-parses JSON WebSocket messages — `message` is already an object.
        // routeMessage accepts both string and pre-parsed objects.
        await routeMessage(
          ws as any,
          message as string | Record<string, unknown>,
          db,
          { publish: (topic: string, data: string) => ws.publish(topic, data) },
          _stateManager,
          _ephemeralManager,
          policy,
          config.snapshotTables,
          config.resourcePolicy
        );
      },

      close(ws, code, reason) {
        activeSockets.delete(ws as unknown as ServerWebSocket<SyncSocketData>);
        // Bun automatically unsubscribes from all pub/sub topics on close.
        // Clean up ephemeral manager subscriptions and presence data.
        if (_ephemeralManager) {
          cleanupEphemeralForSocket(ws as any, _ephemeralManager);
        }
      },

      drain(ws) {
        // Socket ready for more data after backpressure.
        // For this implementation, we don't pause sends — changes are
        // delivered via pub/sub and lost messages are recovered via
        // ring buffer catchup on reconnect.
      },
    });
}

function describeSyncDatabase(config: SyncPluginConfig['db'], db: ReactiveDB): string {
  const sqlite = db.getSQLiteService();
  if (sqlite) {
    return sqlite.mode === 'ephemeral'
      ? ':memory:'
      : sqlite.snapshotPath ?? sqlite.path ?? sqlite.mode;
  }

  if (config.database) return '[injected database]';
  if (config.mode === 'memory' || config.mode === ':memory:') return ':memory:';
  return config.path ?? config.mode ?? '[platform sqlite]';
}

function createSyncChangeMessage(change: Change): SyncChangeMessage {
  return {
    type: 'sync.change',
    seq: change.seq,
    table: change.table,
    op: change.op,
    rowId: change.rowId,
    row: change.row,
    origin: currentMutationOrigin ?? '',
    ts: change.ts,
  };
}

function publishFilteredChange(
  sockets: Set<ServerWebSocket<SyncSocketData>>,
  change: Change
): void {
  for (const socket of sockets) {
    if (!socket.data.rowFilteredSubscribedTables.has(change.table)) continue;
    const filter = socket.data.resourceRowFilters.get(change.table);
    if (!filter) continue;

    const projected = projectSyncChange(change, filter);
    if (!projected) continue;

    const msg: SyncChangeMessage = {
      type: 'sync.change',
      ...projected,
      origin: currentMutationOrigin ?? '',
    };
    socket.send(JSON.stringify(msg));
  }
}
