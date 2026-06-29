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
  SyncResourcePolicyAdapter,
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
import { filterSyncRows, projectSyncChange } from './row-filter';

/**
 * Route an incoming WebSocket message to the appropriate handler.
 *
 * Accepts either a raw JSON string or a pre-parsed object (Elysia
 * auto-parses JSON WebSocket messages into objects).
 */
export async function routeMessage(
  ws: ServerWebSocket<SyncSocketData>,
  raw: string | Record<string, unknown>,
  db: ReactiveDB,
  server: { publish: (topic: string, data: string) => void },
  stateManager?: StateManager | null,
  ephemeralManager?: EphemeralStateManager | null,
  policy: SyncPolicy = allowAllSyncPolicy,
  snapshotTables?: Set<string>,
  resourcePolicy?: SyncResourcePolicyAdapter
): Promise<void> {
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
      await handleMutate(
        ws,
        msg as unknown as SyncMutateMessage,
        db,
        server,
        policy,
        resourcePolicy
      );
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
  const rowFilters = ws.data.resourceRowFilters ?? new Map();
  const rowFilteredSubscribedTables = ws.data.rowFilteredSubscribedTables ?? new Set();
  ws.data.resourceRowFilters = rowFilters;
  ws.data.rowFilteredSubscribedTables = rowFilteredSubscribedTables;

  // Determine which tables to include in snapshot. A platform app may provide
  // snapshotTables to enforce resolved lazy/full modes server-side.
  const snapshotList = (msg.snapshot ?? []).filter((table) =>
    subscribeTables.includes(table) && (!snapshotTables || snapshotTables.has(table))
  );

  // Subscribe to Bun pub/sub topics for unfiltered tables. Row-filtered tables
  // are delivered directly by sync.plugin.ts so they never receive broad table
  // broadcasts.
  for (const table of subscribeTables) {
    if (rowFilters.has(table)) {
      rowFilteredSubscribedTables.add(table);
      continue;
    }

    const topic = `sync:${table}`;
    if (!ws.data.subscribedTopics.has(topic)) {
      ws.subscribe(topic);
      ws.data.subscribedTopics.add(topic);
    }
  }

  if (lastSeq === 0) {
    // Fresh connect — send snapshot (only for snapshotList tables)
    sendSnapshot(ws, snapshotList, db, rowFilters);
  } else {
    // Reconnect — try catchup from ring buffer
    const changes = db.getChangesAfter(lastSeq);
    if (changes === null) {
      // Gap too large (seq pruned from ring buffer) — send full snapshot
      sendSnapshot(ws, snapshotList, db, rowFilters);
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
        .map((change) => projectSyncChange(change, rowFilters.get(change.table)))
        .filter((change): change is NonNullable<typeof change> => Boolean(change))
        .map((change) => ({
          ...change,
          origin: '', // Historical changes have no meaningful origin
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
  db: ReactiveDB,
  rowFilters?: Map<string, { matches(row: Row): boolean }>
): void {
  const tableData: Record<string, Record<string, Row>> = {};

  for (const table of tables) {
    const rows = filterSyncRows(db.query(table), rowFilters?.get(table));
    const keyed: Record<string, Row> = {};

    // Key rows by their primary key
    for (const row of rows) {
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
 * Note: The onChange listener in the sync plugin publishes sync.change through
 * broad table topics and per-connection row-filtered deliveries. The ack is
 * sent AFTER publish (order doesn't matter — they serve different purposes).
 */
async function handleMutate(
  ws: ServerWebSocket<SyncSocketData>,
  msg: SyncMutateMessage,
  db: ReactiveDB,
  server: { publish: (topic: string, data: string) => void },
  policy: SyncPolicy,
  resourcePolicy?: SyncResourcePolicyAdapter
): Promise<void> {
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

  let mutationRow = row;
  if (op === 'INSERT') {
    if (!mutationRow || typeof mutationRow !== 'object') {
      sendAck(ws, ref, false, null, 'INSERT requires a row');
      return;
    }
  } else if (op === 'UPDATE') {
    if (!rowId || typeof rowId !== 'string') {
      sendAck(ws, ref, false, null, 'UPDATE requires rowId');
      return;
    }
    if (!mutationRow || typeof mutationRow !== 'object') {
      sendAck(ws, ref, false, null, 'UPDATE requires row (partial)');
      return;
    }
  } else if (!rowId || typeof rowId !== 'string') {
    sendAck(ws, ref, false, null, 'DELETE requires rowId');
    return;
  }

  if (resourcePolicy) {
    const resourceDecision = await resourcePolicy.authorizeMutation({
      table,
      op,
      rowId,
      row: mutationRow,
      authContext: ws.data.authContext,
      loadRow: (tableName, id) => db.get(tableName, id),
    });

    if (!resourceDecision.ok) {
      sendAck(ws, ref, false, null, resourceDecision.reason);
      return;
    }

    if (resourceDecision.row !== undefined) {
      mutationRow = resourceDecision.row;
    }
  }

  try {
    let change;

    switch (op) {
      case 'INSERT': {
        // Store the connection ID on a thread-local-like variable so the
        // onChange listener can include it in the published message
        currentMutationOrigin = ws.data.connectionId;
        change = db.insert(table, mutationRow as Row);
        currentMutationOrigin = null;
        break;
      }

      case 'UPDATE': {
        currentMutationOrigin = ws.data.connectionId;
        change = db.update(table, rowId!, mutationRow as Partial<Row>);
        currentMutationOrigin = null;

        if (!change) {
          sendAck(ws, ref, false, null, `Row not found: ${rowId!}`);
          return;
        }
        break;
      }

      case 'DELETE': {
        currentMutationOrigin = ws.data.connectionId;
        change = db.delete(table, rowId!);
        currentMutationOrigin = null;

        if (!change) {
          sendAck(ws, ref, false, null, `Row not found: ${rowId!}`);
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
