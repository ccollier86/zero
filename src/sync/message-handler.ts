/**
 * message-handler.ts
 *
 * Routes WebSocket wire-protocol messages to sync, state, and ephemeral
 * handlers. This file owns message validation and dispatch only; database
 * persistence, auth resolution, and policy definitions live in separate modules.
 */

import type { ServerWebSocket } from 'bun';
import {
  withReactiveDBLocalChangeOrigin,
  type ReactiveDB,
} from './reactive-db';
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
  SyncResourceMutationScope,
  SyncTableMutationValidator,
} from './types';
import type { StateManager } from './state-manager';
import type { EphemeralStateManager } from './ephemeral-manager';
import type { EphemeralChannel } from './ephemeral-channel';
import {
  handleStateSubscribe,
  handleStateSet,
  handleStateDelete,
  handleStateClear,
  sendInvalidStateRequest,
} from './state-handler';
import { isJsonValue } from './state-manager';
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
import { validateSyncMutation } from './sync-mutation-validation';

/**
 * Plugin-local mutation metadata shared only by one sync transport and its
 * ReactiveDB change listener.
 */
export interface SyncMutationOriginContext {
  current: string | null;
}

/**
 * Legacy origin observer for callers that invoke routeMessage() directly.
 * createSyncPlugin always supplies an instance-local context and never reads
 * this compatibility value.
 */
