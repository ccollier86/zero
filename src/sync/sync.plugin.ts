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
import {
  createSyncAuthReadyMessage,
  parseSyncAuthMessage,
} from './sync-auth-message';
import { createSyncSocketAuthRuntime } from './sync-socket-auth';
import { allowAllSyncPolicy } from './sync-policy';
import { deliverSyncChange } from './sync-change-delivery';
import { clearSyncBackpressure } from './sync-wire-send';
import { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode, warnPlatform } from '../observability/sink';
import {
  clearPlatformSQLiteService,
  setPlatformSQLiteService,
} from '../persistence';
import type {
  SyncPluginConfig,
  SyncSocketData,
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
  const socketAuth = createSyncSocketAuthRuntime({
    auth: config.auth,
    db,
    policy,
    resourcePolicy: config.resourcePolicy,
    activeSockets,
  });

  for (const [name, schema] of Object.entries(config.tables)) {
    db.defineTable(name, schema);
  }
  const mutationReceipts = new SyncMutationReceiptStore(db);

  _db = db;
  if (sqlite) setPlatformSQLiteService(sqlite);

  return new Elysia({ name: 'sync' })

    // ─── Lifecycle ──────────────────────────────────────
    .onStart(() => {
      // Register onChange BEFORE any connections arrive.
      // Every write to ReactiveDB publishes to the appropriate topic.
      // This is the single broadcast path — works for WS mutations,
      // HTTP route writes, background jobs, transactions — everything.
      _db = db;
      _unsubChange = db.onChange((change) => {
        // Don't publish changes for _ prefix tables (internal)
        if (change.table.startsWith('_')) return;
        deliverSyncChange(
          activeSockets,
          change,
          db.syncEpoch,
          currentMutationOrigin ?? '',
        );
      });

      // Create StateManager if state sync is enabled
      if (config.stateSync) {
        _stateManager = new StateManager(db);
      }

      // Always create EphemeralStateManager for ephemeral KV + presence
      _ephemeralManager = new EphemeralStateManager();

      if (config.auth?.required && config.auth.modeDefaulted) {
        warnPlatform(OBS_CODES.SYNC_AUTH_REQUIRED_DEFAULTED, {
          metadata: {
            hint: "Set syncAuth: 'public' only when anonymous sync is deliberate.",
          },
        });
      }

      emitPlatformCode(OBS_CODES.SYNC_STARTED, {
        metadata: {
          db: describeSyncDatabase(config.db, db),
          tables: Object.keys(config.tables),
          stateSync: Boolean(config.stateSync),
          authMode: config.auth
            ? config.auth.required ? 'required' : 'public'
            : 'disabled',
        },
      });
    })

    .onStop(() => {
      _unsubChange?.();
      _unsubChange = null;
      _stateManager = null;
      _ephemeralManager?.dispose();
      _ephemeralManager = null;
      socketAuth.dispose();
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
      // Kept in the schema only for the explicit, temporary compatibility flag.
      query: t.Object({
        token: t.Optional(t.String()),
      }),

      // Bun WebSocket config
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: 1_048_576, // 1MB
      backpressureLimit: 1_048_576,
      closeOnBackpressureLimit: true,
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
        data.syncSubscribedTables = new Set();
        data.syncBackpressured = false;
        data.authContext = null;
        data.authToken = undefined;
        data.authResolved = false;
        data.authorizationFingerprint = null;
        data.authorizationScope = null;
        data.allowedTables = new Set();
        data.resourceRowFilters = new Map();
        data.rowFilteredSubscribedTables = new Set();
        data.stateSubscribed = false;
        data.ephemeralTopics = new Set();
        data.query = (ws.data as { query?: { token?: string } }).query ?? {};

        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        if (data.query.token) {
          if (!config.auth?.allowLegacyQueryToken) {
            socket.close(4001, 'Query token authentication disabled');
            return;
          }
          await socketAuth.authorize(socket, data.query.token);
          return;
        }

        if (!config.auth) {
          await socketAuth.authorize(socket);
        } else {
          socketAuth.waitForRequiredHandshake(socket);
        }
      },

      async message(ws, message) {
        const data = ws.data as unknown as SyncSocketData;
        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        const wireMessage = message as string | Record<string, unknown>;
        const authMessage = parseSyncAuthMessage(wireMessage);

        if (authMessage.matched) {
          if (!authMessage.ok) {
            socket.close(4001, 'Invalid auth handshake');
            return;
          }

          if (!data.authResolved) {
            const authorized = await socketAuth.authorize(socket, authMessage.token);
            if (!authorized) return;
          }

          socket.send(JSON.stringify(
            createSyncAuthReadyMessage(data.authContext !== null)
          ));
          return;
        }

        // Legacy no-token clients can still enter deliberately public sync.
        // Required mode fails closed until the explicit auth message arrives.
        if (!data.authResolved) {
          const authorized = await socketAuth.authorize(socket);
          if (!authorized) return;
        } else if (!(await socketAuth.revalidate(socket))) {
          return;
        }

        // Elysia auto-parses JSON WebSocket messages — `message` is already an object.
        // routeMessage accepts both string and pre-parsed objects.
        await routeMessage(
          ws as any,
          wireMessage,
          db,
          { publish: (topic: string, data: string) => ws.publish(topic, data) },
          _stateManager,
          _ephemeralManager,
          policy,
          config.snapshotTables,
          config.resourcePolicy,
          mutationReceipts,
        );
      },

      close(ws, code, reason) {
        const socket = ws as unknown as ServerWebSocket<SyncSocketData>;
        activeSockets.delete(socket);
        socketAuth.clearSocket(socket);
        // Bun automatically unsubscribes from all pub/sub topics on close.
        // Clean up ephemeral manager subscriptions and presence data.
        if (_ephemeralManager) {
          cleanupEphemeralForSocket(ws as any, _ephemeralManager);
        }
      },

      drain(ws) {
        clearSyncBackpressure(ws as unknown as ServerWebSocket<SyncSocketData>);
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
