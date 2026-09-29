/**
 * sync-stream-guard.ts
 *
 * Validates server epoch, authorization scope, and projected sequence
 * continuity before a Sync message can mutate the client cache.
 */

import type {
  SyncCatchupMessage,
  SyncChangeMessage,
  SyncDataPlaneName,
  SyncSnapshotMessage,
} from '../types';
import {
  getSyncPlaneCursor,
  type SyncStoreContext,
} from './sync-store';
import {
  messageSyncDataPlane,
  syncDataPlaneForTable,
} from './sync-data-planes';

type StreamMessage = SyncSnapshotMessage | SyncChangeMessage | SyncCatchupMessage;

/** Return false when the socket must reconnect from its last accepted cursor. */
export function acceptSyncStreamMessage(
  context: SyncStoreContext,
  message: StreamMessage,
  tablePlanes?: Readonly<Record<string, SyncDataPlaneName>>,
): boolean {
  const plane = messageSyncDataPlane(message);
  if (plane === null) return false;
  if (tablePlanes && !messageTablesMatchPlane(message, tablePlanes, plane)) {
    return false;
  }
  if (!validSeq(message.seq)) return false;
  if (message.type === 'sync.snapshot') {
    return acceptSnapshot(context, message, plane);
  }
  if (message.epoch === undefined && message.prevSeq === undefined) return true;
  const cursor = getSyncPlaneCursor(context._sync, plane);
  if (!sameStream(context, message, plane)) return false;
  if (!validSeq(message.prevSeq) || message.prevSeq !== cursor.lastSeq) {
    return false;
  }
  if (message.type === 'sync.change') return message.seq > message.prevSeq;
  if (message.seq < message.prevSeq) return false;
  let previous = message.prevSeq;
  for (const change of message.changes) {
    if (!validSeq(change.seq) || change.seq <= previous || change.seq > message.seq) {
      return false;
    }
    previous = change.seq;
  }
  return true;
}

function acceptSnapshot(
  context: SyncStoreContext,
  message: SyncSnapshotMessage,
  plane: SyncDataPlaneName,
): boolean {
  if (message.epoch === undefined) return true;
  const cursor = getSyncPlaneCursor(context._sync, plane);
  const epochChanged = cursor.epoch !== null
    && cursor.epoch !== message.epoch;
  const scopeChanged = message.scope !== undefined
    && cursor.scope !== null
    && cursor.scope !== message.scope;
  if ((epochChanged || scopeChanged) && message.reset === undefined) return false;
  return message.reset !== undefined || message.seq >= cursor.lastSeq;
}

function sameStream(
  context: SyncStoreContext,
  message: Exclude<StreamMessage, SyncSnapshotMessage>,
  plane: SyncDataPlaneName,
): boolean {
  const cursor = getSyncPlaneCursor(context._sync, plane);
  return typeof message.epoch === 'string'
    && cursor.epoch === message.epoch
    && message.scope !== undefined
    && cursor.scope === message.scope;
}

function messageTablesMatchPlane(
  message: StreamMessage,
  tablePlanes: Readonly<Record<string, SyncDataPlaneName>>,
  plane: SyncDataPlaneName,
): boolean {
  if (message.type === 'sync.snapshot') {
    return Object.keys(message.tables).every(
      (table) => syncDataPlaneForTable(tablePlanes, table) === plane,
    );
  }
  if (message.type === 'sync.change') {
    return syncDataPlaneForTable(tablePlanes, message.table) === plane;
  }
  return message.changes.every(
    (change) => syncDataPlaneForTable(tablePlanes, change.table) === plane,
  );
}

function validSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