export let currentMutationOrigin: string | null = null;

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
  mutationOrigin?: SyncMutationOriginContext,
  mutationValidators?: Readonly<Record<string, SyncTableMutationValidator>>,
  ephemeralChannel?: EphemeralChannel | null,
  tenancyMode: 'single' | 'multi' = 'single',
  revalidateMutationAuthority?: () => Promise<boolean>,
  validateMutationAuthorityAtCommit?: () => boolean,
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
        mutationOrigin,
        mutationValidators,
        revalidateMutationAuthority,
        validateMutationAuthorityAtCommit,
      );
      break;
    case 'state.subscribe':
      if (stateManager) handleStateSubscribe(
        ws,
        stateManager,
        server,
        tenancyMode,
        validateMutationAuthorityAtCommit,
      );
      break;
    case 'state.set':
      if (stateManager) {
        if (!isValidStateRef(msg.ref)
          || typeof msg.key !== 'string'
          || !Object.hasOwn(msg, 'value')
          || !isJsonValue(msg.value)) {
          sendInvalidStateRequest(ws, safeStateRef(msg.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          db,
          ws.data.connectionId,
          () => handleStateSet(
            ws,
            msg as unknown as StateSetMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'state.delete':
      if (stateManager) {
        if (!isValidStateRef(msg.ref) || typeof msg.key !== 'string') {
          sendInvalidStateRequest(ws, safeStateRef(msg.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          db,
          ws.data.connectionId,
          () => handleStateDelete(
            ws,
            msg as unknown as StateDeleteMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'state.clear':
      if (stateManager) {
        if (!isValidStateRef(msg.ref)) {
          sendInvalidStateRequest(ws, safeStateRef(msg.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          db,
          ws.data.connectionId,
          () => handleStateClear(
            ws,
            msg as unknown as StateClearMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'ephemeral.subscribe':
      if (ephemeralChannel) {
        await ephemeralChannel.subscribe(ws, msg.topic);
      } else if (ephemeralManager) {
        handleEphemeralSubscribe(ws, msg as unknown as EphemeralSubscribeMessage, ephemeralManager, server.publish.bind(server));
      }
      break;
    case 'ephemeral.unsubscribe':
      if (ephemeralChannel) {
        ephemeralChannel.unsubscribe(ws, msg.topic);
      } else if (ephemeralManager) {
        handleEphemeralUnsubscribe(ws, msg as unknown as EphemeralUnsubscribeMessage, ephemeralManager);
      }
      break;
    case 'ephemeral.set':
      if (ephemeralChannel) {
        await ephemeralChannel.set(ws, {
          topic: msg.topic,
          key: msg.key,
          value: msg.value,
          ttl: msg.ttl,
        });
      } else if (ephemeralManager) {
        handleEphemeralSet(ws, msg as unknown as EphemeralSetMessage, ephemeralManager, server);
      }
      break;
    case 'ephemeral.delete':
      if (ephemeralChannel) {
        await ephemeralChannel.delete(ws, msg.topic, msg.key);
      } else if (ephemeralManager) {
        handleEphemeralDelete(ws, msg as unknown as EphemeralDeleteMessage, ephemeralManager, server);
      }
      break;
    default:
      // Unknown message type — ignore
      break;
  }
}

const MAX_STATE_REF_LENGTH = 128;

function isValidStateRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STATE_REF_LENGTH;
}

function safeStateRef(value: unknown): string {
  return isValidStateRef(value) ? value : '';
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
  mutationOrigin?: SyncMutationOriginContext,
  mutationValidators?: Readonly<Record<string, SyncTableMutationValidator>>,
  revalidateMutationAuthority?: () => Promise<boolean>,
  validateMutationAuthorityAtCommit?: () => boolean,
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
  let mutationScope: SyncResourceMutationScope | undefined;
  let mutationExpectedRow: Row | undefined;
  let mutationCreateOnly = false;
  let mutationAuthorityFingerprint: string | undefined;
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
    mutationScope = resourceDecision.scope;
    mutationExpectedRow = resourceDecision.expectedRow;
    mutationCreateOnly = resourceDecision.createOnly ?? false;
    mutationAuthorityFingerprint = resourceDecision.authorityFingerprint;
  }

  // Custom resource policies may yield. Re-resolve the socket's live token,
  // tenant generations, assignments, and effective policy after that work and
  // immediately before the remaining synchronous write boundary.
  if (revalidateMutationAuthority
    && !await revalidateMutationAuthority()) {
    sendAck(ws, ref, false, null, 'Authorization changed during mutation');
    return;
  }

  const validation = validateSyncMutation(
    db,
    table,
    op,
    rowId,
    mutationRow,
    mutationValidators?.[table],
  );
  if (!validation.ok) {
    sendAck(ws, ref, false, null, validation.error);
    return;
  }
  mutationRow = validation.row;

  try {
    let ack: SyncAckMessage | undefined;
    const previousOrigin = mutationOrigin
      ? mutationOrigin.current
      : currentMutationOrigin;
    if (mutationOrigin) {
      mutationOrigin.current = ws.data.connectionId;
    } else {
      currentMutationOrigin = ws.data.connectionId;
    }
    try {
      withReactiveDBLocalChangeOrigin(db, ws.data.connectionId, () => db.transaction(() => {
        if (validateMutationAuthorityAtCommit
          && !validateMutationAuthorityAtCommit()) {
          throw new Error('Authorization changed during mutation');
        }
        if (mutationAuthorityFingerprint
          && !(resourcePolicy?.validateMutationAuthorityAtCommit?.(
            ws.data.authContext,
            mutationAuthorityFingerprint,
          ) ?? true)) {
          throw new Error('Authorization changed during mutation');
        }
        const raced = receipts?.find(principal, ref, requestHash);
        if (raced?.status === 'conflict') throw new Error('Mutation reference conflict');
        if (raced?.status === 'hit') {
          ack = raced.ack;
          return;
        }
        const change = applyMutation(
          db,
          table,
          op,
          rowId,
          mutationRow,
          mutationScope,
          mutationExpectedRow,
          mutationCreateOnly,
        );
        ack = createSuccessAck(ref, change);
        receipts?.save(principal, ref, requestHash, ack);
      }));
    } finally {
      if (mutationOrigin) {
        mutationOrigin.current = previousOrigin;
      } else {
        currentMutationOrigin = previousOrigin;
      }
    }
    if (ack) sendResolvedAck(ws, db, ack);
  } catch (err) {
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
  scope?: SyncResourceMutationScope,
  expectedRow?: Row,
  createOnly = false,
): Change {
  if (op === 'INSERT') {
    return scope
      ? db.createScoped(table, row as Row, scope)
      : createOnly
        ? db.createStrict(table, row as Row)
        : db.insert(table, row as Row);
  }
  const change = op === 'UPDATE'
    ? scope
      ? db.updateScoped(table, rowId!, row as Partial<Row>, scope, expectedRow)
      : expectedRow
        ? db.updateIfCurrent(table, rowId!, row as Partial<Row>, expectedRow)
        : db.update(table, rowId!, row as Partial<Row>)
    : scope
      ? db.deleteScoped(table, rowId!, scope, expectedRow)
      : expectedRow
        ? db.deleteIfCurrent(table, rowId!, expectedRow)
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
    ? `user:${ws.data.authContext.userId}:scope:${ws.data.authorizationScope ?? 'unresolved'}`
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
  const projectedRow = row
    ? ws.data.resourceRowProjectors?.get(table)?.project(row) ?? row
    : null;
  sendSyncWire(ws, {
    ...ack,
    seq: db.currentSeq,
    change: readable && projectedRow && matches
      ? { table, rowId, op: 'UPDATE', row: projectedRow }
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
