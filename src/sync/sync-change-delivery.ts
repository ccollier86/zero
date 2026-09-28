/**
 * sync-change-delivery.ts
 *
 * Projects each database change for every subscribed socket and queues it
 * directly so delivery status and per-socket sequence continuity are known.
 */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import { sendSyncWire } from './sync-wire-send';
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
    if (!validateCurrentAuthority(socket)) continue;
    const projected = projectSyncChange(
      change,
      socket.data.resourceRowFilters.get(change.table),
      socket.data.resourceRowProjectors?.get(change.table),
    );
    if (!projected) continue;

    const message: SyncChangeMessage = {
      type: 'sync.change',
      ...projected,
      prevSeq: socket.data.lastSeq,
      epoch,
      scope: socket.data.authorizationScope,
      origin,
    };
    if (sendSyncWire(socket, message)) socket.data.lastSeq = change.seq;
  }
}
