/**
 * sync-subscribe-handler.ts
 *
 * Owns epoch/scope-aware reconnect selection between incremental catchup and
 * authoritative cache replacement. It never mutates application data.
 */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import type { ReactiveDB } from './reactive-db';
import { sendSyncSnapshot } from './sync-snapshot-response';
import { selectSyncSubscription } from './sync-subscription-selection';
import { sendSyncWire } from './sync-wire-send';
import type {
  SyncCatchupMessage,
  SyncSocketData,
  SyncSubscribeMessage,
} from './types';

/** Handle one validated sync.subscribe request. */
export function handleSyncSubscribe(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncSubscribeMessage,
  db: ReactiveDB,
  snapshotTables?: Set<string>,
): void {
  if (!validSubscribe(message)) return;
  const selection = selectSyncSubscription(socket, message, db, snapshotTables);
  const hasPriorCursor = message.epoch !== undefined || message.lastSeq > 0;
  const scopeMatches = typeof message.scope === 'string'
    && message.scope === socket.data.authorizationScope;
  const scopeChanged = hasPriorCursor && !scopeMatches;
  const epochMatches = message.epoch === db.syncEpoch;

  if (!epochMatches || scopeChanged || message.lastSeq > db.currentSeq) {
    sendSyncSnapshot(
      socket,
      selection.snapshot,
      db,
      scopeChanged ? 'purge' : 'preserve-pending',
    );
    return;
  }

  const changes = db.getChangesAfter(message.lastSeq);
  if (changes === null
    || (changes.length > 0 && changes[0].seq > message.lastSeq + 1)) {
    sendSyncSnapshot(socket, selection.snapshot, db, 'preserve-pending');
    return;
  }

  const projected = changes
    .filter((change) => selection.subscribed.includes(change.table))
    .map((change) => projectSyncChange(
      change,
      socket.data.resourceRowFilters.get(change.table),
    ))
    .filter((change): change is NonNullable<typeof change> => Boolean(change))
    .map((change) => ({ ...change, origin: '' }));
  const response: SyncCatchupMessage = {
    type: 'sync.catchup',
    changes: projected,
    seq: db.currentSeq,
    prevSeq: message.lastSeq,
    epoch: db.syncEpoch,
    scope: socket.data.authorizationScope,
  };
  if (sendSyncWire(socket, response)) socket.data.lastSeq = db.currentSeq;
}

function validSubscribe(message: SyncSubscribeMessage): boolean {
  return Array.isArray(message.tables)
    && Number.isSafeInteger(message.lastSeq)
    && message.lastSeq >= 0
    && (message.snapshot === undefined || Array.isArray(message.snapshot))
    && (message.epoch === undefined || typeof message.epoch === 'string')
    && (message.scope === undefined || message.scope === null
      || typeof message.scope === 'string');
}
