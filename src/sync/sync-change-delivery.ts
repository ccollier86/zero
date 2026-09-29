/**
 * sync-change-delivery.ts
 *
 * Projects each database change for every subscribed socket and queues it
 * directly so delivery status and per-socket sequence continuity are known.
 */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import { sendSyncWire, waitForSyncDrain } from './sync-wire-send';
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
      deferred.push({ change: projected, epoch, origin });
      continue;
    }

    const message = syncChangeMessage(socket, projected, epoch, origin);
    if (sendSyncWire(socket, message)) socket.data.lastSeq = change.seq;
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
    for (const item of deferred) {
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
