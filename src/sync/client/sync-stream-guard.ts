/**
 * sync-stream-guard.ts
 *
 * Validates server epoch, authorization scope, and projected sequence
 * continuity before a Sync message can mutate the client cache.
 */

import type {
  SyncCatchupMessage,
  SyncChangeMessage,
  SyncSnapshotMessage,
} from '../types';
import type { SyncStoreContext } from './sync-store';

type StreamMessage = SyncSnapshotMessage | SyncChangeMessage | SyncCatchupMessage;

/** Return false when the socket must reconnect from its last accepted cursor. */
export function acceptSyncStreamMessage(
  context: SyncStoreContext,
  message: StreamMessage,
): boolean {
  if (!validSeq(message.seq)) return false;
  if (message.type === 'sync.snapshot') return acceptSnapshot(context, message);
  if (message.epoch === undefined && message.prevSeq === undefined) return true;
  if (!sameStream(context, message)) return false;
  if (!validSeq(message.prevSeq) || message.prevSeq !== context._sync.lastSeq) {
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
): boolean {
  if (message.epoch === undefined) return true;
  const epochChanged = context._sync.epoch !== null
    && context._sync.epoch !== message.epoch;
  const scopeChanged = message.scope !== undefined
    && context._sync.scope !== null
    && context._sync.scope !== message.scope;
  if ((epochChanged || scopeChanged) && message.reset === undefined) return false;
  return message.reset !== undefined || message.seq >= context._sync.lastSeq;
}

function sameStream(
  context: SyncStoreContext,
  message: Exclude<StreamMessage, SyncSnapshotMessage>,
): boolean {
  return typeof message.epoch === 'string'
    && context._sync.epoch === message.epoch
    && message.scope !== undefined
    && context._sync.scope === message.scope;
}

function validSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
