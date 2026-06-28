import type {
  Row,
  ClientTableDef,
  SyncClientConfig,
  ServerMessage,
  SyncMutateMessage,
} from '../types';
import {
  createSyncStore,
  routeServerMessage,
  type SyncStoreContext,
} from './sync-store';
import { ensureRowSyncPrimaryKey } from '../identity';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SyncClient {
  /** The @xstate/store instance holding all synced data */
  readonly store: ReturnType<typeof createSyncStore>['store'];
  /** Table definitions passed at creation */
  readonly tables: Record<string, ClientTableDef>;
  /** Whether the WebSocket is currently connected */
  readonly connected: boolean;

  /** Optimistic insert + send to server */
  insert(table: string, row: Row): void;
  /** Optimistic update + send to server */
  update(table: string, id: string, partial: Partial<Row>): void;
  /** Optimistic delete + send to server */
  delete(table: string, id: string): void;

  /** Send a raw JSON message over the WS (or buffer if disconnected). Used by StateClient. */
  sendRaw(msg: object): void;
  /** Open the WebSocket when the client was created with autoConnect: false. */
  connect(): void;

  /**
   * Register a handler for non-sync messages arriving on the WS.
   * Returns unsubscribe function.
   */
  onMessage(handler: (msg: { type: string; [key: string]: unknown }) => void): () => void;

  /** Disconnect and clean up all resources */
  disconnect(): void;
}

