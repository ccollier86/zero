/** Privacy-safe acknowledgement and error projection for tenant Sync writes. */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import { sendSyncWire } from './sync-wire-send';
import { SYNC_ACK_ERROR_CODES } from './types';
import type {
  Change,
  SyncAckErrorCode,
  SyncAckMessage,
  SyncSocketData,
} from './types';

/** Send the canonical committed row only after the final read-authority fence. */
export function sendTenantCanonicalAck(
  socket: ServerWebSocket<SyncSocketData>,
  ref: string,
  table: string,
  change: Change,
  assertCurrentReadAuthority: () => void = () => undefined,
): void {
  try {
    const projected = socket.data.allowedTables.has(table)
      ? projectSyncChange(
        change,
        socket.data.resourceRowFilters.get(table),
        socket.data.resourceRowProjectors?.get(table),
      )
      : null;
    const canonical = projected?.row
      ? {
        table,
        rowId: projected.rowId,
        op: 'UPDATE' as const,
        row: projected.row,
      }
      : { table, rowId: change.rowId, op: 'DELETE' as const, row: null };
    // A custom projector may synchronously invalidate its backing authority.
    // Recheck after projection at the final row-bearing wire boundary.
    assertCurrentReadAuthority();
    sendSyncWire(socket, {
      type: 'sync.ack',
      plane: 'tenant',
      ref,
      seq: change.seq,
      ok: true,
      change: canonical,
    });
  } catch (error) {
    // The write/receipt is already durable and the managed fence has closed the
    // socket. Silence only that known boundary so reconnect can replay truth.
    if (isDatabaseAuthorityChanged(error)) return;
    closeAfterCommittedAckFailure(socket);
  }
}

export function safeTenantMutationError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (code === 'DATABASE_AUTHORITY_CHANGED') {
      return 'Authorization changed during mutation';
    }
    if (code === 'DATABASE_CONFLICT') return 'Mutation conflict';
    if (code === 'DATABASE_HISTORY_GAP') return 'Mutation outcome requires resync';
    if (code === 'DATABASE_PAYLOAD_INVALID'
      || code === 'DATABASE_PAYLOAD_LIMIT') return 'Invalid mutation payload';
    if (code === 'DATABASE_OPERATION_UNSUPPORTED') return 'Mutation is not supported';
  }
  return error instanceof Error && error.message.startsWith('Tenant Sync actor returned')
    ? 'Mutation result was invalid; reconnect required'
    : 'Mutation failed';
}

export function sendExpiredTenantMutationReceiptAck(
  socket: ServerWebSocket<SyncSocketData>,
  ref: string,
): void {
  sendTenantAck(
    socket,
    ref,
    false,
    null,
    'Mutation result expired; current synchronized state is authoritative',
    SYNC_ACK_ERROR_CODES.mutationReceiptExpired,
  );
}

export function sendTenantMutationCapacityExhaustedAck(
  socket: ServerWebSocket<SyncSocketData>,
  ref: string,
): void {
  sendTenantAck(
    socket,
    ref,
    false,
    null,
    'Mutation capacity is exhausted; new mutations are not accepted',
    SYNC_ACK_ERROR_CODES.mutationCapacityExhausted,
  );
}

export function isTenantSyncMutationCapacityExhausted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  try {
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    const details = Object.getOwnPropertyDescriptor(error, 'details');
    if (!code || !('value' in code)
      || code.value !== 'DATABASE_CAPACITY_EXHAUSTED'
      || !details || !('value' in details)
      || !details.value || typeof details.value !== 'object'
      || Array.isArray(details.value)) return false;
    const prototype = Object.getPrototypeOf(details.value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const capacityType = Object.getOwnPropertyDescriptor(
      details.value,
      'capacityType',
    );
    return Boolean(
      capacityType
      && 'value' in capacityType
      && capacityType.value === 'receipts',
    );
  } catch {
    return false;
  }
}

export function sendTenantAck(
  socket: ServerWebSocket<SyncSocketData>,
  ref: string,
  ok: boolean,
  seq: number | null,
  error?: string,
  errorCode?: SyncAckErrorCode,
): void {
  const ack: SyncAckMessage = { type: 'sync.ack', plane: 'tenant', ref, ok, seq };
  if (error) ack.error = error;
  if (errorCode) ack.errorCode = errorCode;
  sendSyncWire(socket, ack);
}

function isDatabaseAuthorityChanged(error: unknown): boolean {
  return Boolean(error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'DATABASE_AUTHORITY_CHANGED');
}

function closeAfterCommittedAckFailure(
  socket: ServerWebSocket<SyncSocketData>,
): void {
  try {
    socket.close(1011, 'Tenant Sync acknowledgement projection failed');
  } catch {
    // The durable receipt remains authoritative even if closing also fails.
  }
}
