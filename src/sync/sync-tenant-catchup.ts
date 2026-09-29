/** Bounded reconnect catch-up transfer for one actor-backed tenant plane. */

import type { ServerWebSocket } from 'bun';
import { projectSyncChange } from './row-filter';
import type {
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneReplay,
} from './sync-tenant-data-plane-contract';
import { validateTenantReplayPage } from './sync-tenant-replay-validation';
import { sendSyncWire } from './sync-wire-send';
import type {
  Change,
  SyncCatchupMessage,
  SyncSocketData,
  SyncSubscribeMessage,
} from './types';

interface SendTenantCatchupOptions {
  readonly socket: ServerWebSocket<SyncSocketData>;
  readonly binding: SyncTenantDataPlaneBinding;
  readonly message: SyncSubscribeMessage;
  readonly subscribed: readonly string[];
  readonly replayLimit: number;
  readonly maxWireBytes: number;
  readonly isCurrent: () => boolean;
  readonly assertCurrentReadAuthoritySync: () => undefined;
  readonly acceptIdentity: (replay: SyncTenantDataPlaneReplay) => void;
}

export type SyncTenantCatchupResult =
  | Readonly<{ status: 'sent'; head: number }>
  | Readonly<{ status: 'snapshot' | 'failed' }>;

const encoder = new TextEncoder();

/**
 * Attempt one bounded reconnect replay. Oversized or deep history deliberately
 * returns `snapshot`; stale subscription work returns `failed` without writing.
 */
export async function sendTenantCatchup(
  options: SendTenantCatchupOptions,
): Promise<SyncTenantCatchupResult> {
  let cursor = options.message.lastSeq;
  let head = options.message.lastSeq;
  let epoch = options.message.epoch;
  const changes: SyncCatchupMessage['changes'] = [];

  for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
    const replay = await options.binding.replay(cursor, options.replayLimit);
    if (!options.isCurrent()) return { status: 'failed' };
    options.assertCurrentReadAuthoritySync();
    if (replay.syncEpoch !== options.message.epoch) return { status: 'snapshot' };
    options.acceptIdentity(replay);
    validateTenantReplayPage(replay, cursor);
    head = replay.sequence.seq;
    epoch = replay.syncEpoch;

    for (const change of replay.value.changes) {
      cursor = change.seq;
      if (!options.subscribed.includes(change.table)) continue;
      const projected = projectSyncChange(
        change as Change,
        options.socket.data.resourceRowFilters.get(change.table),
        options.socket.data.resourceRowProjectors?.get(change.table),
      );
      if (projected) changes.push({ ...projected, origin: '' });
    }
    if (encodedBytes(changes) > options.maxWireBytes) {
      return { status: 'snapshot' };
    }
    if (replay.value.nextAfterSeq === null) break;
    if (pageIndex === 7) return { status: 'snapshot' };
  }

  const response: SyncCatchupMessage = {
    type: 'sync.catchup',
    plane: 'tenant',
    changes,
    seq: head,
    prevSeq: options.message.lastSeq,
    epoch,
    scope: options.socket.data.authorizationScope,
  };
  if (encodedBytes(response) > options.maxWireBytes) {
    return { status: 'snapshot' };
  }
  options.assertCurrentReadAuthoritySync();
  if (!sendSyncWire(options.socket, response)) return { status: 'failed' };
  return Object.freeze({ status: 'sent', head });
}

function encodedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