/** A mutation queued locally while waiting for a same-row pending mutation to be acked */
interface QueuedMutation {
  message: SyncMutateMessage;
  storeEvent: {
    type: string;
    table: string;
    rowId: string;
    ref: string;
    row?: Row;
    partial?: Partial<Row>;
  };
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_ACK_TIMEOUT = 10_000;
const ACK_CHECK_INTERVAL = 2_000;
const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = Infinity;

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a SyncClient that manages WebSocket connectivity, optimistic
 * mutations, reconnect with exponential backoff, and message routing
 * to the @xstate/store.
 *
 * Connects immediately by default. Pass `autoConnect: false` and call
 * `connect()` manually when delayed WebSocket startup is needed.
 */
export function createSyncClient(config: SyncClientConfig): SyncClient {
  const {
    url,
    tables,
    token,
    autoConnect = true,
    onError,
    onReconnect,
    ackTimeout = DEFAULT_ACK_TIMEOUT,
    maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  } = config;

  // ─── State ─────────────────────────────────────────────────────────

  const { store, tables: tableDefs } = createSyncStore(tables);

  let ws: WebSocket | null = null;
  let disposed = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ackCheckTimer: ReturnType<typeof setInterval> | null = null;
  let isFirstConnect = true;

  /** Messages buffered while disconnected — sent on reconnect after subscribe */
  const sendBuffer: string[] = [];

  /** External message handlers for non-sync messages (e.g., state messages) */
  const messageHandlers = new Set<(msg: { type: string; [key: string]: unknown }) => void>();

  /**
   * Per-row mutation queue for same-row serialization.
   * Key: `${table}:${rowId}`. When a mutation is pending for a given row,
   * subsequent mutations to that row are queued here and sent after the
   * pending one is acked. This prevents broken rollback chains.
   */
  const rowQueue = new Map<string, QueuedMutation[]>();

  /**
   * Track which rows have pending (in-flight) mutations.
   * Key: `${table}:${rowId}`, Value: ref of the in-flight mutation.
   */
  const inFlightRows = new Map<string, string>();

  // ─── WebSocket Connection ──────────────────────────────────────────

  function connect(): void {
    if (disposed) return;
    if (
      ws &&
      (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const wsUrl = token
      ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : url;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;

      store.send({ type: 'sync.connected' });

      // Send subscribe message with lastSeq for reconnect/catchup
      const ctx = store.getSnapshot().context as SyncStoreContext;
      const tableNames = Object.keys(tableDefs);

      // Split tables by sync mode: full tables get snapshots, lazy tables don't
      const snapshotTables = tableNames.filter((t) => tableDefs[t]._sync !== 'lazy');

      const subscribeMsg = JSON.stringify({
        type: 'sync.subscribe',
        tables: tableNames,
        snapshot: snapshotTables,
        lastSeq: ctx._sync.lastSeq,
      });
      ws!.send(subscribeMsg);

      // Flush send buffer (mutations that occurred while disconnected)
      for (const msg of sendBuffer) {
        ws!.send(msg);
      }
      sendBuffer.length = 0;

      // Start ack timeout checker
      startAckChecker();

      if (!isFirstConnect) {
        onReconnect?.();
      }
      isFirstConnect = false;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;

      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return; // Malformed JSON — ignore
      }

      if (!msg || typeof msg.type !== 'string') return;

      // Route sync messages to store
      routeServerMessage(store, msg);

      // Notify external handlers (state sync, etc.)
      for (const handler of messageHandlers) {
        handler(msg as unknown as { type: string; [key: string]: unknown });
      }

      // On ack, check if we can flush queued mutations for that row
      if (msg.type === 'sync.ack') {
        handleAckForQueue(msg.ref);
      }

      // On snapshot, clear row queues and in-flight tracking only for tables
      // included in the payload. Lazy tables are omitted from snapshots, so
      // their pending optimistic mutations must survive reconnect fallback.
      if (msg.type === 'sync.snapshot') {
        clearSnapshotTrackedRows(new Set(Object.keys(msg.tables)));
      }

      // On catchup, clear in-flight for rows that were confirmed
      if (msg.type === 'sync.catchup') {
        for (const change of msg.changes) {
          const key = `${change.table}:${change.rowId}`;
          inFlightRows.delete(key);
          // Flush any queued mutations for this row
          flushRowQueue(key);
        }
      }
    };

    ws.onclose = (event: CloseEvent) => {
      ws = null;
      stopAckChecker();

      store.send({ type: 'sync.disconnected' });

      // Don't reconnect if we intentionally disconnected
      if (disposed) return;

      // Don't reconnect on auth failure
      if (event.code === 4001 || event.code === 4003) {
        onError?.(`Auth failed (code ${event.code}): ${event.reason}`);
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      // The error event doesn't provide useful info in browsers.
      // The close event that follows will handle reconnection.
    };
  }

  // ─── Reconnect ─────────────────────────────────────────────────────

  function scheduleReconnect(): void {
    if (disposed) return;

    if (reconnectAttempts >= maxReconnectAttempts) {
      onError?.(`Max reconnect attempts (${maxReconnectAttempts}) exceeded`);
      return;
    }

    // Exponential backoff with jitter: base * 2^attempt + random(0..base)
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts) +
        Math.random() * INITIAL_RECONNECT_DELAY,
      MAX_RECONNECT_DELAY
    );

    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // ─── Ack Timeout Checker ───────────────────────────────────────────

  function startAckChecker(): void {
    stopAckChecker();

    ackCheckTimer = setInterval(() => {
      const ctx = store.getSnapshot().context as SyncStoreContext;
      const now = Date.now();

      for (const mutation of ctx._sync.pending) {
        if (now - mutation.sentAt > ackTimeout) {
          // Timed out — treat as rejection
          store.send({
            type: 'sync.ack',
            ref: mutation.ref,
            ok: false,
            error: 'Mutation timeout',
          });

          // Clean up in-flight tracking
          const key = `${mutation.table}:${mutation.rowId}`;
          if (inFlightRows.get(key) === mutation.ref) {
            inFlightRows.delete(key);
            // Try to flush queued mutations for this row
            flushRowQueue(key);
          }
        }
      }
    }, ACK_CHECK_INTERVAL);
  }

  function stopAckChecker(): void {
    if (ackCheckTimer !== null) {
      clearInterval(ackCheckTimer);
      ackCheckTimer = null;
    }
  }

  // ─── Same-Row Serialization ────────────────────────────────────────

  /**
   * When an ack arrives for a ref, check if there are queued mutations
   * for the same row and send the next one.
   */
  function handleAckForQueue(ref: string): void {
    // Find which row this ref belongs to
    for (const [key, inFlightRef] of inFlightRows.entries()) {
      if (inFlightRef === ref) {
        inFlightRows.delete(key);
        flushRowQueue(key);
        break;
      }
    }
  }

  /**
   * Send the next queued mutation for a given row key, if any.
   */
  function flushRowQueue(key: string): void {
    const queue = rowQueue.get(key);
    if (!queue || queue.length === 0) {
      rowQueue.delete(key);
      return;
    }

    const next = queue.shift()!;
    if (queue.length === 0) {
      rowQueue.delete(key);
    }

    // Apply optimistically
    store.send(next.storeEvent as any);

    // Track as in-flight
    inFlightRows.set(key, next.message.ref);

    // Send over WS (or buffer)
    sendMessage(JSON.stringify(next.message));
  }

  /**
   * Clear queued/in-flight mutations made authoritative by a snapshot.
   *
   * Snapshot payloads only include requested full-sync tables. Lazy tables are
   * omitted by design, so their mutation tracking remains active until ack,
   * catchup, timeout, or a later snapshot that explicitly includes the table.
   */
  function clearSnapshotTrackedRows(snapshotTables: Set<string>): void {
    if (snapshotTables.size === 0) return;

    for (const key of Array.from(rowQueue.keys())) {
      if (snapshotTables.has(getTableFromRowKey(key))) {
        rowQueue.delete(key);
      }
    }

    for (const key of Array.from(inFlightRows.keys())) {
      if (snapshotTables.has(getTableFromRowKey(key))) {
        inFlightRows.delete(key);
      }
    }
  }

  function getTableFromRowKey(key: string): string {
    const delimiter = key.indexOf(':');
    return delimiter === -1 ? key : key.slice(0, delimiter);
  }

  // ─── Send Helpers ──────────────────────────────────────────────────

  /**
   * Send a message over WS, or buffer it if disconnected.
   */
  function sendMessage(data: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      sendBuffer.push(data);
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────

  function insert(table: string, row: Row): void {
    if (disposed) return;

    const pk = tableDefs[table]?._pk;
    if (!pk) throw new Error(`Unknown table: ${table}`);

    row = ensureRowSyncPrimaryKey(table, tableDefs[table], row);
    const rowId = String(row[pk]);

    const ref = crypto.randomUUID();
    const key = `${table}:${rowId}`;

    const mutateMsg: SyncMutateMessage = {
      type: 'sync.mutate',
      ref,
      table,
      op: 'INSERT',
      row,
    };

    const storeEvent = {
      type: 'optimistic.insert' as const,
      table,
      rowId,
      row,
      ref,
    };

    // If there's already an in-flight mutation for this row, queue it
    if (inFlightRows.has(key)) {
      const queue = rowQueue.get(key) ?? [];
      queue.push({ message: mutateMsg, storeEvent });
      rowQueue.set(key, queue);
      return;
    }

    // Apply optimistically
    store.send(storeEvent);

    // Track as in-flight
    inFlightRows.set(key, ref);

    // Send to server
    sendMessage(JSON.stringify(mutateMsg));
  }

  function update(table: string, id: string, partial: Partial<Row>): void {
    if (disposed) return;

    const pk = tableDefs[table]?._pk;
    if (!pk) throw new Error(`Unknown table: ${table}`);

    const ref = crypto.randomUUID();
    const key = `${table}:${id}`;

    const mutateMsg: SyncMutateMessage = {
      type: 'sync.mutate',
      ref,
      table,
      op: 'UPDATE',
      rowId: id,
      row: partial,
    };

    const storeEvent = {
      type: 'optimistic.update' as const,
      table,
      rowId: id,
      partial,
      ref,
    };

    // If there's already an in-flight mutation for this row, queue it
    if (inFlightRows.has(key)) {
      const queue = rowQueue.get(key) ?? [];
      queue.push({ message: mutateMsg, storeEvent });
      rowQueue.set(key, queue);
      return;
    }

    // Apply optimistically
    store.send(storeEvent);

    // Track as in-flight
    inFlightRows.set(key, ref);

    // Send to server
    sendMessage(JSON.stringify(mutateMsg));
  }

  function deleteFn(table: string, id: string): void {
    if (disposed) return;

    const pk = tableDefs[table]?._pk;
    if (!pk) throw new Error(`Unknown table: ${table}`);

    const ref = crypto.randomUUID();
    const key = `${table}:${id}`;

    const mutateMsg: SyncMutateMessage = {
      type: 'sync.mutate',
      ref,
      table,
      op: 'DELETE',
      rowId: id,
    };

    const storeEvent = {
      type: 'optimistic.delete' as const,
      table,
      rowId: id,
      ref,
    };

    // If there's already an in-flight mutation for this row, queue it
    if (inFlightRows.has(key)) {
      const queue = rowQueue.get(key) ?? [];
      queue.push({ message: mutateMsg, storeEvent });
      rowQueue.set(key, queue);
      return;
    }

    // Apply optimistically
    store.send(storeEvent);

    // Track as in-flight
    inFlightRows.set(key, ref);

    // Send to server
    sendMessage(JSON.stringify(mutateMsg));
  }

  // ─── Disconnect ────────────────────────────────────────────────────

  function disconnect(): void {
    if (disposed) return;
    disposed = true;

    // Clear timers
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopAckChecker();

    // Close WS
    if (ws) {
      ws.onclose = null; // Prevent reconnect trigger
      ws.close(1000, 'Client disconnect');
      ws = null;
    }

    // Clear buffers
    sendBuffer.length = 0;
    rowQueue.clear();
    inFlightRows.clear();

    // Update store
    store.send({ type: 'sync.disconnected' });
  }

  // ─── Connect on creation ──────────────────────────────────────────

  if (autoConnect) connect();

  // ─── Public API ────────────────────────────────────────────────────

  return {
    get store() {
      return store;
    },
    get tables() {
      return tableDefs;
    },
    get connected() {
      return (store.getSnapshot().context as SyncStoreContext)._sync.connected;
    },
    insert,
    update,
    delete: deleteFn,

    sendRaw(msg: object): void {
      sendMessage(JSON.stringify(msg));
    },

    connect,

    onMessage(handler: (msg: { type: string; [key: string]: unknown }) => void): () => void {
      messageHandlers.add(handler);
      return () => { messageHandlers.delete(handler); };
    },

    disconnect,
  };
}
