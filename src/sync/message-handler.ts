/**
 * message-handler.ts
 *
 * Routes WebSocket wire-protocol messages to sync, state, and ephemeral
 * handlers. This file owns message validation and dispatch only; database
 * persistence, auth resolution, and policy definitions live in separate modules.
 */

import type { ServerWebSocket } from 'bun';
import type { ReactiveDB } from './reactive-db';
import type {
  SyncSocketData,
  SyncSubscribeMessage,
  SyncMutateMessage,
  SyncChangeMessage,
  SyncSnapshotMessage,
  SyncCatchupMessage,
  SyncAckMessage,
  StateSetMessage,
  StateDeleteMessage,
  StateClearMessage,
  EphemeralSubscribeMessage,
  EphemeralUnsubscribeMessage,
  EphemeralSetMessage,
  EphemeralDeleteMessage,
  Row,
} from './types';
import type { StateManager } from './state-manager';
import type { EphemeralStateManager } from './ephemeral-manager';
import {
  handleStateSubscribe,
  handleStateSet,
  handleStateDelete,
  handleStateClear,
} from './state-handler';
import {
  handleEphemeralSubscribe,
  handleEphemeralUnsubscribe,
  handleEphemeralSet,
  handleEphemeralDelete,
} from './ephemeral-handler';
import { allowAllSyncPolicy, evaluateSyncMutationPolicy } from './sync-policy';
import type { SyncPolicy } from './sync-policy';

/**
 * Route an incoming WebSocket message to the appropriate handler.
 *
 * Accepts either a raw JSON string or a pre-parsed object (Elysia
 * auto-parses JSON WebSocket messages into objects).
 */
export function routeMessage(
  ws: ServerWebSocket<SyncSocketData>,
  raw: string | Record<string, unknown>,
  db: ReactiveDB,
  server: { publish: (topic: string, data: string) => void },
  stateManager?: StateManager | null,
  ephemeralManager?: EphemeralStateManager | null,
  policy: SyncPolicy = allowAllSyncPolicy,
  snapshotTables?: Set<string>
): void {
  let msg: { type: string; [key: string]: unknown };

  if (typeof raw === 'string') {
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // Malformed JSON — ignore
    }
  } else if (raw && typeof raw === 'object') {
    msg = raw as { type: string; [key: string]: unknown };
  } else {
    return; // Unsupported format
  }

  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'sync.subscribe':
      handleSubscribe(ws, msg as unknown as SyncSubscribeMessage, db, snapshotTables);
      break;
    case 'sync.mutate':
      handleMutate(ws, msg as unknown as SyncMutateMessage, db, server, policy);
      break;
    case 'state.subscribe':
      if (stateManager) handleStateSubscribe(ws, stateManager, server);
      break;
    case 'state.set':
      if (stateManager) handleStateSet(ws, msg as unknown as StateSetMessage, stateManager, server);
      break;
    case 'state.delete':
      if (stateManager) handleStateDelete(ws, msg as unknown as StateDeleteMessage, stateManager, server);
      break;
    case 'state.clear':
      if (stateManager) handleStateClear(ws, msg as unknown as StateClearMessage, stateManager, server);
      break;
    case 'ephemeral.subscribe':
      if (ephemeralManager) handleEphemeralSubscribe(ws, msg as unknown as EphemeralSubscribeMessage, ephemeralManager, server.publish.bind(server));
      break;
    case 'ephemeral.unsubscribe':
      if (ephemeralManager) handleEphemeralUnsubscribe(ws, msg as unknown as EphemeralUnsubscribeMessage, ephemeralManager);
      break;
    case 'ephemeral.set':
      if (ephemeralManager) handleEphemeralSet(ws, msg as unknown as EphemeralSetMessage, ephemeralManager, server);
      break;
    case 'ephemeral.delete':
      if (ephemeralManager) handleEphemeralDelete(ws, msg as unknown as EphemeralDeleteMessage, ephemeralManager, server);
      break;
    default:
      // Unknown message type — ignore
      break;
  }
}

