import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { sendSyncWire } from './sync-wire-send';
import type { SyncSocketData } from './types';

function fake(status: number) {
  const closed: unknown[][] = [];
  const socket = {
    data: { syncBackpressured: false },
    send: () => status,
    close: (...args: unknown[]) => { closed.push(args); },
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { socket, closed };
}

describe('sendSyncWire', () => {
  test('closes immediately when Bun drops an outbound message', () => {
    const target = fake(0);
    expect(sendSyncWire(target.socket, {
      type: 'sync.catchup', changes: [], seq: 1,
    })).toBe(false);
    expect(target.closed).toEqual([[1013, 'Sync delivery interrupted']]);
  });

  test('tracks a queued backpressured message for the drain callback', () => {
    const target = fake(-1);
    expect(sendSyncWire(target.socket, {
      type: 'sync.catchup', changes: [], seq: 1,
    })).toBe(true);
    expect(target.socket.data.syncBackpressured).toBe(true);
    expect(target.closed).toEqual([]);
  });
});
