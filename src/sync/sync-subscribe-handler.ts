/**
 * sync-subscribe-handler.ts
 *
 * Owns epoch/scope-aware reconnect selection between incremental catchup and
 * authoritative cache replacement. It never mutates application data.
 */

import type { ServerWebSocket } from 'bun';
import type { PlatformObservabilityRuntime } from '../observability/types';
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
export async function handleSyncSubscribe(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncSubscribeMessage,
  db: ReactiveDB,
  snapshotTables?: Set<string>,
  observability?: PlatformObservabilityRuntime | null,
  assertCurrentAuthority: () => void = () => undefined,
): Promise<void> {
  if (!validSubscribe(message)) return;
  assertCurrentAuthority();
  const selection = selectSyncSubscription(socket, message, db, snapshotTables);
  const hasPriorCursor = message.epoch !== undefined || message.lastSeq > 0;
  const scopeMatches = typeof message.scope === 'string'
    && message.scope === socket.data.authorizationScope;
  const scopeChanged = hasPriorCursor && !scopeMatches;
  const epochMatches = message.epoch === db.syncEpoch;

  if (!epochMatches || scopeChanged || message.lastSeq > db.currentSeq) {
    await sendSyncSnapshot(
      socket,
      selection.snapshot,
      db,
      scopeChanged ? 'purge' : 'preserve-pending',
      observability,
      assertCurrentAuthority,
    );
    return;
  }

  const replay = db.readAtCurrentSequence(() => db.getChangesAfter(message.lastSeq));
  const changes = replay.value;
  if (changes === null
    || (changes.length > 0 && changes[0].seq > message.lastSeq + 1)) {
    await sendSyncSnapshot(
      socket,
      selection.snapshot,
      db,
      'preserve-pending',
      observability,
      assertCurrentAuthority,
    );
    return;
  }

  const projected = changes
    .filter((change) => selection.subscribed.includes(change.table))
    .map((change) => projectSyncChange(
      change,
      socket.data.resourceRowFilters.get(change.table),
      socket.data.resourceRowProjectors?.get(change.table),
    ))
    .filter((change): change is NonNullable<typeof change> => Boolean(change))
    .map((change) => ({ ...change, origin: '' }));
  const response: SyncCatchupMessage = {
    type: 'sync.catchup',
    ...(socket.data.syncMultiplexed ? { plane: 'default' as const } : {}),
    changes: projected,
    seq: replay.seq,
    prevSeq: message.lastSeq,
    epoch: db.syncEpoch,
    scope: socket.data.authorizationScope,
  };
  assertCurrentAuthority();
  if (sendSyncWire(socket, response)) socket.data.lastSeq = replay.seq;
}

function validSubscribe(message: SyncSubscribeMessage): boolean {
  return Array.isArray(message.tables)
    && Number.isSafeInteger(message.lastSeq)
    && message.lastSeq >= 0
    && (message.snapshot === undefined || Array.isArray(message.snapshot))
    && (message.epoch === undefined || typeof message.epoch === 'string')
    && (message.scope === undefined || message.scope === null
      || typeof message.scope === 'string')
    && validCursors(message.cursors);
}

function validCursors(value: SyncSubscribeMessage['cursors']): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(
    (key) => key !== 'default' && key !== 'system' && key !== 'tenant',
  )) {
    return false;
  }
  return Object.values(value).every((cursor) => cursor === undefined || (
    cursor !== null
    && typeof cursor === 'object'
    && Number.isSafeInteger(cursor.lastSeq)
    && cursor.lastSeq >= 0
    && (cursor.epoch === undefined || typeof cursor.epoch === 'string')
    && (cursor.scope === undefined || cursor.scope === null
      || typeof cursor.scope === 'string')
  ));
}
