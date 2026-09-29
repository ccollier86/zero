/**
 * sync-wire-send.ts
 *
 * Owns direct Sync protocol delivery and Bun send-status handling.
 */

import type { ServerWebSocket } from 'bun';
import type { ServerMessage, SyncSocketData } from './types';

interface SyncDrainWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const drainWaiters = new WeakMap<
  ServerWebSocket<SyncSocketData>,
  Set<SyncDrainWaiter>
>();

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
  const waiters = drainWaiters.get(socket);
  if (!waiters) return;
  drainWaiters.delete(socket);
  for (const waiter of waiters) waiter.resolve();
}

/** Pause a multi-frame transfer until Bun reports this raw socket writable. */
export function waitForSyncDrain(
  socket: ServerWebSocket<SyncSocketData>,
): Promise<void> {
  if (!socket.data.syncBackpressured) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let waiters = drainWaiters.get(socket);
    if (!waiters) {
      waiters = new Set();
      drainWaiters.set(socket, waiters);
    }
    waiters.add({ resolve, reject });
  });
}

/** Reject all pending transfer waits when the stable raw socket closes. */
export function rejectSyncDrain(
  socket: ServerWebSocket<SyncSocketData>,
): void {
  const waiters = drainWaiters.get(socket);
  if (!waiters) return;
  drainWaiters.delete(socket);
  const error = new Error('Sync socket closed while awaiting outbound drain.');
  for (const waiter of waiters) waiter.reject(error);
}
