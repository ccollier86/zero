/**
 * sync-change-delivery.ts
 *
 * Projects each database change for every subscribed socket and queues it
 * directly so delivery status and per-socket sequence continuity are known.
 */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import { sendSyncWire, waitForSyncDrain } from './sync-wire-send';
import { enqueueSyncReadDelivery, prepareSyncReadResult } from './sync-read-results';
import type { Change, SyncChangeMessage, SyncSocketData } from './types';

/** Deliver one committed change to every socket whose current scope can read it. */
export function deliverSyncChange(
  sockets: Iterable<ServerWebSocket<SyncSocketData>>,
  change: Change,
  epoch: string,
  origin: string,
  validateCurrentAuthority: (
    socket: ServerWebSocket<SyncSocketData>,
  ) => boolean = () => true,
): void {
  for (const socket of sockets) {
    if (socket.data.syncReadDeliveryClosed) continue;
    // A newly subscribed socket may already hold a snapshot/catch-up cursor
    // ahead of this runtime's durable dispatcher. Those retained rows are
    // represented by its baseline and must never be sent backwards.
    if (change.seq <= socket.data.lastSeq) continue;
    if (!socket.data.syncSubscribedTables.has(change.table)) continue;
    if (!socket.data.allowedTables.has(change.table)) continue;
    const projected = projectSyncChange(
      change,
      socket.data.resourceRowFilters.get(change.table),
      socket.data.resourceRowProjectors?.get(change.table),
    );
    if (!projected) continue;
    // Filters/projectors are trusted extension code and may touch mutable
    // authority. Fence after they return, at the final synchronous send edge.
    if (!validateCurrentAuthority(socket)) continue;

    if (socket.data.syncSnapshotInFlight) {
      const deferred = socket.data.syncDeferredChanges ??= [];
      if (socket.data.prepareReadResult) {
        const bytes = JSON.stringify(projected).length * 3;
        if (deferred.length >= 256 || (socket.data.syncDeferredChangeBytes ?? 0) + bytes > 8 * 1024 * 1024) {
          socket.data.syncReadDeliveryClosed = true;
          socket.data.syncDeferredChanges = []; socket.data.syncDeferredChangeBytes = 0;
          socket.close(1013, 'Bounded deferred delivery capacity exhausted'); continue;
        }
        socket.data.syncDeferredChangeBytes = (socket.data.syncDeferredChangeBytes ?? 0) + bytes;
      }
      deferred.push({ change: socket.data.prepareReadResult ? structuredClone(projected) : projected, epoch, origin });
      continue;
    }

    const message = syncChangeMessage(socket, projected, epoch, origin);
    if (socket.data.prepareReadResult) {
      if (message.row) message.row = structuredClone(message.row);
      enqueueSyncReadDelivery(socket, async () => {
        if (change.seq <= socket.data.lastSeq || !validateCurrentAuthority(socket)) return;
        if (message.row && projected.op !== 'DELETE') message.auditReceipt = await prepareSyncReadResult(socket, projected.table, [message.row], projected.seq, epoch);
        if (!validateCurrentAuthority(socket)) return;
        message.prevSeq = socket.data.lastSeq;
        if (sendSyncWire(socket, message)) { socket.data.lastSeq = change.seq; await waitForSyncDrain(socket); }
      }, JSON.stringify(message).length * 3);
    } else if (sendSyncWire(socket, message)) socket.data.lastSeq = change.seq;
  }
}

/** Deliver changes committed while an atomic default snapshot was streaming. */
export async function flushDeferredSyncChanges(
  socket: ServerWebSocket<SyncSocketData>,
  assertCurrentAuthority: () => void = () => undefined,
): Promise<boolean> {
  while (true) {
    const deferred = socket.data.syncDeferredChanges ?? [];
    if (deferred.length === 0) return true;
    socket.data.syncDeferredChanges = [];
    socket.data.syncDeferredChangeBytes = 0;
    for (const item of deferred) {
      if (socket.data.syncReadDeliveryClosed) return false;
      const change = item.change;
      if (change.seq <= socket.data.lastSeq) continue;
      if (!socket.data.syncSubscribedTables.has(change.table)) continue;
      if (!socket.data.allowedTables.has(change.table)) continue;
      const message = syncChangeMessage(
        socket,
        change,
        item.epoch,
        item.origin,
      );
      if (socket.data.prepareReadResult && message.row) message.row = structuredClone(message.row);
      assertCurrentAuthority();
      if (socket.data.prepareReadResult && message.row && change.op !== 'DELETE') message.auditReceipt = await prepareSyncReadResult(socket, change.table, [message.row], change.seq, item.epoch);
      assertCurrentAuthority();
      if (!sendSyncWire(socket, message)) return false;
      socket.data.lastSeq = change.seq;
      await waitForSyncDrain(socket);
    }
  }
}

function syncChangeMessage(
  socket: ServerWebSocket<SyncSocketData>,
  change: Change,
  epoch: string,
  origin: string,
): SyncChangeMessage {
  return {
      type: 'sync.change',
      ...(socket.data.syncMultiplexed ? { plane: 'default' as const } : {}),
      ...change,
      prevSeq: socket.data.lastSeq,
      epoch,
      scope: socket.data.authorizationScope,
      origin,
    };
}