/**
 * Handle sync.subscribe — subscribe to tables and send snapshot or catchup.
 *
 * Server response logic:
 * - lastSeq === 0 → send sync.snapshot with full table contents
 * - lastSeq > 0 and gap within ring buffer → send sync.catchup
 * - lastSeq > 0 but gap exceeds ring buffer → send sync.snapshot (full resync)
 */
function handleSubscribe(
  ws: ServerWebSocket<SyncSocketData>,
  msg: SyncSubscribeMessage,
  db: ReactiveDB,
  snapshotTables?: Set<string>
): void {
  const { tables, lastSeq } = msg;
  if (!Array.isArray(tables) || typeof lastSeq !== 'number') return;

  // Intersect requested tables with allowed tables
  const allowed = ws.data.allowedTables;
  const subscribeTables = tables.filter((t) => allowed.has(t) && db.hasTable(t));

  // Determine which tables to include in snapshot. A platform app may provide
  // snapshotTables to enforce resolved lazy/full modes server-side.
  const snapshotList = (msg.snapshot ?? []).filter((table) =>
    subscribeTables.includes(table) && (!snapshotTables || snapshotTables.has(table))
  );

  // Subscribe to Bun pub/sub topics for ALL requested tables (live changes flow for all)
  for (const table of subscribeTables) {
    const topic = `sync:${table}`;
    if (!ws.data.subscribedTopics.has(topic)) {
      ws.subscribe(topic);
      ws.data.subscribedTopics.add(topic);
    }
  }

  if (lastSeq === 0) {
    // Fresh connect — send snapshot (only for snapshotList tables)
    sendSnapshot(ws, snapshotList, db);
  } else {
    // Reconnect — try catchup from ring buffer
    const changes = db.getChangesAfter(lastSeq);
    if (changes === null) {
      // Gap too large (seq pruned from ring buffer) — send full snapshot
      sendSnapshot(ws, snapshotList, db);
    } else if (changes.length === 0) {
      // Already up to date — send empty snapshot to confirm seq
      const snapshot: SyncSnapshotMessage = {
        type: 'sync.snapshot',
        tables: {},
        seq: db.currentSeq,
      };
      ws.send(JSON.stringify(snapshot));
      ws.data.lastSeq = db.currentSeq;
    } else {
      // Send catchup — only changes for subscribed tables
      const filteredChanges = changes
        .filter((c) => subscribeTables.includes(c.table))
        .map((c) => ({
          seq: c.seq,
          table: c.table,
          op: c.op,
          rowId: c.rowId,
          row: c.row,
          origin: '', // Historical changes have no meaningful origin
          ts: c.ts,
        }));

      const catchup: SyncCatchupMessage = {
        type: 'sync.catchup',
        changes: filteredChanges,
        seq: db.currentSeq,
      };
      ws.send(JSON.stringify(catchup));
      ws.data.lastSeq = db.currentSeq;
    }
  }
}

/**
 * Build and send a full snapshot of all subscribed tables.
 */
function sendSnapshot(
  ws: ServerWebSocket<SyncSocketData>,
  tables: string[],
  db: ReactiveDB
): void {
  const tableData: Record<string, Record<string, Row>> = {};

  for (const table of tables) {
    const rows = db.query(table);
    const keyed: Record<string, Row> = {};

    // We need the primary key — get it from the table name
    // ReactiveDB stores TableDef internally; for snapshots we key by the first column
    // that looks like a PK. Since we always have the full row, use the 'id' convention
    // or find the PK from the row itself.
    // Actually, we need the PK info. Let's add a method to ReactiveDB for this.
    // For now, we'll use the rows as-is and let the client determine PK from its table defs.

    // Key rows by their primary key
    for (const row of rows) {
      // Get PK value — we need ReactiveDB to expose this
      const pkValue = getRowPrimaryKey(db, table, row);
      keyed[pkValue] = row;
    }

    tableData[table] = keyed;
  }

  const snapshot: SyncSnapshotMessage = {
    type: 'sync.snapshot',
    tables: tableData,
    seq: db.currentSeq,
  };

  ws.send(JSON.stringify(snapshot));
  ws.data.lastSeq = db.currentSeq;
}

/**
 * Get the primary key value from a row for a given table.
 */
