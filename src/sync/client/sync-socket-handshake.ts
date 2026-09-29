/** Complete the post-open auth handshake before sync data can flow. */

import type {
  ClientTableDef,
  SyncDataPlaneName,
  SyncSubscribeMessage,
} from '../types';
import { getSyncPlaneCursor, type SyncStoreContext } from './sync-store';

interface SyncHandshakeInput {
  socket: WebSocket;
  store: {
    send: (event: { type: 'sync.connected' }) => void;
    getSnapshot: () => { context: unknown };
  };
  tables: Record<string, ClientTableDef>;
  expectedPlanes: ReadonlySet<SyncDataPlaneName>;
  stateSync: boolean;
}

export function finishSyncSocketHandshake(input: SyncHandshakeInput): void {
  input.store.send({ type: 'sync.connected' });
  const context = input.store.getSnapshot().context as SyncStoreContext;
  const tableNames = Object.keys(input.tables);
  const defaultCursor = getSyncPlaneCursor(context._sync, 'default');
  const cursors = Object.fromEntries(
    [...input.expectedPlanes].map((plane) => {
      const cursor = getSyncPlaneCursor(context._sync, plane);
      return [plane, {
        lastSeq: cursor.lastSeq,
        ...(cursor.epoch ? { epoch: cursor.epoch } : {}),
        ...(cursor.scope !== null ? { scope: cursor.scope } : {}),
      }];
    }),
  ) as SyncSubscribeMessage['cursors'];
  const subscribe: SyncSubscribeMessage = {
    type: 'sync.subscribe',
    tables: tableNames,
    snapshot: tableNames.filter((name) => input.tables[name]._sync !== 'lazy'),
    lastSeq: defaultCursor.lastSeq,
    ...(defaultCursor.epoch ? { epoch: defaultCursor.epoch } : {}),
    ...(defaultCursor.scope !== null ? { scope: defaultCursor.scope } : {}),
    ...(input.expectedPlanes.size > 0 ? { cursors } : {}),
  };
  input.socket.send(JSON.stringify(subscribe));
  if (input.stateSync) {
    input.socket.send(JSON.stringify({ type: 'state.subscribe' }));
  }
}
