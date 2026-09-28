/** Complete the post-open auth handshake before sync data can flow. */

import type { ClientTableDef } from '../types';
import type { SyncStoreContext } from './sync-store';

interface SyncHandshakeInput {
  socket: WebSocket;
  store: {
    send: (event: { type: 'sync.connected' }) => void;
    getSnapshot: () => { context: unknown };
  };
  tables: Record<string, ClientTableDef>;
  stateSync: boolean;
}

export function finishSyncSocketHandshake(input: SyncHandshakeInput): void {
  input.store.send({ type: 'sync.connected' });
  const context = input.store.getSnapshot().context as SyncStoreContext;
  const tableNames = Object.keys(input.tables);
  input.socket.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: tableNames,
    snapshot: tableNames.filter((name) => input.tables[name]._sync !== 'lazy'),
    lastSeq: context._sync.lastSeq,
    ...(context._sync.epoch ? { epoch: context._sync.epoch } : {}),
    ...(context._sync.scope !== null ? { scope: context._sync.scope } : {}),
  }));
  if (input.stateSync) {
    input.socket.send(JSON.stringify({ type: 'state.subscribe' }));
  }
}
