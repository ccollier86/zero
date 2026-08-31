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
  SyncAckMessage,
  StateSetMessage,
  StateDeleteMessage,
  StateClearMessage,
  EphemeralSubscribeMessage,
  EphemeralUnsubscribeMessage,
  EphemeralSetMessage,
  EphemeralDeleteMessage,
  Row,
  Change,
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
import { handleSyncSubscribe } from './sync-subscribe-handler';
import { sendSyncWire } from './sync-wire-send';
import {
  hashSyncMutation,
  type SyncMutationReceiptStore,
} from './sync-mutation-receipt-store';

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
  resourcePolicy?: SyncResourcePolicyAdapter,
  mutationReceipts?: SyncMutationReceiptStore,
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
      handleSyncSubscribe(ws, msg as unknown as SyncSubscribeMessage, db, snapshotTables);
      break;
    case 'sync.mutate':
      await handleMutate(
        ws,
        msg as unknown as SyncMutateMessage,
        db,
        policy,
        resourcePolicy,
        mutationReceipts,
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
 * Handle sync.mutate — validate, apply to ReactiveDB, ack, publish.
 *
 * Flow:
 * 1. Validate table exists and client may mutate it
 * 2. Apply to ReactiveDB (which triggers onChange → server.publish)
 * 3. Send sync.ack to the originating client
 *
 * Note: The onChange listener projects sync.change for each active socket and
 * checks direct-send status. The ack follows that committed change delivery.
 */
async function handleMutate(
  ws: ServerWebSocket<SyncSocketData>,
  msg: SyncMutateMessage,
  db: ReactiveDB,
  policy: SyncPolicy,
  resourcePolicy?: SyncResourcePolicyAdapter,
  receipts?: SyncMutationReceiptStore,
): Promise<void> {
  const { ref, table, op, rowId, row } = msg;

  if (!ref || typeof ref !== 'string' || ref.length > 128) return;
  if (!table || typeof table !== 'string') return;
  if (!op || !['INSERT', 'UPDATE', 'DELETE'].includes(op)) return;
  if (msg.epoch !== undefined && typeof msg.epoch !== 'string') return;
  if (msg.attempt !== undefined
    && (!Number.isSafeInteger(msg.attempt) || msg.attempt < 1)) return;

  // Check table exists
  if (!db.hasTable(table)) {
    sendAck(ws, ref, false, null, `Unknown table: ${table}`);
    return;
  }

  const principal = mutationPrincipal(ws);
  const requestHash = hashSyncMutation(msg);
  const receipt = receipts?.find(principal, ref, requestHash);
  if (receipt?.status === 'conflict') {
    sendAck(ws, ref, false, null, 'Mutation reference conflict');
    return;
  }
  if (receipt?.status === 'hit') {
    sendResolvedAck(ws, db, receipt.ack);
    return;
  }

  if ((msg.attempt ?? 1) > 1 || (msg.epoch && msg.epoch !== db.syncEpoch)) {
    sendAck(ws, ref, false, null, 'Mutation outcome unavailable; retry as new work');
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
    let ack: SyncAckMessage | undefined;
    currentMutationOrigin = ws.data.connectionId;
    db.transaction(() => {
      const raced = receipts?.find(principal, ref, requestHash);
      if (raced?.status === 'conflict') throw new Error('Mutation reference conflict');
      if (raced?.status === 'hit') {
        ack = raced.ack;
        return;
      }
      const change = applyMutation(db, table, op, rowId, mutationRow);
      ack = createSuccessAck(ref, change);
      receipts?.save(principal, ref, requestHash, ack);
    });
    currentMutationOrigin = null;
    if (ack) sendResolvedAck(ws, db, ack);
  } catch (err) {
    currentMutationOrigin = null;
    const message = err instanceof Error ? err.message : 'Internal error';
    sendAck(ws, ref, false, null, message);
  }
}

function applyMutation(
  db: ReactiveDB,
  table: string,
  op: SyncMutateMessage['op'],
  rowId: string | undefined,
  row: Row | Partial<Row> | undefined,
): Change {
  if (op === 'INSERT') return db.insert(table, row as Row);
  const change = op === 'UPDATE'
    ? db.update(table, rowId!, row as Partial<Row>)
    : db.delete(table, rowId!);
  if (!change) throw new Error(`Row not found: ${rowId!}`);
  return change;
}

function createSuccessAck(ref: string, change: Change): SyncAckMessage {
  return {
    type: 'sync.ack', ref, seq: change.seq, ok: true,
    change: {
      table: change.table, op: change.op, rowId: change.rowId, row: change.row,
    },
  };
}

function mutationPrincipal(ws: ServerWebSocket<SyncSocketData>): string {
  return ws.data.authContext
    ? `user:${ws.data.authContext.userId}`
    : `anonymous:${ws.data.authorizationScope ?? 'public'}`;
}

function sendResolvedAck(
  ws: ServerWebSocket<SyncSocketData>,
  db: ReactiveDB,
  ack: SyncAckMessage,
): void {
  if (!ack.change) return void sendSyncWire(ws, ack);
  const { table, rowId } = ack.change;
  const row = db.get(table, rowId);
  const readable = ws.data.allowedTables.has(table);
  const matches = row
    ? ws.data.resourceRowFilters.get(table)?.matches(row) ?? true
    : false;
  sendSyncWire(ws, {
    ...ack,
    seq: db.currentSeq,
    change: readable && row && matches
      ? { table, rowId, op: 'UPDATE', row }
      : { table, rowId, op: 'DELETE', row: null },
  });
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
  sendSyncWire(ws, ack);
}

/**
 * Module-level variable to track which connection originated the current mutation.
 * Set before db.insert/update/delete, read in the onChange listener, cleared after.
 *
 * This is safe because bun:sqlite is synchronous and single-threaded —
 * the entire write + onChange + publish sequence completes before yielding.
 */
export let currentMutationOrigin: string | null = null;