function getRowPrimaryKey(db: ReactiveDB, table: string, row: Row): string {
  const pkColumn = db.getPrimaryKey(table);
  return String(row[pkColumn]);
}

/**
 * Handle sync.mutate — validate, apply to ReactiveDB, ack, publish.
 *
 * Flow:
 * 1. Validate table exists and client may mutate it
 * 2. Apply to ReactiveDB (which triggers onChange → server.publish)
 * 3. Send sync.ack to the originating client
 *
 * Note: The onChange listener in the sync plugin publishes sync.change
 * to ALL subscribers via server.publish(). The ack is sent AFTER the
 * publish (order doesn't matter — they serve different purposes).
 */
function handleMutate(
  ws: ServerWebSocket<SyncSocketData>,
  msg: SyncMutateMessage,
  db: ReactiveDB,
  server: { publish: (topic: string, data: string) => void },
  policy: SyncPolicy
): void {
  const { ref, table, op, rowId, row } = msg;

  if (!ref || typeof ref !== 'string') return;
  if (!table || typeof table !== 'string') return;
  if (!op || !['INSERT', 'UPDATE', 'DELETE'].includes(op)) return;

  // Check table exists
  if (!db.hasTable(table)) {
    sendAck(ws, ref, false, null, `Unknown table: ${table}`);
    return;
  }

  const policyDecision = evaluateSyncMutationPolicy(policy, {
    table,
    op,
    rowId,
    row,
    authContext: ws.data.authContext,
  });
  if (!policyDecision.ok) {
    sendAck(ws, ref, false, null, policyDecision.reason ?? `Not allowed: ${table}`);
    return;
  }

  try {
    let change;

    switch (op) {
      case 'INSERT': {
        if (!row || typeof row !== 'object') {
          sendAck(ws, ref, false, null, 'INSERT requires a row');
          return;
        }
        // Store the connection ID on a thread-local-like variable so the
        // onChange listener can include it in the published message
        currentMutationOrigin = ws.data.connectionId;
        change = db.insert(table, row as Row);
        currentMutationOrigin = null;
        break;
      }

      case 'UPDATE': {
        if (!rowId || typeof rowId !== 'string') {
          sendAck(ws, ref, false, null, 'UPDATE requires rowId');
          return;
        }
        if (!row || typeof row !== 'object') {
          sendAck(ws, ref, false, null, 'UPDATE requires row (partial)');
          return;
        }
        currentMutationOrigin = ws.data.connectionId;
        change = db.update(table, rowId, row as Partial<Row>);
        currentMutationOrigin = null;

        if (!change) {
          sendAck(ws, ref, false, null, `Row not found: ${rowId}`);
          return;
        }
        break;
      }

      case 'DELETE': {
        if (!rowId || typeof rowId !== 'string') {
          sendAck(ws, ref, false, null, 'DELETE requires rowId');
          return;
        }
        currentMutationOrigin = ws.data.connectionId;
        change = db.delete(table, rowId);
        currentMutationOrigin = null;

        if (!change) {
          sendAck(ws, ref, false, null, `Row not found: ${rowId}`);
          return;
        }
        break;
      }
    }

    // Ack success — sent AFTER server.publish (which happened in onChange)
    sendAck(ws, ref, true, change?.seq ?? null);
  } catch (err) {
    currentMutationOrigin = null;
    const message = err instanceof Error ? err.message : 'Internal error';
    sendAck(ws, ref, false, null, message);
  }
}

function sendAck(
  ws: ServerWebSocket<SyncSocketData>,
  ref: string,
  ok: boolean,
  seq: number | null,
  error?: string
): void {
  const ack: SyncAckMessage = { type: 'sync.ack', ref, seq, ok };
  if (error) ack.error = error;
  ws.send(JSON.stringify(ack));
}

/**
 * Module-level variable to track which connection originated the current mutation.
 * Set before db.insert/update/delete, read in the onChange listener, cleared after.
 *
 * This is safe because bun:sqlite is synchronous and single-threaded —
 * the entire write + onChange + publish sequence completes before yielding.
 */
export let currentMutationOrigin: string | null = null;
