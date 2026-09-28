/**
 * sync-wire-send.ts
 *
 * Owns direct Sync protocol delivery and Bun send-status handling.
 */

import type { ServerWebSocket } from 'bun';
import type { ServerMessage, SyncSocketData } from './types';

/** Queue one Sync message, closing the socket when Bun reports a dropped send. */
export function sendSyncWire(
  socket: ServerWebSocket<SyncSocketData>,
  message: ServerMessage,
): boolean {
  try {
    const status = socket.send(JSON.stringify(message));
    if (status === 0) {
      socket.close(1013, 'Sync delivery interrupted');
      return false;
    }
    if (status === -1) socket.data.syncBackpressured = true;
    return true;
  } catch {
    socket.close(1013, 'Sync delivery interrupted');
    return false;
  }
}

/** Mark a Bun socket writable again after its queued bytes drain. */
export function clearSyncBackpressure(
  socket: ServerWebSocket<SyncSocketData>,
): void {
  socket.data.syncBackpressured = false;
}
